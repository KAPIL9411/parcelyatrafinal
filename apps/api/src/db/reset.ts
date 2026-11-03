import { rm } from 'node:fs/promises';
import { config } from '../config.ts';

/**
 * Deletes the local PGlite data directory. Development only: it refuses to run in production.
 * There is no production reset path, by design.
 */
async function main() {
  if (config.NODE_ENV === 'production') {
    console.error('Refusing to reset a production database.');
    process.exit(1);
  }
  await rm(config.PGLITE_PATH, { recursive: true, force: true });
  console.log(`Removed ${config.PGLITE_PATH}. Run "npm run db:migrate && npm run db:seed".`);
}

main();
