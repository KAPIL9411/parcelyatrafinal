/**
 * Verification submission, end to end, over the real upload path.
 *
 * The production failure this pins: a submitted verification can point at a document key whose
 * bytes the server cannot read — an upload lost when an instance restarted, or an object store that
 * never had it. The route refused correctly, but with the generic VALIDATION_FAILED copy, so the
 * screen said "check the details" and named nothing. `UPLOAD_EXPIRED` now says what happened, and
 * the client clears the stale keys instead of repeating the same refusal.
 *
 * The happy path is driven through `POST /files/upload-url` and the sink the ticket names, so the
 * keys, ownership check and measured metadata are the ones a real client produces.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.PGLITE_PATH = './data/pgdata.verification-upload';
process.env.UPLOAD_DIR = './data/uploads-verification-test';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

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

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function newUser(): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  await app.db.query(
    `INSERT INTO users (id, phone_hash, phone_last4, phone_masked, phone_verified_at, status)
     VALUES ($1, $2, '0000', '+91******0000', now(), 'active')`,
    [id, `verification-upload-${id}`],
  );
  await app.db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'sender')`, [id]);
  const session = await createSession(app.db, id, {});
  return { id, token: session.accessToken };
}

async function upload(keyOwnerToken: string, purpose: 'kyc_id' | 'kyc_selfie'): Promise<{ key: string; url: string }> {
  const ticket = await app.inject({
    method: 'POST',
    url: '/v1/files/upload-url',
    headers: { authorization: `Bearer ${keyOwnerToken}` },
    payload: { purpose, content_type: 'image/png', byte_size: PNG_1X1.byteLength },
  });
  assert.equal(ticket.statusCode, 201, ticket.body);
  const body = ticket.json() as { object_key: string; upload_url: string };
  const put = await app.inject({
    method: 'PUT',
    // The web client writes to the local sink even when the server is on Cloudinary; the server
    // dispatches to the configured provider, so this is the path a browser actually takes.
    url: `/v1/files/local-upload/${body.object_key}`,
    headers: { authorization: `Bearer ${keyOwnerToken}`, 'content-type': 'image/png' },
    payload: PNG_1X1,
  });
  assert.equal(put.statusCode, 201, put.body);
  return { key: body.object_key, url: body.upload_url };
}

test('a verification submitted with its own uploads is accepted and measured', async () => {
  const user = await newUser();
  const front = await upload(user.token, 'kyc_id');
  const selfie = await upload(user.token, 'kyc_selfie');

  const res = await app.inject({
    method: 'POST',
    url: '/v1/verifications',
    headers: { authorization: `Bearer ${user.token}` },
    payload: {
      id_type: 'driving_licence',
      id_front_key: front.key,
      selfie_key: selfie.key,
      consent_version: 'v1',
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal((res.json() as { state?: string }).state, 'pending');

  const docs = await app.db.query<{ kind: string; content_sha256: string; mime_type: string; byte_size: number }>(
    `SELECT kind, content_sha256, mime_type, byte_size FROM verification_documents
      WHERE verification_id = (SELECT id FROM verifications WHERE user_id = $1)`,
    [user.id],
  );
  assert.deepEqual(docs.rows.map((d) => d.kind).sort(), ['id_front', 'selfie']);
  for (const doc of docs.rows) {
    assert.equal(doc.mime_type, 'image/png');
    assert.equal(doc.byte_size, PNG_1X1.byteLength);
    assert.match(doc.content_sha256, /^[0-9a-f]{64}$/);
  }
});

test('a key whose bytes are gone is reported as an expired upload, not a field error', async () => {
  const user = await newUser();
  const front = await upload(user.token, 'kyc_id');
  const ghostSelfie = `kyc_selfie/${user.id}/${crypto.randomUUID()}.png`;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/verifications',
    headers: { authorization: `Bearer ${user.token}` },
    payload: { id_type: 'passport', id_front_key: front.key, selfie_key: ghostSelfie, consent_version: 'v1' },
  });
  assert.equal(res.statusCode, 400, res.body);
  const body = res.json() as { error?: { code?: string; message?: string } };
  assert.equal(body.error?.code, 'UPLOAD_EXPIRED');
  assert.match(body.error?.message ?? '', /Attach them again/);

  // Nothing was recorded, so the user has not spent an attempt on a photo that never arrived.
  const rows = await app.db.query(`SELECT id FROM verifications WHERE user_id = $1`, [user.id]);
  assert.equal(rows.rows.length, 0);
});

test("another account's document key is refused before anything is written", async () => {
  const owner = await newUser();
  const stranger = await newUser();
  const front = await upload(owner.token, 'kyc_id');
  const selfie = await upload(stranger.token, 'kyc_selfie');

  const res = await app.inject({
    method: 'POST',
    url: '/v1/verifications',
    headers: { authorization: `Bearer ${stranger.token}` },
    payload: { id_type: 'voter_id', id_front_key: front.key, selfie_key: selfie.key, consent_version: 'v1' },
  });
  assert.equal(res.statusCode, 400, res.body);
  const body = res.json() as { error?: { code?: string; details?: { field?: string } } };
  assert.equal(body.error?.code, 'VALIDATION_FAILED');
  assert.equal(body.error?.details?.field, 'object_key');

  const rows = await app.db.query(`SELECT id FROM verifications WHERE user_id = $1`, [stranger.id]);
  assert.equal(rows.rows.length, 0);
});

test('an upload URL points at the API sink and only under the caller\'s own id', async () => {
  const user = await newUser();
  const { key, url } = await upload(user.token, 'kyc_id');
  assert.match(url, /\/files\/(local|cloudinary)-upload\//);
  assert.ok(key.startsWith(`kyc_id/${user.id}/`));

  const foreign = key.replace(user.id, crypto.randomUUID());
  const put = await app.inject({
    method: 'PUT',
    url: `/v1/files/local-upload/${foreign}`,
    headers: { authorization: `Bearer ${user.token}`, 'content-type': 'image/png' },
    payload: PNG_1X1,
  });
  assert.equal(put.statusCode, 404, put.body);
});
