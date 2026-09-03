import { readFileSync } from 'node:fs';
import { ConfigError, CliError } from './errors.js';
import { log } from './logger.js';

const MIN_TIMEOUT_SEC = 30;

const FIELD_TO_ENV = {
  icedqUrl: 'ICEDQ_URL',
  keycloakUrl: 'ICEDQ_KEYCLOAK_URL',
  clientId: 'ICEDQ_CLIENT_ID',
  clientSecret: 'ICEDQ_CLIENT_SECRET',
  orgId: 'ICEDQ_ORG_ID',
  accountId: 'ICEDQ_ACCOUNT_ID',
  workspaceId: 'ICEDQ_WORKSPACE_ID',
  verifySsl: 'ICEDQ_VERIFY_SSL',
  timeout: 'ICEDQ_TIMEOUT'
};

const DEFAULT_REQUIRED = ['icedqUrl', 'keycloakUrl', 'clientId', 'clientSecret', 'orgId', 'accountId'];

function pick(opts, key, env) {
  const flag = opts[key];
  if (flag !== undefined && flag !== null && flag !== '') return flag;
  const envName = FIELD_TO_ENV[key];
  const envVal = env[envName];
  if (envVal !== undefined && envVal !== '') return envVal;
  return undefined;
}

function toBool(v, fallback) {
  if (v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase().trim();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return fallback;
}

function toInt(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function trimTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : url;
}

function readSecretFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    throw new CliError(`could not read --client-secret-file at ${filePath}: ${err.message}`, { exitCode: 2 });
  }
  if (!content) {
    throw new CliError(`--client-secret-file at ${filePath} is empty`, { exitCode: 2 });
  }
  return content;
}

export function loadConfig(opts = {}, env = process.env, { requireWorkspace = true } = {}) {
  const required = requireWorkspace ? [...DEFAULT_REQUIRED, 'workspaceId'] : DEFAULT_REQUIRED;

  const clientSecret = opts.clientSecretFile
    ? readSecretFile(opts.clientSecretFile)
    : pick(opts, 'clientSecret', env);

  const timeoutSec = toInt(pick(opts, 'timeout', env), 1800);
  if (timeoutSec < MIN_TIMEOUT_SEC) {
    log.warn(
      `--timeout of ${timeoutSec}s is below the recommended minimum of ${MIN_TIMEOUT_SEC}s — the operation may fail before it has a realistic chance to complete`
    );
  }

  const cfg = {
    icedqUrl: trimTrailingSlash(pick(opts, 'icedqUrl', env)),
    keycloakUrl: trimTrailingSlash(pick(opts, 'keycloakUrl', env)),
    clientId: pick(opts, 'clientId', env),
    clientSecret,
    orgId: pick(opts, 'orgId', env),
    accountId: pick(opts, 'accountId', env),
    workspaceId: pick(opts, 'workspaceId', env),
    verifySsl: toBool(pick(opts, 'verifySsl', env), true),
    timeoutSec
  };

  const missing = required.filter((k) => !cfg[k]);
  if (missing.length > 0) {
    throw new ConfigError(missing.map((k) => FIELD_TO_ENV[k]));
  }

  return Object.freeze(cfg);
}

export const _internal = { FIELD_TO_ENV, DEFAULT_REQUIRED, MIN_TIMEOUT_SEC };
