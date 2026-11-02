/**
 * Rate-limiting E2E test against a running API.
 *
 * Throttling is only honest if a refused request is a request that did not happen, and if the refusal
 * looks like a refusal. Both halves were broken in this build and are pinned here:
 *   1. A write inside its budget executes and answers normally — the write budget must not be a
 *      blanket block. (It was: the manual limiter reports `isAllowed: false` for every request that is
 *      not allow-listed, so reading that flag rejected literally every POST/PATCH/PUT/DELETE.)
 *   2. An exhausted write budget answers 429 with the error envelope and a `Retry-After`.
 *   3. A throttled write has no side effect. The trip it tried to create does not exist, so the
 *      "safe" retry is not a second booking. (It was: a preHandler that *returns* the envelope does
 *      not stop the lifecycle, so a throttled write executed while the caller was told to slow down.)
 *   4. The budget refills after its window, and the same request then succeeds.
 *   5. Reads and writes have separate budgets: writes throttled, reads still served.
 *   6. An exhausted *global* limiter answers 429, not 500 — the plugin throws whatever the builder
 *      returns, so a status-less envelope used to fall through to the unhandled-error branch.
 *   7. A route that declares `config.rateLimit: false` is exempt from the write budget as well as the
 *      global one; it must reach its own authorization check instead of being throttled.
 *
 * The last two steps deliberately exhaust the read and then the write budget, so for up to a minute
 * afterwards this address will see 429 on GETs and writes alike. It heals itself; restart the API to
 * clear it at once (all limiter state is in-memory).
 *
 * Usage: node scripts/ratelimit.mjs        (API must be listening on 127.0.0.1:3000)
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN_CACHE = '.smoke-tokens.json';

const CITY = {
  bareilly: 'c0000000-0000-4000-8000-000000000001',
  delhi: 'c0000000-0000-4000-8000-000000000002',
};
const PHONE = { imran: '+919000000002' };

/** Never loop forever at a server that is refusing us for some other reason. */
const MAX_PROBE_REQUESTS = 400;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function loadCache() {
  try {
    return JSON.parse(readFileSync(TOKEN_CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  writeFileSync(TOKEN_CACHE, JSON.stringify(cache, null, 2));
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, headers: res.headers };
}

/**
 * The long-lived credential is only ever handed out in an HttpOnly cookie — `/auth/otp/verify` answers
 * `access_token` and nothing else. A harness that reads the body for a refresh token caches undefined
 * and then silently falls back to a fresh OTP on every run.
 */
function refreshCookieFrom(res) {
  return /py_refresh=([^;,]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;
}

async function signIn(phone) {
  const cache = loadCache();
  const entry = cache[phone];
  if (entry?.access_token) {
    const me = await call('GET', '/me', { token: entry.access_token });
    if (me.status === 200) return { token: entry.access_token, user: me.body };
  }
  const request = await call('POST', '/auth/otp/request', { body: { phone, purpose: 'login' } });
  if (request.status !== 202) throw new Error(`otp request failed: ${request.status} ${JSON.stringify(request.body)}`);
  const peek = await call('GET', `/dev/otp/${request.body.challenge_id}`);
  if (peek.status !== 200) throw new Error(`dev otp peek failed: ${peek.status} ${JSON.stringify(peek.body)}`);
  const verify = await call('POST', '/auth/otp/verify', {
    body: { challenge_id: request.body.challenge_id, code: peek.body.code },
  });
  if (verify.status !== 200) throw new Error(`otp verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  cache[phone] = { access_token: verify.body.access_token, refresh_token: refreshCookieFrom(verify) };
  saveCache(cache);
  return { token: verify.body.access_token, user: verify.body.user };
}

function dayAt(dayOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function tripBody() {
  return {
    origin_city_id: CITY.bareilly,
    dest_city_id: CITY.delhi,
    origin_area: 'Civil Lines',
    mode: 'car',
    departure_at: dayAt(9, 9),
    arrival_estimate_at: dayAt(9, 15),
    capacity_kg: 3,
  };
}

async function listMine(token) {
  // `GET /trips` is already scoped to the caller — the route has no mine/other switch.
  const res = await call('GET', '/trips?limit=100', { token });
  return (res.body?.items ?? []).map((t) => t.id);
}

/** Keep writing until the server refuses, and report what it refused with. */
async function exhaustWrites(token) {
  let last = null;
  for (let n = 0; n < MAX_PROBE_REQUESTS; n += 1) {
    // An empty body is refused by the route's own validation, so the probe costs nothing and leaves
    // no data behind — but it still crosses the throttle hook, which is what is under test.
    last = await call('POST', '/parcels', { token, body: {} });
    if (last.status === 429) return { attempts: n + 1, res: last };
    if (last.status !== 400) {
      throw new Error(`write probe answered ${last.status} ${JSON.stringify(last.body).slice(0, 200)} — expected 400`);
    }
  }
  throw new Error(`write budget never ran out after ${MAX_PROBE_REQUESTS} writes`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`\nParcel Yatra rate-limit test → ${BASE}\n`);

  const health = await call('GET', '/health');
  if (health.status !== 200) throw new Error(`API not reachable at ${BASE}`);

  const me = await signIn(PHONE.imran);
  check('traveller signed in', Boolean(me.token));

  const tripsBefore = await listMine(me.token);
  check(
    'a read is served before any throttling',
    tripsBefore.length >= 0 && (await call('GET', '/health')).status === 200,
  );

  // ---- 1. writes inside the budget execute normally
  // An earlier suite may have spent this address's minute, so make room before asserting anything
  // about what an in-budget write does. Waiting is not the invariant; refusing without effect is.
  let created = await call('POST', '/trips', { token: me.token, body: tripBody() });
  if (created.status === 429) {
    const wait = Number(created.headers.get('retry-after') ?? '5') + 2;
    console.log(`  ---- write budget already spent by an earlier run; waiting ${wait}s\n`);
    await sleep(wait * 1000);
    created = await call('POST', '/trips', { token: me.token, body: tripBody() });
  }
  check(
    'a write inside the budget executes and answers 201',
    created.status === 201 && Boolean(created.body?.id),
    `${created.status} ${JSON.stringify(created.body).slice(0, 200)}`,
  );
  const probeTripId = created.body?.id;
  if (probeTripId) await call('DELETE', `/trips/${probeTripId}`, { token: me.token });

  // ---- 2 & 3. exhaust it, then prove the refusal is a refusal that changed nothing
  const { attempts, res: throttled } = await exhaustWrites(me.token);  const retryAfter = Number(throttled.headers.get('retry-after') ?? '0');
  check(
    `the write budget runs out (${attempts} writes) and answers 429`,
    throttled.status === 429 && throttled.body?.error?.code === 'RATE_LIMITED',
    `${throttled.status} ${JSON.stringify(throttled.body).slice(0, 200)}`,
  );
  check(
    'the refusal says when to come back',
    retryAfter >= 1 && retryAfter <= 60,
    `retry-after=${throttled.headers.get('retry-after')}`,
  );
  check(
    'the refusal carries the error envelope, not a stack trace',
    typeof throttled.body?.error?.message === 'string' && Boolean(throttled.body?.error?.request_id),
    JSON.stringify(throttled.body).slice(0, 200),
  );

  const idsRightBefore = await listMine(me.token);
  const blocked = await call('POST', '/trips', { token: me.token, body: tripBody() });
  check(
    'a throttled write is refused with 429',
    blocked.status === 429 && blocked.body?.error?.code === 'RATE_LIMITED',
    `${blocked.status} ${JSON.stringify(blocked.body).slice(0, 200)}`,
  );
  // `GET /trips` keeps cancelled rows, so this compares identity sets rather than counting rows: the
  // question is whether the refused create left a trip behind, and a refused create has no id to look
  // up. The control at the end of the script shows the same body really does add a row once allowed.
  const idsAfter = await listMine(me.token);
  check(
    'the throttled write created nothing — a retry is not a second booking',
    idsAfter.length === idsRightBefore.length && idsAfter.every((id) => idsRightBefore.includes(id)),
    `${idsRightBefore.length} → ${idsAfter.length} trips`,
  );
  check(
    'reads are still served while writes are throttled (separate budgets)',
    (await call('GET', '/trips?limit=5', { token: me.token })).status === 200,
  );

  // ---- 4. the window passes and the same request works
  const limitHeader = Number(throttled.headers.get('x-ratelimit-limit') ?? '0');
  console.log(`  ---- waiting ${retryAfter + 2}s for the write window (limit ${limitHeader}/minute)\n`);
  await sleep((retryAfter + 2) * 1000);
  const afterWindow = await call('POST', '/trips', { token: me.token, body: tripBody() });
  check(
    'the budget refills and the identical write then succeeds',
    afterWindow.status === 201 && Boolean(afterWindow.body?.id),
    `${afterWindow.status} ${JSON.stringify(afterWindow.body).slice(0, 200)}`,
  );
  // The control that makes the empty-diff above mean something: this body really does put a row on
  // the list once it is allowed, so "the list did not change" proves the throttled write was inert.
  check(
    'the same body does create a trip when allowed, so the no-side-effect check is not blind',
    Boolean(afterWindow.body?.id) && !idsRightBefore.includes(afterWindow.body?.id),
    `new id ${afterWindow.body?.id} vs ${idsRightBefore.length} ids before`,
  );
  if (afterWindow.body?.id) await call('DELETE', `/trips/${afterWindow.body.id}`, { token: me.token });

  // ---- 6. an exhausted global limiter must answer 429, not 500
  let readRefused = null;
  for (let n = 0; n < MAX_PROBE_REQUESTS; n += 1) {
    const res = await call('GET', '/config', { token: me.token });
    if (res.status === 429) {
      readRefused = res;
      break;
    }
    if (n === MAX_PROBE_REQUESTS - 1) break;
  }
  check(
    'an exhausted read budget answers 429 with the envelope, never 500',
    readRefused !== null && readRefused.status === 429 && readRefused.body?.error?.code === 'RATE_LIMITED',
    readRefused ? JSON.stringify(readRefused.body).slice(0, 200) : `no 429 within ${MAX_PROBE_REQUESTS} reads`,
  );
  check(
    'the read refusal also carries Retry-After',
    Number(readRefused?.headers.get('retry-after') ?? '0') >= 1,
    `retry-after=${readRefused?.headers.get('retry-after')}`,
  );

  // ---- 7. a route that declares `rateLimit: false` opts out of the write budget too
  // `POST /dev/seed/reset` is the only POST that declares itself exempt, and it is the first call the
  // other suites make. While the write budget throttled it, a suite that had just been blocked could
  // not restore the demo data for a minute. Refusing with 403 rather than 429 proves the hook let the
  // request reach the handler, where the staff role check lives — so no reset actually runs here.
  const exhaustedAgain = await exhaustWrites(me.token);
  const exempt = await call('POST', '/dev/seed/reset', { token: me.token });
  check(
    'a limit-exempt route is not throttled by the write budget',
    exhaustedAgain.res.status === 429 && exempt.status === 403 && exempt.body?.error?.code === 'ROLE_REQUIRED',
    `${exempt.status} ${JSON.stringify(exempt.body).slice(0, 160)}`,
  );

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log(`  failed: ${failures.join('; ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n  ABORTED — ${err.message}\n`);
  process.exitCode = 1;
});
