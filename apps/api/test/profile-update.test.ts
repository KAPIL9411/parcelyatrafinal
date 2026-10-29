/**
 * PATCH /me for a Google account.
 *
 * The production failure this pins: both clients send the whole profile form back, including the
 * email the screen was given. For an OAuth account that email is provider-managed, so the route
 * refused the request — and a Google user could not change their name or language at all. Only a
 * real change is refused now; an unchanged echo is not a change.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.PGLITE_PATH = './data/pgdata.profile-update';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

const { buildApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { createSession } = await import('../src/lib/auth.ts');

const app: FastifyInstance = await buildApp();
await runMigrations(app.db);

after(async () => {
  await app.close();
  await closeDb();
});

async function newUser(options: { email?: string; googleSub?: string } = {}): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  await app.db.query(
    `INSERT INTO users (id, phone_hash, phone_last4, phone_masked, phone_verified_at, status, email, google_sub)
     VALUES ($1, $2, '0000', '+91******0000', now(), 'active', $3, $4)`,
    [id, `profile-update-${id}`, options.email ?? null, options.googleSub ?? null],
  );
  const session = await createSession(app.db, id, {});
  return { id, token: session.accessToken };
}

test('a Google account can save its name and language while echoing its own email', async () => {
  const user = await newUser({ email: 'qa.google@example.com', googleSub: 'google-qa-1' });

  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { name: 'QA Google', email: 'qa.google@example.com', locale: 'hi-IN' },
  });

  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { name: string; email: string; locale: string };
  assert.equal(body.name, 'QA Google');
  assert.equal(body.email, 'qa.google@example.com');
  assert.equal(body.locale, 'hi-IN');
});

test('changing the email of a Google account is still refused', async () => {
  const user = await newUser({ email: 'qa.google2@example.com', googleSub: 'google-qa-2' });

  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { email: 'someone.else@example.com' },
  });

  assert.equal(res.statusCode, 403, res.body);
  const body = res.json() as { error: { code: string; details?: { field?: string } } };
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.equal(body.error.details?.field, 'email');

  const after = await app.db.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [user.id]);
  assert.equal(after.rows[0]!.email, 'qa.google2@example.com');
});

test('a phone account can still change its email', async () => {
  const user = await newUser({ email: 'old@example.com' });

  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { email: 'new@example.com' },
  });

  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as { email: string }).email, 'new@example.com');
});
