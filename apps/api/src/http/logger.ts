import type { FastifyBaseLogger } from 'fastify';

/**
 * A pino-shaped logger that writes single-line JSON to the console.
 *
 * The Workers runtime has no writable file descriptor, so pino's default destination cannot be
 * used there. Fastify accepts this object only through `loggerInstance` — handing it to `logger`
 * makes Fastify treat it as pino options and throw.
 *
 * The redaction list mirrors `pinoOptions()` in `app.ts`. A Cloudflare log stream is as sensitive as
 * a container log stream, so the Worker reproduces the redaction rather than inheriting it.
 */

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
type Level = (typeof LEVELS)[number];

const CONFIGURED_LEVEL: Level = ((): Level => {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as Level) : 'info';
})();

const REDACTED_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'idempotency-key',
  'otp',
  'code',
  'code_hash',
  'code_sealed',
  'phone',
  'receiver_phone',
  'refresh_token',
  'access_token',
  'email',
  'user_email',
  'recovery_email',
]);

const MAX_DEPTH = 5;

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth-limit]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(entry, depth + 1);
    }
    return out;
  }
  return value;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function makeConsoleLogger(bindings: Record<string, unknown> = {}): FastifyBaseLogger {
  const emit = (level: Level) => (...args: unknown[]): void => {
    if (LEVELS.indexOf(level) < LEVELS.indexOf(CONFIGURED_LEVEL)) return;

    const fields: Record<string, unknown> = { level, ...bindings };
    let message: string | undefined;
    for (const arg of args) {
      if (typeof arg === 'string') {
        message = message ? `${message} ${arg}` : arg;
      } else if (arg instanceof Error) {
        fields.err = { name: arg.name, message: arg.message, stack: arg.stack };
      } else if (arg && typeof arg === 'object') {
        Object.assign(fields, redact(arg) as Record<string, unknown>);
      } else if (arg !== undefined) {
        fields.detail = arg;
      }
    }
    if (message !== undefined) fields.msg = message;

    const line = safeJson(fields);
    if (level === 'error' || level === 'fatal') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  const logger = {
    level: CONFIGURED_LEVEL,
    fatal: emit('fatal'),
    error: emit('error'),
    warn: emit('warn'),
    info: emit('info'),
    debug: emit('debug'),
    trace: emit('trace'),
    silent: () => undefined,
    child: (childBindings: Record<string, unknown>) =>
      makeConsoleLogger({ ...bindings, ...childBindings }),
  };
  return logger as unknown as FastifyBaseLogger;
}
