/**
 * Redacting structured logger.
 *
 * - JSON lines to stdout.
 * - Never logs secrets, api_key, raw_text contents, or structured_data contents.
 * - Levels: info / warn / error. No debug path in production.
 */

const REDACTED = '[REDACTED]';

const SECRET_KEYS = new Set([
  'api_key',
  'apiKey',
  'raw_text',
  'rawText',
  'structured_data',
  'structuredData',
  'authorization',
  'secret',
  'MCP_SERVER_SECRET',
  'password',
  'token',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return REDACTED;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(record);
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const logger: Logger = {
  info(msg, fields) {
    emit('info', msg, fields);
  },
  warn(msg, fields) {
    emit('warn', msg, fields);
  },
  error(msg, fields) {
    emit('error', msg, fields);
  },
};

// Exposed for tests.
export const __testing = { redact };
