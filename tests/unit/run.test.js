import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runTrigger } from '../../src/commands/run.js';
import { TaskFailedError, PollTimeoutError, CliError } from '../../src/core/errors.js';

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

function makeOpts(baseUrl, extra = {}) {
  return {
    resourceType: 'workflow',
    id: 'wkfl-e6284f0a-5379-5eaf-a31a-017236bbe72a',
    icedqBaseUrl: baseUrl,
    keycloakUrl: `${baseUrl}/realms/test`,
    clientId: 'cid',
    clientSecret: 'sec',
    orgId: 'org-1',
    accountId: 'acct-1',
    workspaceId: 'wksc-1',
    outputFormat: 'json',
    timeout: '60',
    ...extra
  };
}

describe('runTrigger', () => {
  test('success path does not fetch result when --show-result is not set', async () => {
    let resultCalls = 0;
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes(':trigger')) return json(res, 200, { instanceId: '101' });
      if (req.url.endsWith('/workflowruns/101/result')) {
        resultCalls++;
        return json(res, 200, { status: 'success' });
      }
      if (req.url.endsWith('/workflowruns/101')) return json(res, 200, { instanceId: '101', status: 'success' });
      json(res, 404, { code: 'ResourceNotFound', message: 'not found' });
    });

    try {
      await runTrigger(makeOpts(baseUrl));
      assert.equal(resultCalls, 0);
    } finally {
      server.close();
    }
  });

  test('--show-result fetches the result even on success', async () => {
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes(':trigger')) return json(res, 200, { instanceId: '102' });
      if (req.url.endsWith('/workflowruns/102/result')) return json(res, 200, { status: 'success', detail: 'ok' });
      if (req.url.endsWith('/workflowruns/102')) return json(res, 200, { instanceId: '102', status: 'success' });
      json(res, 404, { code: 'ResourceNotFound', message: 'not found' });
    });

    try {
      await runTrigger(makeOpts(baseUrl, { showResult: true }));
    } finally {
      server.close();
    }
  });

  test('failure auto-fetches the result and throws TaskFailedError', async () => {
    let resultCalls = 0;
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes(':trigger')) return json(res, 200, { instanceId: '103' });
      if (req.url.endsWith('/workflowruns/103/result')) {
        resultCalls++;
        return json(res, 200, { status: 'error' });
      }
      if (req.url.endsWith('/workflowruns/103')) return json(res, 200, { instanceId: '103', status: 'error' });
      json(res, 404, { code: 'ResourceNotFound', message: 'not found' });
    });

    try {
      await assert.rejects(() => runTrigger(makeOpts(baseUrl)), TaskFailedError);
      assert.equal(resultCalls, 1);
    } finally {
      server.close();
    }
  });

  test('missing instanceId in trigger response throws CliError', async () => {
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes(':trigger')) return json(res, 200, {});
      json(res, 404, { code: 'ResourceNotFound', message: 'not found' });
    });

    try {
      await assert.rejects(() => runTrigger(makeOpts(baseUrl)), CliError);
    } finally {
      server.close();
    }
  });

  test('wrong id prefix for resourceType is rejected before any network call', async () => {
    await assert.rejects(
      () => runTrigger(makeOpts('http://127.0.0.1:1', { resourceType: 'workflow', id: 'rule-not-a-workflow' })),
      CliError
    );
    await assert.rejects(
      () => runTrigger(makeOpts('http://127.0.0.1:1', { resourceType: 'rule', id: 'wkfl-not-a-rule' })),
      CliError
    );
  });

  test('timeout without --terminate-on-timeout propagates PollTimeoutError and never calls terminate', async () => {
    let terminateCalls = 0;
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes(':trigger')) return json(res, 200, { instanceId: '104' });
      if (req.url.includes(':terminate')) {
        terminateCalls++;
        return json(res, 202, { code: 'Success', message: 'Instance termination request has been accepted.' });
      }
      json(res, 200, { instanceId: '104', status: 'running' });
    });

    try {
      await assert.rejects(() => runTrigger(makeOpts(baseUrl, { timeout: '0' })), PollTimeoutError);
      assert.equal(terminateCalls, 0);
    } finally {
      server.close();
    }
  });

  test('--terminate-on-timeout sends exactly one terminate call and still throws PollTimeoutError', async () => {
    let terminateCalls = 0;
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes(':trigger')) return json(res, 200, { instanceId: '105' });
      if (req.url.includes(':terminate')) {
        terminateCalls++;
        return json(res, 202, { code: 'Success', message: 'Instance termination request has been accepted.' });
      }
      json(res, 200, { instanceId: '105', status: 'running' });
    });

    try {
      await assert.rejects(
        () => runTrigger(makeOpts(baseUrl, { timeout: '0', terminateOnTimeout: true })),
        PollTimeoutError
      );
      assert.equal(terminateCalls, 1);
    } finally {
      server.close();
    }
  });

  test('terminate call failing during timeout still throws the original PollTimeoutError', async () => {
    const { server, baseUrl } = await startStubServer((req, res, body) => {
      if (handleAuth(req, res, body)) return;
      if (req.url.includes(':trigger')) return json(res, 200, { instanceId: '106' });
      if (req.url.includes(':terminate')) return json(res, 500, { code: 'ServerError', message: 'boom' });
      json(res, 200, { instanceId: '106', status: 'running' });
    });

    try {
      await assert.rejects(
        () => runTrigger(makeOpts(baseUrl, { timeout: '0', terminateOnTimeout: true })),
        PollTimeoutError
      );
    } finally {
      server.close();
    }
  });

  test('--sequence is rejected for rules', async () => {
    await assert.rejects(
      () =>
        runTrigger(
          makeOpts('http://127.0.0.1:1', { resourceType: 'rule', id: 'rule-77f73152-17cc-5b35-9841-13e24a4039b7', sequence: '1,2' })
        ),
      CliError
    );
  });
});
