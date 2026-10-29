import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.ts';
import type { Db } from './client.ts';
import { MIGRATION_SOURCES } from './migrations.generated.ts';
import { normalizeSql } from './migration-source.ts';

/**
 * Versioned migrations.
 *
 * Rules, in the order they matter:
 *
 *  1. Migrations are files, `NNNN_name.sql`, applied in version order.
 *  2. Applied versions and their SHA-256 are recorded in `schema_migrations`.
 *  3. A changed checksum for an applied version is a hard failure, not a warning. Editing a
 *     migration that already ran is how environments drift apart.
 *  4. The whole run holds `pg_advisory_xact_lock(hashtext('parcel_yatra_migrations'))`, so two API
 *     containers starting at once cannot race.
 *  5. A database that already has the base schema but no `schema_migrations` row is *baselined*:
 *     0001 is recorded as applied without re-running it. That is how the pre-migrations PGlite
 *     development database is adopted, and it is the only silent path.
 *
 * The runner is deliberately not clever: no down migrations, no squashing, no automatic repair.
 */

const LOCK_KEY = 'parcel_yatra_migrations';

export interface Migration {
  version: string;
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

export interface MigrationReport {
  applied: string[];
  baselined: string[];
  alreadyApplied: number;
  pending: string[];
}

function here(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Where the SQL files live, in dev (`apps/api/migrations`) and in the container (`/app/migrations`). */
export function migrationsDir(): string {
  const candidates = [
    config.MIGRATIONS_DIR,
    join(process.cwd(), 'migrations'),
    join(here(), '..', '..', 'migrations'),
    join(here(), '..', '..', '..', 'migrations'),
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  throw new Error(
    `No migrations directory found. Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}\nSet MIGRATIONS_DIR.`,
  );
}

export async function loadMigrations(): Promise<Migration[]> {
  const migrations = await readMigrationsFromDisk().catch((err: unknown) => {
    // Workers have no filesystem: `readdir`/`readFile` throw there. Fall back to the manifest that
    // `scripts/gen-migrations.mjs` compiles before each Worker build. The manifest is generated from
    // the same files, so the fallback cannot disagree with a correct checkout; a stale one is caught
    // by `test/migration-manifest.test.ts`.
    if (MIGRATION_SOURCES.length === 0) throw err;
    return MIGRATION_SOURCES.map((m) => ({
      version: m.version,
      name: m.name,
      path: `migrations/${m.version}_${m.name}.sql`,
      sql: m.sql,
      checksum: m.checksum,
    }));
  });

  const seen = new Set<string>();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version}.`);
    seen.add(m.version);
  }
  return migrations;
}

async function readMigrationsFromDisk(): Promise<Migration[]> {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(f)).sort();

  if (files.length === 0) throw new Error(`No migration files in ${dir}.`);

  const migrations: Migration[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const sql = await readFile(path, 'utf8');
    const [version] = file.split('_');
    if (!version) throw new Error(`Cannot read a version from ${file}.`);
    migrations.push({
      version,
      name: file.replace(/^\d+_/, '').replace(/\.sql$/, ''),
      path,
      sql,
      checksum: createHash('sha256').update(normalizeSql(sql), 'utf8').digest('hex'),
    });
  }

  return migrations;
}

async function ensureTable(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version      text PRIMARY KEY,
      name         text NOT NULL,
      checksum     text NOT NULL,
      applied_at   timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL DEFAULT 0
    );
  `);
}

export async function appliedMigrations(db: Db): Promise<AppliedMigration[]> {
  const exists = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations') AS exists`,
  );
  if (!exists.rows[0]?.exists) return [];
  const res = await db.query<AppliedMigration>(
    `SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC`,
  );
  return res.rows;
}

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: Migration[];
  /** Applied versions whose file has changed since it ran. Any entry here is a hard failure. */
  drifted: Array<{ version: string; applied: string; current: string }>;
  /** True when the base schema exists but migrations were never recorded (adoption case). */
  needsBaseline: boolean;
}

export async function migrationStatus(db: Db): Promise<MigrationStatus> {
  const all = await loadMigrations();
  const applied = await appliedMigrations(db);
  const appliedByVersion = new Map(applied.map((a) => [a.version, a]));

  const drifted = all
    .filter((m) => {
      const row = appliedByVersion.get(m.version);
      return row && row.checksum !== m.checksum;
    })
    .map((m) => ({
      version: m.version,
      applied: appliedByVersion.get(m.version)!.checksum,
      current: m.checksum,
    }));

  const pending = all.filter((m) => !appliedByVersion.has(m.version));

  let needsBaseline = false;
  if (applied.length === 0) {
    const base = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bookings') AS exists`,
    );
    needsBaseline = base.rows[0]?.exists === true;
  }

  return { applied, pending, drifted, needsBaseline };
}

/**
 * Apply every pending migration. Throws on drift, on a missing migration directory, or on the
 * first failing statement (the whole run is one transaction, so nothing is half-applied).
 */
export async function runMigrations(db: Db): Promise<MigrationReport> {
  const report: MigrationReport = { applied: [], baselined: [], alreadyApplied: 0, pending: [] };

  const before = await migrationStatus(db);
  if (before.drifted.length > 0) {
    throw new Error(
      'Applied migrations have changed on disk. Restore the original file or add a new migration:\n' +
        before.drifted.map((d) => `  - ${d.version}: applied ${d.applied.slice(0, 12)}…, file ${d.current.slice(0, 12)}…`).join('\n'),
    );
  }

  const all = await loadMigrations();
  const appliedVersions = new Set(before.applied.map((a) => a.version));
  const toApply = all.filter((m) => !appliedVersions.has(m.version));

  report.alreadyApplied = before.applied.length;
  report.pending = toApply.map((m) => m.version);

  if (toApply.length === 0) return report;

  await ensureTable(db);

  await db.transaction(async (tx) => {
    // Transaction-scoped: released automatically on commit or rollback.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [LOCK_KEY]);

    // Re-read under the lock. Another process may have applied something while we waited.
    const now = await appliedMigrations(tx);
    const done = new Set(now.map((a) => a.version));

    if (done.size === 0 && before.needsBaseline) {
      const first = all[0]!;
      await tx.query(
        `INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES ($1,$2,$3,0)
         ON CONFLICT (version) DO NOTHING`,
        [first.version, first.name, first.checksum],
      );
      done.add(first.version);
      report.baselined.push(first.version);
    }

    for (const migration of all) {
      if (done.has(migration.version)) continue;
      const started = Date.now();
      await tx.exec(migration.sql);
      await tx.query(
        `INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES ($1,$2,$3,$4)`,
        [migration.version, migration.name, migration.checksum, Date.now() - started],
      );
      report.applied.push(migration.version);
    }
  });

  return report;
}

/**
 * Boot guard for a deployed process: refuse to serve traffic when the database is behind the
 * checked-in migrations. Returns the pending versions instead of throwing so the caller can decide
 * (the API treats any pending migration as fatal).
 */
export async function pendingMigrations(db: Db): Promise<string[]> {
  const status = await migrationStatus(db);
  if (status.drifted.length > 0) {
    throw new Error(
      'Applied migrations have changed on disk:\n' +
        status.drifted.map((d) => `  - ${d.version}`).join('\n'),
    );
  }
  const pending = status.pending.map((m) => m.version);
  if (status.needsBaseline && !pending.includes('0001')) pending.unshift('0001');
  return pending;
}
