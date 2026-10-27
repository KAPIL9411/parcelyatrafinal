/**
 * The native transport for the refresh token.
 *
 * The web keeps the token in an HttpOnly cookie. A native app cannot read or reliably persist that
 * cookie, so it declares `x-py-client: native`, receives the token in the body and keeps it in the
 * platform keystore. These tests pin the parts that matter: the body token is only honoured for a
 * declared native client, rotation still happens on every refresh, and replaying a rotated token
 * still revokes the family.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.PGLITE_PATH = './data/pgdata.native-session';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

const { buildApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { createSession } = await import('../src/lib/auth.ts');
const { sha256 } = await import('../src/lib/crypto.ts');

const app: FastifyInstance = await buildApp();
await runMigrations(app.db);

after(async () => {
  await app.close();
  await closeDb();
});

let seeded = 0;
async function newUser(): Promise<string> {
  seeded += 1;
  const id = crypto.randomUUID();
  await app.db.query(
    `INSERT INTO users (id, phone_hash, phone_last4, phone_masked, phone_verified_at, status)
     VALUES ($1, $2, '0000', '+91******0000', now(), 'active')`,
    [id, `native-session-${seeded}-${id}`],
  );
  await app.db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'sender')`, [id]);
  return id;
}

async function refresh(init: { token?: string; native?: boolean; cookie?: string }) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: {
      ...(init.native ? { 'x-py-client': 'native' } : {}),
      ...(init.cookie ? { cookie: `py_refresh=${init.cookie}` } : {}),
    },
    ...(init.token ? { payload: { refresh_token: init.token } } : {}),
  });
}

test('a native client gets a rotated pair in the body', async () => {
  const userId = await newUser();
  const session = await createSession(app.db, userId, { deviceId: 'test-device' });

  const res = await refresh({ token: session.refreshToken, native: true });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { access_token?: string; refresh_token?: string; user?: { id?: string } };
  assert.ok(body.access_token, 'an access token is issued');
  assert.ok(body.refresh_token, 'the rotated refresh token is in the body');
  assert.notEqual(body.refresh_token, session.refreshToken, 'the token rotates on every refresh');
  assert.equal(body.user?.id, userId);
});

test('the body token is ignored for a client that did not declare itself native', async () => {
  const userId = await newUser();
  const session = await createSession(app.db, userId);

  const res = await refresh({ token: session.refreshToken });
  assert.equal(res.statusCode, 401);
  assert.equal((res.json() as { error?: { code?: string } }).error?.code, 'AUTH_REFRESH_INVALID');

  // The token is untouched: a failed web-shaped attempt must not consume it.
  const stillValid = await refresh({ token: session.refreshToken, native: true });
  assert.equal(stillValid.statusCode, 200);
});

test('the cookie transport is unchanged for the web', async () => {
  const userId = await newUser();
  const session = await createSession(app.db, userId);

  const res = await refresh({ cookie: session.refreshToken });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as { refresh_token?: string }).refresh_token, undefined, 'no token in the body for web');
  assert.match(String(res.headers['set-cookie']), /py_refresh=/, 'a new cookie is set');
});

test('replaying a rotated native token revokes the family', async () => {
  const userId = await newUser();
  const session = await createSession(app.db, userId);

  const first = await refresh({ token: session.refreshToken, native: true });
  assert.equal(first.statusCode, 200);
  const rotated = (first.json() as { refresh_token: string }).refresh_token;

  const replay = await refresh({ token: session.refreshToken, native: true });
  assert.equal(replay.statusCode, 401);
  assert.equal((replay.json() as { error?: { code?: string } }).error?.code, 'AUTH_REFRESH_REUSE');

  // Reuse detection kills the whole family, including the token the replay was trying to displace.
  const after = await refresh({ token: rotated, native: true });
  assert.equal(after.statusCode, 401, 'the rotated token is dead too');
});

test('the stored refresh row is a hash, never the token itself', async () => {
  const userId = await newUser();
  const session = await createSession(app.db, userId);

  const stored = await app.db.query<{ refresh_hash: string }>(
    `SELECT refresh_hash FROM sessions WHERE user_id = $1`,
    [userId],
  );
  assert.equal(stored.rows[0]?.refresh_hash, sha256(session.refreshToken));
  assert.notEqual(stored.rows[0]?.refresh_hash, session.refreshToken);
});
