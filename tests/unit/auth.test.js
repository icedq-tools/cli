import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { KeycloakClientCredentialsAuth } from '../../src/core/auth.js';
import { AuthError } from '../../src/core/errors.js';

function startStubKeycloak(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/realms/test` });
    });
  });
}

describe('KeycloakClientCredentialsAuth', () => {
  test('fetches token via client_credentials grant', async () => {
    let receivedBody = '';
    const { server, baseUrl } = await startStubKeycloak((req, res, body) => {
      receivedBody = body;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'tok-1', expires_in: 300, token_type: 'Bearer' }));
    });
    try {
      const auth = new KeycloakClientCredentialsAuth({
        keycloakUrl: baseUrl,
        clientId: 'cid',
        clientSecret: 'sec'
      });
      const t = await auth.getToken();
      assert.equal(t, 'tok-1');
      assert.match(receivedBody, /grant_type=client_credentials/);
      assert.match(receivedBody, /client_id=cid/);
      assert.match(receivedBody, /client_secret=sec/);
    } finally {
      server.close();
    }
  });

  test('caches token within expiry window', async () => {
    let calls = 0;
    const { server, baseUrl } = await startStubKeycloak((req, res) => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: `tok-${calls}`, expires_in: 300 }));
    });
    try {
      const auth = new KeycloakClientCredentialsAuth({
        keycloakUrl: baseUrl,
        clientId: 'cid',
        clientSecret: 'sec'
      });
      assert.equal(await auth.getToken(), 'tok-1');
      assert.equal(await auth.getToken(), 'tok-1');
      assert.equal(calls, 1);
    } finally {
      server.close();
    }
  });

  test('forceRefresh fetches a new token', async () => {
    let calls = 0;
    const { server, baseUrl } = await startStubKeycloak((req, res) => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: `tok-${calls}`, expires_in: 300 }));
    });
    try {
      const auth = new KeycloakClientCredentialsAuth({
        keycloakUrl: baseUrl,
        clientId: 'cid',
        clientSecret: 'sec'
      });
      await auth.getToken();
      const t2 = await auth.forceRefresh();
      assert.equal(t2, 'tok-2');
      assert.equal(calls, 2);
    } finally {
      server.close();
    }
  });

  test('throws AuthError on non-2xx', async () => {
    const { server, baseUrl } = await startStubKeycloak((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"invalid_client"}');
    });
    try {
      const auth = new KeycloakClientCredentialsAuth({
        keycloakUrl: baseUrl,
        clientId: 'cid',
        clientSecret: 'sec'
      });
      await assert.rejects(() => auth.getToken(), (err) => err instanceof AuthError);
    } finally {
      server.close();
    }
  });

  test('throws on missing access_token in response', async () => {
    const { server, baseUrl } = await startStubKeycloak((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"expires_in":300}');
    });
    try {
      const auth = new KeycloakClientCredentialsAuth({
        keycloakUrl: baseUrl,
        clientId: 'cid',
        clientSecret: 'sec'
      });
      await assert.rejects(() => auth.getToken(), /missing access_token/);
    } finally {
      server.close();
    }
  });

  test('rejects construction with missing fields', () => {
    assert.throws(
      () => new KeycloakClientCredentialsAuth({ keycloakUrl: 'x', clientId: 'cid' }),
      (err) => err instanceof AuthError
    );
  });
});
