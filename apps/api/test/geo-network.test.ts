/**
 * The geographic network introduced by migration 0010.
 *
 * This asserts what the reference data is allowed to claim:
 *  - eight launch cities exist exactly once, with a state link;
 *  - every directed pair is present exactly once, and every edge is a candidate with no distance
 *    until a routing provider fills it;
 *  - no hotspot is active or verified, and none carries an invented coordinate;
 *  - exactly one launch pricing policy is active, and it matches the compiled defaults;
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
const { DEFAULT_LAUNCH_POLICY } = await import('@py/domain');

const LAUNCH_CITIES = [
  'Baheri',
  'Bareilly',
  'Delhi',
  'Ghaziabad',
  'Rudrapur',
  'Haldwani',
  'Pilibhit',
  'Lucknow',
] as const;

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
  assert.equal(Number(e.total), LAUNCH_CITIES.length * (LAUNCH_CITIES.length - 1), 'every directed pair exists');
  assert.equal(e.distinct_pairs, e.total, 'no duplicated origin→destination');
  assert.equal(e.with_distance, '0', 'no distance exists before a provider is called');
  assert.equal(e.operational, '0', 'nothing is operational without a measured distance');
  assert.equal(e.calculated, '0', 'nothing claims to be calculated');

  const policy = await db.query<{ version: string; params: Record<string, unknown> }>(
    `SELECT version, params FROM pricing_policies WHERE status = 'active'`,
  );
  assert.equal(policy.rows.length, 1, 'exactly one active policy');
  const active = policy.rows[0]!;
  assert.equal(active.version, DEFAULT_LAUNCH_POLICY.version);
  for (const [key, value] of Object.entries(DEFAULT_LAUNCH_POLICY)) {
    // `version` is the row's own column, not part of the tunable parameter set.
    if (key === 'version') continue;
    assert.equal(active.params[key], value, `policy ${key} matches the compiled default`);
  }

  const benchmarks = await db.query<{ total: string }>(`SELECT count(*)::text AS total FROM postal_benchmarks`);
  assert.equal(benchmarks.rows[0]!.total, '0', 'no third-party tariff is claimed before it is sourced');

  const again = await runMigrations(db);
  assert.deepEqual(again.applied, [], 'a second run applies nothing');

  await closeDb();
});

test('an operational route cannot exist without a measured distance', async () => {
  const db = await getDb();
  await runMigrations(db);

  const pair = await db.query<{ id: string }>(`SELECT id FROM route_edges ORDER BY id LIMIT 1`);
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
