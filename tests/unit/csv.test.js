import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvLine, parseCsvRows } from '../../src/lib/csv.js';

describe('parseCsvLine', () => {
  test('splits simple comma-separated fields', () => {
    assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  });

  test('handles quoted fields with embedded commas', () => {
    assert.deepEqual(parseCsvLine('1,"1,3",foo'), ['1', '1,3', 'foo']);
  });

  test('handles doubled-quote escaping', () => {
    assert.deepEqual(parseCsvLine('a,"he said ""hi""",c'), ['a', 'he said "hi"', 'c']);
  });

  test('handles empty fields', () => {
    assert.deepEqual(parseCsvLine('a,,c'), ['a', '', 'c']);
  });
});

describe('parseCsvRows', () => {
  test('maps rows to objects keyed by lowercased header', () => {
    const rows = parseCsvRows('Block,Sequence,Type\n1,"1,3",connection\n2,,parameter\n');
    assert.deepEqual(rows, [
      { block: '1', sequence: '1,3', type: 'connection' },
      { block: '2', sequence: '', type: 'parameter' }
    ]);
  });

  test('returns an empty array for empty input', () => {
    assert.deepEqual(parseCsvRows(''), []);
  });

  test('trims trailing blank lines', () => {
    const rows = parseCsvRows('a,b\n1,2\n\n');
    assert.deepEqual(rows, [{ a: '1', b: '2' }]);
  });
});
