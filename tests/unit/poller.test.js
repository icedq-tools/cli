import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pollTask } from '../../src/core/poller.js';
import { PollTimeoutError } from '../../src/core/errors.js';

function fakeClient(responses) {
  let i = 0;
  return {
    get: async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    }
  };
}

describe('pollTask', () => {
  test('returns on terminal Completed status', async () => {
    const client = fakeClient([
      { taskStatus: 'Submitted' },
      { taskStatus: 'Running' },
      { taskStatus: 'Completed' }
    ]);
    const out = await pollTask(client, 'imports', 'tins-1', {
      timeoutSec: 60,
      sleep: async () => {},
      now: ((t = 0) => () => (t += 100))()
    });
    assert.equal(out.status, 'Completed');
    assert.equal(out.attempts, 3);
  });

  test('returns on Error', async () => {
    const client = fakeClient([{ taskStatus: 'Error' }]);
    const out = await pollTask(client, 'exports', 'tins-2', {
      timeoutSec: 60,
      sleep: async () => {},
      now: ((t = 0) => () => (t += 100))()
    });
    assert.equal(out.status, 'Error');
  });

  test('returns on Terminated', async () => {
    const client = fakeClient([{ taskStatus: 'Terminated' }]);
    const out = await pollTask(client, 'exports', 'tins-3', {
      timeoutSec: 60,
      sleep: async () => {},
      now: ((t = 0) => () => (t += 100))()
    });
    assert.equal(out.status, 'Terminated');
  });

  test('throws PollTimeoutError when timeout exceeded', async () => {
    const client = fakeClient([{ taskStatus: 'Running' }]);
    let nowVal = 0;
    await assert.rejects(
      () =>
        pollTask(client, 'imports', 'tins-4', {
          timeoutSec: 1,
          sleep: async () => {},
          now: () => {
            nowVal += 600;
            return nowVal;
          }
        }),
      (err) => err instanceof PollTimeoutError
    );
  });

  test('rejects unknown kind', async () => {
    await assert.rejects(() => pollTask({}, 'foo', 'tins'), /kind must be/);
  });

  test('reports attempts via onTick', async () => {
    const ticks = [];
    const client = fakeClient([
      { taskStatus: 'Running' },
      { taskStatus: 'Running' },
      { taskStatus: 'Completed' }
    ]);
    await pollTask(client, 'imports', 'tins-5', {
      timeoutSec: 60,
      sleep: async () => {},
      now: ((t = 0) => () => (t += 100))(),
      onTick: (info) => ticks.push(info.status)
    });
    assert.deepEqual(ticks, ['Running', 'Running', 'Completed']);
  });
});
