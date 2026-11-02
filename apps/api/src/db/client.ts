import type { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';

import { config } from '../config.ts';

/**
 * Database access.
 *
 * Two drivers behind one interface:
 *
 *  - `pg` (node-postgres, pooled) whenever `DATABASE_URL` is set. This is the deployed path: a
 *    PostgreSQL 16+ server in the Compose stack, or a managed instance.
 *  - PGlite (PostgreSQL compiled to WebAssembly, embedded in the API process) otherwise. That keeps
 *    `npm run dev` to one command on a machine with no Docker. Every statement, constraint, enum
 *    and index is ordinary PostgreSQL and runs unchanged against either.
 *
 * The driver is chosen once at boot and never falls back. A deployment that sets DATABASE_URL and
 * cannot reach it fails to start rather than silently creating a local database.
 */

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** 'pg' for a networked PostgreSQL server, 'pglite' for the embedded development engine. */
  readonly driver: 'pg' | 'pglite';
}

let instance: Db | null = null;
let ready: Promise<void> | null = null;
let pgliteHandle: PGlite | null = null;
let pgPool: pg.Pool | null = null;

function wrapPgQueryable(client: pg.Pool | pg.PoolClient | pg.Client, opts: { single?: boolean } = {}): Db {
  return {
    driver: 'pg',
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await client.query(sql, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql: string) {
      // No parameters: node-postgres uses the simple protocol, which allows multiple statements.
      await client.query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!(client instanceof pg.Pool)) {
        if (!opts.single) {
          // Nested transactions inside an explicit transaction are not supported by this interface.
          // Callers that need nesting should use a savepoint explicitly.
          throw new Error('Nested transaction() is not supported; pass the transaction handle through.');
        }
        // Per-request connection (Workers): the whole request owns one socket, so BEGIN/COMMIT runs
        // on it directly. `single` is only set for the outer handle, so nesting still fails loudly.
        await client.query('BEGIN');
        try {
          const result = await fn(wrapPgQueryable(client));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        }
      }
      const conn = await client.connect();
      try {
        await conn.query('BEGIN');
        const result = await fn(wrapPgQueryable(conn));
        await conn.query('COMMIT');
        return result;
      } catch (err) {
        await conn.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}

function wrapPglite(client: PGlite): Db {
  return {
    driver: 'pglite',
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await client.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
    async exec(sql: string) {
      await client.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      return client.transaction(async (tx) => fn(wrapPglite(tx as unknown as PGlite)));
    },
  };
}

function sslConfig(): false | { rejectUnauthorized: boolean } {
  if (config.DATABASE_SSL === 'disable') return false;
  // `require` encrypts but does not verify the chain, which is what most managed providers need
  // behind their own CA bundle. `verify-full` is deliberately not offered until a CA path exists.
  return { rejectUnauthorized: config.DATABASE_SSL === 'verify-full' };
}

async function connectPg(): Promise<Db> {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
    statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    query_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    ssl: sslConfig(),
    application_name: 'parcel-yatra-api',
  });

  // A pool-level error (server restart, network partition) must not take the process down with an
  // unhandled 'error' event. The query that was in flight still fails; the next one reconnects.
  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('postgres pool error:', err.message);
  });

  const db = wrapPgQueryable(pool);
  await db.query('SELECT 1');
  pgPool = pool;
  return db;
}

async function connectPglite(): Promise<Db> {
  // PGlite is a development engine. On Workers it would pull WebAssembly into the isolate and then
  // fail (or, in `wrangler dev`, crash the runtime). Fail with a sentence the operator can act on
  // instead; production already requires DATABASE_URL in `assertSafetyRails`.
  if (isWorkersRuntime()) {
    throw new Error(
      'DATABASE_URL is required on Cloudflare Workers: the embedded PGlite engine is development-only.',
    );
  }
  // Loaded on demand: production always sets DATABASE_URL and uses `pg`, and a Worker bundle must
  // not pull the embedded engine's WebAssembly (and its worker/fs assumptions) in for nothing.
  const { PGlite } = await import('@electric-sql/pglite');
  // PGlite creates the leaf directory but not its parents.
  await mkdir(config.PGLITE_PATH, { recursive: true });
  const pglite = new PGlite(config.PGLITE_PATH);
  await pglite.waitReady;
  pgliteHandle = pglite;
  return wrapPglite(pglite);
}

/** True inside the Workers runtime, where sockets are per-request and there is no process lifetime. */
export function isWorkersRuntime(): boolean {
  return (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === 'Cloudflare-Workers';
}

/**
 * Request-scoped database handle for Workers.
 *
 * The runtime forbids reusing a TCP socket across requests — "TCP sockets cannot be created in global
 * scope and shared across requests" (https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).
 * A module-level `pg.Pool` keeps sockets alive between requests, so on Workers the pool hands the next
 * request a socket the runtime has already closed: every other request then hung until the 10s
 * statement timeout. Measured on the deployed Worker before this change: `/v1/homepage` alternated
 * 500 (10.5s) / 200 (1.5s).
 *
 * So each request gets its own `pg.Client`, and Hyperdrive provides the actual pooling: "Create a new
 * client instance for each request. Hyperdrive maintains the underlying database connection pool, so
 * creating a new client is fast."
 * (https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/)
 *
 * `AsyncLocalStorage` carries the client to `getDb()` so the route modules — which only ever see
 * `app.db` — need no changes. The client connects on first query, so routes that never touch the
 * database (root, CORS preflight, 404s) pay nothing.
 */
const requestDb = new AsyncLocalStorage<Db>();

interface RequestDbOptions {
  /** Hyperdrive's local endpoint speaks plain TCP inside the edge; direct connections need TLS. */
  tls: boolean;
  queryTimeoutMs: number;
}

function lazyPgClient(connectionString: string, { tls, queryTimeoutMs }: RequestDbOptions): { db: Db; close: () => Promise<void> } {
  let client: pg.Client | null = null;
  let connected = false;
  const ensure = async (): Promise<pg.Client> => {
    client ??= new pg.Client({
      connectionString,
      connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
      // `query_timeout` is enforced client-side. `statement_timeout` is deliberately NOT set here:
      // node-postgres sends it as a startup parameter (`options=-c ...`) and Hyperdrive's proxy did
      // not honour it — the query then hung until the client timeout. Hyperdrive caps a statement at
      // 60s on its own (https://developers.cloudflare.com/hyperdrive/platform/limits/).
      query_timeout: queryTimeoutMs,
      ssl: tls ? sslConfig() : false,
      application_name: 'parcel-yatra-api',
    });
    if (!connected) {
      // Connect explicitly before the first query. Letting `query()` connect implicitly arms
      // node-postgres' query timer while the Hyperdrive handshake is still in flight, so a cold pool
      // failed with `Query read timeout` even though the pool was healthy.
      await client.connect();
      connected = true;
    }
    return client;
  };
  const db: Db = {
    driver: 'pg',
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await (await ensure()).query(sql, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql: string) {
      await (await ensure()).query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      return wrapPgQueryable(await ensure(), { single: true }).transaction(fn);
    },
  };

  return {
    db,
    async close() {
      const open = client;
      client = null;
      // `end()` on a client that never connected resolves immediately.
      if (open) await open.end().catch(() => undefined);
    },
  };
}

/**
 * Runs one request with its own database connection. A no-op on Node (Render, tests, CLI), where the
 * pooled singleton is correct because the process outlives the request.
 */
export async function withRequestDb<T>(
  connectionString: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isWorkersRuntime()) return fn();

  // Hyperdrive is the intended path. Falling back to DATABASE_URL still works, but every request
  // then pays the full TLS handshake to the database host — keep the binding configured.
  const usingHyperdrive = Boolean(connectionString);
  const target = connectionString ?? config.DATABASE_URL;
  if (!target) {
    throw new Error('No database configured on Workers: bind HYPERDRIVE or set DATABASE_URL.');
  }

  const { db, close } = lazyPgClient(target, {
    tls: !usingHyperdrive,
    // Hyperdrive's initial origin connection is allowed 15s, and it happens inside the first query.
    // 20s keeps that first request alive; steady-state queries answer in single-digit milliseconds.
    queryTimeoutMs: usingHyperdrive ? 20_000 : config.DATABASE_STATEMENT_TIMEOUT_MS,
  });
  try {
    return await requestDb.run(db, fn);
  } finally {
    await close();
  }
}

export async function getDb(): Promise<Db> {
  const scoped = requestDb.getStore();
  if (scoped) return scoped;
  if (isWorkersRuntime()) {
    // A Worker query outside a request scope would fall through to the module-level pool and
    // reintroduce the cross-request socket reuse this whole arrangement exists to avoid.
    throw new Error('Database access outside a request on Workers; wrap the work in withRequestDb().');
  }
  if (!instance) {
    ready ??= (async () => {
      instance = config.DATABASE_URL ? await connectPg() : await connectPglite();
    })();
    try {
      await ready;
    } catch (err) {
      // A failed connect must not poison the process. Without this reset the rejected promise stays
      // cached and every later call fails with the first error, which on a long-lived Worker isolate
      // means the isolate never recovers from a database blip.
      ready = null;
      throw err;
    }
  }
  return instance!;
}

/**
 * A `Db` that opens the real connection on first use.
 *
 * The Worker entry uses this so that booting the HTTP app does not depend on the database being
 * reachable. That matters for two reasons: a Worker starts per request, so a failed connect at boot
 * would return a 500 before `/v1/health` could report *why*; and Fastify's own registration does not
 * need a connection, only the routes do. Every call still goes through `getDb()`, so the pooling,
 * driver selection and error handling are identical to the eager path.
 */
export function deferredDb(): Db {
  return {
    get driver() {
      return config.DATABASE_URL ? 'pg' : 'pglite';
    },
    async query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      return (await getDb()).query<T>(sql, params);
    },
    async exec(sql: string) {
      return (await getDb()).exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      return (await getDb()).transaction(fn);
    },
  };
}

export async function closeDb(): Promise<void> {
  const current = instance;
  instance = null;
  ready = null;
  if (!current) return;
  if (current.driver === 'pglite' && pgliteHandle) {
    await pgliteHandle.close();
    pgliteHandle = null;
  }
  if (current.driver === 'pg' && pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}

/** True when the base schema has been applied. Used only to decide whether a dev database needs migrating. */
export async function schemaExists(db: Db): Promise<boolean> {
  const res = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bookings') AS exists`,
  );
  return res.rows[0]?.exists === true;
}
