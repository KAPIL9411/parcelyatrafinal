/**
 * Cloudflare Workers entry point — **BLOCKED, DO NOT DEPLOY.**
 *
 * This file is scaffolding kept for the next attempt, not a working deployment. It boots, bundles
 * and reaches Fastify, and then fails for a reason that cannot be fixed in this file: Fastify's
 * router (`find-my-way` 9.x) generates its matching functions with `new Function`, and Workers
 * forbids `eval`/`new Function` outright for security reasons
 * (https://developers.cloudflare.com/workers/runtime-apis/web-standards/). Every `app.get(...)`
 * therefore throws `EvalError: Code generation from strings disallowed for this context` inside
 * `HandlerStorage._compileCreateParamsObject` while the app is being registered. There is no
 * compatibility flag that re-enables code generation.
 *
 * Consequences: the API cannot run on Workers by reusing the Fastify application. A Workers
 * deployment needs a Workers-native HTTP layer (Hono or similar) in front of the existing handlers,
 * or the API stays on a Node host. See docs/CLOUDFLARE_MIGRATION.md for the evidence and options.
 *
 * Everything below is still correct for a Node-compatible runtime and records what the migration
 * needs: lazy boot, no migrations, no background jobs, no Socket.IO, a console logger instead of
 * pino's file-descriptor destination, and a deferred database connection.
 *
 * What this entry deliberately does NOT do:
 *
 *  - It does not run migrations or seed data. A Worker is not a boot-time process, and production
 *    has always migrated as a separate step. Run `npm run db:migrate` before deploying.
 *  - It does not start background jobs. `JOBS_ENABLED` is false in the Worker configuration;
 *    `setInterval` does not outlive a request on Workers. The OTP-counter prune and the trip-route
 *    backfill need a Cron Trigger (or a scheduled GitHub Action hitting an authenticated endpoint).
 *  - It does not mount Socket.IO. Workers have no HTTP `upgrade` event. Live position updates stay
 *    on the polling endpoints (`/v1/tracking/...`); the app's change feed is `/v1/sync/state`.
 *
 * Boot is lazy and cached per isolate: connecting to Postgres at module scope would count against
 * the startup limit, and a failed connection would kill the isolate before it could answer a health
 * check. A failed boot clears the cache so the next request retries. The database itself is
 * `deferredDb()`, so boot does not touch it at all.
 *
 * Nothing in this module may do work at import time. Workers rejects timers, sockets and
 * `crypto.randomUUID()` in the global scope, and a single violation stops the isolate from starting.
 */
import { httpServerHandler } from 'cloudflare:node';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { buildApp } from './app.ts';
import { deferredDb } from './db/client.ts';

interface Booted {
  app: FastifyInstance;
  handler: (request: Request, env: unknown, ctx: unknown) => Promise<Response>;
}

let booting: Promise<Booted> | null = null;

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
type Level = (typeof LEVELS)[number];

const CONFIGURED_LEVEL: Level = ((): Level => {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as Level) : 'info';
})();

/**
 * Keys that must never reach a log line, mirroring the pino redaction list in `app.ts`.
 *
 * The Worker cannot use pino — its default destination is a file descriptor the Workers virtual
 * file system does not expose — so this logger reproduces the redaction itself rather than
 * inheriting it. A Cloudflare log stream is as sensitive as a container log stream.
 */
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

/**
 * A pino-shaped logger that writes single-line JSON to the console.
 *
 * Fastify accepts this only through `loggerInstance`; passing it as `logger` makes Fastify treat it
 * as pino options and throw. `child()` returns a new logger that carries the bindings, which is how
 * the request id reaches every request-scoped line.
 */
function makeLogger(bindings: Record<string, unknown> = {}): FastifyBaseLogger {
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
    child: (childBindings: Record<string, unknown>) => makeLogger({ ...bindings, ...childBindings }),
  };
  return logger as unknown as FastifyBaseLogger;
}

function boot(): Promise<Booted> {
  booting ??= (async () => {
    // `deferredDb()` keeps the database out of the boot path: the first query connects, so a
    // database outage produces a health check that says "database down" instead of a Worker that
    // cannot start.
    const app = await buildApp({ db: deferredDb(), loggerInstance: makeLogger() });
    await app.ready();
    return { app, handler: httpServerHandler(app.server) };
  })().catch((err: unknown) => {
    booting = null;
    console.error('[boot] application failed to start', err);
    throw err;
  });
  return booting;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const { handler } = await boot();
    return handler(request, env, ctx);
  },
};
