#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command, Option } from 'commander';
import { runExport } from '../commands/export.js';
import { runImport } from '../commands/import.js';
import { runGenerateMapping } from '../commands/generate-mapping.js';
import { runTrigger } from '../commands/run.js';
import { runStatus } from '../commands/status.js';
import { runTerminate } from '../commands/terminate.js';
import { runResult } from '../commands/result.js';
import { CliError } from '../core/errors.js';
import { log } from '../core/logger.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

const program = new Command();

program
  .name('icedq')
  .description('CLI for iceDQ rule and workflow promotion')
  .version(version);

function addGlobalOptions(cmd) {
  cmd
    .option('--icedq-base-url <url>', 'iceDQ instance base URL [env: ICEDQ_BASE_URL]')
    .option('--keycloak-url <url>', 'Keycloak token endpoint base [env: ICEDQ_KEYCLOAK_URL]')
    .option('--client-id <id>', 'OAuth client ID [env: ICEDQ_CLIENT_ID]')
    .option('--client-secret <secret>', 'OAuth client secret [env: ICEDQ_CLIENT_SECRET]')
    .option('--client-secret-file <path>', 'read the OAuth client secret from a file (overrides --client-secret and env)')
    .option('--org-id <id>', '[env: ICEDQ_ORG_ID]')
    .option('--account-id <id>', '[env: ICEDQ_ACCOUNT_ID]')
    .option('--workspace-id <id>', '[env: ICEDQ_WORKSPACE_ID]')
    .option('--verify-ssl <bool>', 'verify TLS (default true)')
    .option('--timeout <seconds>', 'polling timeout in seconds', '1800')
    .addOption(new Option('--output-format <format>', 'output format').choices(['text', 'json', 'markdown']).default('text'))
    .option('-v, --verbose', 'verbose logging')
    .option('-q, --quiet', 'suppress non-error logging');
  return cmd;
}

addGlobalOptions(
  program
    .command('export')
    .description('Export rules, workflows, or folders to a bundle')
    .requiredOption('--resource <kind>', 'rule | workflow | folder')
    .requiredOption('--id <uuid>', 'resource UUID')
    .option('--include-child', 'recurse folder children (folder resource only)', false)
    .requiredOption('--output <path>', 'where to write the bundle ZIP')
).action(async (opts, cmd) => wrap(() => runExport(merge(cmd, opts))));

addGlobalOptions(
  program
    .command('generate-mapping')
    .description('Auto-generate a mapping file from an export bundle')
    .requiredOption('--bundle <path>', 'path to the export ZIP')
    .requiredOption('--output <path>', 'where to write the mapping JSON')
    .option(
      '--cross-env-names-file <path>',
      'JSON config mapping each connection/parameter to its per-environment name, for cross-environment name matching'
    )
    .option('--target-env <label>', 'environment label to look up in --cross-env-names-file (required if that flag is set)')
).action(async (opts, cmd) => wrap(() => runGenerateMapping(merge(cmd, opts))));

addGlobalOptions(
  program
    .command('import')
    .description('Import a bundle into the target workspace')
    .requiredOption('--bundle <path>', 'path to the export ZIP')
    .requiredOption('--kind <kind>', 'rules | workflows')
    .requiredOption('--mapping-file <path>', 'mapping JSON (auto-generation arrives in v0.2)')
    .option('--use-fqn', 'use FQN (name) resolution instead of UUIDs', false)
    .option('--strict', 'exit non-zero on any skipped rule', false)
    .option('--terminate-on-conflict', 'cancel any active import in the target workspace and retry', false)
    .option('--retain-log <path>', 'write the full import log to this path')
).action(async (opts, cmd) => wrap(() => runImport(merge(cmd, opts))));

const runGroup = program.command('run').description('Trigger a rule or workflow run and poll to completion');
for (const resourceType of ['workflow', 'rule']) {
  const prefix = resourceType === 'workflow' ? 'wkfl-' : 'rule-';
  addGlobalOptions(
    runGroup
      .command(resourceType)
      .description(`Trigger a ${resourceType} run`)
      .requiredOption('--id <id>', `${resourceType} object ID (${prefix}<uuid>)`)
      .option('--show-result', 'also print full run result on success (always printed on failure)', false)
      .option('--terminate-on-timeout', 'if --timeout is reached, terminate the run and stop waiting immediately', false)
      .option('--overrides-file <path>', 'connection/parameter/variable overrides (.json or .csv), validated')
      .option('--sequence <steps>', 'comma-separated 1-based step numbers to run (workflow only)')
      .addHelpText(
        'after',
        `\nExamples:\n` +
          `  $ icedq run ${resourceType} --id ${prefix}77f73152-17cc-5b35-9841-13e24a4039b7\n` +
          `  $ icedq run ${resourceType} --id ${prefix}... --show-result\n` +
          (resourceType === 'workflow' ? `  $ icedq run workflow --id ${prefix}... --sequence 1,3 --terminate-on-timeout\n` : '') +
          `  $ icedq run ${resourceType} --id ${prefix}... --overrides-file overrides.json\n` +
          `\nSee the @icedq/cli README for the overrides-file format (.json or .csv).`
      )
  ).action(async (opts, cmd) => wrap(() => runTrigger({ ...merge(cmd, opts), resourceType })));
}

const statusGroup = program.command('status').description('Fetch the current status of a run');
for (const resourceType of ['workflow', 'rule']) {
  addGlobalOptions(
    statusGroup
      .command(resourceType)
      .description(`Fetch the current status of a ${resourceType} run`)
      .requiredOption('--id <id>', 'run instance ID (returned by `icedq run` as instance-id)')
      .addHelpText('after', `\nExample:\n  $ icedq status ${resourceType} --id 185274\n`)
  ).action(async (opts, cmd) => wrap(() => runStatus(merge(cmd, opts))));
}

const terminateGroup = program.command('terminate').description('Terminate a running instance');
for (const resourceType of ['workflow', 'rule']) {
  addGlobalOptions(
    terminateGroup
      .command(resourceType)
      .description(`Terminate a running ${resourceType} instance`)
      .requiredOption('--id <id>', 'run instance ID (returned by `icedq run` as instance-id)')
      .addHelpText('after', `\nExample:\n  $ icedq terminate ${resourceType} --id 185274\n`)
  ).action(async (opts, cmd) => wrap(() => runTerminate(merge(cmd, opts))));
}

const resultGroup = program.command('result').description('Fetch full run result detail');
for (const resourceType of ['workflow', 'rule']) {
  addGlobalOptions(
    resultGroup
      .command(resourceType)
      .description(`Fetch full result detail for a ${resourceType} run`)
      .requiredOption('--id <id>', 'run instance ID (returned by `icedq run` as instance-id)')
      .addHelpText('after', `\nExample:\n  $ icedq result ${resourceType} --id 185274\n`)
  ).action(async (opts, cmd) => wrap(() => runResult(merge(cmd, opts))));
}

function merge(cmd, localOpts) {
  return { ...cmd.parent.opts(), ...cmd.opts(), ...localOpts };
}

async function wrap(fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof CliError) {
      log.error(err.message);
      process.exit(err.exitCode || 1);
    }
    log.error(`Unexpected error: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

program.parseAsync(process.argv).catch((err) => {
  log.error(`Fatal: ${err.message}`);
  process.exit(1);
});
