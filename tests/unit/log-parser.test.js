import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportLog } from '../../src/lib/log-parser.js';

describe('parseImportLog', () => {
  test('handles empty input', () => {
    assert.deepEqual(parseImportLog(''), { skippedCount: 0, skippedRules: [], hardErrors: [] });
    assert.deepEqual(parseImportLog(null), { skippedCount: 0, skippedRules: [], hardErrors: [] });
  });

  test('extracts skipped rule lines', () => {
    const log = [
      'Starting import',
      "Skipped rule 'Validate_Sales' - connection type mismatch",
      'INFO completed step 1',
      "Skipping workflow 'Recon_Daily': folder ancestor failed"
    ].join('\n');
    const r = parseImportLog(log);
    assert.equal(r.skippedCount, 2);
    assert.equal(r.skippedRules[0].name, 'Validate_Sales');
    assert.match(r.skippedRules[0].reason, /type mismatch/);
    assert.equal(r.skippedRules[1].name, 'Recon_Daily');
  });

  test('extracts ERROR lines as hard errors', () => {
    const log = ['INFO ok', 'ERROR: connection lookup failed', 'FATAL system fault'].join('\n');
    const r = parseImportLog(log);
    assert.equal(r.skippedCount, 0);
    assert.equal(r.hardErrors.length, 2);
    assert.match(r.hardErrors[0], /connection lookup/);
  });

  test('deduplicates identical skips', () => {
    const log = [
      "Skipped rule 'Foo' - bar",
      "Skipped rule 'Foo' - bar",
      "Skipped rule 'Foo' - bar"
    ].join('\n');
    const r = parseImportLog(log);
    assert.equal(r.skippedCount, 1);
  });

  test('classifies non-matching lines as neither skip nor error', () => {
    const r = parseImportLog('Just a normal log line\nProgress: 50%');
    assert.equal(r.skippedCount, 0);
    assert.equal(r.hardErrors.length, 0);
  });
});
