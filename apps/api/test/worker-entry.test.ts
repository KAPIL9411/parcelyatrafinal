/**
 * The Worker entry, exercised through its real default export.
 *
 * `hono-parity.test.ts` proves the HTTP layer matches Fastify. This file proves `worker.ts` itself —
 * lazy boot, safety rails, `registerRoutes`, the deferred database — serves requests. It runs in
 * Node, not the Workers runtime, so it cannot prove the isolate, CPU limits or Neon reachability;
 * `wrangler deploy --dry-run` covers bundling and a real deployment is still required for the rest.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, test } from 'node:test';

const PGLITE_PATH = './data/pgdata.worker-entry';
process.env.PGLITE_PATH = PGLITE_PATH;
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

rmSync(PGLITE_PATH, { recursive: true, force: true });

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const worker = (await import('../src/worker.ts')).default;

await runMigrations(await getDb());

after(async () => {
  await closeDb();
  rmSync(PGLITE_PATH, { recursive: true, force: true });
});

function call(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`http://localhost${path}`, init));
}

test('boots lazily and serves the root route', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = (await res.json()) as { name: string; health: string };
  assert.equal(body.name, 'Parcel Yatra API');
  assert.equal(body.health, '/v1/health');
  // Security headers come from the reimplemented layer, not a Fastify plugin.
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
});

test('health reaches the database through the deferred handle', async () => {
  const res = await call('/v1/health');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, 'ok');
});

test('an unknown route answers the shared 404 envelope', async () => {
  const res = await call('/v1/nope');
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('an authenticated route is refused without a token', async () => {
  const res = await call('/v1/me');
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'AUTH_REQUIRED');
});

test('a CORS preflight is answered before routing', async () => {
  const res = await call('/v1/me', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://127.0.0.1:5173',
      'access-control-request-method': 'PATCH',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-methods'), 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
});

test('a wildcard upload read is matched and stays authenticated', async () => {
  const res = await call('/v1/files/object/kyc_id/user-1/photo.jpg');
  assert.equal(res.status, 401);
});
