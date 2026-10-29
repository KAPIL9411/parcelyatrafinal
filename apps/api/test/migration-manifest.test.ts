import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MIGRATION_SOURCES } from '../src/db/migrations.generated.ts';
import { normalizeSql } from '../src/db/migration-source.ts';

/**
 * The Worker reads migrations from the compiled manifest, not from disk, so a manifest that drifts
 * from `migrations/` would make `/v1/readiness` lie — it would report "ready" while a migration is
 * pending, or "checksum drift" for an untouched file. This test is the only thing standing between
 * a forgotten `npm run gen:migrations` and that outcome.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

test('generated manifest matches migrations/ exactly', async () => {
  const files = (await readdir(migrationsDir))
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(f))
    .sort();

  assert.ok(files.length > 0, 'no migration files found');
  assert.deepEqual(
    MIGRATION_SOURCES.map((m) => `${m.version}_${m.name}.sql`),
    files,
    'migrations.generated.ts is out of date — run `npm run gen:migrations -w @py/api`',
  );

  for (const [index, file] of files.entries()) {
    const source = MIGRATION_SOURCES[index]!;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    assert.equal(
      source.checksum,
      createHash('sha256').update(normalizeSql(sql), 'utf8').digest('hex'),
      `${file} changed since the manifest was generated — run \`npm run gen:migrations -w @py/api\``,
    );
    assert.equal(normalizeSql(source.sql), normalizeSql(sql), `${file} text differs from the manifest`);
  }
});

test('checksums ignore CRLF line endings', () => {
  const lf = 'CREATE TABLE t (id int);\nSELECT 1;\n';
  assert.equal(normalizeSql(lf.replace(/\n/g, '\r\n')), lf);
});
