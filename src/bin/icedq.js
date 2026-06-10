#!/usr/bin/env node
import { Command, Option } from 'commander';
import { runExport } from '../commands/export.js';
import { runImport } from '../commands/import.js';
import { runGenerateMapping } from '../commands/generate-mapping.js';
import { CliError } from '../core/errors.js';
import { log } from '../core/logger.js';

const program = new Command();

program
  .name('icedq')
  .description('CLI for iceDQ rule and workflow promotion')
  .version('0.1.0');

function addGlobalOptions(cmd) {
  cmd
    .option('--icedq-url <url>', 'iceDQ instance base URL [env: ICEDQ_URL]')
    .option('--keycloak-url <url>', 'Keycloak token endpoint base [env: ICEDQ_KEYCLOAK_URL]')
    .option('--client-id <id>', 'OAuth client ID [env: ICEDQ_CLIENT_ID]')
    .option('--client-secret <secret>', 'OAuth client secret [env: ICEDQ_CLIENT_SECRET]')
    .option('--org-id <id>', '[env: ICEDQ_ORG_ID]')
    .option('--account-id <id>', '[env: ICEDQ_ACCOUNT_ID]')
    .option('--workspace-id <id>', '[env: ICEDQ_WORKSPACE_ID]')
    .option('--verify-ssl <bool>', 'verify TLS (default true)')
    .option('--timeout <seconds>', 'polling timeout in seconds', '1800')
    .addOption(new Option('--output <format>', 'output format').choices(['text', 'json', 'markdown']).default('text'))
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
    .requiredOption('--output-file <path>', 'where to write the bundle ZIP')
).action(async (opts, cmd) => wrap(() => runExport(merge(cmd, opts))));

addGlobalOptions(
  program
    .command('generate-mapping')
    .description('Auto-generate a mapping file from an export bundle')
    .requiredOption('--bundle <path>', 'path to the export ZIP')
    .requiredOption('--output-file <path>', 'where to write the mapping JSON')
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
