import { loadConfig } from '../core/config.js';
import { KeycloakClientCredentialsAuth } from '../core/auth.js';
import { IcedqApiClient } from '../core/client.js';
import { Reporter } from '../core/reporter.js';
import { CliError } from '../core/errors.js';
import { log, setLevel } from '../core/logger.js';

export async function runResult(rawOpts) {
  if (rawOpts.verbose) setLevel('debug');
  if (rawOpts.quiet) setLevel('error');

  if (!rawOpts.id) throw new CliError('--id is required');

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

  log.info('Fetching run result', { id: rawOpts.id });
  const resp = await client.get(`/api/v1/workflowruns/${rawOpts.id}/result`, { retryOn5xx: true });

  const result = {
    command: 'result',
    instanceId: rawOpts.id,
    status: resp.status,
    result: resp
  };
  new Reporter(rawOpts.outputFormat || 'text').emit(result);
}
