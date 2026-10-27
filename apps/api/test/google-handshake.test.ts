/**
 * The Google sign-in handshake, end to end, without Google.
 *
 * Production answered `POST /v1/auth/google/callback` with a 400 in under a millisecond — refused
 * before the code was ever sent to Google — while a later attempt on the same deployment succeeded.
 * Two things could cause that, and both were real: the handshake was remembered in one Node process
 * (a redeploy or a hibernating instance forgets it), and the browser-side half was an HttpOnly cookie
 * that has to survive a cross-site round trip (Safari, Firefox and Chrome incognito refuse it).
 *
 * So this suite asks the questions the logs could not answer:
 *   - is a handshake still valid after everything the process remembered is gone?
 *   - can the callback complete with no cookie at all, and with no body binding?
 *   - is a foreign, tampered or expired state still refused?
 *
 * A handshake that passes every check is followed by the call to Google, which cannot succeed with
 * these placeholder credentials. `GOOGLE_AUTH_FAILED` is therefore the marker for "the handshake was
 * accepted", and it is that marker — not a fake success — that the passing cases assert.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

// The config snapshot is taken when `config.ts` first loads, so these have to be set before the
// import below. Google OAuth needs three values to switch on; none of them is a real credential.
process.env.GOOGLE_OAUTH_ENABLED = 'true';
process.env.GOOGLE_CLIENT_ID = 'handshake-test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'handshake-test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://127.0.0.1:5173/auth/google/callback';
process.env.PGLITE_PATH = './data/pgdata.handshake';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

const { buildApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { seal } = await import('../src/lib/seal.ts');
const { sha256 } = await import('../src/lib/crypto.ts');

const HANDSHAKE_TTL_MS = 10 * 60 * 1000;
/** Any non-empty string: the code is only ever sent to Google, which is where this test stops. */
const CODE = 'handshake-test-authorization-code';

const app: FastifyInstance = await buildApp();
await runMigrations(app.db);

// PGlite keeps a worker and the app keeps timers, so the process needs to be told to stop.
after(async () => {
  await app.close();
  await closeDb();
});

interface HandshakeResponse {
  authorization_url: string;
  state: string;
  handshake_binding: string;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/** The `state` plus the binding it was issued with, exactly as the browser holds them. */
async function startSignIn(): Promise<HandshakeResponse> {
  const res = await app.inject({ method: 'GET', url: '/v1/auth/google/authorize' });
  assert.equal(res.statusCode, 200, `authorize answered ${res.statusCode}: ${res.body}`);
  return res.json() as HandshakeResponse;
}

function cookieFor(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers['set-cookie'];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  for (const entry of list) {
    const [pair] = String(entry).split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return undefined;
}

async function callback(body: Record<string, unknown>, cookie?: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/google/callback',
    payload: body,
    headers: cookie ? { cookie: `py_oauth=${cookie}` } : {},
  });
}

/** A state minted here is a state minted by another process: the app has never heard of it. */
function foreignHandshake(overrides: Partial<{ codeVerifier: string; nonce: string; binding: string; expiresAt: number }> = {}) {
  const binding = overrides.binding ?? 'ab'.repeat(16);
  return {
    state: seal(
      JSON.stringify({
        codeVerifier: overrides.codeVerifier ?? 'foreign-verifier',
        nonce: overrides.nonce ?? 'foreign-nonce',
        bindingHash: sha256(binding),
        expiresAt: overrides.expiresAt ?? Date.now() + HANDSHAKE_TTL_MS,
      }),
      'oauth_state',
    ),
    binding,
  };
}

test('authorize carries the handshake in the state and sets both bindings', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/auth/google/authorize' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as HandshakeResponse;

  assert.ok(body.state.length > 32 && body.state.length <= 1024, `state length ${body.state.length}`);
  assert.match(body.handshake_binding, /^[0-9a-f]{32}$/, 'the binding is the 32 characters the schema expects');

  // Nothing security-relevant is in the URL the browser will hold: the verifier and the nonce are
  // inside the encrypted state, not next to it.
  assert.ok(!body.authorization_url.includes('handshake-test-client-secret'), 'the client secret is never in the URL');
  for (const param of ['code_challenge', 'state', 'prompt=select_account']) {
    assert.ok(body.authorization_url.includes(param), `the authorization URL carries ${param}`);
  }

  const cookie = cookieFor(res.headers, 'py_oauth');
  assert.equal(cookie, body.handshake_binding, 'the cookie and the body carry the same binding');
  const setCookie = String((res.headers['set-cookie'] as string[] | string | undefined) ?? '');
  assert.match(setCookie, /Path=\/v1\/auth/, 'scoped to the auth endpoints');
  assert.match(setCookie, /HttpOnly/, 'script-readable storage is not where the binding lives');
});

test('a state the server did not seal is refused', async () => {
  for (const forged of ['not-a-sealed-state', 'aGVsbG8gd29ybGQ', (await startSignIn()).state + 'x']) {
    const res = await callback({ code: CODE, state: forged, binding: 'ab'.repeat(16) });
    assert.equal(res.statusCode, 400, `${forged.slice(0, 12)}… answered ${res.statusCode}`);
    assert.equal((res.json() as ErrorBody).error?.code, 'INVALID_STATE');
  }
});

test('an expired state is refused even with the right binding', async () => {
  const stale = foreignHandshake({ expiresAt: Date.now() - 1000 });
  const res = await callback({ code: CODE, state: stale.state, binding: stale.binding });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as ErrorBody).error?.code, 'INVALID_STATE');
});

test('a valid state with no proof of the browser is refused', async () => {
  const handshake = await startSignIn();
  // Neither transport: the request that followed the redirect came from somewhere else.
  const res = await callback({ code: CODE, state: handshake.state });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as ErrorBody).error?.code, 'INVALID_STATE');
});

test('a valid state with someone else’s binding is refused', async () => {
  const handshake = await startSignIn();
  const res = await callback({ code: CODE, state: handshake.state, binding: 'cd'.repeat(16) });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as ErrorBody).error?.code, 'INVALID_STATE');
});

test('a state minted by another process is still accepted: the body binding carries it', async () => {
  // This is the redeploy case. Nothing in this app instance was ever told about the handshake, and no
  // cookie is sent at all — the browser that blocks third-party cookies.
  const minted = foreignHandshake({ codeVerifier: 'verifier-from-another-instance', nonce: 'nonce-from-another-instance' });
  const res = await callback({ code: CODE, state: minted.state, binding: minted.binding });
  assert.notEqual((res.json() as ErrorBody).error?.code, 'INVALID_STATE', res.body);
  assert.equal((res.json() as ErrorBody).error?.code, 'GOOGLE_AUTH_FAILED', 'the handshake passed and Google rejected the placeholder code');
});

test('the cookie transport alone still completes the handshake', async () => {
  // The web bundle deployed before the binding was put in `sessionStorage` sends only `code` and
  // `state`, so the cookie has to be enough on its own until that bundle is replaced.
  const handshake = await startSignIn();
  const res = await callback({ code: CODE, state: handshake.state }, handshake.handshake_binding);
  assert.notEqual((res.json() as ErrorBody).error?.code, 'INVALID_STATE', res.body);
  assert.equal((res.json() as ErrorBody).error?.code, 'GOOGLE_AUTH_FAILED');
});

test('a second tab’s stale binding does not outweigh the cookie that matches', async () => {
  // Two tabs share cookies but not `sessionStorage`: the tab that did not start this attempt sends its
  // own old binding in the body while the cookie carries the right one. Either copy is proof.
  const handshake = await startSignIn();
  const res = await callback(
    { code: CODE, state: handshake.state, binding: 'ef'.repeat(16) },
    handshake.handshake_binding,
  );
  assert.notEqual((res.json() as ErrorBody).error?.code, 'INVALID_STATE', res.body);
  assert.equal((res.json() as ErrorBody).error?.code, 'GOOGLE_AUTH_FAILED');
});

test('a callback that gets past the handshake clears the binding cookie without dropping the session cookie', async () => {
  // `reply.header` replaces, so a response that writes two cookies used to keep only the last one.
  // Nothing here sets a session cookie — Google refused the code first — but the handshake cookie must
  // still be expired rather than left in the jar.
  const handshake = await startSignIn();
  const res = await callback({ code: CODE, state: handshake.state, binding: handshake.handshake_binding });
  assert.equal(res.statusCode, 400);
  assert.match(String(res.headers['set-cookie']), /py_oauth=;/, 'the stale handshake cookie is expired');
});
