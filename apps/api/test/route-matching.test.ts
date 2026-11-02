/**
 * Route-based matching through the real Fastify app and the real database.
 *
 * The trip's geometry is written directly, the way the background measurement would write it. That
 * keeps the suite deterministic and offline: these tests are about the query, the gates and the
 * contract, not about whether a public OSRM instance is awake.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';

process.env.PGLITE_PATH = './data/pgdata.routematch';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.FEATURE_MATCHING_ENABLED = 'true';
process.env.LOG_LEVEL = 'fatal';

rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { buildApp } = await import('../src/app.ts');
const { createSession } = await import('../src/lib/auth.ts');
const { encodePolyline, decodePolyline } = await import('../src/lib/geo.ts');

const db = await getDb();
await runMigrations(db);
const app = await buildApp();
await app.ready();

interface Injected<T> {
  statusCode: number;
  body: T;
}

async function call<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string | null = null,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<Injected<T>> {
  const res = await app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { statusCode: res.statusCode, body: res.body ? (res.json() as T) : (undefined as T) };
}

async function city(name: string, state: string, lat: number, lng: number): Promise<string> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO cities (name, state, lat, lng, is_serviceable)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (name, state) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng
     RETURNING id`,
    [name, state, lat, lng],
  );
  return inserted.rows[0]!.id;
}

const BAREILLY = { lat: 28.367, lng: 79.43 };
const MORADABAD = { lat: 28.838, lng: 78.773 };
const GHAZIABAD = { lat: 28.669, lng: 77.453 };
const DELHI = { lat: 28.613, lng: 77.209 };

const CORRIDOR = [BAREILLY, MORADABAD, GHAZIABAD, DELHI].map(
  (p) => [p.lat, p.lng] as [number, number],
);

const bareillyId = await city('Bareilly', 'Uttar Pradesh', BAREILLY.lat, BAREILLY.lng);
const moradabadId = await city('Moradabad', 'Uttar Pradesh', MORADABAD.lat, MORADABAD.lng);
const ghaziabadId = await city('Ghaziabad', 'Uttar Pradesh', GHAZIABAD.lat, GHAZIABAD.lng);
const delhiId = await city('Delhi', 'National Capital Territory of Delhi', DELHI.lat, DELHI.lng);

async function user(tag: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO users (phone_hash, phone_last4, name) VALUES ($1,'0001',$2) RETURNING id`,
    [`routematch:${tag}:${crypto.randomUUID()}`, `Route ${tag}`],
  );
  return res.rows[0]!.id;
}

const senderId = await user('sender');
const travellerId = await user('traveller');
const otherSenderId = await user('other-sender');

await db.query(`INSERT INTO verifications (user_id, state) VALUES ($1,'verified')`, [travellerId]);
const senderToken = (await createSession(db, senderId, {})).accessToken;
const otherSenderToken = (await createSession(db, otherSenderId, {})).accessToken;
const travellerToken = (await createSession(db, travellerId, {})).accessToken;

const now = Date.now();
const hour = 3_600_000;

interface TripFixture {
  id: string;
  capacityKg: number;
  route: boolean;
  status?: string;
  departureAt?: Date;
  arrivalAt?: Date;
}

async function createTrip(over: TripFixture): Promise<string> {
  const departure = over.departureAt ?? new Date(now + 3 * hour);
  const arrival = over.arrivalAt ?? new Date(departure.getTime() + 5 * hour);
  const withRoute = over.route;
  const res = await db.query<{ id: string }>(
    `INSERT INTO trips
       (traveller_id, origin_city_id, dest_city_id, mode, departure_at, arrival_estimate_at,
        capacity_kg, capacity_kg_remaining, accepts_documents_only, status,
        route_geometry, route_distance_m, route_duration_s, route_provider, route_source, route_status,
        route_computed_at, route_expires_at, route_min_lat, route_max_lat, route_min_lng, route_max_lng)
     VALUES ($1,$2,$3,'car',$4,$5,$6,$6,true,$7,
             $8,$9,$10,'osrm',$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      travellerId,
      bareillyId,
      delhiId,
      departure,
      arrival,
      over.capacityKg,
      over.status ?? 'published',
      withRoute ? encodePolyline(CORRIDOR) : null,
      withRoute ? 270_000 : null,
      withRoute ? 18_000 : null,
      withRoute ? 'routed' : null,
      withRoute ? 'ready' : 'pending',
      withRoute ? new Date() : null,
      withRoute ? new Date(Date.now() + 14 * 24 * hour) : null,
      withRoute ? Math.min(BAREILLY.lat, DELHI.lat) : null,
      withRoute ? Math.max(BAREILLY.lat, MORADABAD.lat, DELHI.lat) : null,
      withRoute ? Math.min(BAREILLY.lng, DELHI.lng) : null,
      withRoute ? Math.max(BAREILLY.lng, DELHI.lng) : null,
    ],
  );
  return res.rows[0]!.id;
}

async function createParcel(over: {
  sender?: string;
  origin: string;
  dest: string;
  weightKg?: number;
  windowStart?: Date;
  windowEnd?: Date;
}): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO parcels
       (sender_id, origin_city_id, dest_city_id, origin_area, dest_area, category, description,
        weight_kg, dims_cm, declared_value_paise, window_start, window_end,
        receiver_name, receiver_phone_hash, receiver_phone_last4, status)
     VALUES ($1,$2,$3,'Civil Lines','Raj Nagar','documents','A4 envelope with a signed agreement',
             $4, ARRAY[30,20,2], 50000, $5, $6, 'Receiver', $7, '0002', 'posted')
     RETURNING id`,
    [
      over.sender ?? senderId,
      over.origin,
      over.dest,
      over.weightKg ?? 2,
      over.windowStart ?? new Date(now + 2 * hour),
      over.windowEnd ?? new Date(now + 14 * hour),
      `receiver:${crypto.randomUUID()}`,
    ],
  );
  return res.rows[0]!.id;
}

const tripId = await createTrip({ id: '', capacityKg: 10, route: true });
const bareillyGhaziabadParcel = await createParcel({ origin: bareillyId, dest: ghaziabadId });

test('polyline storage round-trips the route the matcher reads', () => {
  const decoded = decodePolyline(encodePolyline(CORRIDOR));
  assert.equal(decoded.length, CORRIDOR.length);
  for (const [index, point] of CORRIDOR.entries()) {
    assert.equal(decoded[index]![0].toFixed(5), point[0].toFixed(5));
    assert.equal(decoded[index]![1].toFixed(5), point[1].toFixed(5));
  }
});

test('a sender-created parcel discovers a trip whose route passes through it', async () => {
  const res = await call<{
    matches: Array<{
      trip_id: string;
      route_source: string;
      detour_km: number;
      leg_km: number;
      drop_eta_at: string;
      arrival_estimate_at: string;
      score_breakdown: { formula_version: string };
    }>;
    no_match_reasons: string[];
  }>('GET', `/v1/parcels/${bareillyGhaziabadParcel}/matches`, senderToken);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.matches.length, 1);
  const match = res.body.matches[0]!;
  assert.equal(match.trip_id, tripId);
  assert.equal(match.route_source, 'routed');
  assert.equal(match.detour_km, 0);
  assert.ok(match.leg_km > 0);
  assert.ok(new Date(match.drop_eta_at) < new Date(match.arrival_estimate_at));
  assert.equal(match.score_breakdown.formula_version, 'match-p2.0');
});

test('a traveller-created trip discovers parcels waiting along it', async () => {
  const res = await call<{
    route_status: string;
    items: Array<{ parcel_id: string; score: number; score_breakdown: { formula_version: string } }>;
  }>('GET', `/v1/trips/${tripId}/opportunities`, travellerToken);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.route_status, 'ready');
  assert.deepEqual(
    res.body.items.map((i) => i.parcel_id),
    [bareillyGhaziabadParcel],
  );
  assert.equal(res.body.items[0]!.score_breakdown.formula_version, 'match-p2.0');
});

test('a reversed parcel is refused with a route reason, not silently hidden', async () => {
  const reversed = await createParcel({ origin: delhiId, dest: ghaziabadId });
  const res = await call<{ matches: unknown[]; no_match_reasons: string[] }>(
    'GET',
    `/v1/parcels/${reversed}/matches`,
    senderToken,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.matches.length, 0);
  assert.ok(res.body.no_match_reasons.includes('NO_TRIP_ON_ROUTE'));
});

test('a trip with no geometry still matches an exact city pair and never guesses a corridor', async () => {
  const pendingTrip = await createTrip({ id: '', capacityKg: 10, route: false });
  const exact = await createParcel({ origin: bareillyId, dest: delhiId });
  const corridorOnly = await createParcel({ origin: moradabadId, dest: ghaziabadId });

  const exactRes = await call<{ matches: Array<{ trip_id: string; route_source: string }> }>(
    'GET',
    `/v1/parcels/${exact}/matches`,
    senderToken,
  );
  assert.equal(exactRes.statusCode, 200);
  const exactMatch = exactRes.body.matches.find((m) => m.trip_id === pendingTrip);
  assert.ok(exactMatch, 'the exact city pair is still visible without geometry');
  assert.equal(exactMatch!.route_source, 'exact');

  const corridorRes = await call<{ matches: Array<{ trip_id: string }> }>(
    'GET',
    `/v1/parcels/${corridorOnly}/matches`,
    senderToken,
  );
  assert.equal(corridorRes.statusCode, 200);
  assert.equal(
    corridorRes.body.matches.some((m) => m.trip_id === pendingTrip),
    false,
    'a mid-route parcel must not be fabricated from an unmeasured route',
  );
});

test('offering interest twice creates one row and reports already_offered', async () => {
  const first = await call<{ already_offered: boolean }>(
    'POST',
    `/v1/trips/${tripId}/opportunities/${bareillyGhaziabadParcel}/interest`,
    travellerToken,
  );
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.already_offered, false);

  const second = await call<{ already_offered: boolean }>(
    'POST',
    `/v1/trips/${tripId}/opportunities/${bareillyGhaziabadParcel}/interest`,
    travellerToken,
  );
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.already_offered, true);

  const rows = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM trip_interests WHERE trip_id = $1 AND parcel_id = $2`,
    [tripId, bareillyGhaziabadParcel],
  );
  assert.equal(rows.rows[0]!.count, '1');
});

test('two concurrent bookings cannot overbook a trip', async () => {
  // 3 kg of space, two 1.5 kg parcels with the 1.1 packaging allowance: 3.3 kg of demand.
  const tightTrip = await createTrip({ id: '', capacityKg: 3, route: true });
  const firstParcel = await createParcel({ sender: senderId, origin: bareillyId, dest: ghaziabadId, weightKg: 1.5 });
  const secondParcel = await createParcel({
    sender: otherSenderId,
    origin: moradabadId,
    dest: ghaziabadId,
    weightKg: 1.5,
  });

  const quote = async (parcelId: string): Promise<string> => {
    const res = await db.query<{ id: string }>(
      `INSERT INTO quotes
         (parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
          total_paise, traveller_paise, breakdown, expires_at)
       VALUES ($1,'test','{}',10000,0,0,10000,8000,'{}', now() + interval '1 hour')
       RETURNING id`,
      [parcelId],
    );
    return res.rows[0]!.id;
  };

  const [q1, q2] = await Promise.all([quote(firstParcel), quote(secondParcel)]);
  const [r1, r2] = await Promise.all([
    call('POST', '/v1/bookings', senderToken, { parcel_id: firstParcel, trip_id: tightTrip, quote_id: q1 }, {
      'idempotency-key': crypto.randomUUID(),
    }),
    call('POST', '/v1/bookings', otherSenderToken, { parcel_id: secondParcel, trip_id: tightTrip, quote_id: q2 }, {
      'idempotency-key': crypto.randomUUID(),
    }),
  ]);

  const created = [r1, r2].filter((r) => r.statusCode === 201);
  const refused = [r1, r2].filter((r) => r.statusCode !== 201);
  assert.equal(created.length, 1, 'exactly one booking may take the last kilogram');
  assert.equal(refused.length, 1);
  assert.ok(
    ['CAPACITY_UNAVAILABLE', 'PARCEL_HAS_ACTIVE_BOOKING'].includes(
      String((refused[0]!.body as { error?: { code?: string } }).error?.code),
    ),
  );

  const bookings = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bookings WHERE trip_id = $1 AND status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible','cancelled_safety','expired','refunded','paid_out')`,
    [tightTrip],
  );
  assert.equal(bookings.rows[0]!.count, '1');

  const remaining = await db.query<{ capacity_kg_remaining: string }>(
    `SELECT capacity_kg_remaining FROM trips WHERE id = $1`,
    [tightTrip],
  );
  assert.ok(Number(remaining.rows[0]!.capacity_kg_remaining) >= 0);
});

test('a cancelled trip disappears from matching', async () => {
  await db.query(`UPDATE trips SET status = 'cancelled' WHERE id = $1`, [tripId]);
  const res = await call<{ matches: Array<{ trip_id: string }> }>(
    'GET',
    `/v1/parcels/${bareillyGhaziabadParcel}/matches`,
    senderToken,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(
    res.body.matches.some((m) => m.trip_id === tripId),
    false,
    'the cancelled trip must not be offered',
  );
});

test('close the database', async () => {
  await app.close();
  await closeDb();
});
