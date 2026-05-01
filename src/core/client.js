import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import FormData from 'form-data';
import { ApiError } from './errors.js';
import { log } from './logger.js';

const STATUS_RETRY_5XX = 3;
const STATUS_RETRY_DELAY_MS = 5000;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export class IcedqApiClient {
  constructor({ baseUrl, orgId, accountId, workspaceId, auth, verifySsl = true }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.orgId = orgId;
    this.accountId = accountId;
    this.workspaceId = workspaceId;
    this.auth = auth;
    this.verifySsl = verifySsl;
  }

  _buildHeaders(extra = {}, { includeWorkspace = true } = {}) {
    const headers = {
      Accept: 'application/json',
      'Org-Id': this.orgId,
      'Account-Id': this.accountId,
      ...extra
    };
    if (includeWorkspace && this.workspaceId) {
      headers['Workspace-Id'] = this.workspaceId;
    }
    return headers;
  }

  async get(path, opts = {}) {
    return this._request('GET', path, opts);
  }

  async post(path, body, opts = {}) {
    return this._request('POST', path, { ...opts, jsonBody: body });
  }

  async postMultipart(path, parts, opts = {}) {
    const form = new FormData();
    for (const [name, value] of Object.entries(parts)) {
      if (value && typeof value === 'object' && value.buffer && value.filename) {
        form.append(name, value.buffer, {
          filename: value.filename,
          contentType: value.contentType || 'application/octet-stream'
        });
      } else if (value && typeof value === 'object' && value.json !== undefined) {
        form.append(name, JSON.stringify(value.json), { contentType: 'application/json' });
      } else {
        form.append(name, value);
      }
    }
    return this._request('POST', path, { ...opts, multipart: form });
  }

  async getBinary(path, opts = {}) {
    return this._request('GET', path, { ...opts, expectBinary: true });
  }

  async _request(method, path, opts = {}) {
    const includeWorkspace = opts.includeWorkspace !== false;
    let attempt = 0;
    let last401 = false;

    while (true) {
      attempt++;
      const token = await this.auth.getToken();
      const headers = this._buildHeaders(
        {
          Authorization: `Bearer ${token}`,
          ...(opts.headers || {})
        },
        { includeWorkspace }
      );

      let bodyBuffer;
      if (opts.multipart) {
        Object.assign(headers, opts.multipart.getHeaders());
        bodyBuffer = opts.multipart.getBuffer();
      } else if (opts.jsonBody !== undefined) {
        headers['Content-Type'] = 'application/json';
        bodyBuffer = Buffer.from(JSON.stringify(opts.jsonBody));
      }

      const url = path.startsWith('http')
        ? path
        : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

      log.debug('iceDQ request', { method, url, attempt });

      let response;
      try {
        response = await this._doRequest(method, url, headers, bodyBuffer, !!opts.expectBinary);
      } catch (err) {
        throw new ApiError(`Network error calling ${url}: ${err.message}`, { endpoint: path });
      }

      if (response.status === 401 && !last401) {
        log.warn('iceDQ 401 — refreshing token and retrying once');
        last401 = true;
        await this.auth.forceRefresh();
        continue;
      }

      if (response.status >= 500 && opts.retryOn5xx && attempt <= STATUS_RETRY_5XX) {
        log.warn(`iceDQ ${response.status} — retrying after ${STATUS_RETRY_DELAY_MS}ms`, { attempt });
        await sleep(STATUS_RETRY_DELAY_MS);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        const parsed = parseErrorBody(response.body);
        throw new ApiError(`HTTP ${response.status} from ${path}: ${parsed.summary}`, {
          status: response.status,
          code: parsed.code,
          messages: parsed.messages,
          body: response.body,
          endpoint: path
        });
      }

      if (opts.expectBinary) return response.buffer;
      if (!response.body) return {};
      try {
        return JSON.parse(response.body);
      } catch {
        return response.body;
      }
    }
  }

  _doRequest(method, urlString, headers, bodyBuffer, expectBinary) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const reqOpts = { method, headers };
      if (isHttps && !this.verifySsl) reqOpts.rejectUnauthorized = false;

      const req = lib.request(url, reqOpts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (expectBinary) {
            resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) });
          } else {
            resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
          }
        });
      });
      req.on('error', reject);
      if (bodyBuffer) req.write(bodyBuffer);
      req.end();
    });
  }
}

function parseErrorBody(body) {
  if (!body) return { summary: '(empty body)', code: undefined, messages: [] };
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const summary =
        messages
          .map((m) => `${m.fieldName ? m.fieldName + ': ' : ''}${m.violation || m.message || ''}`)
          .filter(Boolean)
          .join('; ') || parsed.message || JSON.stringify(parsed);
      return { summary, code: parsed.code, messages };
    }
  } catch {
    // not JSON, fall through
  }
  return { summary: body.slice(0, 200), code: undefined, messages: [] };
}

export const _internal = { parseErrorBody };
