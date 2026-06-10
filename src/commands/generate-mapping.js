import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { KeycloakClientCredentialsAuth } from '../core/auth.js';
import { IcedqApiClient } from '../core/client.js';
import { Reporter } from '../core/reporter.js';
import { ApiError, CliError } from '../core/errors.js';
import { log, setLevel } from '../core/logger.js';

const PAGE_SIZE = 1000;

export async function runGenerateMapping(rawOpts) {
  if (rawOpts.verbose) setLevel('debug');
  if (rawOpts.quiet) setLevel('error');

  if (!rawOpts.bundle) throw new CliError('--bundle is required');
  if (!rawOpts.outputFile) throw new CliError('--output-file is required');

  const cfg = loadConfig(rawOpts);
  const auth = new KeycloakClientCredentialsAuth({
    keycloakUrl: cfg.keycloakUrl,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    verifySsl: cfg.verifySsl
  });
  const client = new IcedqApiClient({
    baseUrl: cfg.icedqUrl,
    orgId: cfg.orgId,
    accountId: cfg.accountId,
    workspaceId: cfg.workspaceId,
    auth,
    verifySsl: cfg.verifySsl
  });

  const bundlePath = path.resolve(rawOpts.bundle);
  let bundleBuffer;
  try {
    bundleBuffer = await readFile(bundlePath);
  } catch (err) {
    throw new CliError(`could not read bundle at ${bundlePath}: ${err.message}`);
  }

  // Step 1: get expected mappings from bundle
  log.info('Uploading bundle to get expected mappings');
  const expected = await client.postMultipart('/api/v1/internal/imports/mapping', {
    file: {
      buffer: bundleBuffer,
      filename: path.basename(bundlePath),
      contentType: 'application/zip'
    }
  });

  const srcConnections = expected.connections || [];
  const srcParameters = expected.parameters || [];
  const srcCustomFields = expected.customFields || [];

  log.info('Expected mappings', {
    connections: srcConnections.length,
    parameters: srcParameters.length,
    customFields: srcCustomFields.length
  });

  // Step 2: resolve connections from target environment
  const connections = await resolveConnections(client, srcConnections);

  // Step 3: resolve parameters from target environment
  const parameters = await resolveParameters(client, srcParameters);

  // Step 4: resolve custom fields from target environment
  const customFields = await resolveCustomFields(client, srcCustomFields);

  const mappingDoc = {
    useFqn: true,
    mapping: { connections, parameters, customFields }
  };

  const outputFile = path.resolve(rawOpts.outputFile);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(mappingDoc, null, 2), 'utf8');
  log.info('Mapping file written', { outputFile });

  const result = {
    command: 'generate-mapping',
    outputFile,
    connections: connections.length,
    parameters: parameters.length,
    customFields: customFields.length
  };
  new Reporter(rawOpts.output || 'text').emit(result);
}

async function resolveConnections(client, srcConnections) {
  if (srcConnections.length === 0) return [];

  // Group source connections by connectorId
  const byConnectorId = new Map();
  for (const conn of srcConnections) {
    if (!byConnectorId.has(conn.connectorId)) byConnectorId.set(conn.connectorId, []);
    byConnectorId.get(conn.connectorId).push(conn);
  }

  const mappings = [];

  for (const [connectorId, srcConns] of byConnectorId) {
    log.info('Searching connections in target', { connectorId });

    // Fetch all pages for this connectorId
    const targetItems = await fetchAllPages(client, '/api/v1/connections/search', {
      filter: [{ attribute: 'connectorId', operator: 'In', datatype: 'string', value: connectorId }]
    }, `connections with connectorId=${connectorId}`);

    for (const src of srcConns) {
      const match = targetItems.find(
        (t) => t.name.toLowerCase() === src.name.toLowerCase()
      );
      if (!match) {
        throw new CliError(
          `Connection "${src.name}" (connectorId: ${connectorId}) was not found in the target environment. ` +
          `Ensure a connection with this name exists in the target workspace before generating the mapping.`
        );
      }
      mappings.push({ existingId: src.id, newId: match.id, action: 'override' });
      log.info('Mapped connection', { name: src.name, existingId: src.id, newId: match.id });
    }
  }

  return mappings;
}

async function resolveParameters(client, srcParameters) {
  if (srcParameters.length === 0) return [];

  log.info('Searching parameters in target');

  let targetItems = [];
  try {
    targetItems = await fetchAllPages(client, '/api/v1/parameters/search', {}, 'parameters');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'ResultsNotFound') {
      log.warn('No parameters found in target environment — mapping without newId');
      return srcParameters.map((p) => ({ existingId: p.id, action: 'upsert' }));
    }
    throw err;
  }

  return srcParameters.map((src) => {
    const match = targetItems.find(
      (t) => t.name.toLowerCase() === src.name.toLowerCase()
    );
    if (!match) {
      log.warn('Parameter not matched in target, mapping without newId', { name: src.name });
      return { existingId: src.id, action: 'upsert' };
    }
    log.info('Mapped parameter', { name: src.name, existingId: src.id, newId: match.id });
    return { existingId: src.id, newId: match.id, action: 'upsert' };
  });
}

async function resolveCustomFields(client, srcCustomFields) {
  if (srcCustomFields.length === 0) return [];

  log.info('Fetching screens for custom field mapping');
  const screens = await client.post('/api/v1/screens/default/search', ['rule', 'check']);

  // Flatten all fields from all sections of all screens into a name→id map
  const fieldMap = new Map();
  for (const screen of Array.isArray(screens) ? screens : []) {
    const sections = screen?.info?.sections || [];
    for (const section of sections) {
      for (const field of section.fields || []) {
        if (field.name && field.id) {
          fieldMap.set(field.name.toLowerCase(), field.id);
        }
      }
    }
  }

  const mappings = [];
  for (const fieldName of srcCustomFields) {
    const targetId = fieldMap.get(fieldName.toLowerCase());
    if (!targetId) {
      log.warn('Custom field not found in target screens, skipping', { fieldName });
      continue;
    }
    mappings.push({ existingId: fieldName, newId: targetId, action: 'override' });
    log.info('Mapped custom field', { fieldName, newId: targetId });
  }

  return mappings;
}

// Fetches all pages from a paginated POST search endpoint.
// Throws ApiError with code='ResultsNotFound' when the endpoint reports nothing found.
async function fetchAllPages(client, endpoint, body, label) {
  const items = [];
  let pageNo = 1;
  let totalPages = 1;

  do {
    const url = `${endpoint}?pageNo=${pageNo}&pageSize=${PAGE_SIZE}&sort=updatedTimestamp:desc`;
    const resp = await client.post(url, body);

    // API may return 200 with {code, message} instead of a 4xx
    if (resp && resp.code === 'ResultsNotFound') {
      throw new ApiError(`${label}: ${resp.message || 'ResultsNotFound'}`, {
        status: 200,
        code: 'ResultsNotFound'
      });
    }

    items.push(...(resp?.items || []));
    totalPages = resp?.pageable?.pages ?? 1;
    pageNo++;
  } while (pageNo <= totalPages);

  return items;
}
