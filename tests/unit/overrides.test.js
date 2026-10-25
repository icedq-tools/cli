import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildTriggerBody, parseOverridesFile } from '../../src/lib/overrides.js';
import { CliError } from '../../src/core/errors.js';

const RULE_ID = 'rule-77f73152-17cc-5b35-9841-13e24a4039b7';
const WKFL_ID = 'wkfl-e6284f0a-5379-5eaf-a31a-017236bbe72a';
const CONN_A = 'conn-2d5186fa-9699-51f6-8347-15de1a9830db';
const CONN_B = 'conn-175d81f5-76d2-520c-8bab-9e3a93a64035';
const CONN_C = 'conn-61cb9018-3e86-50a1-84f0-f508d58e06b6';
const PARM_A = 'parm-dac67a3b-c014-571a-9b77-167548341784';
const PARM_B = 'parm-6b626d52-face-5426-bca9-ec1fe3e7263e';

// Contract fixtures below are transcribed directly from
// python-sdk-temp/override_connection_parameter_guides.docx (the primary source),
// not the SDK spec's recap of it.

describe('buildTriggerBody — contract fixtures (rule)', () => {
  test('1. connection override — single rule', () => {
    const body = buildTriggerBody({
      objectId: RULE_ID,
      resourceType: 'rule',
      overrideBlocks: [
        { connections: [
          { type: 'source', find: CONN_A, replace: CONN_B },
          { type: 'target', find: CONN_B, replace: CONN_C }
        ] }
      ]
    });
    assert.deepStrictEqual(body, {
      objectId: RULE_ID,
      overrideSequence: 'all',
      overrides: [
        { connection: [
          { type: 'source', find: CONN_A, replace: CONN_B },
          { type: 'target', find: CONN_B, replace: CONN_C }
        ], useKeyValuePair: false }
      ]
    });
  });

  test('2. parameter override — single rule', () => {
    const body = buildTriggerBody({
      objectId: RULE_ID,
      resourceType: 'rule',
      overrideBlocks: [{ parameters: [{ find: PARM_A, replace: PARM_B }] }]
    });
    assert.deepStrictEqual(body, {
      objectId: RULE_ID,
      overrideSequence: 'all',
      overrides: [{ useKeyValuePair: false, parameter: [{ type: 'rule', find: PARM_A, replace: PARM_B }] }]
    });
  });

  test('3. connection + parameter — single rule', () => {
    const body = buildTriggerBody({
      objectId: RULE_ID,
      resourceType: 'rule',
      overrideBlocks: [{
        connections: [{ type: 'source', find: CONN_A, replace: CONN_B }],
        parameters: [{ find: PARM_A, replace: PARM_B }]
      }]
    });
    assert.deepStrictEqual(body, {
      objectId: RULE_ID,
      overrideSequence: 'all',
      overrides: [{
        connection: [{ type: 'source', find: CONN_A, replace: CONN_B }],
        useKeyValuePair: false,
        parameter: [{ type: 'rule', find: PARM_A, replace: PARM_B }]
      }]
    });
  });

  test('4. useKeyValuePair:true summary variables — single rule', () => {
    const body = buildTriggerBody({
      objectId: RULE_ID,
      resourceType: 'rule',
      overrideBlocks: [{ variables: { alationStatus: 'green' } }]
    });
    assert.deepStrictEqual(body, {
      objectId: RULE_ID,
      overrideSequence: 'all',
      overrides: [{ useKeyValuePair: true, parameterVariables: [{ key: 'alationStatus', value: 'green' }] }]
    });
  });

  test('source-only connection override is valid for rules', () => {
    const body = buildTriggerBody({
      objectId: RULE_ID,
      resourceType: 'rule',
      overrideBlocks: [{ connections: [{ type: 'source', find: CONN_A, replace: CONN_B }] }]
    });
    assert.deepEqual(body.overrides[0].connection, [{ type: 'source', find: CONN_A, replace: CONN_B }]);
  });
});

describe('buildTriggerBody — contract fixtures (workflow)', () => {
  test('5. connection override — all steps (no runSequence)', () => {
    const body = buildTriggerBody({
      objectId: WKFL_ID,
      resourceType: 'workflow',
      overrideBlocks: [{
        connections: [
          { type: 'source', find: CONN_A, replace: CONN_B },
          { type: 'target', find: CONN_B, replace: CONN_C }
        ]
      }]
    });
    assert.deepStrictEqual(body, {
      objectId: WKFL_ID,
      overrideSequence: 'all',
      overrides: [{ connection: [
        { type: 'source', find: CONN_A, replace: CONN_B },
        { type: 'target', find: CONN_B, replace: CONN_C }
      ], useKeyValuePair: false }]
    });
    assert.equal('runSequence' in body, false);
  });

  test('6. connection override — selected steps (runSequence:"all")', () => {
    const body = buildTriggerBody({
      objectId: WKFL_ID,
      resourceType: 'workflow',
      overrideBlocks: [{
        sequence: [1, 3],
        connections: [
          { type: 'source', find: CONN_A, replace: CONN_B },
          { type: 'target', find: CONN_B, replace: CONN_C }
        ]
      }]
    });
    assert.deepStrictEqual(body, {
      objectId: WKFL_ID,
      runSequence: 'all',
      overrideSequence: 'selected',
      overrides: [{
        sequence: [1, 3],
        connection: [
          { type: 'source', find: CONN_A, replace: CONN_B },
          { type: 'target', find: CONN_B, replace: CONN_C }
        ],
        useKeyValuePair: false
      }]
    });
  });

  test('7. parameter override — all steps (no runSequence)', () => {
    const body = buildTriggerBody({
      objectId: WKFL_ID,
      resourceType: 'workflow',
      overrideBlocks: [{ parameters: [{ find: PARM_A, replace: PARM_B }] }]
    });
    assert.deepStrictEqual(body, {
      objectId: WKFL_ID,
      overrideSequence: 'all',
      overrides: [{ useKeyValuePair: false, parameter: [{ type: 'rule', find: PARM_A, replace: PARM_B }] }]
    });
  });

  test('8. parameter override — selected steps', () => {
    const body = buildTriggerBody({
      objectId: WKFL_ID,
      resourceType: 'workflow',
      overrideBlocks: [{ sequence: [1, 3], parameters: [{ find: PARM_A, replace: PARM_B }] }]
    });
    assert.deepStrictEqual(body, {
      objectId: WKFL_ID,
      runSequence: 'all',
      overrideSequence: 'selected',
      overrides: [{ sequence: [1, 3], useKeyValuePair: false, parameter: [{ type: 'rule', find: PARM_A, replace: PARM_B }] }]
    });
  });

  test('9. connection + parameter — selected steps', () => {
    const body = buildTriggerBody({
      objectId: WKFL_ID,
      resourceType: 'workflow',
      overrideBlocks: [{
        sequence: [1, 3],
        connections: [{ type: 'source', find: CONN_A, replace: CONN_B }],
        parameters: [{ find: PARM_A, replace: PARM_B }]
      }]
    });
    assert.deepStrictEqual(body, {
      objectId: WKFL_ID,
      runSequence: 'all',
      overrideSequence: 'selected',
      overrides: [{
        sequence: [1, 3],
        connection: [{ type: 'source', find: CONN_A, replace: CONN_B }],
        useKeyValuePair: false,
        parameter: [{ type: 'rule', find: PARM_A, replace: PARM_B }]
      }]
    });
  });

  test('10. useKeyValuePair:true on selected steps + top-level run sequence', () => {
    const body = buildTriggerBody({
      objectId: WKFL_ID,
      resourceType: 'workflow',
      sequence: [3, 2],
      overrideBlocks: [{ sequence: [3], variables: { Regression: 'All' } }]
    });
    assert.deepStrictEqual(body, {
      objectId: WKFL_ID,
      runSequence: 'selected',
      sequence: [2, 3],
      overrideSequence: 'selected',
      overrides: [{ sequence: [3], useKeyValuePair: true, parameterVariables: [{ key: 'Regression', value: 'All' }] }]
    });
  });

  test('no overrides at all — plain trigger body', () => {
    const body = buildTriggerBody({ objectId: WKFL_ID, resourceType: 'workflow' });
    assert.deepStrictEqual(body, { objectId: WKFL_ID });
  });
});

describe('buildTriggerBody — validation', () => {
  test('mixed sequence presence across blocks is rejected', () => {
    assert.throws(
      () => buildTriggerBody({
        objectId: WKFL_ID,
        resourceType: 'workflow',
        overrideBlocks: [{ sequence: [1], connections: [{ type: 'source', find: CONN_A, replace: CONN_B }] }, { parameters: [{ find: PARM_A, replace: PARM_B }] }]
      }),
      CliError
    );
  });

  test('top-level sequence on a rule is rejected', () => {
    assert.throws(() => buildTriggerBody({ objectId: RULE_ID, resourceType: 'rule', sequence: [1] }), CliError);
  });

  test('block-level sequence on a rule is rejected', () => {
    assert.throws(
      () => buildTriggerBody({
        objectId: RULE_ID,
        resourceType: 'rule',
        overrideBlocks: [{ sequence: [1], parameters: [{ find: PARM_A, replace: PARM_B }] }]
      }),
      CliError
    );
  });

  test('variables + parameters in one block is rejected', () => {
    assert.throws(
      () => buildTriggerBody({
        objectId: RULE_ID,
        resourceType: 'rule',
        overrideBlocks: [{ variables: { a: 'b' }, parameters: [{ find: PARM_A, replace: PARM_B }] }]
      }),
      CliError
    );
  });

  test('bad connection id prefix is rejected', () => {
    assert.throws(
      () => buildTriggerBody({
        objectId: RULE_ID,
        resourceType: 'rule',
        overrideBlocks: [{ connections: [{ type: 'source', find: 'wkfl-not-a-connection', replace: CONN_B }] }]
      }),
      CliError
    );
  });

  test('bad parameter id prefix is rejected', () => {
    assert.throws(
      () => buildTriggerBody({
        objectId: RULE_ID,
        resourceType: 'rule',
        overrideBlocks: [{ parameters: [{ find: 'conn-not-a-parameter', replace: PARM_B }] }]
      }),
      CliError
    );
  });

  test('invalid connection type is rejected', () => {
    assert.throws(
      () => buildTriggerBody({
        objectId: RULE_ID,
        resourceType: 'rule',
        overrideBlocks: [{ connections: [{ type: 'sideways', find: CONN_A, replace: CONN_B }] }]
      }),
      CliError
    );
  });
});

describe('parseOverridesFile — CSV and JSON produce the same friendly blocks', () => {
  let tmpDir;

  before(async () => {
    tmpDir = path.join(tmpdir(), `icedq-overrides-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('CSV example matches its JSON equivalent', async () => {
    const jsonPath = path.join(tmpDir, 'fixture.json');
    const csvPath = path.join(tmpDir, 'fixture.csv');

    // Two separate blocks: connections+parameters can share a block, but "variables" may not
    // combine with "parameters" in the same block (validation rule 3) — so the variable lives
    // in its own block here, same as it would have to in a hand-written file.
    const jsonContent = JSON.stringify([
      {
        sequence: [1, 3],
        connections: [
          { type: 'source', find: CONN_A, replace: CONN_B },
          { type: 'target', find: CONN_B, replace: CONN_C }
        ],
        parameters: [{ find: PARM_A, replace: PARM_B }]
      },
      { sequence: [1, 3], variables: { alationStatus: 'green' } }
    ]);
    const csvContent =
      'block,sequence,type,conn_type,find,replace,key,value\n' +
      `1,"1,3",connection,source,${CONN_A},${CONN_B},,\n` +
      `1,"1,3",connection,target,${CONN_B},${CONN_C},,\n` +
      `1,"1,3",parameter,,${PARM_A},${PARM_B},,\n` +
      `2,"1,3",variable,,,,alationStatus,green\n`;

    await writeFile(jsonPath, jsonContent, 'utf8');
    await writeFile(csvPath, csvContent, 'utf8');

    const fromJson = await parseOverridesFile(jsonPath);
    const fromCsv = await parseOverridesFile(csvPath);

    const bodyFromJson = buildTriggerBody({ objectId: WKFL_ID, resourceType: 'workflow', overrideBlocks: fromJson });
    const bodyFromCsv = buildTriggerBody({ objectId: WKFL_ID, resourceType: 'workflow', overrideBlocks: fromCsv });

    assert.deepStrictEqual(bodyFromCsv, bodyFromJson);
  });

  test('CSV: mismatched sequence within one block id throws', async () => {
    const csvPath = path.join(tmpDir, 'bad-sequence.csv');
    await writeFile(
      csvPath,
      'block,sequence,type,conn_type,find,replace,key,value\n' +
        `1,"1",connection,source,${CONN_A},${CONN_B},,\n` +
        `1,"2",connection,target,${CONN_B},${CONN_C},,\n`,
      'utf8'
    );
    await assert.rejects(() => parseOverridesFile(csvPath), CliError);
  });

  test('CSV: unknown type value throws', async () => {
    const csvPath = path.join(tmpDir, 'bad-type.csv');
    await writeFile(
      csvPath,
      'block,sequence,type,conn_type,find,replace,key,value\n' + `1,,bogus,,${CONN_A},${CONN_B},,\n`,
      'utf8'
    );
    await assert.rejects(() => parseOverridesFile(csvPath), CliError);
  });

  test('rejects an unsupported file extension', async () => {
    await assert.rejects(() => parseOverridesFile('overrides.txt'), CliError);
  });
});
