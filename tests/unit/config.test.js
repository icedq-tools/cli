import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/core/config.js';
import { ConfigError } from '../../src/core/errors.js';

describe('loadConfig', () => {
  test('reads from flags first', () => {
    const cfg = loadConfig(
      {
        icedqUrl: 'https://app.icedq.com/',
        keycloakUrl: 'https://auth/realms/x',
        clientId: 'cid',
        clientSecret: 'sec',
        orgId: 'o',
        accountId: 'a',
        workspaceId: 'w'
      },
      {}
    );
    assert.equal(cfg.icedqUrl, 'https://app.icedq.com');
    assert.equal(cfg.clientId, 'cid');
    assert.equal(cfg.verifySsl, true);
    assert.equal(cfg.timeoutSec, 1800);
  });

  test('falls back to env vars', () => {
    const cfg = loadConfig(
      {},
      {
        ICEDQ_URL: 'https://e',
        ICEDQ_KEYCLOAK_URL: 'https://k',
        ICEDQ_CLIENT_ID: 'cid',
        ICEDQ_CLIENT_SECRET: 'sec',
        ICEDQ_ORG_ID: 'o',
        ICEDQ_ACCOUNT_ID: 'a',
        ICEDQ_WORKSPACE_ID: 'w'
      }
    );
    assert.equal(cfg.icedqUrl, 'https://e');
    assert.equal(cfg.workspaceId, 'w');
  });

  test('flag overrides env', () => {
    const cfg = loadConfig(
      { icedqUrl: 'https://flag', clientId: 'flag-cid' },
      {
        ICEDQ_URL: 'https://env',
        ICEDQ_KEYCLOAK_URL: 'https://k',
        ICEDQ_CLIENT_ID: 'env-cid',
        ICEDQ_CLIENT_SECRET: 'sec',
        ICEDQ_ORG_ID: 'o',
        ICEDQ_ACCOUNT_ID: 'a',
        ICEDQ_WORKSPACE_ID: 'w'
      }
    );
    assert.equal(cfg.icedqUrl, 'https://flag');
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
        'ICEDQ_CLIENT_ID',
        'ICEDQ_CLIENT_SECRET',
        'ICEDQ_KEYCLOAK_URL',
        'ICEDQ_ORG_ID',
        'ICEDQ_URL',
        'ICEDQ_WORKSPACE_ID'
      ]);
    }
  });

  test('does not require workspace when requireWorkspace=false', () => {
    const cfg = loadConfig(
      {
        icedqUrl: 'https://e',
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
      cfg.icedqUrl = 'changed';
    });
  });
});

function baseEnv() {
  return {
    ICEDQ_URL: 'https://e',
    ICEDQ_KEYCLOAK_URL: 'https://k',
    ICEDQ_CLIENT_ID: 'cid',
    ICEDQ_CLIENT_SECRET: 'sec',
    ICEDQ_ORG_ID: 'o',
    ICEDQ_ACCOUNT_ID: 'a',
    ICEDQ_WORKSPACE_ID: 'w'
  };
}
