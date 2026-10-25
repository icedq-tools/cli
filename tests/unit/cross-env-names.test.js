import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadCrossEnvNames } from '../../src/lib/cross-env-names.js';

let tmpDir;

before(async () => {
  tmpDir = path.join(tmpdir(), `icedq-cen-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeTmp(name, content) {
  const filePath = path.join(tmpDir, name);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

describe('loadCrossEnvNames', () => {
  test('.json file is parsed as-is', async () => {
    const filePath = await writeTmp(
      'config.json',
      JSON.stringify({ connections: { finance_db: { UAT: 'finance_db_uat' } } })
    );
    const config = await loadCrossEnvNames(filePath);
    assert.deepEqual(config, { connections: { finance_db: { UAT: 'finance_db_uat' } } });
  });

  test('.json category keys are case-insensitive, same as CSV\'s "type" column', async () => {
    const filePath = await writeTmp(
      'wrong-case.json',
      JSON.stringify({ Connections: { finance_db: { UAT: 'finance_db_uat' } }, PARAMETERS: { p: { UAT: 'p_uat' } } })
    );
    const config = await loadCrossEnvNames(filePath);
    assert.deepEqual(config, {
      connections: { finance_db: { UAT: 'finance_db_uat' } },
      parameters: { p: { UAT: 'p_uat' } }
    });
  });

  test('invalid .json throws a clear CliError', async () => {
    const filePath = await writeTmp('bad.json', 'not json');
    await assert.rejects(
      () => loadCrossEnvNames(filePath),
      (err) => {
        assert.ok(err.message.includes('could not parse --cross-env-names-file'));
        return true;
      }
    );
  });

  test('.csv happy path — multiple labels, partial environment coverage', async () => {
    const csv = [
      'type,label,environment,actual_name',
      'connection,etl-1-sqlserver,UAT,sqlserver-uat',
      'connection,etl-1-sqlserver,QA,sqlserver-qa',
      'connection,etl-1-sqlserver,PROD,sqlserver-prod',
      'connection,etl-2-sqlserver,PROD,sqlserver-prod-2',
      'parameter,etl-parameters,UAT,parameters_set_1-uat',
      'parameter,etl-parameters,PROD,parameters_set_1-prod'
    ].join('\n');
    const filePath = await writeTmp('names.csv', csv);

    const config = await loadCrossEnvNames(filePath);
    assert.deepEqual(config, {
      connections: {
        'etl-1-sqlserver': { UAT: 'sqlserver-uat', QA: 'sqlserver-qa', PROD: 'sqlserver-prod' },
        'etl-2-sqlserver': { PROD: 'sqlserver-prod-2' }
      },
      parameters: {
        'etl-parameters': { UAT: 'parameters_set_1-uat', PROD: 'parameters_set_1-prod' }
      }
    });
  });

  test('.csv header is case-insensitive and column order doesn\'t matter', async () => {
    const csv = ['Label,Type,Actual_Name,Environment', 'finance_db,connection,finance_db_uat,UAT'].join('\n');
    const filePath = await writeTmp('reordered.csv', csv);

    const config = await loadCrossEnvNames(filePath);
    assert.deepEqual(config, { connections: { finance_db: { UAT: 'finance_db_uat' } } });
  });

  test('.csv handles quoted fields with embedded commas', async () => {
    const csv = [
      'type,label,environment,actual_name',
      'connection,finance_db,UAT,"finance_db, uat copy"'
    ].join('\n');
    const filePath = await writeTmp('quoted.csv', csv);

    const config = await loadCrossEnvNames(filePath);
    assert.equal(config.connections.finance_db.UAT, 'finance_db, uat copy');
  });

  test('.csv skips blank lines', async () => {
    const csv = [
      'type,label,environment,actual_name',
      '',
      'connection,finance_db,UAT,finance_db_uat',
      '   ',
      ''
    ].join('\n');
    const filePath = await writeTmp('blanks.csv', csv);

    const config = await loadCrossEnvNames(filePath);
    assert.deepEqual(config, { connections: { finance_db: { UAT: 'finance_db_uat' } } });
  });

  test('.csv missing a required column throws a clear CliError', async () => {
    const csv = ['type,label,environment', 'connection,finance_db,UAT'].join('\n');
    const filePath = await writeTmp('missing-col.csv', csv);

    await assert.rejects(
      () => loadCrossEnvNames(filePath),
      (err) => {
        assert.ok(err.message.includes('missing column(s): actual_name'));
        return true;
      }
    );
  });

  test('.csv row with invalid "type" throws a clear CliError', async () => {
    const csv = ['type,label,environment,actual_name', 'resource,finance_db,UAT,finance_db_uat'].join('\n');
    const filePath = await writeTmp('bad-type.csv', csv);

    await assert.rejects(
      () => loadCrossEnvNames(filePath),
      (err) => {
        assert.ok(err.message.includes('row 2'));
        assert.ok(err.message.includes('"type" must be "connection" or "parameter"'));
        return true;
      }
    );
  });

  test('.csv row with a missing required value throws a clear CliError', async () => {
    const csv = ['type,label,environment,actual_name', 'connection,finance_db,,finance_db_uat'].join('\n');
    const filePath = await writeTmp('missing-value.csv', csv);

    await assert.rejects(
      () => loadCrossEnvNames(filePath),
      (err) => {
        assert.ok(err.message.includes('row 2'));
        assert.ok(err.message.includes('"environment" is required'));
        return true;
      }
    );
  });

  test('unsupported file extension throws a clear CliError', async () => {
    const filePath = await writeTmp('names.xlsx', 'whatever');
    await assert.rejects(
      () => loadCrossEnvNames(filePath),
      (err) => {
        assert.ok(err.message.includes('must be .json or .csv'));
        return true;
      }
    );
  });

  test('missing file throws a clear CliError', async () => {
    await assert.rejects(
      () => loadCrossEnvNames(path.join(tmpDir, 'does-not-exist.csv')),
      (err) => {
        assert.ok(err.message.includes('could not read --cross-env-names-file'));
        return true;
      }
    );
  });
});
