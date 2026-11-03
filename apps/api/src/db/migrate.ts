import { closeDb, getDb } from './client.ts';
import { migrationStatus, migrationsDir, runMigrations } from './migrations.ts';

/**
 * Migration CLI.
 *
 *   npm run db:migrate            apply every pending migration
 *   npm run db:migrate -- --status   show applied/pending without changing anything
 *   npm run db:migrate -- --check    exit 1 when anything is pending or drifted (deploy gate)
 */

async function main(): Promise<void> {
  const mode = process.argv.includes('--status')
    ? 'status'
    : process.argv.includes('--check')
      ? 'check'
      : 'apply';

  const db = await getDb();
  console.log(`Driver: ${db.driver}`);
  console.log(`Migrations: ${migrationsDir()}`);

  if (mode === 'status' || mode === 'check') {
    const status = await migrationStatus(db);
    console.log(`Applied: ${status.applied.length}`);
    for (const m of status.applied) console.log(`  ok   ${m.version}  ${m.name}`);
    console.log(`Pending: ${status.pending.length}`);
    for (const m of status.pending) console.log(`  next ${m.version}  ${m.name}`);
    if (status.drifted.length) {
      console.error('Drift detected:');
      for (const d of status.drifted) console.error(`  changed ${d.version}`);
      process.exitCode = 1;
      return;
    }
    if (mode === 'check' && status.pending.length > 0) process.exitCode = 1;
    return;
  }

  const report = await runMigrations(db);
  if (report.baselined.length) console.log(`Baselined existing schema: ${report.baselined.join(', ')}`);
  if (report.applied.length) console.log(`Applied: ${report.applied.join(', ')}`);
  else console.log('Nothing to apply.');
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error('Migration failed:', err);
    await closeDb();
    process.exit(1);
  });
