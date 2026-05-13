import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { KeycloakClientCredentialsAuth } from '../core/auth.js';
import { IcedqApiClient } from '../core/client.js';
import { pollTask } from '../core/poller.js';
import { Reporter } from '../core/reporter.js';
import { isSuccess, STATUS } from '../lib/status-enum.js';
import { TaskFailedError, CliError } from '../core/errors.js';
import { log, setLevel } from '../core/logger.js';

const VALID_RESOURCES = new Set(['rule', 'workflow', 'folder']);

function endpointForResource(resource) {
  // Rules export uses /exports/rules; workflows + folders use /exports/workflows
  return resource === 'rule' ? 'rules' : 'workflows';
}

export async function runExport(rawOpts) {
  if (rawOpts.verbose) setLevel('debug');
  if (rawOpts.quiet) setLevel('error');

  const resource = rawOpts.resource;
  if (!VALID_RESOURCES.has(resource)) {
    throw new CliError(`--resource must be one of: rule, workflow, folder`);
  }
  if (!rawOpts.id) throw new CliError('--id is required');
  if (!rawOpts.outputFile) throw new CliError('--output-file is required');

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

  const kindEndpoint = endpointForResource(resource);
  const body = {
    objects: [
      {
        id: rawOpts.id,
        resource,
        ...(rawOpts.includeChild ? { includeChild: 'true' } : {})
      }
    ]
  };

  log.info(`Submitting export`, { resource, id: rawOpts.id, endpoint: kindEndpoint });
  const submitResp = await client.post(`/api/v1/exports/${kindEndpoint}`, body);
  const taskId = submitResp.taskInstanceId;
  if (!taskId) {
    throw new CliError(`Export submit did not return a taskInstanceId: ${JSON.stringify(submitResp)}`);
  }
  process.stderr.write(`task-id: ${taskId}\n`);

  log.info('Polling export task', { taskId, timeoutSec: cfg.timeoutSec });
  const start = Date.now();
  const { status, attempts, elapsedMs } = await pollTask(client, 'exports', taskId, {
    timeoutSec: cfg.timeoutSec,
    onTick: ({ status: s, attempt }) => log.debug('tick', { status: s, attempt })
  });

  let outputFile = rawOpts.outputFile;
  let logTail;

  if (isSuccess(status)) {
    const buffer = await client.getBinary(`/api/v1/exports/${taskId}/download`);
    outputFile = path.resolve(outputFile);
    await writeFile(outputFile, buffer);
    log.info('Export bundle written', { outputFile, bytes: buffer.length });
  } else {
    try {
      logTail = await client.get(`/api/v1/exports/${taskId}/log`);
    } catch (err) {
      log.warn('Could not retrieve task log', { error: err.message });
    }
  }

  const result = {
    command: 'export',
    taskId,
    status,
    attempts,
    durationMs: elapsedMs,
    outputFile: isSuccess(status) ? outputFile : undefined,
    elapsedSinceSubmitMs: Date.now() - start
  };
  new Reporter(rawOpts.output || 'text').emit(result);

  if (!isSuccess(status)) {
    throw new TaskFailedError(taskId, 'export', status, logTail);
  }
}
