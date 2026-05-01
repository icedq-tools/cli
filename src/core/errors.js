export class CliError extends Error {
  constructor(message, { exitCode = 1, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.exitCode = exitCode;
    if (cause) this.cause = cause;
  }
}

export class ConfigError extends CliError {
  constructor(missing) {
    const list = Array.isArray(missing) ? missing : [missing];
    super(`Missing required configuration: ${list.join(', ')}`, { exitCode: 2 });
    this.missing = list;
  }
}

export class AuthError extends CliError {
  constructor(message, { cause } = {}) {
    super(`Authentication failed: ${message}`, { exitCode: 2, cause });
  }
}

export class ApiError extends CliError {
  constructor(message, { status, code, messages, body, endpoint } = {}) {
    super(message, { exitCode: 2 });
    this.status = status;
    this.code = code;
    this.messages = messages;
    this.body = body;
    this.endpoint = endpoint;
  }

  isConstraintViolation() {
    return this.code === 'ConstraintViolation';
  }
}

export class PollTimeoutError extends CliError {
  constructor(taskId, kind, elapsedMs) {
    super(`Timed out waiting for ${kind} task ${taskId} after ${elapsedMs}ms`, { exitCode: 3 });
    this.taskId = taskId;
    this.kind = kind;
    this.elapsedMs = elapsedMs;
  }
}

export class TaskFailedError extends CliError {
  constructor(taskId, kind, status, logTail) {
    super(`${kind} task ${taskId} ended in status ${status}`, { exitCode: 1 });
    this.taskId = taskId;
    this.kind = kind;
    this.status = status;
    this.logTail = logTail;
  }
}

export class BundleError extends CliError {
  constructor(message) {
    super(`Bundle error: ${message}`, { exitCode: 2 });
  }
}
