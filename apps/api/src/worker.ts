/**
 * Cloudflare Workers entry point.
 *
 * The API runs on Workers through a compatibility HTTP layer, not through Fastify itself. Fastify's
 * router (`find-my-way`) compiles a matcher per route with `new Function`, and the Workers runtime
 * forbids code generation from strings outright
 * (https://developers.cloudflare.com/workers/runtime-apis/web-standards/). That is a hard blocker,
 * not a bundling problem: `EvalError: Code generation from strings disallowed` is thrown from
 * `HandlerStorage._compileCreateParamsObject` while routes are being registered, and there is no
 * compatibility flag that re-enables it.
 *
 * So this entry builds `http/fastify-compat.ts` — a Hono-backed implementation of the small Fastify
 * API slice the route modules use — and mounts the same `registerRoutes()` table that `app.ts`
 * mounts on Render. Route modules, auth, validation and SQL are untouched; only the transport is
 * different. `test/hono-parity.test.ts` sends the same requests through both hosts.
 *
 * What this entry deliberately does NOT do:
 *
 *  - It does not run migrations or seed data. A Worker is not a boot-time process, and production
 *    has always migrated as a separate step. Run `npm run db:migrate` before deploying.
 *  - It does not start background jobs. `JOBS_ENABLED` is false in the Worker configuration;
 *    `setInterval` does not outlive a request on Workers. Time-based booking transitions are run by
 *    the Cron Trigger below (`scheduled`), which calls the same `runLifecycleSweep` the Node
 *    scheduler calls. The OTP-counter prune and the trip-route backfill still need that trigger or a
 *    scheduled GitHub Action hitting an authenticated endpoint.
 *  - It does not mount Socket.IO. Workers have no HTTP `upgrade` event. Live position updates stay
 *    on the polling endpoints (`/v1/tracking/...`); the app's change feed is `/v1/sync/state`.
 *  - It does not run live tracking across isolates. The default tracking store is per-isolate
 *    memory; a shared store needs `REDIS_URL` or a Durable Object.
 *
 * Boot is lazy and cached per isolate: connecting to Postgres at module scope would count against
 * the startup limit, and a failed boot would kill the isolate before it could answer a health
 * check. A failed boot clears the cache so the next request retries. The database is
 * `deferredDb()`, so boot does not touch it at all.
 *
 * Nothing in this module may do work at import time. Workers rejects timers, sockets and
 * `crypto.randomUUID()` in the global scope, and a single violation stops the isolate from starting.
 */
import type { FastifyInstance } from 'fastify';

import { assertSafetyRails, config, corsOrigins } from './config.ts';
import { deferredDb, withRequestDb } from './db/client.ts';
import { createCompatApp, type CompatScope } from './http/fastify-compat.ts';
import { makeConsoleLogger } from './http/logger.ts';
import { registerRoutes } from './routes/register.ts';
import { runLifecycleSweep } from './services/lifecycle.ts';

interface Booted {
  app: CompatScope;
}

interface Env {
  /**
   * Hyperdrive binding (`wrangler.jsonc` → `hyperdrive`). It points at a pooled, already-warm
   * connection to Neon, which is what makes a per-request `pg.Client` cheap.
   */
  HYPERDRIVE?: { connectionString: string };
}

let booting: Promise<Booted> | null = null;

function boot(): Promise<Booted> {
  booting ??= (async () => {
    // Same rails as the Node entry. A Worker with a development secret or a live-payments flag must
    // refuse to serve, not degrade quietly.
    assertSafetyRails(config);

    // One deferred handle shared by the routes and the auth hook. Both resolve through `getDb()`, so
    // the connection is opened on the first query and reused for the life of the isolate.
    const db = deferredDb();

    const app = createCompatApp({
      db,
      log: makeConsoleLogger(),
      origins: corsOrigins,
      production: config.NODE_ENV === 'production',
    });

    // The single seam between the shared route table and this host. `registerRoutes` is typed
    // against Fastify's instance, and `CompatScope` implements exactly the methods it calls; the
    // cast is deliberate and confined to this line rather than weakening the route modules' types.
    await registerRoutes(app as unknown as FastifyInstance, { db });
    await app.ready();

    return { app };
  })().catch((err: unknown) => {
    booting = null;
    console.error('[boot] application failed to start', err);
    throw err;
  });
  return booting;
}

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const { app } = await boot();
    // Every request gets its own connection: a Worker may not reuse a TCP socket across requests.
    // Hyperdrive supplies the pooling behind that connection.
    return withRequestDb(env.HYPERDRIVE?.connectionString, () => app.fetch(request));
  },

  /**
   * Cron Trigger (`wrangler.jsonc` → `triggers.crons`). Runs the time-based booking transitions:
   * expire unanswered requests, open pickup when the window starts, settle delivered bookings whose
   * problem window closed after payment. The sweep is idempotent and bounded, so an overlapping or
   * retried invocation cannot double-apply a transition.
   */
  async scheduled(_event: unknown, env: Env = {}): Promise<void> {
    const { app } = await boot();
    await withRequestDb(env.HYPERDRIVE?.connectionString, async () => {
      const summary = await runLifecycleSweep(app as unknown as FastifyInstance);
      console.log('[cron] lifecycle sweep', JSON.stringify(summary));
    });
  },
};
