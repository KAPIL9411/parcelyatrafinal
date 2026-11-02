/**
 * Public geography, serviceability, and the staff controls that make them true.
 *
 * These requests run through the real Fastify app and the real database. They demonstrate the
 * distinction the launch network depends on: a city existing, a direction being measured, a route
 * being approved, a route being operational, and a hotspot being verified are five different facts.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';

process.env.PGLITE_PATH = './data/pgdata.geoapi';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

// These tests move the seeded rows through their lifecycle (hotspot verification, route approval,
// policy activation). Starting from the previous run's database would make the first assertion
// depend on history, so the dedicated test directory is cleared before the client opens it.
rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { buildApp } = await import('../src/app.ts');
const { createSession } = await import('../src/lib/auth.ts');

const db = await getDb();
await runMigrations(db);
const app = await buildApp();
await app.ready();

async function staffSession(roles: string[], tag: string): Promise<string> {
  const user = await db.query<{ id: string }>(
    `INSERT INTO users (phone_hash, phone_last4, name) VALUES ($1,'0001',$2) RETURNING id`,
    [`geoapi:${tag}:${crypto.randomUUID()}`, `Geo ${tag}`],
  );
  const userId = user.rows[0]!.id;
  for (const role of roles) {
    await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [userId, role]);
  }
  const session = await createSession(db, userId, {});
  return session.accessToken;
}

const trustToken = await staffSession(['trust_safety', 'verification_reviewer'], 'trust');
const financeToken = await staffSession(['finance'], 'finance');
const plainToken = await staffSession([], 'plain');

interface Injected<T> {
  statusCode: number;
  body: T;
}

async function call<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string | null = null,
  payload?: unknown,
): Promise<Injected<T>> {
  const res = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { statusCode: res.statusCode, body: res.body ? (res.json() as T) : (undefined as T) };
}

async function cityId(name: string): Promise<string> {
  const res = await db.query<{ id: string }>(`SELECT id FROM cities WHERE name = $1`, [name]);
  return res.rows[0]!.id;
}

async function hotspotId(city: string, nameLike: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `SELECT h.id FROM hotspots h JOIN cities c ON c.id = h.city_id
     WHERE c.name = $1 AND h.name ILIKE $2 LIMIT 1`,
    [city, `%${nameLike}%`],
  );
  return res.rows[0]!.id;
}

const baheri = await cityId('Baheri');
const bareilly = await cityId('Bareilly');
const rudrapur = await cityId('Rudrapur');
const lucknow = await cityId('Lucknow');

test('public geography lists the eight launch cities without claiming they are connected', async () => {
  const cities = await call<{
    countries: Array<{ code: string }>;
    states: Array<{ name: string; code: string | null }>;
    cities: Array<{
      name: string;
      status: string;
      state_id?: string;
      coordinate_source: string | null;
      coordinate_verified_at: string | null;
      zones: Array<{ name: string }>;
    }>;
  }>('GET', '/v1/geo/cities');

  assert.equal(cities.statusCode, 200);
  const names = cities.body.cities.map((c) => c.name).sort();
  assert.deepEqual(names, ['Baheri', 'Bareilly', 'Delhi', 'Ghaziabad', 'Haldwani', 'Lucknow', 'Pilibhit', 'Rudrapur']);
  assert.ok(cities.body.states.some((s) => s.name === 'National Capital Territory of Delhi'));
  for (const city of cities.body.cities) {
    assert.equal(city.status, 'active');
    assert.equal(city.coordinate_source, 'manual_reference');
    assert.equal(city.coordinate_verified_at, null, 'a reference centroid is not a geocoded confirmation');
    assert.ok(city.zones.length >= 4);
  }

  const routes = await call<{ items: Array<{ status: string; distance_km: number | null; bookable: boolean }> }>(
    'GET',
    '/v1/geo/routes',
  );
  assert.equal(routes.statusCode, 200);
  assert.equal(routes.body.items.length, 56, 'all directed pairs exist as slots');
  assert.ok(routes.body.items.every((r) => r.status === 'candidate'));
  assert.ok(routes.body.items.every((r) => r.distance_km === null));
  assert.ok(routes.body.items.every((r) => r.bookable === false));
});

test('serviceability labels an estimate and refuses to call doorstep available', async () => {
  const res = await call<{
    hub_to_hub: { bookable: boolean; distance_source: string; route_status: string; distance_km: number };
    doorstep: { bookable: boolean; reason: string };
  }>('GET', `/v1/geo/serviceability?origin_city_id=${baheri}&dest_city_id=${bareilly}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hub_to_hub.bookable, true);
  assert.equal(res.body.hub_to_hub.distance_source, 'estimated');
  assert.equal(res.body.hub_to_hub.route_status, 'unverified');
  assert.ok(res.body.hub_to_hub.distance_km > 0);
  assert.equal(res.body.doorstep.bookable, false);
  assert.equal(res.body.doorstep.reason, 'no_verified_pickup_hotspot');
});

test('staff surfaces reject anonymous and non-staff callers', async () => {
  const anonymous = await call('GET', '/v1/admin/geo/coverage');
  assert.equal(anonymous.statusCode, 401);

  const plain = await call<{ error: { code: string } }>('GET', '/v1/admin/geo/coverage', plainToken);
  assert.equal(plain.statusCode, 403);
  assert.equal(plain.body.error.code, 'ROLE_REQUIRED');

  const staff = await call<{ routes: { total: number } }>('GET', '/v1/admin/geo/coverage', trustToken);
  assert.equal(staff.statusCode, 200);
  assert.equal(staff.body.routes.total, 56);
});

test('a hotspot becomes a real pickup/drop-off point only after coordinates and verification', async () => {
  const pickupId = await hotspotId('Baheri', 'Main market');
  const dropoffId = await hotspotId('Bareilly', 'Junction');

  // Verification without coordinates must be refused.
  const early = await call<{ error: { code: string } }>(
    'POST',
    `/v1/admin/geo/hotspots/${pickupId}/verify`,
    trustToken,
    { decision: 'verify' },
  );
  assert.equal(early.statusCode, 400);

  const moved = await call<{ status: string; verification_status: string }>(
    'PATCH',
    `/v1/admin/geo/hotspots/${pickupId}`,
    trustToken,
    {
      lat: 28.4736,
      lng: 79.4553,
      pickup_enabled: true,
      dropoff_enabled: false,
      service_modes: ['hub_to_hub', 'doorstep'],
      service_radius_m: 1500,
      operating_hours: { mon_sun: '08:00-20:00' },
      verification_notes: 'Coordinates checked against the surveyed market entrance.',
    },
  );
  assert.equal(moved.statusCode, 200);
  assert.equal(moved.body.verification_status, 'unverified');
  assert.equal(moved.body.status, 'candidate');

  const verified = await call('POST', `/v1/admin/geo/hotspots/${pickupId}/verify`, trustToken, {
    decision: 'verify',
    notes: 'Entrance and hours confirmed on site.',
  });
  assert.equal(verified.statusCode, 200);

  const activated = await call<{ status: string }>(
    'PATCH',
    `/v1/admin/geo/hotspots/${pickupId}`,
    trustToken,
    { status: 'active' },
  );
  assert.equal(activated.statusCode, 200);
  assert.equal(activated.body.status, 'active');

  // Destination hotspot.
  await call('PATCH', `/v1/admin/geo/hotspots/${dropoffId}`, trustToken, {
    lat: 28.3670,
    lng: 79.4304,
    dropoff_enabled: true,
    service_modes: ['hub_to_hub', 'doorstep'],
  });
  await call('POST', `/v1/admin/geo/hotspots/${dropoffId}/verify`, trustToken, { decision: 'verify' });
  const destActive = await call('PATCH', `/v1/admin/geo/hotspots/${dropoffId}`, trustToken, {
    status: 'active',
  });
  assert.equal(destActive.statusCode, 200);

  const publicList = await call<{ hotspots: Array<{ id: string }>; withheld_candidates: number }>(
    'GET',
    `/v1/geo/cities/${baheri}/hotspots`,
  );
  assert.ok(publicList.body.hotspots.some((h) => h.id === pickupId));
  assert.ok(publicList.body.withheld_candidates > 0, 'unverified candidates are counted, not published');

  // A verified hotspot with coordinates does not by itself make every pair doorstep-serviceable;
  // this pair now has both ends, so it does.
  const serviceable = await call<{ doorstep: { bookable: boolean; reason: string | null } }>(
    'GET',
    `/v1/geo/serviceability?origin_city_id=${baheri}&dest_city_id=${bareilly}`,
  );
  assert.equal(serviceable.body.doorstep.bookable, true);
  assert.equal(serviceable.body.doorstep.reason, null);

  // Moving an active hotspot's coordinates without re-verifying is refused.
  const silentMove = await call<{ error: { code: string } }>(
    'PATCH',
    `/v1/admin/geo/hotspots/${pickupId}`,
    trustToken,
    { lat: 28.48, lng: 79.46 },
  );
  assert.equal(silentMove.statusCode, 400);

  const audit = await db.query<{ action: string }>(
    `SELECT action FROM audit_log WHERE resource = 'hotspot' AND resource_id = ANY($1::text[])`,
    [[pickupId, dropoffId]],
  );
  assert.ok(audit.rows.some((r) => r.action === 'hotspot.verified'));
});

test('a route moves through calculated, approved, and operational without skipping a step', async () => {
  const early = await call<{ error: { code: string } }>(
    'POST',
    `/v1/admin/geo/routes/refresh`,
    trustToken,
    { pairs: [{ origin_city_id: baheri, dest_city_id: bareilly }] },
  );
  assert.equal(early.statusCode, 503, 'without a provider, refresh says so instead of inventing a distance');
  assert.equal(early.body.error.code, 'ROUTING_UNAVAILABLE');

  const edge = await db.query<{ id: string }>(
    `SELECT id FROM route_edges WHERE origin_city_id = $1 AND dest_city_id = $2`,
    [baheri, bareilly],
  );
  const edgeId = edge.rows[0]!.id;

  const premature = await call<{ error: { code: string } }>(
    'POST',
    `/v1/admin/geo/routes/${edgeId}/decision`,
    trustToken,
    { action: 'approve' },
  );
  assert.equal(premature.statusCode, 400, 'a candidate cannot be approved without a distance');

  await db.query(
    `UPDATE route_edges SET distance_m = 58400, duration_s = 5400, provider = 'test_survey',
            status = 'calculated', calculated_at = now() WHERE id = $1`,
    [edgeId],
  );

  const approve = await call('POST', `/v1/admin/geo/routes/${edgeId}/decision`, trustToken, { action: 'approve' });
  assert.equal(approve.statusCode, 200);

  const notYetOperational = await call<{ items: Array<{ status: string; bookable: boolean }> }>(
    'GET',
    `/v1/geo/routes?origin_city_id=${baheri}`,
  );
  const approved = notYetOperational.body.items.find((r) => r.status === 'approved');
  assert.ok(approved);
  assert.equal(approved.bookable, false, 'approved is not operational');

  const operational = await call('POST', `/v1/admin/geo/routes/${edgeId}/decision`, trustToken, {
    action: 'operational',
  });
  assert.equal(operational.statusCode, 200);

  const journey = await call<{ found: boolean; bookable: boolean; total_distance_km: number }>(
    'GET',
    `/v1/geo/journeys?origin_city_id=${baheri}&dest_city_id=${bareilly}`,
  );
  assert.equal(journey.body.found, true);
  assert.equal(journey.body.bookable, true);
  assert.equal(journey.body.total_distance_km, 58.4);

  const serviceability = await call<{ hub_to_hub: { distance_source: string; route_status: string; distance_km: number } }>(
    'GET',
    `/v1/geo/serviceability?origin_city_id=${baheri}&dest_city_id=${bareilly}`,
  );
  assert.equal(serviceability.body.hub_to_hub.distance_source, 'routed');
  assert.equal(serviceability.body.hub_to_hub.route_status, 'operational');
  assert.equal(serviceability.body.hub_to_hub.distance_km, 58.4);
});

test('a two-leg plan is found but is not sold as a single booking', async () => {
  await db.query(
    `UPDATE route_edges SET distance_m = 100000, status = 'operational', approved_at = now(),
            calculated_at = now(), provider = 'test_survey'
     WHERE (origin_city_id = $1 AND dest_city_id = $2)`,
    [baheri, rudrapur],
  );
  await db.query(
    `UPDATE route_edges SET distance_m = 120000, status = 'operational', approved_at = now(),
            calculated_at = now(), provider = 'test_survey'
     WHERE (origin_city_id = $1 AND dest_city_id = $2)`,
    [rudrapur, lucknow],
  );

  const journey = await call<{
    found: boolean;
    bookable: boolean;
    legs: Array<{ status: string }>;
    note: string | null;
  }>('GET', `/v1/geo/journeys?origin_city_id=${baheri}&dest_city_id=${lucknow}&max_legs=2`);
  assert.equal(journey.statusCode, 200);
  assert.equal(journey.body.found, true);
  assert.equal(journey.body.legs.length, 2);
  assert.ok(journey.body.legs.every((l) => l.status === 'operational'));
  assert.equal(journey.body.bookable, false);
  assert.match(journey.body.note ?? '', /single-traveller/);

  const singleLegOnly = await call<{ found: boolean }>(
    'GET',
    `/v1/geo/journeys?origin_city_id=${baheri}&dest_city_id=${lucknow}&max_legs=1`,
  );
  assert.equal(singleLegOnly.body.found, false);
});

test('pricing policies and postal benchmarks are staff-controlled and audited', async () => {
  const denied = await call<{ error: { code: string } }>(
    'POST',
    '/v1/admin/geo/policies',
    trustToken,
    { version: 'finance-only', name: 'x', params: {} },
  );
  assert.equal(denied.statusCode, 403, 'route staff cannot change prices');

  const created = await call<{ id: string }>('POST', '/v1/admin/geo/policies', financeToken, {
    version: 'geoapi-test-policy',
    name: 'Test policy',
    params: { baseFarePaise: 1500, commissionRate: 0.07 },
    notes: 'Test only.',
  });
  assert.equal(created.statusCode, 201);

  const activated = await call('POST', `/v1/admin/geo/policies/${created.body.id}/activate`, financeToken);
  assert.equal(activated.statusCode, 200);

  const active = await db.query<{ version: string }>(
    `SELECT version FROM pricing_policies WHERE status = 'active'`,
  );
  assert.equal(active.rows.length, 1);
  assert.equal(active.rows[0]!.version, 'geoapi-test-policy');

  const benchmark = await call<{ id: string }>('POST', '/v1/admin/geo/benchmarks', financeToken, {
    provider: 'India Post',
    service: 'Speed Post',
    category: 'documents',
    weight_band: '0-500g',
    amount_paise: 4_500,
    source_url: 'https://example.test/speed-post-tariff',
    retrieved_at: new Date().toISOString(),
    notes: 'Test record; not a quoted tariff.',
  });
  assert.equal(benchmark.statusCode, 201);

  const listed = await call<{ items: Array<{ id: string }> }>('GET', '/v1/admin/geo/benchmarks', trustToken);
  assert.ok(listed.body.items.some((b) => b.id === benchmark.body.id));

  const removed = await call('DELETE', `/v1/admin/geo/benchmarks/${benchmark.body.id}`, financeToken);
  assert.equal(removed.statusCode, 204);

  const audit = await db.query<{ action: string }>(
    `SELECT action FROM audit_log WHERE action LIKE 'pricing_policy.%' OR action LIKE 'postal_benchmark.%'`,
  );
  const actions = audit.rows.map((r) => r.action);
  assert.ok(actions.includes('pricing_policy.created'));
  assert.ok(actions.includes('pricing_policy.activated'));
  assert.ok(actions.includes('postal_benchmark.recorded'));
  assert.ok(actions.includes('postal_benchmark.deleted'));

  await app.close();
  await closeDb();
});
