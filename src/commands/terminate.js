import { loadConfig } from '../core/config.js';
import { KeycloakClientCredentialsAuth } from '../core/auth.js';
import { IcedqApiClient } from '../core/client.js';
import { Reporter } from '../core/reporter.js';
import { CliError } from '../core/errors.js';
import { log, setLevel } from '../core/logger.js';

export async function runTerminate(rawOpts) {
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

  log.info('Terminating run', { id: rawOpts.id });
  const resp = await client.post(`/api/v1/workflowruns/${rawOpts.id}:terminate`, {}, { retryOn5xx: true });

  const result = {
    command: 'terminate',
    instanceId: rawOpts.id,
    code: resp.code,
    message: resp.message
  };
  new Reporter(rawOpts.outputFormat || 'text').emit(result);
}
