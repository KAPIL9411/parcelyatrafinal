/**
 * PATCH /me for a Google account.
 *
 * The production failure this pins: both clients send the whole profile form back, including the
 * email the screen was given. For an OAuth account that email is provider-managed, so the route
 * refused the request — and a Google user could not change their name or language at all. Only a
 * real change is refused now; an unchanged echo is not a change.
 *
 * The avatar cases cover the first-run profile setup: the selfie arrives as an object key, so the two
 * ways a client can send a bad reference (somebody else's face, or bytes that never landed) are both
 * refused, a patch that does not mention the photo leaves it alone, and the sign-in response carries
 * the field the app gates the setup screen on.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.PGLITE_PATH = './data/pgdata.profile-update';
process.env.UPLOAD_DIR = './data/uploads-profile-update';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });
rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });

const { buildApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { createSession } = await import('../src/lib/auth.ts');
const { loadProfile } = await import('../src/routes/auth.ts');

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

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The real path a client takes: ask for a ticket for the given purpose, then PUT the bytes to it. */
async function upload(token: string, purpose: 'avatar'): Promise<string> {
  const ticket = await app.inject({
    method: 'POST',
    url: '/v1/files/upload-url',
    headers: { authorization: `Bearer ${token}` },
    payload: { purpose, content_type: 'image/png', byte_size: PNG_1X1.byteLength },
  });
  assert.equal(ticket.statusCode, 201, ticket.body);
  const body = ticket.json() as { object_key: string; upload_url: string };
  const put = await app.inject({
    method: 'PUT',
    url: body.upload_url.replace(/^https?:\/\/[^/]+/, ''),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
    payload: PNG_1X1,
  });
  assert.equal(put.statusCode, 201, put.body);
  return body.object_key;
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

test('a selfie saved with the name is stored as a key and served through a signed URL', async () => {
  const user = await newUser({ email: 'qa.avatar@example.com', googleSub: 'google-qa-avatar' });
  const key = await upload(user.token, 'avatar');

  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { name: 'QA Avatar', avatar_key: key },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { name: string; avatar_key: string; avatar_url: string };
  assert.equal(body.name, 'QA Avatar');
  assert.equal(body.avatar_key, key);
  assert.match(body.avatar_url, /\/files\/signed\//);

  const stored = await app.db.query<{ avatar_key: string | null; avatar_updated_at: Date | null }>(
    `SELECT avatar_key, avatar_updated_at FROM users WHERE id = $1`,
    [user.id],
  );
  assert.equal(stored.rows[0]!.avatar_key, key);
  assert.ok(stored.rows[0]!.avatar_updated_at instanceof Date);

  // The URL the profile screen is handed really returns the bytes.
  const fetched = await app.inject({ method: 'GET', url: body.avatar_url.replace(/^https?:\/\/[^/]+/, '') });
  assert.equal(fetched.statusCode, 200, fetched.body);
  assert.equal(fetched.headers['content-type'], 'image/png');
  assert.equal(fetched.rawPayload.byteLength, PNG_1X1.byteLength);
});

test("another account's selfie key is refused and nothing is stored", async () => {
  const owner = await newUser({ email: 'owner.avatar@example.com' });
  const stranger = await newUser({ email: 'stranger.avatar@example.com' });
  const key = await upload(owner.token, 'avatar');

  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${stranger.token}` },
    payload: { avatar_key: key },
  });
  assert.equal(res.statusCode, 400, res.body);
  const body = res.json() as { error?: { code?: string; details?: { field?: string } } };
  assert.equal(body.error?.code, 'VALIDATION_FAILED');
  assert.equal(body.error?.details?.field, 'avatar_key');

  const stored = await app.db.query<{ avatar_key: string | null }>(
    `SELECT avatar_key FROM users WHERE id = $1`,
    [stranger.id],
  );
  assert.equal(stored.rows[0]!.avatar_key, null);
});

test('a selfie key whose bytes never arrived is an expired upload, not a field error', async () => {
  const user = await newUser({ email: 'ghost.avatar@example.com' });
  const ghost = `avatar/${user.id}/${crypto.randomUUID()}.png`;

  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { name: 'Ghost Photo', avatar_key: ghost },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal((res.json() as { error?: { code?: string } }).error?.code, 'UPLOAD_EXPIRED');

  // The name in the same request is not half-applied: the refusal happens before the write.
  const stored = await app.db.query<{ name: string | null }>(`SELECT name FROM users WHERE id = $1`, [user.id]);
  assert.equal(stored.rows[0]!.name, null);
});

test('a patch that does not mention the photo leaves it in place, and null clears it', async () => {
  const user = await newUser({ email: 'keep.avatar@example.com' });
  const key = await upload(user.token, 'avatar');

  const saved = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { avatar_key: key },
  });
  assert.equal(saved.statusCode, 200, saved.body);

  const languageOnly = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { locale: 'hi-IN' },
  });
  assert.equal(languageOnly.statusCode, 200, languageOnly.body);
  assert.equal((languageOnly.json() as { avatar_key: string | null }).avatar_key, key);

  const cleared = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { avatar_key: null },
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  const body = cleared.json() as { avatar_key: string | null; avatar_url: string | null };
  assert.equal(body.avatar_key, null);
  assert.equal(body.avatar_url, null);
});

test('the profile handed back at sign-in carries the avatar field the app gates on', async () => {
  const user = await newUser({ email: 'signin.avatar@example.com', googleSub: 'google-qa-signin-avatar' });

  const fresh = await loadProfile(app, user.id);
  assert.equal(fresh.avatar_key, null, 'a brand-new account has no photo, so the app shows setup');
  assert.equal(fresh.avatar_url, null);

  const key = await upload(user.token, 'avatar');
  await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { avatar_key: key },
  });

  const withPhoto = await loadProfile(app, user.id);
  assert.equal(withPhoto.avatar_key, key, 'and once saved, it never asks again');
  assert.match(withPhoto.avatar_url ?? '', /\/files\/signed\//);
});
