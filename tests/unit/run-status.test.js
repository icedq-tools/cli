import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isRunTerminal, isRunSuccess } from '../../src/lib/run-status.js';

describe('isRunTerminal', () => {
  test('submitted and running are non-terminal', () => {
    assert.equal(isRunTerminal('submitted'), false);
    assert.equal(isRunTerminal('running'), false);
    assert.equal(isRunTerminal('Submitted'), false);
    assert.equal(isRunTerminal('RUNNING'), false);
  });

  test('success, warning, error, critical, blocker are terminal', () => {
    for (const s of ['success', 'warning', 'error', 'critical', 'blocker']) {
      assert.equal(isRunTerminal(s), true, `${s} should be terminal`);
    }
  });

  test('an unrecognized future status is terminal', () => {
    assert.equal(isRunTerminal('something-new'), true);
  });

  test('undefined/null are not terminal', () => {
    assert.equal(isRunTerminal(undefined), false);
    assert.equal(isRunTerminal(null), false);
  });
});

describe('isRunSuccess', () => {
  test('success and warning are success', () => {
    assert.equal(isRunSuccess('success'), true);
    assert.equal(isRunSuccess('Warning'), true);
  });

  test('error, critical, blocker are not success', () => {
    for (const s of ['error', 'critical', 'blocker', 'submitted', 'running']) {
      assert.equal(isRunSuccess(s), false, `${s} should not be success`);
    }
  });

  test('undefined/null are not success', () => {
    assert.equal(isRunSuccess(undefined), false);
    assert.equal(isRunSuccess(null), false);
  });
});
