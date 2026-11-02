/**
 * Host parity: Fastify (Node/Render) vs the Hono-backed Workers HTTP layer.
 *
 * The route modules are shared, but the transport is not: Fastify uses `@fastify/cors`,
 * `@fastify/helmet`, `@fastify/rate-limit` and its own body parser, while the Workers layer
 * reimplements that slice. This test sends the same requests through both and compares status,
 * the headers clients actually read, and the body.
 *
 * It is not a substitute for deploying to Workers â€” it runs in Node. It pins the behaviour that
 * must not drift while the API is served from two hosts.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const PGLITE_PATH = './data/pgdata.hono-parity';
process.env.PGLITE_PATH = PGLITE_PATH;
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';
process.env.PUBLIC_WEB_URL = 'https://parcelyatrafinal.vercel.app';
process.env.ADMIN_WEB_URL = 'https://admin-parcelyatrafinal.vercel.app';
process.env.WEB_ORIGINS = '';

rmSync(PGLITE_PATH, { recursive: true, force: true });

const { buildApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { corsOrigins } = await import('../src/config.ts');
const { ensureHomepageSeed } = await import('../src/lib/homepage.ts');
const { createCompatApp } = await import('../src/http/fastify-compat.ts');
const { makeConsoleLogger } = await import('../src/http/logger.ts');
const { registerRoutes } = await import('../src/routes/register.ts');

const ALLOWED_ORIGIN = 'https://parcelyatrafinal.vercel.app';

const fastify: FastifyInstance = await buildApp();
const db = fastify.db;
await runMigrations(db);
// The Node entry seeds the default page at boot; tests build the app directly, so seed it here.
// Without a published row the homepage is synthesised per request and its ETag changes with it.
await ensureHomepageSeed(db);

const compat = createCompatApp({
  db,
  log: makeConsoleLogger(),
  origins: corsOrigins,
  production: false,
});
// The same deliberate seam as `worker.ts`: the shared table is typed against Fastify's instance.
await registerRoutes(compat as unknown as FastifyInstance, { db });
await compat.ready();

after(async () => {
  await fastify.close();
  await closeDb();
  rmSync(PGLITE_PATH, { recursive: true, force: true });
});

interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: Uint8Array;
}

interface Case {
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Headers to compare in addition to `content-type`. */
  headersToCompare?: string[];
  compare?: (a: Res, b: Res) => void;
}

async function viaFastify(c: Case): Promise<Res> {
  const res = await fastify.inject({
    method: c.method as never,
    url: c.url,
    headers: c.headers,
    ...(c.body !== undefined ? { payload: c.body as never } : {}),
  });
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (value !== undefined) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(' | ') : String(value);
  }
  return { status: res.statusCode, headers, body: res.body, bytes: new Uint8Array(res.rawPayload) };
}

async function viaCompat(c: Case): Promise<Res> {
  const res = await compat.fetch(
    new Request(`http://localhost${c.url}`, {
      method: c.method,
      headers: c.headers,
      ...(c.body !== undefined ? { body: c.body } : {}),
    }),
  );
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers, body: new TextDecoder().decode(bytes), bytes };
}

/** Envelopes carry a per-request id; compare the parts that are contract. */
function sameEnvelope(a: Res, b: Res): void {
  const left = JSON.parse(a.body) as { error: { code: string; message: string; details?: unknown } };
  const right = JSON.parse(b.body) as { error: { code: string; message: string; details?: unknown } };
  assert.deepEqual(right.error.code, left.error.code, 'error code');
  assert.deepEqual(right.error.message, left.error.message, 'error message');
  assert.deepEqual(right.error.details, left.error.details, 'error details');
}

function sameJson(a: Res, b: Res): void {
  assert.deepEqual(JSON.parse(b.body), JSON.parse(a.body), 'JSON body');
}

function headerEqual(a: Res, b: Res, name: string): void {
  assert.equal(b.headers[name], a.headers[name], `header ${name}`);
}

const CASES: Case[] = [
  {
    name: 'root',
    method: 'GET',
    url: '/',
    compare: sameJson,
  },
  {
    name: 'health',
    method: 'GET',
    url: '/v1/health',
    headersToCompare: ['cache-control'],
    compare: (a, b) => {
      type Health = { status: string; version: string; checks: Array<{ name: string; status: string }> };
      const left = JSON.parse(a.body) as Health;
      const right = JSON.parse(b.body) as Health;
      assert.equal(right.status, left.status, 'health status');
      assert.equal(right.version, left.version, 'health version');
      assert.deepEqual(
        right.checks.map((c) => ({ name: c.name, status: c.status })),
        left.checks.map((c) => ({ name: c.name, status: c.status })),
        'health checks (latency is not compared)',
      );
    },
  },
  {
    name: 'unknown path',
    method: 'GET',
    url: '/v1/definitely-not-a-route',
    compare: sameEnvelope,
  },
  {
    name: 'unknown method on a known path',
    method: 'DELETE',
    url: '/v1/health',
    compare: sameEnvelope,
  },
  {
    name: 'authenticated route without a token',
    method: 'GET',
    url: '/v1/me',
    compare: sameEnvelope,
  },
  {
    name: 'authenticated route with a bad token',
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: 'Bearer not-a-jwt' },
    compare: sameEnvelope,
  },
  {
    name: 'malformed JSON',
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: { 'content-type': 'application/json' },
    body: '{ not json',
    compare: sameEnvelope,
  },
  {
    name: 'empty JSON body',
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: { 'content-type': 'application/json' },
    body: '',
    compare: sameEnvelope,
  },
  {
    name: 'unsupported content type',
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: { 'content-type': 'application/xml' },
    body: '<refresh/>',
    compare: sameEnvelope,
  },
  {
    name: 'body over the 1 MiB limit',
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pad: 'x'.repeat(1_100_000) }),
    compare: sameEnvelope,
  },
  {
    name: 'wildcard route is matched and stays authenticated',
    method: 'GET',
    url: '/v1/files/object/kyc_id/user-1/photo.jpg',
    compare: sameEnvelope,
  },
  {
    name: 'webhook raw-body parser rejects malformed JSON',
    method: 'POST',
    url: '/v1/webhooks/payments/mock',
    headers: { 'content-type': 'application/json' },
    body: '{ broken',
    compare: sameEnvelope,
  },
  {
    name: 'webhook parser keeps its own empty-body behaviour',
    method: 'POST',
    url: '/v1/webhooks/payments/mock',
    headers: { 'content-type': 'application/json' },
    body: '',
    compare: sameEnvelope,
  },
  {
    name: 'CORS: allowed origin is echoed',
    method: 'GET',
    url: '/v1/health',
    headers: { origin: ALLOWED_ORIGIN },
    headersToCompare: ['vary', 'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-expose-headers'],
    compare: () => undefined,
  },
  {
    name: 'CORS: a disallowed origin is not echoed',
    method: 'GET',
    url: '/v1/health',
    headers: { origin: 'https://evil.example' },
    headersToCompare: ['vary', 'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-expose-headers'],
    compare: () => undefined,
  },
  {
    name: 'CORS: preflight',
    method: 'OPTIONS',
    url: '/v1/me',
    headers: {
      origin: ALLOWED_ORIGIN,
      'access-control-request-method': 'PATCH',
      'access-control-request-headers': 'authorization, content-type',
    },
    headersToCompare: [
      'vary',
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'access-control-allow-credentials',
    ],
    compare: () => undefined,
  },
  {
    name: 'HEAD carries no body',
    method: 'HEAD',
    url: '/v1/health',
    headersToCompare: ['cache-control'],
    compare: () => undefined,
  },
];

for (const c of CASES) {
  test(`parity: ${c.name}`, async () => {
    const [a, b] = [await viaFastify(c), await viaCompat(c)];

    assert.equal(b.status, a.status, 'status');
    headerEqual(a, b, 'content-type');
    for (const name of c.headersToCompare ?? []) headerEqual(a, b, name);
    c.compare?.(a, b);
  });
}

test('parity: 304 on a matching ETag', async () => {
  const request = (headers?: Record<string, string>): Case => ({
    name: 'homepage',
    method: 'GET',
    url: '/v1/homepage?platform=web',
    ...(headers ? { headers } : {}),
  });

  const firstA = await viaFastify(request());
  const firstB = await viaCompat(request());
  assert.equal(firstA.status, 200);
  assert.equal(firstB.status, 200);
  headerEqual(firstA, firstB, 'cache-control');
  headerEqual(firstA, firstB, 'vary');
  assert.equal(firstB.headers.etag, firstA.headers.etag, 'etag');
  // `generated_at` is per-request by design and is excluded from the ETag; compare the rest.
  const stripGeneratedAt = (res: Res) => {
    const body = JSON.parse(res.body) as Record<string, unknown>;
    delete body.generated_at;
    return body;
  };
  assert.deepEqual(stripGeneratedAt(firstB), stripGeneratedAt(firstA), 'body');
  // Revalidate each host against its own tag, as a browser would.
  const secondA = await viaFastify(request({ 'if-none-match': firstA.headers.etag! }));
  const secondB = await viaCompat(request({ 'if-none-match': firstB.headers.etag! }));
  assert.equal(secondA.status, 304);
  assert.equal(secondB.status, 304);
  headerEqual(secondA, secondB, 'content-type');
  assert.equal(secondB.body, '');
});

test('parity: binary media response', async () => {
  const { putObject } = await import('../src/lib/storage.ts');
  const key = `homepage_media/parity-${crypto.randomUUID()}.png`;
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x7f]);
  await putObject(key, bytes);

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO homepage_media (id, object_key, content_type, byte_size) VALUES ($1, $2, 'image/png', $3)`,
    [id, key, bytes.byteLength],
  );

  const c: Case = {
    name: 'media',
    method: 'GET',
    url: `/v1/homepage/media/${id}`,
    headersToCompare: ['content-length', 'cache-control', 'x-content-type-options', 'content-security-policy'],
    compare: (a, b) => {
      assert.deepEqual(Buffer.from(b.bytes), Buffer.from(a.bytes), 'bytes');
    },
  };
  const [a, b] = [await viaFastify(c), await viaCompat(c)];
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.headers['content-type'], 'image/png');
  headerEqual(a, b, 'content-type');
  for (const name of c.headersToCompare ?? []) headerEqual(a, b, name);
  c.compare?.(a, b);
});

test('parity: security headers', async () => {
  const [a, b] = [await viaFastify(CASES[0]!), await viaCompat(CASES[0]!)];
  for (const name of [
    'content-security-policy',
    'cross-origin-opener-policy',
    'cross-origin-resource-policy',
    'origin-agent-cluster',
    'referrer-policy',
    'x-content-type-options',
    'x-dns-prefetch-control',
    'x-download-options',
    'x-frame-options',
    'x-permitted-cross-domain-policies',
    'x-xss-protection',
  ]) {
    headerEqual(a, b, name);
  }
});

test('parity: route rate limit answers 429 with the same envelope', async () => {
  // `/v1/auth/refresh` declares `rateLimit: { max: 30, timeWindow: '1 minute' }`. The earlier cases
  // already consumed a few of those, so drive both hosts until each refuses rather than assuming a
  // count.
  const send = (which: 'fastify' | 'compat') => {
    const c: Case = {
      name: 'rate limit',
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    };
    return which === 'fastify' ? viaFastify(c) : viaCompat(c);
  };

  let left: Res | null = null;
  let right: Res | null = null;
  for (let i = 0; i < 40 && (!left || !right); i += 1) {
    if (!left) {
      const res = await send('fastify');
      if (res.status === 429) left = res;
    }
    if (!right) {
      const res = await send('compat');
      if (res.status === 429) right = res;
    }
  }

  assert.ok(left, 'Fastify refused the request');
  assert.ok(right, 'the Workers layer refused the request');
  assert.equal(right.status, left.status);
  headerEqual(left, right, 'retry-after');
  headerEqual(left, right, 'x-ratelimit-limit');
  headerEqual(left, right, 'x-ratelimit-remaining');
  sameEnvelope(left, right);
});
