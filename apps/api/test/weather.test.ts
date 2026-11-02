/**
 * Current weather: the WMO mapping, the public route, and the cache's honesty rules.
 *
 * The provider is stubbed at the global `fetch`, so these tests exercise the real route, the real
 * database and the real mapping without depending on Open-Meteo being reachable.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';

process.env.PGLITE_PATH = './data/pgdata.weather';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { buildApp } = await import('../src/app.ts');
const { resetWeatherCache, loadCityWeather, wmoToWeather } = await import('../src/lib/weather.ts');

const db = await getDb();
await runMigrations(db);
const app = await buildApp();
await app.ready();

const CITY_ID = 'c0000000-0000-4000-8000-000000000010';
const CITY_NAME = 'Weather Test City';

await db.query(
  `INSERT INTO cities (id, name, state, lat, lng, is_serviceable) VALUES ($1,$2,'Test',28.367,79.4304,true)
   ON CONFLICT (id) DO NOTHING`,
  [CITY_ID, CITY_NAME],
);

const realFetch = globalThis.fetch;
let calls = 0;
let lastUrl: URL | null = null;

function stubProvider(
  handler: (url: URL) => { status?: number; body?: unknown; throws?: boolean } = () => ({}),
): void {
  calls = 0;
  lastUrl = null;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls += 1;
    const url = input instanceof URL ? input : new URL(String(input));
    lastUrl = url;
    const result = handler(url);
    if (result.throws) throw new Error('socket hang up');
    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const rainBody = {
  current: {
    time: '2026-10-31T09:15',
    temperature_2m: 31.44,
    apparent_temperature: 34.16,
    relative_humidity_2m: 68,
    wind_speed_10m: 12.34,
    precipitation: 0.42,
    cloud_cover: 91,
    is_day: 1,
    weather_code: 61,
  },
};

interface WeatherResponse {
  city_id: string;
  city_name: string;
  source: string;
  condition: string;
  label: string;
  is_day: boolean;
  temperature_c: number;
  apparent_c: number;
  humidity_pct: number;
  wind_kph: number;
  precipitation_mm: number;
  cloud_cover_pct: number;
  weather_code: number;
  observed_at: string;
  stale: boolean;
  fetched_at: string;
}

async function getWeather(query: string): Promise<{ statusCode: number; body: unknown; headers: Record<string, unknown> }> {
  const res = await app.inject({ method: 'GET', url: `/v1/weather${query}` });
  return {
    statusCode: res.statusCode,
    body: res.json(),
    headers: res.headers as Record<string, unknown>,
  };
}

test.after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  await closeDb();
});

test('maps every WMO code group to a drawable condition', () => {
  assert.deepEqual(wmoToWeather(0), { condition: 'clear', label: 'Clear sky' });
  assert.equal(wmoToWeather(1).condition, 'partly_cloudy');
  assert.equal(wmoToWeather(2).condition, 'partly_cloudy');
  assert.equal(wmoToWeather(3).condition, 'cloudy');
  assert.equal(wmoToWeather(45).condition, 'fog');
  assert.equal(wmoToWeather(48).condition, 'fog');
  assert.equal(wmoToWeather(51).condition, 'drizzle');
  assert.equal(wmoToWeather(55).condition, 'drizzle');
  assert.equal(wmoToWeather(61).condition, 'rain');
  assert.equal(wmoToWeather(65).condition, 'rain');
  assert.equal(wmoToWeather(67).condition, 'rain');
  assert.equal(wmoToWeather(71).condition, 'snow');
  assert.equal(wmoToWeather(77).condition, 'snow');
  assert.equal(wmoToWeather(82).condition, 'rain');
  assert.equal(wmoToWeather(86).condition, 'snow');
  assert.equal(wmoToWeather(95).condition, 'thunderstorm');
  assert.equal(wmoToWeather(99).condition, 'thunderstorm');
  // A code the catalogue does not know must still produce a sky, never a blank.
  assert.equal(wmoToWeather(1234).condition, 'cloudy');
});

test('serves current conditions for a city, fetched from its stored coordinates', async () => {
  resetWeatherCache();
  stubProvider(() => ({ body: rainBody }));

  const res = await getWeather(`?city_id=${CITY_ID}`);
  assert.equal(res.statusCode, 200);
  const body = res.body as WeatherResponse;

  assert.equal(body.city_id, CITY_ID);
  assert.equal(body.city_name, CITY_NAME);
  assert.equal(body.source, 'open_meteo');
  assert.equal(body.condition, 'rain');
  assert.equal(body.label, 'Light rain');
  assert.equal(body.is_day, true);
  assert.equal(body.temperature_c, 31.4);
  assert.equal(body.apparent_c, 34.2);
  assert.equal(body.wind_kph, 12.3);
  assert.equal(body.precipitation_mm, 0.42);
  assert.equal(body.cloud_cover_pct, 91);
  assert.equal(body.weather_code, 61);
  assert.equal(body.stale, false);
  assert.match(body.observed_at, /^2026-10-31T09:15Z$/);
  assert.match(String(res.headers['cache-control']), /max-age=300/);

  // The provider must have been addressed with the city's own coordinates, not client input.
  assert.ok(lastUrl);
  assert.equal(lastUrl.searchParams.get('latitude'), '28.3670');
  assert.equal(lastUrl.searchParams.get('longitude'), '79.4304');
  assert.equal(lastUrl.searchParams.get('timezone'), 'UTC');
});

test('a second request inside the cache window does not call the provider again', async () => {
  resetWeatherCache();
  stubProvider(() => ({ body: rainBody }));

  await getWeather(`?city_id=${CITY_ID}`);
  assert.equal(calls, 1);
  const second = await getWeather(`?city_id=${CITY_ID}`);
  assert.equal(second.statusCode, 200);
  assert.equal(calls, 1);
});

test('unknown city is a 404, malformed id is a validation failure', async () => {
  stubProvider(() => ({ body: rainBody }));
  const missing = await getWeather('?city_id=00000000-0000-4000-8000-000000000000');
  assert.equal(missing.statusCode, 404);
  assert.equal((missing.body as { error: { code: string } }).error.code, 'NOT_FOUND');

  const invalid = await getWeather('?city_id=not-a-uuid');
  assert.equal(invalid.statusCode, 400);
  assert.equal((invalid.body as { error: { code: string } }).error.code, 'VALIDATION_FAILED');

  const unknownField = await getWeather(`?city_id=${CITY_ID}&lat=1`);
  assert.equal(unknownField.statusCode, 400);
});

test('an unusable provider answers 503 WEATHER_UNAVAILABLE, never invented numbers', async () => {
  resetWeatherCache();
  stubProvider(() => ({ status: 500, body: { error: true } }));

  const failed = await getWeather(`?city_id=${CITY_ID}`);
  assert.equal(failed.statusCode, 503);
  assert.equal((failed.body as { error: { code: string } }).error.code, 'WEATHER_UNAVAILABLE');

  resetWeatherCache();
  stubProvider(() => ({ throws: true }));
  const unreachable = await getWeather(`?city_id=${CITY_ID}`);
  assert.equal(unreachable.statusCode, 503);
  assert.equal((unreachable.body as { error: { code: string } }).error.code, 'WEATHER_UNAVAILABLE');

  resetWeatherCache();
  stubProvider(() => ({ body: { current: { time: 'x' } } }));
  const malformed = await getWeather(`?city_id=${CITY_ID}`);
  assert.equal(malformed.statusCode, 503);
});

test('a reading older than the cache window is served as stale rather than dropped', async () => {
  resetWeatherCache();
  let clock = 1_000_000;
  stubProvider(() => ({ body: rainBody }));

  const first = await loadCityWeather(CITY_ID, 28.367, 79.4304, {
    ttlMs: 60_000,
    now: () => clock,
  });
  assert.equal(first.stale, false);

  // Past the window, and the provider is now down.
  clock += 120_000;
  stubProvider(() => ({ throws: true }));
  const stale = await loadCityWeather(CITY_ID, 28.367, 79.4304, {
    ttlMs: 60_000,
    now: () => clock,
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.condition, 'rain');

  // Past the six-hour honesty limit, the old reading is no longer offered.
  clock += 7 * 60 * 60_000;
  await assert.rejects(
    loadCityWeather(CITY_ID, 28.367, 79.4304, { ttlMs: 60_000, now: () => clock }),
    (error: { code?: string }) => error.code === 'WEATHER_UNAVAILABLE',
  );
});
