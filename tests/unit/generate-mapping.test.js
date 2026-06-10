import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runGenerateMapping } from '../../src/commands/generate-mapping.js';

// ── stub server helpers ───────────────────────────────────────────────────────

function startStubServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const EXPECTED_MAPPING_RESP = {
  connections: [{ id: 'conn-src-001', name: 'Oracle-test', connectorId: 'oracle' }],
  parameters: [{ id: 'parm-src-001', name: 'Param_A', folderPath: '/folder' }],
  customFields: ['test_field_one', 'test_field_two']
};

const CONNECTIONS_SEARCH_RESP = {
  pageable: { pageNo: 1, pageSize: 1000, pages: 1, size: 1 },
  items: [{ id: 'conn-tgt-001', name: 'Oracle-test', connectorId: 'oracle' }]
};

const PARAMETERS_SEARCH_RESP = {
  pageable: { pageNo: 1, pageSize: 1000, pages: 1, size: 1 },
  items: [{ id: 'parm-tgt-001', name: 'Param_A' }]
};

const SCREENS_RESP = [
  {
    id: 'scrn-001',
    screenType: 'rule',
    info: {
      sections: [
        {
          id: 'scrns-001',
          fields: [
            { id: 'fild-001', name: 'test_field_one' },
            { id: 'fild-002', name: 'test_field_two' }
          ]
        }
      ]
    }
  },
  {
    id: 'scrn-002',
    screenType: 'check',
    info: { sections: [] }
  }
];

// ── base opts factory ─────────────────────────────────────────────────────────

function makeOpts(baseUrl, bundlePath, outputFile) {
  return {
    bundle: bundlePath,
    outputFile,
    icedqUrl: baseUrl,
    keycloakUrl: `${baseUrl}/realms/test`,
    clientId: 'cid',
    clientSecret: 'sec',
    orgId: 'org-1',
    accountId: 'acct-1',
    workspaceId: 'wksc-1',
    output: 'json'
  };
}

// Stub token endpoint so all tests can authenticate
function handleAuth(req, res, body) {
  if (req.url.includes('/protocol/openid-connect/token')) {
    json(res, 200, { access_token: 'test-token', expires_in: 300 });
    return true;
  }
  return false;
}

// ── setup: create a dummy bundle zip ─────────────────────────────────────────

let tmpDir;
let bundlePath;

before(async () => {
  tmpDir = path.join(tmpdir(), `icedq-gm-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  bundlePath = path.join(tmpDir, 'bundle.zip');
  // Write a minimal non-empty file as the "bundle" — content doesn't matter for unit tests
  await writeFile(bundlePath, Buffer.from('PK\x03\x04'), 'binary');
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('runGenerateMapping', () => {
  test('happy path — all types matched, correct mapping JSON written', async () => {
    const outputFile = path.join(tmpDir, 'mapping-happy.json');

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        return json(res, 200, EXPECTED_MAPPING_RESP);
      }
      if (req.url.includes('/api/v1/connections/search')) {
        return json(res, 200, CONNECTIONS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/parameters/search')) {
        return json(res, 200, PARAMETERS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/screens/default/search')) {
        return json(res, 200, SCREENS_RESP);
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile));
      const result = JSON.parse(await readFile(outputFile, 'utf8'));

      assert.equal(result.useFqn, true);
      assert.equal(result.mapping.connections.length, 1);
      assert.deepEqual(result.mapping.connections[0], {
        existingId: 'conn-src-001',
        newId: 'conn-tgt-001',
        action: 'override'
      });
      assert.equal(result.mapping.parameters.length, 1);
      assert.deepEqual(result.mapping.parameters[0], {
        existingId: 'parm-src-001',
        newId: 'parm-tgt-001',
        action: 'upsert'
      });
      assert.equal(result.mapping.customFields.length, 2);
      assert.deepEqual(result.mapping.customFields[0], {
        existingId: 'test_field_one',
        newId: 'fild-001',
        action: 'override'
      });
    } finally {
      server.close();
    }
  });

  test('connection ResultsNotFound → throws CliError', async () => {
    const outputFile = path.join(tmpDir, 'mapping-conn-notfound.json');

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        return json(res, 200, EXPECTED_MAPPING_RESP);
      }
      if (req.url.includes('/api/v1/connections/search')) {
        return json(res, 200, { code: 'ResultsNotFound', message: 'Connection not found' });
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await assert.rejects(
        () => runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile)),
        (err) => {
          assert.ok(err.message.includes('ResultsNotFound') || err.message.includes('not found'));
          return true;
        }
      );
    } finally {
      server.close();
    }
  });

  test('connection found but no name match → throws CliError', async () => {
    const outputFile = path.join(tmpDir, 'mapping-conn-nomatch.json');

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        return json(res, 200, EXPECTED_MAPPING_RESP);
      }
      if (req.url.includes('/api/v1/connections/search')) {
        return json(res, 200, {
          pageable: { pageNo: 1, pageSize: 1000, pages: 1, size: 1 },
          items: [{ id: 'conn-tgt-999', name: 'DifferentConnection', connectorId: 'oracle' }]
        });
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await assert.rejects(
        () => runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile)),
        (err) => {
          assert.ok(err.message.includes('Oracle-test'));
          return true;
        }
      );
    } finally {
      server.close();
    }
  });

  test('connection pagination — match found on page 2', async () => {
    const outputFile = path.join(tmpDir, 'mapping-conn-paginate.json');
    const pageRequests = [];

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        return json(res, 200, EXPECTED_MAPPING_RESP);
      }
      if (req.url.includes('/api/v1/connections/search')) {
        const pageNo = Number(new URL(req.url, baseUrl).searchParams.get('pageNo'));
        pageRequests.push(pageNo);
        if (pageNo === 1) {
          return json(res, 200, {
            pageable: { pageNo: 1, pageSize: 1000, pages: 2, size: 1 },
            items: [{ id: 'conn-tgt-p1', name: 'OtherConn', connectorId: 'oracle' }]
          });
        }
        return json(res, 200, {
          pageable: { pageNo: 2, pageSize: 1000, pages: 2, size: 1 },
          items: [{ id: 'conn-tgt-001', name: 'Oracle-test', connectorId: 'oracle' }]
        });
      }
      if (req.url.includes('/api/v1/parameters/search')) {
        return json(res, 200, PARAMETERS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/screens/default/search')) {
        return json(res, 200, SCREENS_RESP);
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile));
      assert.deepEqual(pageRequests, [1, 2]);
      const result = JSON.parse(await readFile(outputFile, 'utf8'));
      assert.equal(result.mapping.connections[0].newId, 'conn-tgt-001');
    } finally {
      server.close();
    }
  });

  test('parameters ResultsNotFound → entries written without newId', async () => {
    const outputFile = path.join(tmpDir, 'mapping-param-notfound.json');

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        return json(res, 200, EXPECTED_MAPPING_RESP);
      }
      if (req.url.includes('/api/v1/connections/search')) {
        return json(res, 200, CONNECTIONS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/parameters/search')) {
        return json(res, 200, { code: 'ResultsNotFound', message: 'Parameter not found' });
      }
      if (req.url.includes('/api/v1/screens/default/search')) {
        return json(res, 200, SCREENS_RESP);
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile));
      const result = JSON.parse(await readFile(outputFile, 'utf8'));
      assert.equal(result.mapping.parameters.length, 1);
      assert.deepEqual(result.mapping.parameters[0], { existingId: 'parm-src-001', action: 'upsert' });
      assert.equal('newId' in result.mapping.parameters[0], false);
    } finally {
      server.close();
    }
  });

  test('custom field not found in screens → skipped, others still written', async () => {
    const outputFile = path.join(tmpDir, 'mapping-cf-missing.json');

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        return json(res, 200, {
          ...EXPECTED_MAPPING_RESP,
          customFields: ['test_field_one', 'nonexistent_field']
        });
      }
      if (req.url.includes('/api/v1/connections/search')) {
        return json(res, 200, CONNECTIONS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/parameters/search')) {
        return json(res, 200, PARAMETERS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/screens/default/search')) {
        return json(res, 200, SCREENS_RESP);
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile));
      const result = JSON.parse(await readFile(outputFile, 'utf8'));
      // nonexistent_field is skipped; test_field_one is mapped
      assert.equal(result.mapping.customFields.length, 1);
      assert.equal(result.mapping.customFields[0].existingId, 'test_field_one');
      assert.equal(result.mapping.customFields[0].newId, 'fild-001');
    } finally {
      server.close();
    }
  });

  test('custom field matched in info.sections[0].fields[] → newId = field.id', async () => {
    const outputFile = path.join(tmpDir, 'mapping-cf-nested.json');

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        return json(res, 200, { ...EXPECTED_MAPPING_RESP, customFields: ['deep_field'] });
      }
      if (req.url.includes('/api/v1/connections/search')) {
        return json(res, 200, CONNECTIONS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/parameters/search')) {
        return json(res, 200, PARAMETERS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/screens/default/search')) {
        return json(res, 200, [
          {
            id: 'scrn-001',
            screenType: 'rule',
            info: {
              sections: [
                { id: 's1', fields: [{ id: 'fild-deep-001', name: 'deep_field' }] }
              ]
            }
          }
        ]);
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile));
      const result = JSON.parse(await readFile(outputFile, 'utf8'));
      assert.equal(result.mapping.customFields[0].newId, 'fild-deep-001');
    } finally {
      server.close();
    }
  });

  test('connection name match is case-insensitive', async () => {
    const outputFile = path.join(tmpDir, 'mapping-case.json');

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        // Source has uppercase name
        return json(res, 200, {
          ...EXPECTED_MAPPING_RESP,
          connections: [{ id: 'conn-src-001', name: 'ORACLE-TEST', connectorId: 'oracle' }]
        });
      }
      if (req.url.includes('/api/v1/connections/search')) {
        // Target has lowercase name
        return json(res, 200, {
          pageable: { pageNo: 1, pageSize: 1000, pages: 1, size: 1 },
          items: [{ id: 'conn-tgt-001', name: 'oracle-test', connectorId: 'oracle' }]
        });
      }
      if (req.url.includes('/api/v1/parameters/search')) {
        return json(res, 200, PARAMETERS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/screens/default/search')) {
        return json(res, 200, SCREENS_RESP);
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile));
      const result = JSON.parse(await readFile(outputFile, 'utf8'));
      assert.equal(result.mapping.connections[0].newId, 'conn-tgt-001');
    } finally {
      server.close();
    }
  });

  test('multiple screens — fields from all sections flattened for matching', async () => {
    const outputFile = path.join(tmpDir, 'mapping-multi-screen.json');

    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes('/api/v1/internal/imports/mapping')) {
        return json(res, 200, {
          ...EXPECTED_MAPPING_RESP,
          customFields: ['field_from_check_screen']
        });
      }
      if (req.url.includes('/api/v1/connections/search')) {
        return json(res, 200, CONNECTIONS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/parameters/search')) {
        return json(res, 200, PARAMETERS_SEARCH_RESP);
      }
      if (req.url.includes('/api/v1/screens/default/search')) {
        return json(res, 200, [
          {
            id: 'scrn-rule',
            screenType: 'rule',
            info: { sections: [{ id: 's1', fields: [{ id: 'fild-r1', name: 'rule_field' }] }] }
          },
          {
            id: 'scrn-check',
            screenType: 'check',
            info: { sections: [{ id: 's2', fields: [{ id: 'fild-c1', name: 'field_from_check_screen' }] }] }
          }
        ]);
      }
      json(res, 404, { message: 'not found' });
    });

    try {
      await runGenerateMapping(makeOpts(baseUrl, bundlePath, outputFile));
      const result = JSON.parse(await readFile(outputFile, 'utf8'));
      assert.equal(result.mapping.customFields[0].newId, 'fild-c1');
    } finally {
      server.close();
    }
  });
});
