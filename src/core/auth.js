import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { AuthError } from './errors.js';
import { log } from './logger.js';

const REFRESH_BUFFER_MS = 30 * 1000;

export class KeycloakClientCredentialsAuth {
  constructor({ keycloakUrl, clientId, clientSecret, verifySsl = true }) {
    if (!keycloakUrl || !clientId || !clientSecret) {
      throw new AuthError('keycloakUrl, clientId, and clientSecret are required');
    }
    this.keycloakUrl = keycloakUrl.replace(/\/+$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.verifySsl = verifySsl;
    this._token = null;
    this._expiresAt = 0;
    this._inFlight = null;
  }

  async getToken() {
    if (this._token && Date.now() < this._expiresAt - REFRESH_BUFFER_MS) {
      return this._token;
    }
    if (!this._inFlight) {
      this._inFlight = this._fetchToken().finally(() => {
        this._inFlight = null;
      });
    }
    return this._inFlight;
  }

  async forceRefresh() {
    this._token = null;
    this._expiresAt = 0;
    return this.getToken();
  }

  async _fetchToken() {
    const tokenUrl = `${this.keycloakUrl}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret
    }).toString();

    log.debug('Requesting Keycloak token', { url: tokenUrl, clientId: this.clientId });

    const response = await this._post(tokenUrl, body);

    if (!response.access_token) {
      throw new AuthError('Token response missing access_token');
    }

    this._token = response.access_token;
    const ttlMs = (response.expires_in ?? 300) * 1000;
    this._expiresAt = Date.now() + ttlMs;

    log.info('Keycloak token acquired', { expiresInSec: response.expires_in ?? 300 });
    return this._token;
  }

  _post(urlString, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const opts = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json'
        }
      };
      if (isHttps && !this.verifySsl) opts.rejectUnauthorized = false;

      const req = lib.request(url, opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new AuthError(`HTTP ${res.statusCode} from Keycloak: ${text}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new AuthError(`Invalid JSON from Keycloak: ${err.message}`));
          }
        });
      });
      req.on('error', (err) => reject(new AuthError(err.message, { cause: err })));
      req.write(body);
      req.end();
    });
  }
}
