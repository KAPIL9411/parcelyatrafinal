/**
 * Shape of one compiled migration.
 *
 * `migrations.generated.ts` is produced from `migrations/*.sql` by `scripts/gen-migrations.mjs` and
 * is the Worker's only way to read the checked-in SQL: a Worker has no filesystem, so `readdir` /
 * `readFile` throw there. Node hosts keep reading the files from disk.
 */
export interface MigrationSource {
  version: string;
  name: string;
  /** SHA-256 of the LF-normalized SQL. Line endings must not change a checksum. */
  checksum: string;
  sql: string;
}

/**
 * Migrations are authored on Windows and applied on Linux, so CRLF and LF copies of the same file
 * must hash identically. Both the disk loader and the generator run text through this.
 */
export const normalizeSql = (sql: string): string => sql.replace(/\r\n/g, '\n');
