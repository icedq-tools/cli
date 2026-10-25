import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from '../core/errors.js';
import { parseCsvRows } from './csv.js';
import { assertIdPrefix } from './id-prefix.js';

const VALID_TYPES = new Set(['connection', 'parameter', 'variable']);
const CONN_TYPES = new Set(['source', 'target']);

export async function parseOverridesFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.json' && ext !== '.csv') {
    throw new CliError(`--overrides-file must be .json or .csv (got "${path.basename(filePath)}")`);
  }

  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    throw new CliError(`could not read --overrides-file at ${filePath}: ${err.message}`);
  }

  return ext === '.json' ? parseJsonOverrides(text, filePath) : parseCsvOverrides(text, filePath);
}

function parseJsonOverrides(text, filePath) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new CliError(`could not parse --overrides-file at ${filePath}: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new CliError(`--overrides-file at ${filePath} must be a JSON array of override blocks`);
  }
  return parsed;
}

function parseCsvOverrides(text, filePath) {
  const rows = parseCsvRows(text);
  const groups = new Map();
  let autoBlock = 0;

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // header is row 1
    if (Object.values(row).every((v) => v === '')) return;

    const blockId = row.block?.trim() || `__auto_${++autoBlock}`;
    const type = (row.type || '').trim().toLowerCase();
    if (!VALID_TYPES.has(type)) {
      throw new CliError(
        `--overrides-file at ${filePath}, row ${rowNum}: "type" must be one of connection, parameter, variable (got "${row.type}")`
      );
    }

    const rowSequence = (row.sequence ?? '').trim();
    if (!groups.has(blockId)) {
      groups.set(blockId, { sequenceRaw: rowSequence, connections: [], parameters: [], variables: {} });
    }
    const group = groups.get(blockId);

    if (rowSequence !== group.sequenceRaw) {
      throw new CliError(
        `--overrides-file at ${filePath}, row ${rowNum}: "sequence" ("${rowSequence}") does not match the rest of block "${blockId}" ("${group.sequenceRaw}")`
      );
    }

    if (type === 'connection') {
      if (!row.conn_type || !row.find || !row.replace) {
        throw new CliError(
          `--overrides-file at ${filePath}, row ${rowNum}: connection rows require "conn_type", "find", and "replace"`
        );
      }
      group.connections.push({ type: row.conn_type.trim(), find: row.find.trim(), replace: row.replace.trim() });
    } else if (type === 'parameter') {
      if (!row.find || !row.replace) {
        throw new CliError(
          `--overrides-file at ${filePath}, row ${rowNum}: parameter rows require "find" and "replace"`
        );
      }
      group.parameters.push({ find: row.find.trim(), replace: row.replace.trim() });
    } else {
      if (!row.key) {
        throw new CliError(`--overrides-file at ${filePath}, row ${rowNum}: variable rows require "key"`);
      }
      group.variables[row.key.trim()] = row.value ?? '';
    }
  });

  return [...groups.values()].map((g) => {
    const block = {};
    if (g.sequenceRaw !== '') {
      block.sequence = g.sequenceRaw.split(',').map((s) => s.trim());
    }
    if (g.connections.length) block.connections = g.connections;
    if (g.parameters.length) block.parameters = g.parameters;
    if (Object.keys(g.variables).length) block.variables = g.variables;
    return block;
  });
}

export function buildTriggerBody({ objectId, resourceType, sequence, overrideBlocks = [] }) {
  const body = { objectId };

  if (resourceType === 'rule') {
    if (sequence !== undefined) {
      throw new CliError('--sequence is not valid for rules (rules have no steps)');
    }
    for (const block of overrideBlocks) {
      if (block.sequence !== undefined) {
        throw new CliError('override "sequence" is not valid for rules (rules have no steps)');
      }
    }
  }

  let overrideSequence;
  if (overrideBlocks.length > 0) {
    const withSeq = overrideBlocks.filter((b) => b.sequence !== undefined).length;
    if (withSeq !== 0 && withSeq !== overrideBlocks.length) {
      throw new CliError('All override blocks must either specify "sequence" or none of them can (cannot mix)');
    }
    overrideSequence = withSeq > 0 ? 'selected' : 'all';
  }

  // runSequence is only meaningful (and only ever sent) for workflows, and only when the
  // overrides themselves are step-scoped ("selected") or the caller restricts which steps
  // run at all — confirmed against every example in override_connection_parameter_guides.docx.
  if (resourceType === 'workflow') {
    if (sequence !== undefined) {
      body.runSequence = 'selected';
      body.sequence = normalizeSequence(sequence);
    } else if (overrideSequence === 'selected') {
      body.runSequence = 'all';
    }
  }

  if (overrideBlocks.length > 0) {
    body.overrideSequence = overrideSequence;
    body.overrides = overrideBlocks.map(buildOverrideBlock);
  }

  return body;
}

function buildOverrideBlock(block) {
  const wireBlock = {};

  if (block.sequence !== undefined) {
    wireBlock.sequence = normalizeSequence(block.sequence);
  }

  if (block.connections?.length) {
    wireBlock.connection = block.connections.map((c) => {
      if (!CONN_TYPES.has(c.type)) {
        throw new CliError(`connection override "type" must be "source" or "target" (got "${c.type}")`);
      }
      assertIdPrefix(c.find, 'conn-', 'connection override "find"');
      assertIdPrefix(c.replace, 'conn-', 'connection override "replace"');
      return { type: c.type, find: c.find, replace: c.replace };
    });
  }

  if (block.variables && Object.keys(block.variables).length > 0) {
    if (block.parameters?.length) {
      throw new CliError('An override block cannot have both "variables" and "parameters"');
    }
    wireBlock.useKeyValuePair = true;
    wireBlock.parameterVariables = Object.entries(block.variables).map(([key, value]) => ({ key, value }));
  } else {
    wireBlock.useKeyValuePair = false;
    if (block.parameters?.length) {
      wireBlock.parameter = block.parameters.map((p) => {
        assertIdPrefix(p.find, 'parm-', 'parameter override "find"');
        assertIdPrefix(p.replace, 'parm-', 'parameter override "replace"');
        return { type: 'rule', find: p.find, replace: p.replace };
      });
    }
  }

  return wireBlock;
}

function normalizeSequence(sequence) {
  const items = Array.isArray(sequence)
    ? sequence
    : String(sequence)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  const nums = items.map((n) => {
    const parsed = Number.isInteger(n) ? n : Number.parseInt(n, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new CliError(`sequence values must be 1-based integers >= 1 (got "${n}")`);
    }
    return parsed;
  });

  return [...new Set(nums)].sort((a, b) => a - b);
}
