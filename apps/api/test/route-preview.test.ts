/**
 * `/v1/geo/route-preview` — the road a traveller would drive, drawn from a routing engine.
 *
 * The map on the Send screen only ever receives a line the router actually returned, so these tests
 * stand a local router in its place: one that answers with a winding geometry, one that answers with
 * "no route", and the shape sampling and caching that keep a keystroke from becoming a router call.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { test } from 'node:test';

process.env.PGLITE_PATH = './data/pgdata.routepreview';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

const { encodePolyline } = await import('../src/lib/geo.ts');

/** The single pair for which the stand-in router claims no road exists. */
let unreachablePair = '';

let routerHits = 0;

/** A road that deliberately wanders: a straight line between the same ends would score zero here. */
function windingGeometry(lng1: number, lat1: number, lng2: number, lat2: number): Array<[number, number]> {
  const steps = 320;
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const wobble = Math.sin(t * Math.PI * 6) * 0.02;
    points.push([lat1 + wobble + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t + wobble]);
  }
  return points;
}

const router = createServer((req, res) => {
  routerHits += 1;
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const coords = url.pathname.replace('/route/v1/driving/', '');
  const [from, to] = coords.split(';');
  const [originLng, originLat] = (from ?? '').split(',').map(Number);
  const [destLng, destLat] = (to ?? '').split(',').map(Number);

  const key = `${Number(originLat).toFixed(4)},${Number(originLng).toFixed(4)}->${Number(destLat).toFixed(4)},${Number(destLng).toFixed(4)}`;
  if (key === unreachablePair) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'No Route', message: 'No route found' }));
    return;
  }

  const shape = windingGeometry(originLng!, originLat!, destLng!, destLat!);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      code: 'Ok',
      routes: [
        { distance: 248_900, duration: 18_600, geometry: encodePolyline(shape) },
      ],
    }),
  );
});

await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
const routerAddress = router.address();
if (typeof routerAddress !== 'object' || routerAddress === null) throw new Error('stub router did not bind');
process.env.OSRM_ROUTER_URL = `http://127.0.0.1:${routerAddress.port}`;

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { buildApp } = await import('../src/app.ts');
const { createSession } = await import('../src/lib/auth.ts');

const db = await getDb();
await runMigrations(db);
const app = await buildApp();
await app.ready();

async function city(name: string): Promise<{ id: string; lat: number; lng: number }> {
  const res = await db.query<{ id: string; lat: string | number; lng: string | number }>(
    `SELECT id, lat, lng FROM cities WHERE name = $1`,
    [name],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`seed city ${name} is missing`);
  return { id: row.id, lat: Number(row.lat), lng: Number(row.lng) };
}

const [baheri, delhi, pilibhit] = await Promise.all([
  city('Baheri'),
  city('Delhi'),
  city('Pilibhit'),
]);
unreachablePair =
  `${pilibhit.lat.toFixed(4)},${pilibhit.lng.toFixed(4)}->${delhi.lat.toFixed(4)},${delhi.lng.toFixed(4)}`;

interface Injected<T> {
  statusCode: number;
  body: T;
}

async function call<T = Record<string, unknown>>(url: string): Promise<Injected<T>> {
  const res = await app.inject({ method: 'GET', url });
  return { statusCode: res.statusCode, body: res.json() as T };
}

interface Preview {
  origin: { city_id: string; city_name: string; area: string | null; lat: number; lng: number; precision: string };
  destination: Preview['origin'];
  polyline: Array<[number, number]>;
  distance_km: number;
  duration_minutes: number;
  source: string;
  measured_at: string;
}

test('a preview returns the road the router gave, not a line drawn between two pins', async () => {
  const res = await call<Preview>(
    `/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${delhi.id}`,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'routed');
  assert.equal(res.body.distance_km, 248.9);
  assert.equal(res.body.duration_minutes, 310);

  const line = res.body.polyline;
  assert.ok(line.length >= 2, 'a road needs an end and a start');
  assert.ok(line.length <= 260, 'a full intercity geometry is downsampled before it reaches a phone');
  assert.ok(Math.abs(line[0]![0]! - baheri.lat) < 1e-4, 'the line starts at the pickup city');
  assert.ok(Math.abs(line.at(-1)![0]! - delhi.lat) < 1e-4, 'and ends at the drop city');

  // A straight line between these two cities would put every point on the segment between them.
  const [startLat, startLng] = line[0]!;
  const [endLat, endLng] = line.at(-1)!;
  const offLine = line.slice(1, -1).filter((point) => {
    const cross =
      (endLng - startLng) * (point[0] - startLat) - (endLat - startLat) * (point[1] - startLng);
    return Math.abs(cross) > 1e-4;
  });
  assert.ok(offLine.length > 100, 'the geometry follows the road, so it cannot be a straight connection');

  assert.equal(typeof res.body.measured_at, 'string');
});

test('asking twice does not ask the router twice', async () => {
  const before = routerHits;
  await call(`/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${delhi.id}`);
  await call(`/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${delhi.id}`);
  assert.equal(routerHits, before, 'a cached shape is served without touching the router');

  const res = await call<{ error: { code: string } }>(
    `/v1/geo/route-preview?origin_city_id=${pilibhit.id}&dest_city_id=${delhi.id}`,
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'ROUTING_UNAVAILABLE');
});

test('an area is a coordinate only when a verified hotspot carries that name', async () => {
  const spot = await db.query<{ id: string; name: string }>(
    `SELECT h.id, h.name FROM hotspots h WHERE h.city_id = $1 ORDER BY h.name LIMIT 1`,
    [baheri.id],
  );
  const hotspot = spot.rows[0]!;

  const before = await call<Preview>(
    `/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${delhi.id}&origin_area=${encodeURIComponent(hotspot.name)}`,
  );
  assert.equal(before.statusCode, 200);
  assert.equal(before.body.origin.area, hotspot.name, 'the area is still reported');
  assert.equal(before.body.origin.precision, 'city', 'a candidate hotspot is not a location');
  assert.equal(before.body.origin.lat, baheri.lat, 'so the pin sits on the city');

  const user = await db.query<{ id: string }>(
    `INSERT INTO users (phone_hash, phone_last4, name) VALUES ($1,'0002',$2) RETURNING id`,
    [`routepreview:trust:${crypto.randomUUID()}`, 'Route preview reviewer'],
  );
  const userId = user.rows[0]!.id;
  await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'trust_safety')`, [userId]);
  const session = await createSession(db, userId, {});
  const token = session.accessToken;
  const staff = (method: 'POST' | 'PATCH', url: string, payload: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });

  const moved = await staff('PATCH', `/v1/admin/geo/hotspots/${hotspot.id}`, {
    lat: baheri.lat + 0.02,
    lng: baheri.lng + 0.02,
    pickup_enabled: true,
    service_modes: ['hub_to_hub', 'doorstep'],
    service_radius_m: 1500,
    operating_hours: { mon_sun: '08:00-20:00' },
    verification_notes: 'Coordinates checked against the surveyed market entrance.',
  });
  assert.equal(moved.statusCode, 200, moved.body as string);

  const verified = await staff('POST', `/v1/admin/geo/hotspots/${hotspot.id}/verify`, {
    decision: 'verify',
    notes: 'Entrance confirmed on site.',
  });
  assert.equal(verified.statusCode, 200, verified.body as string);

  const activated = await staff('PATCH', `/v1/admin/geo/hotspots/${hotspot.id}`, { status: 'active' });
  assert.equal(activated.statusCode, 200, activated.body as string);

  const after = await call<Preview>(
    `/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${delhi.id}&origin_area=${encodeURIComponent(hotspot.name)}`,
  );
  assert.equal(after.body.origin.precision, 'hotspot');
  assert.ok(Math.abs(after.body.origin.lat - (baheri.lat + 0.02)) < 1e-9, 'the pin moves to the surveyed entrance');
  assert.notEqual(after.body.origin.lat, before.body.origin.lat);

  const unknown = await call<Preview>(
    `/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${delhi.id}&origin_area=Somewhere+Else`,
  );
  assert.equal(unknown.body.origin.precision, 'city', 'an unmatched area falls back to the city, never a guess');
  assert.equal(unknown.body.origin.area, 'Somewhere Else');
});

test('a preview refuses nonsense instead of drawing something anyway', async () => {
  const sameCity = await call<{ error: { code: string } }>(
    `/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${baheri.id}`,
  );
  assert.equal(sameCity.statusCode, 422);
  assert.equal(sameCity.body.error.code, 'CITY_NOT_SERVICED');

  const unknownCity = await call<{ error: { code: string } }>(
    `/v1/geo/route-preview?origin_city_id=${crypto.randomUUID()}&dest_city_id=${delhi.id}`,
  );
  assert.equal(unknownCity.statusCode, 404);
  assert.equal(unknownCity.body.error.code, 'NOT_FOUND');

  const notAUuid = await call<{ error: { code: string } }>(
    '/v1/geo/route-preview?origin_city_id=baheri&dest_city_id=delhi',
  );
  assert.equal(notAUuid.statusCode, 400);
  assert.equal(notAUuid.body.error.code, 'VALIDATION_FAILED');

  const extraParam = await call<{ error: { code: string } }>(
    `/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${delhi.id}&shoe=leather`,
  );
  assert.equal(extraParam.statusCode, 400);
  assert.equal(extraParam.body.error.code, 'VALIDATION_FAILED');
});

test('the geometry is cached publicly, because a city pair does not move', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/geo/route-preview?origin_city_id=${baheri.id}&dest_city_id=${delhi.id}`,
  });
  assert.match(res.headers['cache-control'] ?? '', /max-age=3600/);
});

test('teardown', async () => {
  await app.close();
  await closeDb();
  await new Promise<void>((resolve, reject) =>
    router.close((err) => (err ? reject(err) : resolve())),
  );
});
