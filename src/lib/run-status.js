const NON_TERMINAL = new Set(['submitted', 'running']);
const SUCCESS = new Set(['success', 'warning']);

export function isRunTerminal(status) {
  if (status === undefined || status === null) return false;
  return !NON_TERMINAL.has(String(status).toLowerCase());
}

export function isRunSuccess(status) {
  return status !== undefined && status !== null && SUCCESS.has(String(status).toLowerCase());
}
