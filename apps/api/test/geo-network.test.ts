/**
 * The geographic network introduced by migration 0010 and extended by 0016.
 *
 * This asserts what the reference data is allowed to claim:
 *  - ten corridor-and-context cities exist exactly once, with a state link;
 *  - the Bareilly–Nainital corridor carries the finalized plan distances as operational edges;
 *    every other pair stays a candidate with no distance until a routing provider fills it;
 *  - no hotspot is active or verified, and none carries an invented coordinate;
 *  - exactly one pricing policy is active — the pilot slab tariff — and its key figures match the
 *    compiled defaults;
 *  - re-running the runner applies nothing.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PGLITE_PATH = './data/pgdata.geotest';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { DEFAULT_PILOT_POLICY } = await import('@py/domain');

const LAUNCH_CITIES = [
  'Baheri',
  'Bareilly',
  'Delhi',
  'Ghaziabad',
  'Haldwani',
  'Kichha',
  'Lucknow',
  'Nainital',
  'Pilibhit',
  'Rudrapur',
] as const;

// The six corridor stops whose fixed pairwise distances migration 0016 publishes.
const CORRIDOR_STOPS = ['Bareilly', 'Baheri', 'Kichha', 'Rudrapur', 'Haldwani', 'Nainital'] as const;

test('the launch network is seeded, connected, and honest about what is unverified', async () => {
  const db = await getDb();
  await runMigrations(db);

  const cities = await db.query<{ id: string; name: string; status: string; state_id: string | null }>(
    `SELECT id, name, status, state_id FROM cities WHERE name = ANY($1::text[]) ORDER BY name`,
    [LAUNCH_CITIES],
  );
  assert.equal(cities.rows.length, LAUNCH_CITIES.length, 'each launch city exists exactly once');
  assert.equal(new Set(cities.rows.map((c) => c.name)).size, LAUNCH_CITIES.length, 'no duplicate city');
  for (const city of cities.rows) {
    assert.equal(city.status, 'active', `${city.name} is active`);
    assert.ok(city.state_id, `${city.name} is linked to a state`);
  }

  const zones = await db.query<{ city: string; zones: string }>(
    `SELECT c.name AS city, count(*)::text AS zones
     FROM zones z JOIN cities c ON c.id = z.city_id
     WHERE c.name = ANY($1::text[]) GROUP BY c.name ORDER BY c.name`,
    [LAUNCH_CITIES],
  );
  assert.equal(zones.rows.length, LAUNCH_CITIES.length);
  for (const row of zones.rows) {
    assert.ok(Number(row.zones) >= 4, `${row.city} has at least four operational groupings`);
  }

  const hotspots = await db.query<{
    total: string;
    active: string;
    verified: string;
    with_coords: string;
    enabled: string;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE status = 'active')::text AS active,
            count(*) FILTER (WHERE verification_status = 'verified')::text AS verified,
            count(*) FILTER (WHERE lat IS NOT NULL OR lng IS NOT NULL)::text AS with_coords,
            count(*) FILTER (WHERE pickup_enabled OR dropoff_enabled)::text AS enabled
     FROM hotspots`,
  );
  const h = hotspots.rows[0]!;
  assert.ok(Number(h.total) >= 38, `hotspot candidates seeded (found ${h.total})`);
  assert.equal(h.active, '0', 'no hotspot is active before geocoding and verification');
  assert.equal(h.verified, '0', 'no hotspot is verified without a human check');
  assert.equal(h.with_coords, '0', 'no coordinate is invented for a hotspot');
  assert.equal(h.enabled, '0', 'no pickup or drop-off is enabled on a candidate');

  const edges = await db.query<{
    total: string;
    distinct_pairs: string;
    with_distance: string;
    operational: string;
    calculated: string;
  }>(
    `SELECT count(*)::text AS total,
            count(DISTINCT (origin_city_id, dest_city_id))::text AS distinct_pairs,
            count(*) FILTER (WHERE distance_m IS NOT NULL)::text AS with_distance,
            count(*) FILTER (WHERE status = 'operational')::text AS operational,
            count(*) FILTER (WHERE status = 'calculated')::text AS calculated
     FROM route_edges`,
  );
  const e = edges.rows[0]!;
  // 56 directed slots among the original eight cities (0010) + the 18 corridor edges that add
  // Kichha or Nainital (0016). Pairs of the new stops with the non-corridor cities have no slot.
  assert.equal(Number(e.total), 74, 'every seeded directed pair exists exactly once');
  assert.equal(e.distinct_pairs, e.total, 'no duplicated origin→destination');
  const corridorEdges = CORRIDOR_STOPS.length * (CORRIDOR_STOPS.length - 1);
  assert.equal(e.operational, String(corridorEdges), 'the corridor carries the plan as operational edges');
  assert.equal(e.with_distance, e.operational, 'only the plan-published corridor edges have a distance');
  assert.equal(e.calculated, '0', 'nothing claims to be provider-calculated');

  const endToEnd = await db.query<{ distance_m: number; status: string }>(
    `SELECT le.distance_m, le.status
     FROM route_edges le
     JOIN cities o ON o.id = le.origin_city_id
     JOIN cities d ON d.id = le.dest_city_id
     WHERE o.name = 'Bareilly' AND d.name = 'Nainital'`,
  );
  assert.equal(endToEnd.rows[0]!.distance_m, 172000, 'the finalized 172 km end to end');
  assert.equal(endToEnd.rows[0]!.status, 'operational');

  const policy = await db.query<{ version: string; params: Record<string, unknown> }>(
    `SELECT version, params FROM pricing_policies WHERE status = 'active'`,
  );
  assert.equal(policy.rows.length, 1, 'exactly one active policy');
  const active = policy.rows[0]!;
  assert.equal(active.version, 'pilot-2026-11');
  assert.equal(active.params.model, 'pilot_slab');
  assert.equal(active.params.senderBasePaise, DEFAULT_PILOT_POLICY.senderBasePaise);
  assert.equal(active.params.senderRatePaisePerKm, DEFAULT_PILOT_POLICY.senderRatePaisePerKm);
  assert.equal(active.params.senderMinFarePaise, DEFAULT_PILOT_POLICY.senderMinFarePaise);
  assert.equal(active.params.travellerBasePaise, DEFAULT_PILOT_POLICY.travellerBasePaise);
  assert.equal(active.params.travellerRatePaisePerKm, DEFAULT_PILOT_POLICY.travellerRatePaisePerKm);
  assert.equal(active.params.travellerMinPayoutPaise, DEFAULT_PILOT_POLICY.travellerMinPayoutPaise);
  assert.deepEqual(active.params.maxDimsCm, DEFAULT_PILOT_POLICY.maxDimsCm);
  assert.equal(active.params.maxWeightKg, 3);

  const benchmarks = await db.query<{ total: string }>(`SELECT count(*)::text AS total FROM postal_benchmarks`);
  assert.equal(benchmarks.rows[0]!.total, '0', 'no third-party tariff is claimed before it is sourced');

  const again = await runMigrations(db);
  assert.deepEqual(again.applied, [], 'a second run applies nothing');

  await closeDb();
});

test('an operational route cannot exist without a measured distance', async () => {
  const db = await getDb();
  await runMigrations(db);

  const pair = await db.query<{ id: string }>(
    `SELECT id FROM route_edges WHERE distance_m IS NULL ORDER BY id LIMIT 1`,
  );
  const edgeId = pair.rows[0]!.id;

  await assert.rejects(
    db.query(`UPDATE route_edges SET status = 'operational' WHERE id = $1`, [edgeId]),
    /route_edges_operational_ck/,
    'the status ladder is enforced by the database, not only by application code',
  );

  await db.query(
    `UPDATE route_edges SET distance_m = 123456, duration_s = 9000, provider = 'test',
       status = 'calculated', calculated_at = now() WHERE id = $1`,
    [edgeId],
  );
  await db.query(`UPDATE route_edges SET status = 'operational' WHERE id = $1`, [edgeId]);
  const row = await db.query<{ status: string }>(`SELECT status FROM route_edges WHERE id = $1`, [edgeId]);
  assert.equal(row.rows[0]!.status, 'operational');

  await db.query(`UPDATE route_edges SET status = 'candidate', distance_m = NULL, duration_s = NULL WHERE id = $1`, [edgeId]);
  await closeDb();
});

test('a hotspot cannot be activated without coordinates and verification', async () => {
  const db = await getDb();
  await runMigrations(db);

  const hotspot = await db.query<{ id: string }>(`SELECT id FROM hotspots ORDER BY id LIMIT 1`);
  const hotspotId = hotspot.rows[0]!.id;

  await assert.rejects(
    db.query(`UPDATE hotspots SET status = 'active' WHERE id = $1`, [hotspotId]),
    /hotspots_active_ck/,
  );

  await db.query(
    `UPDATE hotspots SET lat = 28.1, lng = 79.2, verification_status = 'verified', status = 'active'
     WHERE id = $1`,
    [hotspotId],
  );
  await db.query(`UPDATE hotspots SET status = 'candidate', lat = NULL, lng = NULL, verification_status = 'unverified'
     WHERE id = $1`, [hotspotId]);
  await closeDb();
});
