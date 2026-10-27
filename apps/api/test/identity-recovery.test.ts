/**
 * Recovery after account deletion, and the identity races around it.
 *
 * The production failure these tests pin: `POST /me/deletion-request` once left `google_sub` and the
 * real `phone_hash` on the soft-deleted row. `users_google_sub_idx` does not filter by `deleted_at`,
 * so the next Google sign-in for that person died on the unique constraint with a 500, and the same
 * phone number could never register again. Sessions were left alive too, so `/auth/refresh` kept
 * minting tokens that every other route refused with 403.
 *
 * The tests drive the real routes and the real `upsertUserFromGoogle`; only Google's identity is
 * supplied directly, because no Google credential exists in this environment.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.PGLITE_PATH = './data/pgdata.identity-recovery';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

const { buildApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { createSession } = await import('../src/lib/auth.ts');
const { hashCode, phoneHash } = await import('../src/lib/crypto.ts');
const { upsertUserFromGoogle } = await import('../src/routes/google-auth.ts');

const app: FastifyInstance = await buildApp();
await runMigrations(app.db);

after(async () => {
  await app.close();
  await closeDb();
});

async function insertUser(opts: {
  googleSub?: string | null;
  email?: string | null;
  status?: 'active' | 'suspended' | 'deleted';
  deleted?: boolean;
} = {}): Promise<{ id: string; phoneHash: string; email: string }> {
  const id = crypto.randomUUID();
  const phoneHashValue = phoneHash(uniquePhone());
  const email = opts.email ?? `identity-${crypto.randomUUID()}@example.test`;
  await app.db.query(
    `INSERT INTO users (id, phone_hash, phone_last4, phone_masked, phone_verified_at, status, deleted_at,
                        google_sub, email, email_verified_at)
     VALUES ($1, $2, '0000', '+91******0000', now(), $3, $4, $5, $6, now())`,
    [id, phoneHashValue, opts.status ?? 'active', opts.deleted ? new Date() : null, opts.googleSub ?? null, email],
  );
  await app.db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'sender') ON CONFLICT DO NOTHING`, [id]);
  return { id, phoneHash: phoneHashValue, email };
}

function googleIdentity(sub: string, email: string) {
  return { sub, email, email_verified: true, name: 'Identity Test' };
}

/**
 * The PGlite directory survives between runs, so a fixed phone number would collide with the row a
 * previous run inserted. Each run gets its own number.
 */
function uniquePhone(): string {
  return `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

async function deleteAccount(userId: string): Promise<void> {
  const session = await createSession(app.db, userId, {});
  const res = await app.inject({
    method: 'POST',
    url: '/v1/me/deletion-request',
    headers: { authorization: `Bearer ${session.accessToken}` },
    payload: { confirm: true },
  });
  assert.equal(res.statusCode, 200, res.body);
}

test('deletion frees the login identifiers and revokes every session', async () => {
  const sub = `sub-${crypto.randomUUID()}`;
  const user = await insertUser({ googleSub: sub });
  const session = await createSession(app.db, user.id, { deviceId: 'device-a' });
  await createSession(app.db, user.id, { deviceId: 'device-b' });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/me/deletion-request',
    headers: { authorization: `Bearer ${session.accessToken}` },
    payload: { confirm: true },
  });
  assert.equal(res.statusCode, 200, res.body);

  const row = (
    await app.db.query<{ status: string; google_sub: string | null; phone_hash: string; deleted_at: Date | null }>(
      `SELECT status, google_sub, phone_hash, deleted_at FROM users WHERE id = $1`,
      [user.id],
    )
  ).rows[0]!;
  assert.equal(row.status, 'deleted');
  assert.ok(row.deleted_at, 'the row is soft-deleted');
  assert.equal(row.google_sub, null, 'the Google subject no longer blocks a new sign-in');
  assert.equal(row.phone_hash, `deleted:${user.id}`, 'the real phone hash is replaced by a tombstone');

  const live = await app.db.query(`SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, [user.id]);
  assert.equal(live.rows.length, 0, 'no session survives the deletion');
});

test('refresh will not rotate a session whose account was deleted', async () => {
  const user = await insertUser();
  const session = await createSession(app.db, user.id, { deviceId: 'device-c' });
  // Simulate a session that outlived the account: deletion revokes sessions, so put this one back.
  await app.db.query(`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = $1`, [user.id]);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: { 'x-py-client': 'native' },
    payload: { refresh_token: session.refreshToken },
  });
  assert.equal(res.statusCode, 401, res.body);
  assert.equal((res.json() as { error?: { code?: string } }).error?.code, 'AUTH_REFRESH_INVALID');

  const after = await app.db.query<{ revoked_at: Date | null }>(`SELECT revoked_at FROM sessions WHERE id = $1`, [
    session.sessionId,
  ]);
  assert.ok(after.rows[0]?.revoked_at, 'the session is revoked so it can never rotate again');
});

test('refresh reports a suspended account without issuing a token', async () => {
  const user = await insertUser({ status: 'suspended' });
  const session = await createSession(app.db, user.id, {});

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: { 'x-py-client': 'native' },
    payload: { refresh_token: session.refreshToken },
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal((res.json() as { error?: { code?: string } }).error?.code, 'ACCOUNT_SUSPENDED');
});

test('the same Google subject signs in again after deletion, on a fresh account', async () => {
  const sub = `sub-${crypto.randomUUID()}`;
  const email = `identity-${crypto.randomUUID()}@example.test`;

  const first = await upsertUserFromGoogle(app.db, googleIdentity(sub, email));
  await deleteAccount(first.id);

  const second = await upsertUserFromGoogle(app.db, googleIdentity(sub, email));
  assert.notEqual(second.id, first.id, 'the deleted row is a tombstone, not the account');
  assert.equal(second.status, 'active');

  const roles = await app.db.query(`SELECT role FROM user_roles WHERE user_id = $1`, [second.id]);
  assert.equal(roles.rows.length, 1, 'the fresh account has its sender role');
});

test('a pre-migration tombstone holding the subject does not break sign-in', async () => {
  const sub = `sub-${crypto.randomUUID()}`;
  const email = `identity-${crypto.randomUUID()}@example.test`;
  // The state migration 0009 repairs: deleted row, real phone hash, subject still attached.
  const tombstone = await insertUser({ googleSub: sub, deleted: true, status: 'deleted' });

  const user = await upsertUserFromGoogle(app.db, googleIdentity(sub, email));
  assert.notEqual(user.id, tombstone.id);
  assert.equal(user.status, 'active');

  const old = (
    await app.db.query<{ google_sub: string | null }>(`SELECT google_sub FROM users WHERE id = $1`, [tombstone.id])
  ).rows[0]!;
  assert.equal(old.google_sub, null, 'the stale subject is freed');
});

test('two first sign-ins for one Google identity resolve to one account', async () => {
  const sub = `sub-${crypto.randomUUID()}`;
  const email = `identity-${crypto.randomUUID()}@example.test`;

  const [a, b] = await Promise.all([
    upsertUserFromGoogle(app.db, googleIdentity(sub, email)),
    upsertUserFromGoogle(app.db, googleIdentity(sub, email)),
  ]);
  assert.equal(a.id, b.id, 'both callers get the same account');

  const rows = await app.db.query(`SELECT id FROM users WHERE google_sub = $1`, [sub]);
  assert.equal(rows.rows.length, 1, 'only one row owns the subject');
});

test('the same phone number registers a fresh account after deletion', async () => {
  const phone = uniquePhone();
  const hash = phoneHash(phone);
  await app.db.query(
    `INSERT INTO users (phone_hash, phone_last4, phone_masked, phone_verified_at, status, deleted_at)
     VALUES ($1, '0000', '+91******0000', now(), 'active', null)`,
    [hash],
  );
  const original = (
    await app.db.query<{ id: string }>(`SELECT id FROM users WHERE phone_hash = $1 AND deleted_at IS NULL`, [hash])
  ).rows[0]!;
  await deleteAccount(original.id);

  const challengeId = crypto.randomUUID();
  await app.db.query(
    `INSERT INTO otp_challenges (id, phone_hash, phone_last4, phone_masked, purpose, code_hash, expires_at)
     VALUES ($1, $2, '0000', '+91******0000', 'login', $3, now() + interval '5 minutes')`,
    [challengeId, hash, hashCode('123456')],
  );

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    headers: { 'x-py-client': 'native' },
    payload: { challenge_id: challengeId, code: '123456', device_id: 'device-otp' },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { user?: { id?: string }; access_token?: string; refresh_token?: string };
  assert.ok(body.access_token);
  assert.ok(body.refresh_token, 'a native transport session is issued');
  assert.notEqual(body.user?.id, original.id, 'the deleted row is not resurrected');

  const live = await app.db.query<{ id: string }>(`SELECT id FROM users WHERE phone_hash = $1 AND deleted_at IS NULL`, [
    hash,
  ]);
  assert.equal(live.rows.length, 1);
  assert.equal(live.rows[0]?.id, body.user?.id);
});

test('a suspended phone number is refused at verify time', async () => {
  const phone = uniquePhone();
  const hash = phoneHash(phone);
  const user = await insertUser({ status: 'suspended' });
  await app.db.query(`UPDATE users SET phone_hash = $2 WHERE id = $1`, [user.id, hash]);

  const challengeId = crypto.randomUUID();
  await app.db.query(
    `INSERT INTO otp_challenges (id, phone_hash, phone_last4, phone_masked, purpose, code_hash, expires_at)
     VALUES ($1, $2, '0000', '+91******0000', 'login', $3, now() + interval '5 minutes')`,
    [challengeId, hash, hashCode('654321')],
  );

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { challenge_id: challengeId, code: '654321' },
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal((res.json() as { error?: { code?: string } }).error?.code, 'ACCOUNT_SUSPENDED');
});
