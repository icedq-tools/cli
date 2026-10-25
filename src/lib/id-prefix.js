import { CliError } from '../core/errors.js';

export function assertIdPrefix(value, prefix, label) {
  if (!value || !value.startsWith(prefix)) {
    throw new CliError(`${label} must start with "${prefix}" (got: ${value})`);
  }
}
