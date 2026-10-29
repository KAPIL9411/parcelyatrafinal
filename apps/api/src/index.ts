import { config, assertSafetyRails } from './config.ts';
import { buildApp } from './app.ts';
import { closeDb, getDb, schemaExists } from './db/client.ts';
import { pendingMigrations, runMigrations } from './db/migrations.ts';
import { seedDatabase } from './db/seed.ts';
import { ensureHomepageSeed } from './lib/homepage.ts';
import { initSocketServer } from './socket/index.ts';
import { trackingStore } from './services/redis.ts';
import { historyWorker } from './services/history-worker.ts';

/**
 * Boot sequence.
 *
 * 1. Refuse to start if the configuration violates a pilot safety rail.
 * 2. Bring the database to the checked-in migration version, or refuse to start.
 * 3. Seed demo data only in a non-production database that is empty.
 * 4. Listen.
 *
 * In production the schema is never created implicitly and demo data is never written. Either the
 * deploy step ran `db:migrate` (the Compose entrypoint does), or `MIGRATE_ON_BOOT=true` was set
 * deliberately, or the process exits.
 */
async function main(): Promise<void> {
  assertSafetyRails(config);

  const db = await getDb();

  if (config.NODE_ENV === 'production') {
    if (config.MIGRATE_ON_BOOT) {
      const report = await runMigrations(db);
      if (report.applied.length) console.log(`Migrations applied at boot: ${report.applied.join(', ')}`);
    } else {
      const pending = await pendingMigrations(db);
      if (pending.length) {
        throw new Error(
          `Database is behind the checked-in migrations (${pending.join(', ')}). ` +
            'Run "npm run db:migrate" as a deploy step before starting the API.',
        );
      }
    }
  } else {
    // Development convenience: adopt an existing PGlite database by baselining it, then apply
    // anything newer. A failure here is fatal, as it would be in production.
    const report = await runMigrations(db);
    if (report.baselined.length) console.log(`Baselined existing development schema: ${report.baselined.join(', ')}`);
    if (report.applied.length) console.log(`Migrations applied: ${report.applied.join(', ')}`);

    if (config.AUTO_SEED && (await schemaExists(db))) {
      const users = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM users`);
      if (Number(users.rows[0]?.count ?? 0) === 0) {
        await seedDatabase(db);
        console.log('Demo data seeded.');
      }
    }
  }

  // The homepage is content, not schema: seed the default page once, in every environment, so the
  // console always has a published version to diff a draft against. Idempotent.
  await ensureHomepageSeed(db);

  const app = await buildApp();
  const io = initSocketServer(app.server, db);

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down.`);
    io.close();
    await trackingStore.close();
    await historyWorker.close();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });

  console.log(`
Parcel Yatra API
  url        http://${config.HOST}:${config.PORT}/v1
  env        ${config.NODE_ENV}
  database   ${db.driver}${config.DATABASE_URL ? '' : ` (${config.PGLITE_PATH})`}
  payments   sandbox only (provider: ${config.PAYMENT_PROVIDER}, live: false)
  payouts    disabled
  sms        ${config.SMS_PROVIDER}
  dev routes ${config.ENABLE_DEV_ENDPOINTS ? 'enabled' : 'disabled'}
`);
}

main().catch(async (err) => {
  console.error('Failed to start:', err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
