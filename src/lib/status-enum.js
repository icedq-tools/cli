export const STATUS = {
  SUBMITTED: 'Submitted',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  TERMINATED: 'Terminated',
  ERROR: 'Error'
};

export const TERMINAL_STATES = new Set([STATUS.COMPLETED, STATUS.TERMINATED, STATUS.ERROR]);

export function isTerminal(status) {
  return TERMINAL_STATES.has(status);
}

export function isSuccess(status) {
  return status === STATUS.COMPLETED;
}
