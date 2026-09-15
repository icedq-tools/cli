import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/core/config.js';
import { ConfigError, CliError } from '../../src/core/errors.js';

describe('loadConfig', () => {
  test('reads from flags first', () => {
    const cfg = loadConfig(
      {
        icedqBaseUrl: 'https://app.icedq.com/',
        keycloakUrl: 'https://auth/realms/x',
        clientId: 'cid',
        clientSecret: 'sec',
        orgId: 'o',
        accountId: 'a',
        workspaceId: 'w'
      },
      {}
    );
    assert.equal(cfg.icedqBaseUrl, 'https://app.icedq.com');
    assert.equal(cfg.clientId, 'cid');
    assert.equal(cfg.verifySsl, true);
    assert.equal(cfg.timeoutSec, 1800);
  });

  test('falls back to env vars', () => {
    const cfg = loadConfig(
      {},
      {
        ICEDQ_BASE_URL: 'https://e',
        ICEDQ_KEYCLOAK_URL: 'https://k',
        ICEDQ_CLIENT_ID: 'cid',
        ICEDQ_CLIENT_SECRET: 'sec',
        ICEDQ_ORG_ID: 'o',
        ICEDQ_ACCOUNT_ID: 'a',
        ICEDQ_WORKSPACE_ID: 'w'
      }
    );
    assert.equal(cfg.icedqBaseUrl, 'https://e');
    assert.equal(cfg.workspaceId, 'w');
  });

  test('flag overrides env', () => {
    const cfg = loadConfig(
      { icedqBaseUrl: 'https://flag', clientId: 'flag-cid' },
      {
        ICEDQ_BASE_URL: 'https://env',
        ICEDQ_KEYCLOAK_URL: 'https://k',
        ICEDQ_CLIENT_ID: 'env-cid',
        ICEDQ_CLIENT_SECRET: 'sec',
        ICEDQ_ORG_ID: 'o',
        ICEDQ_ACCOUNT_ID: 'a',
        ICEDQ_WORKSPACE_ID: 'w'
      }
    );
    assert.equal(cfg.icedqBaseUrl, 'https://flag');
    assert.equal(cfg.clientId, 'flag-cid');
  });

  test('throws ConfigError listing ALL missing fields', () => {
    try {
      loadConfig({}, {});
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof ConfigError);
      assert.deepEqual(err.missing.sort(), [
        'ICEDQ_ACCOUNT_ID',
        'ICEDQ_BASE_URL',
        'ICEDQ_CLIENT_ID',
        'ICEDQ_CLIENT_SECRET',
        'ICEDQ_KEYCLOAK_URL',
        'ICEDQ_ORG_ID',
        'ICEDQ_WORKSPACE_ID'
      ]);
    }
  });

  test('does not require workspace when requireWorkspace=false', () => {
    const cfg = loadConfig(
      {
        icedqBaseUrl: 'https://e',
        keycloakUrl: 'https://k',
        clientId: 'cid',
        clientSecret: 'sec',
        orgId: 'o',
        accountId: 'a'
      },
      {},
      { requireWorkspace: false }
    );
    assert.equal(cfg.workspaceId, undefined);
  });

  test('parses verifySsl boolean strings', () => {
    const cfg1 = loadConfig({ verifySsl: 'false' }, baseEnv());
    assert.equal(cfg1.verifySsl, false);
    const cfg2 = loadConfig({ verifySsl: '1' }, baseEnv());
    assert.equal(cfg2.verifySsl, true);
  });

  test('returns frozen config', () => {
    const cfg = loadConfig({}, baseEnv());
    assert.throws(() => {
      cfg.icedqBaseUrl = 'changed';
    });
  });

  test('does not throw when timeout is below the recommended minimum (warns only)', () => {
    const cfg = loadConfig({ timeout: '5' }, baseEnv());
    assert.equal(cfg.timeoutSec, 5);
  });

  describe('clientSecretFile', () => {
    let tmpDir;

    before(async () => {
      tmpDir = path.join(tmpdir(), `icedq-config-test-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    test('reads and trims the secret from --client-secret-file', async () => {
      const filePath = path.join(tmpDir, 'secret.txt');
      await writeFile(filePath, '  file-secret\n', 'utf8');
      const cfg = loadConfig({ clientSecretFile: filePath }, baseEnv());
      assert.equal(cfg.clientSecret, 'file-secret');
    });

    test('--client-secret-file takes precedence over --client-secret flag and env', async () => {
      const filePath = path.join(tmpDir, 'secret2.txt');
      await writeFile(filePath, 'from-file', 'utf8');
      const cfg = loadConfig({ clientSecretFile: filePath, clientSecret: 'from-flag' }, baseEnv());
      assert.equal(cfg.clientSecret, 'from-file');
    });

    test('throws CliError when the file is empty', async () => {
      const filePath = path.join(tmpDir, 'empty.txt');
      await writeFile(filePath, '   \n', 'utf8');
      assert.throws(
        () => loadConfig({ clientSecretFile: filePath }, baseEnv()),
        (err) => err instanceof CliError && err.message.includes('empty')
      );
    });

    test('throws CliError when the file does not exist', () => {
      assert.throws(
        () => loadConfig({ clientSecretFile: path.join(tmpDir, 'missing.txt') }, baseEnv()),
        (err) => err instanceof CliError
      );
    });
  });
});

function baseEnv() {
  return {
    ICEDQ_BASE_URL: 'https://e',
    ICEDQ_KEYCLOAK_URL: 'https://k',
    ICEDQ_CLIENT_ID: 'cid',
    ICEDQ_CLIENT_SECRET: 'sec',
    ICEDQ_ORG_ID: 'o',
    ICEDQ_ACCOUNT_ID: 'a',
    ICEDQ_WORKSPACE_ID: 'w'
  };
}
