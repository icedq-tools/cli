import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runStatus } from '../../src/commands/status.js';
import { ApiError } from '../../src/core/errors.js';

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

function handleAuth(req, res, body) {
  if (req.url.includes('/protocol/openid-connect/token')) {
    json(res, 200, { access_token: 'test-token', expires_in: 300 });
    return true;
  }
  return false;
}

function makeOpts(baseUrl, id) {
  return {
    id,
    icedqBaseUrl: baseUrl,
    keycloakUrl: `${baseUrl}/realms/test`,
    clientId: 'cid',
    clientSecret: 'sec',
    orgId: 'org-1',
    accountId: 'acct-1',
    workspaceId: 'wksc-1',
    outputFormat: 'json'
  };
}

describe('runStatus', () => {
  test('happy path reports status without throwing on a non-success status', async () => {
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.endsWith('/workflowruns/201')) {
        return json(res, 200, { instanceId: 201, startedAt: '06/24/2024 14:47:48 UTC', status: 'running' });
      }
      json(res, 404, { code: 'ResourceNotFound', message: 'not found' });
    });

    try {
      await runStatus(makeOpts(baseUrl, '201'));
    } finally {
      server.close();
    }
  });

  test('propagates ApiError on a 404', async () => {
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      json(res, 404, { code: 'ResourceNotFound', message: 'Task Instance not found' });
    });

    try {
      await assert.rejects(() => runStatus(makeOpts(baseUrl, '999')), ApiError);
    } finally {
      server.close();
    }
  });
});
