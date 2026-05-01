const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let level = LEVELS.info;

export function setLevel(name) {
  if (Object.prototype.hasOwnProperty.call(LEVELS, name)) {
    level = LEVELS[name];
  }
}

const TOKEN_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-+/=]+/g,
  /(access_token|refresh_token|client_secret)["':\s=]+["']?[A-Za-z0-9._\-+/=]+["']?/gi
];

function maskTokens(value) {
  if (typeof value === 'string') {
    let out = value;
    for (const pattern of TOKEN_PATTERNS) {
      out = out.replace(pattern, (m) => {
        const head = m.slice(0, m.indexOf(' ') > 0 ? m.indexOf(' ') + 1 : 12);
        return `${head}***`;
      });
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const clone = Array.isArray(value) ? [] : {};
    for (const [k, v] of Object.entries(value)) {
      if (/(authorization|token|secret|password)/i.test(k)) {
        clone[k] = '***';
      } else {
        clone[k] = maskTokens(v);
      }
    }
    return clone;
  }
  return value;
}

function emit(name, lvl, msg, ctx) {
  if (lvl > level) return;
  const stamp = new Date().toISOString();
  const safeCtx = ctx ? maskTokens(ctx) : undefined;
  const line = safeCtx
    ? `[${stamp}] ${name.toUpperCase()} ${maskTokens(msg)} ${JSON.stringify(safeCtx)}`
    : `[${stamp}] ${name.toUpperCase()} ${maskTokens(msg)}`;
  process.stderr.write(line + '\n');
}

export const log = {
  error: (msg, ctx) => emit('error', LEVELS.error, msg, ctx),
  warn:  (msg, ctx) => emit('warn',  LEVELS.warn,  msg, ctx),
  info:  (msg, ctx) => emit('info',  LEVELS.info,  msg, ctx),
  debug: (msg, ctx) => emit('debug', LEVELS.debug, msg, ctx)
};

export const _internal = { maskTokens };
