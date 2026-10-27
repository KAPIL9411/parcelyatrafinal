/**
 * Fill the road-distance matrix.
 *
 *   npm run geo:matrix             fill pairs with no measured distance
 *   npm run geo:matrix -- --all    also refresh pairs whose distance was calculated but never
 *                                 approved
 *
 * A pair that is already `approved` or `operational` is never overwritten: that number was signed
 * off by a person. The script writes provider results to `distance_cache` and to `route_edges`
 * (status `calculated`). It never marks an edge operational.
 *
 * Without GOOGLE_MAPS_API_KEY the script prints the unresolved pairs and exits non-zero. It does
 * not fall back to estimates for stored data — an estimate is a runtime fallback for a quote, not
 * evidence that a road was driven.
 */
import { closeDb, getDb } from '../src/db/client.ts';
import { pendingMigrations } from '../src/db/migrations.ts';
import { config } from '../src/config.ts';
import { refreshCityPairs, routingConfigured } from '../src/lib/routing.ts';

const all = process.argv.includes('--all');

const db = await getDb();
const pending = await pendingMigrations(db);
if (pending.length > 0) {
  console.error(`Database has pending migrations (${pending.join(', ')}). Run them before filling routes.`);
  await closeDb();
  process.exit(1);
}

const edges = await db.query<{
  origin_city_id: string;
  dest_city_id: string;
  origin: string;
  dest: string;
  status: string;
  distance_m: number | null;
}>(
  `SELECT e.origin_city_id, e.dest_city_id, o.name AS origin, d.name AS dest, e.status, e.distance_m
   FROM route_edges e
   JOIN cities o ON o.id = e.origin_city_id
   JOIN cities d ON d.id = e.dest_city_id
   ORDER BY o.name, d.name`,
);

const targets = edges.rows.filter((r) => {
  if (r.status === 'approved' || r.status === 'operational') return false;
  return all ? true : r.distance_m === null || r.status === 'failed' || r.status === 'candidate';
});

if (!routingConfigured()) {
  console.error(
    [
      'ROUTING_PROVIDER is not google or GOOGLE_MAPS_API_KEY is not set.',
      'Road distances are unresolved; the API will label them as estimates (or refuse quotes when',
      'ALLOW_ESTIMATED_DISTANCE=false). Required environment variables:',
      '  ROUTING_PROVIDER=google',
      '  GOOGLE_MAPS_API_KEY=<server-side key with the Routes API enabled>',
      '',
      `Unresolved directed pairs (${targets.length}):`,
      ...targets.slice(0, 80).map((r) => `  - ${r.origin} → ${r.dest} (${r.status})`),
      targets.length > 80 ? `  … and ${targets.length - 80} more` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  await closeDb();
  process.exit(1);
}

console.log(`Measuring ${targets.length} directed pair(s) with ${config.ROUTING_PROVIDER}.`);
const summary = await refreshCityPairs(
  db,
  targets.map((r) => ({ originCityId: r.origin_city_id, destCityId: r.dest_city_id })),
  { onlyMissing: !all },
);

console.log(
  JSON.stringify(
    {
      pairs_requested: summary.pairs,
      resolved: summary.resolved,
      failed: summary.failed,
      skipped_approved: summary.skippedApproved,
      errors: summary.errors,
    },
    null,
    2,
  ),
);

const state = await db.query<{ status: string; n: string }>(
  `SELECT status, count(*)::text AS n FROM route_edges GROUP BY status ORDER BY status`,
);
console.log('route edges by status:', Object.fromEntries(state.rows.map((r) => [r.status, Number(r.n)])));

await closeDb();
if (summary.failed > 0) process.exit(1);
