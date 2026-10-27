/**
 * Routing provider interface, cache, and route-edge lifecycle.
 *
 * The provider call is exercised with a fake `fetch`, so the request shape and the response
 * parsing are tested without a credential. No test claims a real road distance was measured.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PGLITE_PATH = './data/pgdata.routingtest';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.ROUTING_PROVIDER = 'none';

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const {
  GOOGLE_ROUTES_ENDPOINT,
  computeRouteMatrix,
  metresToKm,
  refreshCityPairs,
  resolveCityDistance,
  routingConfigured,
} = await import('../src/lib/routing.ts');
const { config } = await import('../src/config.ts');

function fakeFetch(
  handler: (input: string, init: RequestInit) => { status?: number; body: unknown },
  calls: Array<{ url: string; init: RequestInit }> = [],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const result = handler(String(input), init ?? {});
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof result.body === 'string' ? result.body : JSON.stringify(result.body)),
    } as Response;
  }) as typeof fetch;
}

async function cityId(db: Awaited<ReturnType<typeof getDb>>, name: string): Promise<string> {
  const res = await db.query<{ id: string }>(`SELECT id FROM cities WHERE name = $1`, [name]);
  return res.rows[0]!.id;
}

/**
 * The test database directory persists between runs, so the seeded pair is restored to its
 * candidate state before each test. Without this, a measured distance from a previous run makes
 * the "unresolved pair" assertion fail.
 */
async function resetPair(
  db: Awaited<ReturnType<typeof getDb>>,
  originCityId: string,
  destCityId: string,
): Promise<void> {
  await db.query(
    `DELETE FROM distance_cache
     WHERE from_kind = 'city' AND from_id = $1 AND to_kind = 'city' AND to_id = $2`,
    [originCityId, destCityId],
  );
  await db.query(
    `UPDATE route_edges
     SET status = 'candidate', distance_m = NULL, duration_s = NULL, provider = NULL,
         calculated_at = NULL, approved_by = NULL, approved_at = NULL, notes = NULL,
         updated_at = now()
     WHERE origin_city_id = $1 AND dest_city_id = $2`,
    [originCityId, destCityId],
  );
}

test('the matrix request is shaped for the Routes API and maps per-pair failures', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = fakeFetch(
    (url) => {
      assert.equal(url, GOOGLE_ROUTES_ENDPOINT);
      return {
        body: [
          {
            originIndex: 0,
            destinationIndex: 0,
            status: { code: 0 },
            condition: 'ROUTE_EXISTS',
            distanceMeters: 261_432,
            duration: '14_400s'.replace('_', ''),
          },
          {
            originIndex: 0,
            destinationIndex: 1,
            status: { code: 3, message: 'no route' },
            condition: 'ROUTE_NOT_FOUND',
          },
        ],
      };
    },
    calls,
  );

  const elements = await computeRouteMatrix(
    [{ key: 'a', lat: 28.6, lng: 77.2 }],
    [
      { key: 'b', lat: 29.2, lng: 79.5 },
      { key: 'c', lat: 30, lng: 80 },
    ],
    { apiKey: 'test-key', fetchImpl },
  );

  assert.equal(calls.length, 1);
  const init = calls[0]!.init;
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['X-Goog-Api-Key'], 'test-key');
  assert.match(headers['X-Goog-FieldMask'] ?? '', /distanceMeters/);
  const body = JSON.parse(String(init.body));
  assert.equal(body.travelMode, 'DRIVE');
  assert.equal(body.origins[0].waypoint.location.latLng.latitude, 28.6);
  assert.equal(body.destinations.length, 2);

  assert.deepEqual(elements[0], {
    originKey: 'a',
    destinationKey: 'b',
    distanceM: 261_432,
    durationS: 14_400,
    error: null,
  });
  assert.equal(elements[1]!.distanceM, null);
  assert.match(elements[1]!.error ?? '', /no route/);
});

test('a provider HTTP error is surfaced, not converted into a distance', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 403, body: 'PERMISSION_DENIED' }));
  await assert.rejects(
    computeRouteMatrix([{ key: 'a', lat: 1, lng: 2 }], [{ key: 'b', lat: 3, lng: 4 }], {
      apiKey: 'test-key',
      fetchImpl,
    }),
    /HTTP 403/,
  );
  assert.equal(metresToKm(261_432), 261.43);
});

test('an unresolved pair is estimated and labelled, then becomes routed after the matrix', async () => {
  const db = await getDb();
  await runMigrations(db);
  const baheri = await cityId(db, 'Baheri');
  const bareilly = await cityId(db, 'Bareilly');
  await resetPair(db, baheri, bareilly);

  assert.equal(routingConfigured(), false, 'no provider is configured in this test');

  const before = await resolveCityDistance(db, baheri, bareilly);
  assert.equal(before.kind, 'estimated');
  assert.equal(before.source, 'estimated');
  assert.equal(before.routeStatus, 'unverified');
  assert.ok((before.distanceKm ?? 0) > 0);

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = fakeFetch(
    () => ({
      body: [
        {
          originIndex: 0,
          destinationIndex: 0,
          status: { code: 0 },
          condition: 'ROUTE_EXISTS',
          distanceMeters: 58_400,
          duration: '5400s',
        },
      ],
    }),
    calls,
  );

  const summary = await refreshCityPairs(
    db,
    [{ originCityId: baheri, destCityId: bareilly }],
    { apiKey: 'test-key', fetchImpl },
  );
  assert.equal(summary.resolved, 1);
  assert.equal(summary.failed, 0);

  const edge = await db.query<{ status: string; distance_m: number; provider: string }>(
    `SELECT status, distance_m, provider FROM route_edges WHERE origin_city_id = $1 AND dest_city_id = $2`,
    [baheri, bareilly],
  );
  assert.equal(edge.rows[0]!.status, 'calculated');
  assert.equal(edge.rows[0]!.distance_m, 58_400);
  assert.equal(edge.rows[0]!.provider, 'google_routes');

  const after = await resolveCityDistance(db, baheri, bareilly);
  assert.equal(after.kind, 'routed');
  assert.equal(after.source, 'routed');
  assert.equal(after.distanceKm, 58.4);
  assert.equal(after.routeStatus, 'calculated');

  const again = await refreshCityPairs(
    db,
    [{ originCityId: baheri, destCityId: bareilly }],
    { apiKey: 'test-key', fetchImpl },
  );
  assert.equal(again.resolved, 0, 'a calculated distance is not re-billed by default');
  assert.equal(calls.length, 1);

  await closeDb();
});

test('an approved route is never overwritten by the provider', async () => {
  const db = await getDb();
  await runMigrations(db);
  const baheri = await cityId(db, 'Baheri');
  const bareilly = await cityId(db, 'Bareilly');
  await resetPair(db, baheri, bareilly);

  await db.query(
    `UPDATE route_edges SET status = 'approved', distance_m = 61_000, duration_s = 5700, provider = 'survey'
     WHERE origin_city_id = $1 AND dest_city_id = $2`,
    [baheri, bareilly],
  );

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = fakeFetch(
    () => ({
      body: [
        {
          originIndex: 0,
          destinationIndex: 0,
          status: { code: 0 },
          distanceMeters: 1,
          duration: '1s',
        },
      ],
    }),
    calls,
  );

  const summary = await refreshCityPairs(
    db,
    [{ originCityId: baheri, destCityId: bareilly }],
    { apiKey: 'test-key', fetchImpl },
  );
  assert.equal(summary.skippedApproved, 1);
  assert.equal(calls.length, 0, 'the provider is not called for an approved pair');

  const edge = await db.query<{ status: string; distance_m: number; provider: string }>(
    `SELECT status, distance_m, provider FROM route_edges WHERE origin_city_id = $1 AND dest_city_id = $2`,
    [baheri, bareilly],
  );
  assert.equal(edge.rows[0]!.status, 'approved');
  assert.equal(edge.rows[0]!.distance_m, 61_000);
  assert.equal(edge.rows[0]!.provider, 'survey');

  // A deployment that requires an operational route refuses an approved-but-not-operational pair.
  config.REQUIRE_OPERATIONAL_ROUTE = true;
  try {
    const gated = await resolveCityDistance(db, baheri, bareilly);
    assert.equal(gated.kind, 'unavailable');
    assert.equal(gated.reason, 'route_not_operational');
  } finally {
    config.REQUIRE_OPERATIONAL_ROUTE = false;
  }

  await closeDb();
});

test('a failed provider attempt is recorded and leaves the edge measurable', async () => {
  const db = await getDb();
  await runMigrations(db);
  const baheri = await cityId(db, 'Baheri');
  const pilibhit = await cityId(db, 'Pilibhit');
  await resetPair(db, baheri, pilibhit);

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = fakeFetch(
    () => ({
      body: [
        {
          originIndex: 0,
          destinationIndex: 0,
          status: { code: 8, message: 'quota exceeded' },
          condition: 'ROUTE_NOT_FOUND',
        },
      ],
    }),
    calls,
  );

  const summary = await refreshCityPairs(
    db,
    [{ originCityId: baheri, destCityId: pilibhit }],
    { apiKey: 'test-key', fetchImpl },
  );
  assert.equal(summary.failed, 1);

  const cache = await db.query<{ status: string; error: string; distance_m: number | null }>(
    `SELECT status, error, distance_m FROM distance_cache
     WHERE from_kind='city' AND from_id=$1 AND to_kind='city' AND to_id=$2 AND provider='google_routes'`,
    [baheri, pilibhit],
  );
  assert.equal(cache.rows[0]!.status, 'failed');
  assert.match(cache.rows[0]!.error, /quota exceeded/);
  assert.equal(cache.rows[0]!.distance_m, null);

  const edge = await db.query<{ status: string }>(
    `SELECT status FROM route_edges WHERE origin_city_id = $1 AND dest_city_id = $2`,
    [baheri, pilibhit],
  );
  assert.equal(edge.rows[0]!.status, 'failed');

  const resolved = await resolveCityDistance(db, baheri, pilibhit);
  assert.equal(resolved.kind, 'estimated', 'a failure does not erase the labelled fallback');

  await closeDb();
});
