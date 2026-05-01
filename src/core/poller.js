import { isTerminal } from '../lib/status-enum.js';
import { PollTimeoutError } from './errors.js';
import { log } from './logger.js';

const INITIAL_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;
const BACKOFF = 2;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export async function pollTask(client, kind, taskId, opts = {}) {
  if (kind !== 'exports' && kind !== 'imports') {
    throw new Error(`pollTask: kind must be 'exports' or 'imports', got '${kind}'`);
  }

  const timeoutMs = (opts.timeoutSec ?? 1800) * 1000;
  const onTick = opts.onTick || (() => {});
  const sleeper = opts.sleep || sleep;
  const now = opts.now || (() => Date.now());

  const start = now();
  let delay = opts.initialDelayMs ?? INITIAL_DELAY_MS;
  let attempt = 0;

  while (true) {
    attempt++;
    const elapsedMs = now() - start;
    if (elapsedMs >= timeoutMs) {
      throw new PollTimeoutError(taskId, kind, elapsedMs);
    }

    const remaining = timeoutMs - elapsedMs;
    const waitMs = Math.min(delay, remaining);
    await sleeper(waitMs);

    let response;
    try {
      response = await client.get(`/api/v1/${kind}/${taskId}/status`, { retryOn5xx: true });
    } catch (err) {
      log.warn('Status poll failed', { taskId, attempt, error: err.message });
      throw err;
    }

    const status = extractStatus(response);
    onTick({ status, attempt, elapsedMs: now() - start, response });

    if (isTerminal(status)) {
      return { status, response, attempts: attempt, elapsedMs: now() - start };
    }

    delay = Math.min(delay * BACKOFF, MAX_DELAY_MS);
  }
}

function extractStatus(response) {
  if (!response || typeof response !== 'object') return undefined;
  return response.taskStatus || response.status || response.state;
}

export const _internal = { extractStatus, INITIAL_DELAY_MS, MAX_DELAY_MS, BACKOFF };
