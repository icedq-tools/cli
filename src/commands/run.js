import { loadConfig } from '../core/config.js';
import { KeycloakClientCredentialsAuth } from '../core/auth.js';
import { IcedqApiClient } from '../core/client.js';
import { pollTask } from '../core/poller.js';
import { Reporter } from '../core/reporter.js';
import { isRunTerminal, isRunSuccess } from '../lib/run-status.js';
import { assertIdPrefix } from '../lib/id-prefix.js';
import { parseOverridesFile, buildTriggerBody } from '../lib/overrides.js';
import { CliError, PollTimeoutError, TaskFailedError } from '../core/errors.js';
import { log, setLevel } from '../core/logger.js';

const OBJECT_PREFIX = { workflow: 'wkfl-', rule: 'rule-' };

export async function runTrigger(rawOpts) {
  if (rawOpts.verbose) setLevel('debug');
  if (rawOpts.quiet) setLevel('error');

  const resourceType = rawOpts.resourceType;
  if (!rawOpts.id) throw new CliError('--id is required');
  assertIdPrefix(rawOpts.id, OBJECT_PREFIX[resourceType], '--id');

  if (rawOpts.sequence !== undefined && resourceType === 'rule') {
    throw new CliError('--sequence is not valid for rules (rules have no steps)');
  }

  const overrideBlocks = rawOpts.overridesFile ? await parseOverridesFile(rawOpts.overridesFile) : [];

  const body = buildTriggerBody({
    objectId: rawOpts.id,
    resourceType,
    sequence: rawOpts.sequence,
    overrideBlocks
  });

  const cfg = loadConfig(rawOpts);
  const auth = new KeycloakClientCredentialsAuth({
    keycloakUrl: cfg.keycloakUrl,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    verifySsl: cfg.verifySsl
  });
  const client = new IcedqApiClient({
    baseUrl: cfg.icedqBaseUrl,
    orgId: cfg.orgId,
    accountId: cfg.accountId,
    workspaceId: cfg.workspaceId,
    auth,
    verifySsl: cfg.verifySsl
  });

  log.info('Triggering run', { resourceType, objectId: rawOpts.id });
  const submitResp = await client.post('/api/v1/workflow:trigger', body);
  const instanceId = submitResp.instanceId;
  if (!instanceId) {
    throw new CliError(`Trigger did not return an instanceId: ${JSON.stringify(submitResp)}`);
  }
  process.stderr.write(`instance-id: ${instanceId}\n`);

  const start = Date.now();
  let status;
  let attempts;
  let elapsedMs;
  try {
    ({ status, attempts, elapsedMs } = await pollTask(client, 'workflowruns', instanceId, {
      timeoutSec: cfg.timeoutSec,
      buildPath: (kind, id) => `/api/v1/${kind}/${id}`,
      isTerminal: isRunTerminal,
      onTick: ({ status: s, attempt, elapsedMs: e }) => log.info('Polling status', { status: s, attempt, elapsedMs: e })
    }));
  } catch (err) {
    if (err instanceof PollTimeoutError) {
      if (rawOpts.terminateOnTimeout) {
        await reportTimeoutTermination(client, instanceId, resourceType, rawOpts.outputFormat);
      } else {
        log.warn(
          `The run is likely still in progress. Check it with: icedq status ${resourceType} --id ${instanceId}` +
            ` — or cancel it with: icedq terminate ${resourceType} --id ${instanceId}`
        );
      }
    }
    throw err;
  }

  const succeeded = isRunSuccess(status);
  let resultDetail;
  if (!succeeded || rawOpts.showResult) {
    try {
      resultDetail = await client.get(`/api/v1/workflowruns/${instanceId}/result`, { retryOn5xx: true });
    } catch (err) {
      log.warn('Could not retrieve run result', { error: err.message });
    }
  }

  const result = {
    command: `run-${resourceType}`,
    instanceId,
    status,
    attempts,
    durationMs: elapsedMs,
    elapsedSinceSubmitMs: Date.now() - start,
    ...(resultDetail !== undefined ? { result: resultDetail } : {})
  };
  new Reporter(rawOpts.outputFormat || 'text').emit(result);

  if (!succeeded) {
    throw new TaskFailedError(instanceId, 'workflowruns', status);
  }
}

async function reportTimeoutTermination(client, instanceId, resourceType, outputFormat) {
  let terminateAck;
  let terminateError;
  try {
    terminateAck = await client.post(`/api/v1/workflowruns/${instanceId}:terminate`, {});
  } catch (err) {
    terminateError = err;
  }

  const result = {
    command: `run-${resourceType}`,
    instanceId,
    timedOut: true,
    terminateRequested: !!terminateAck,
    ...(terminateAck ? { terminateCode: terminateAck.code, terminateMessage: terminateAck.message } : {}),
    ...(terminateError ? { terminateError: terminateError.message } : {})
  };
  new Reporter(outputFormat || 'text').emit(result);
}
