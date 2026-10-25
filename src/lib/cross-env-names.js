import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from '../core/errors.js';
import { parseCsvLine } from './csv.js';

const TYPE_TO_CATEGORY = { connection: 'connections', parameter: 'parameters' };
const CATEGORY_KEYS = ['connections', 'parameters'];
const REQUIRED_COLUMNS = ['type', 'label', 'environment', 'actual_name'];

// Loads --cross-env-names-file into { connections: { label: { env: name } }, parameters: { ... } }.
// Accepts .json (already in that shape) or .csv (a flat type/label/environment/actual_name table).
export async function loadCrossEnvNames(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.json' && ext !== '.csv') {
    throw new CliError(
      `--cross-env-names-file must be .json or .csv (got "${path.basename(filePath)}")`
    );
  }

  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    throw new CliError(`could not read --cross-env-names-file at ${filePath}: ${err.message}`);
  }

  return ext === '.json' ? parseJson(text, filePath) : parseCsvConfig(text, filePath);
}

function parseJson(text, filePath) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new CliError(`could not parse --cross-env-names-file at ${filePath}: ${err.message}`);
  }
  return normalizeCategoryKeys(parsed);
}

// Matches the CSV format's case-insensitive "type" column: "Connections"/"CONNECTIONS"/
// "connections" are all treated as the same category, same as the CSV path already does
// via TYPE_TO_CATEGORY.
function normalizeCategoryKeys(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const normalized = { ...parsed };
  for (const key of Object.keys(parsed)) {
    const canonical = CATEGORY_KEYS.find((c) => c === key.toLowerCase());
    if (canonical && canonical !== key) {
      normalized[canonical] = parsed[key];
      delete normalized[key];
    }
  }
  return normalized;
}

function parseCsvConfig(text, filePath) {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new CliError(`--cross-env-names-file at ${filePath} has no rows`);
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new CliError(
      `--cross-env-names-file at ${filePath} is missing column(s): ${missing.join(', ')} ` +
      `(expected: ${REQUIRED_COLUMNS.join(', ')})`
    );
  }

  const config = {};
  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1; // 1-based, matches what a spreadsheet app would show
    const fields = parseCsvLine(lines[i]);
    if (fields.every((f) => f.trim() === '')) continue; // skip blank rows

    const rec = {};
    header.forEach((col, idx) => { rec[col] = (fields[idx] ?? '').trim(); });

    const category = TYPE_TO_CATEGORY[rec.type.toLowerCase()];
    if (!category) {
      throw new CliError(
        `--cross-env-names-file at ${filePath}, row ${rowNum}: "type" must be "connection" or ` +
        `"parameter", got "${rec.type}"`
      );
    }
    for (const col of ['label', 'environment', 'actual_name']) {
      if (!rec[col]) {
        throw new CliError(`--cross-env-names-file at ${filePath}, row ${rowNum}: "${col}" is required`);
      }
    }

    config[category] ??= {};
    config[category][rec.label] ??= {};
    config[category][rec.label][rec.environment] = rec.actual_name;
  }

  return config;
}
