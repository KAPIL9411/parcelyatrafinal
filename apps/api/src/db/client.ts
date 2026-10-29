import type { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';

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

function wrapPgQueryable(client: pg.Pool | pg.PoolClient): Db {
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
        // Nested transactions inside an explicit transaction are not supported by this interface.
        // Callers that need nesting should use a savepoint explicitly.
        throw new Error('Nested transaction() is not supported; pass the transaction handle through.');
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
  const userAgent = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  if (userAgent === 'Cloudflare-Workers') {
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

export async function getDb(): Promise<Db> {
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
