import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { KeycloakClientCredentialsAuth } from '../core/auth.js';
import { IcedqApiClient } from '../core/client.js';
import { pollTask } from '../core/poller.js';
import { Reporter } from '../core/reporter.js';
import { parseImportLog } from '../lib/log-parser.js';
import { isSuccess } from '../lib/status-enum.js';
import { ApiError, BundleError, CliError, TaskFailedError } from '../core/errors.js';
import { log, setLevel } from '../core/logger.js';

const VALID_KINDS = new Set(['rules', 'workflows']);

export async function runImport(rawOpts) {
  if (rawOpts.verbose) setLevel('debug');
  if (rawOpts.quiet) setLevel('error');

  if (!rawOpts.bundle) throw new CliError('--bundle is required');
  if (!rawOpts.kind || !VALID_KINDS.has(rawOpts.kind)) {
    throw new CliError(`--kind must be one of: rules, workflows`);
  }
  if (!rawOpts.mappingFile) {
    throw new CliError(
      '--mapping-file is required in v0.1. Auto-mapping (`generate-mapping`) ships in v0.2.'
    );
  }

  const cfg = loadConfig(rawOpts);
  const auth = new KeycloakClientCredentialsAuth({
    keycloakUrl: cfg.keycloakUrl,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    verifySsl: cfg.verifySsl
  });
  const client = new IcedqApiClient({
    baseUrl: cfg.icedqUrl,
    orgId: cfg.orgId,
    accountId: cfg.accountId,
    workspaceId: cfg.workspaceId,
    auth,
    verifySsl: cfg.verifySsl
  });

  const bundlePath = path.resolve(rawOpts.bundle);
  const mappingPath = path.resolve(rawOpts.mappingFile);

  let bundleBuffer;
  try {
    bundleBuffer = await readFile(bundlePath);
  } catch (err) {
    throw new BundleError(`could not read bundle at ${bundlePath}: ${err.message}`);
  }

  let mappingDoc;
  try {
    const text = await readFile(mappingPath, 'utf8');
    mappingDoc = JSON.parse(text);
  } catch (err) {
    throw new CliError(`could not parse --mapping-file at ${mappingPath}: ${err.message}`);
  }

  if (mappingDoc.useFqn === undefined) {
    mappingDoc.useFqn = !!rawOpts.useFqn;
  }

  const submitParts = {
    file: {
      buffer: bundleBuffer,
      filename: path.basename(bundlePath),
      contentType: 'application/zip'
    },
    mapping: { json: mappingDoc }
  };

  const importPath = `/api/v1/imports/${rawOpts.kind}`;
  log.info('Submitting import', { kind: rawOpts.kind, bundle: bundlePath, mapping: mappingPath });

  let submitResp;
  try {
    submitResp = await client.postMultipart(importPath, submitParts);
  } catch (err) {
    if (err instanceof ApiError && err.isConstraintViolation()) {
      const result = {
        command: 'import',
        status: 'ConstraintViolation',
        hardErrors: err.messages.map(
          (m) => `${m.fieldName ? m.fieldName + ': ' : ''}${m.violation || m.message || ''}`
        )
      };
      new Reporter(rawOpts.output || 'text').emit(result);
      throw err;
    }
    if (err instanceof ApiError && err.status === 409 && rawOpts.terminateOnConflict) {
      log.warn('Active import job conflicts; locating and terminating');
      await terminateActiveImport(client);
      submitResp = await client.postMultipart(importPath, submitParts);
    } else {
      throw err;
    }
  }

  const taskId = submitResp.taskInstanceId;
  if (!taskId) throw new CliError(`Import submit did not return taskInstanceId: ${JSON.stringify(submitResp)}`);
  process.stderr.write(`task-id: ${taskId}\n`);

  const start = Date.now();
  const { status, elapsedMs, attempts } = await pollTask(client, 'imports', taskId, {
    timeoutSec: cfg.timeoutSec,
    onTick: ({ status: s, attempt }) => log.debug('tick', { status: s, attempt })
  });

  let logText = '';
  try {
    logText = await client.get(`/api/v1/imports/${taskId}/log`);
    if (typeof logText !== 'string') logText = JSON.stringify(logText);
  } catch (err) {
    log.warn('Could not retrieve import log', { error: err.message });
  }

  if (rawOpts.retainLog && logText) {
    const logPath = path.resolve(rawOpts.retainLog);
    try {
      await writeFile(logPath, logText, 'utf8');
      log.info('Import log retained', { logPath });
    } catch (err) {
      log.warn('Could not write retained log', { logPath, error: err.message });
    }
  }

  const parsed = parseImportLog(logText);
  const result = {
    command: 'import',
    taskId,
    status,
    attempts,
    durationMs: elapsedMs,
    skippedCount: parsed.skippedCount,
    skippedRules: parsed.skippedRules,
    hardErrors: parsed.hardErrors,
    elapsedSinceSubmitMs: Date.now() - start
  };
  new Reporter(rawOpts.output || 'text').emit(result);

  if (!isSuccess(status)) {
    throw new TaskFailedError(taskId, 'import', status);
  }
  if (rawOpts.strict && parsed.skippedCount > 0) {
    const e = new CliError(
      `--strict: import completed but ${parsed.skippedCount} rule(s) skipped. See log for details.`
    );
    e.exitCode = 1;
    throw e;
  }
}

async function terminateActiveImport(client) {
  const search = await client.post('/api/v1/taskruns/search', {
    filter: [
      { attribute: 'type', operator: 'In', value: 'import-rules' },
      { attribute: 'type', operator: 'In', value: 'import-workflows' }
    ]
  });
  const active = (search?.items || search?.taskRuns || []).find((r) =>
    ['Submitted', 'Running'].includes(r.taskStatus || r.status)
  );
  if (!active) {
    log.warn('No active import found to terminate');
    return;
  }
  const id = active.id || active.taskInstanceId;
  log.info('Terminating active import', { taskId: id });
  await client.post(`/api/v1/imports/${id}:terminate`, {});
}
