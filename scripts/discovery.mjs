/**
 * Traveller-side discovery E2E test against a running API.
 *
 * The traveller's half of matching only means something if it cannot lie, so every assertion here is
 * about the invariant that a shown offer is a valid offer:
 *   1. A verified traveller sees the parcels that pass the engine's hard gates on their own trip, and
 *      the two directions agree — a parcel shown here is a parcel the sender was shown this trip for.
 *   2. Someone else's trip answers 404, and an anonymous call answers 401. Nothing is leaked by
 *      existing.
 *   3. An empty list is an honest empty list: it names the reason the engine actually returned rather
 *      than padding itself with anything on a similar route.
 *   4. An offer is a flag, not a booking: it is idempotent, it notifies the sender once, and the
 *      sender can act on it by creating the booking.
 *   5. A stale list cannot be acted on. Once a parcel is booked, or no longer fits the capacity left,
 *      the offer is refused by the same engine that produced the list.
 *   6. A trip that carries accepted work cannot be cancelled out from under it.
 *   7. The sender can find the parcel again. An offer that arrives hours after the wizard was closed
 *      has to be reachable, not just announced.
 *
 * Usage: node scripts/discovery.mjs [--reset]   (API must be listening on 127.0.0.1:3000)
 *
 * `--reset` restores the seeded demo data first, which also puts the demo trip back to a published
 * state with its full capacity. The script creates its own parcels and one trip per run, so it is
 * safe to re-run; the rows it leaves behind are named with this run's timestamp.
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

import { readFileSync, writeFileSync } from 'node:fs';

/** Shared with smoke.mjs: sign-in is limited to 3 OTPs per hour per phone, so tokens are cached. */
const TOKEN_CACHE = '.smoke-tokens.json';

const CITY = {
  bareilly: 'c0000000-0000-4000-8000-000000000001',
  delhi: 'c0000000-0000-4000-8000-000000000002',
  lucknow: 'c0000000-0000-4000-8000-000000000003',
};
const TRIP = {
  imranDelhi: 'b0000000-0000-4000-8000-000000000001',
  nehaLucknow: 'b0000000-0000-4000-8000-000000000002',
};
const PHONE = {
  sender: '+919000000001',
  imran: '+919000000002',
  neha: '+919000000003',
  admin: '+919000000009',
  // A number that is never seeded, so the account behind it stays unverified.
  newcomer: '+919000000044',
};

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

/**
 * A throttled call is waited out, read or write, by `call` itself, in every harness.
 *
 * The write budget is 60/min per address, the read budget 300/min, and every harness here shares those
 * pools, plus any
 * browser left open on the app. A run that fails because the previous suite spent the budget measures
 * nothing about the product, and the failure it prints is a lie. The refusal arrives from a preHandler
 * before the route runs, so nothing was created and the retry is safe.
 */
async function call(method, path, opts) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await rawCall(method, path, opts);
    if (res.status !== 429 || attempt >= 5) return res;
    const wait = Number(res.headers.get('retry-after') ?? '5') + 2;
    // Only a window we can sit out is waited. A per-route hourly limit hands the refusal back, because
    // tripping it is a finding the harness reports itself instead of sleeping on.
    if (wait > 75) return res;
    console.log(`  ---- ${method} ${path} throttled; waiting ${wait}s for the rate-limit window`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

async function rawCall(method, path, { token, body, idempotencyKey, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'idempotency-key': idempotencyKey ?? crypto.randomUUID() } : {}),
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

/** Positional shorthand for an auth write; the throttling itself now lives in `call`. */
async function writeInRoom(path, body) {
  return call('POST', path, { body });
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

    if (entry.refresh_token) {
      // `/auth/refresh` reads the credential from the httpOnly cookie only; it never looks at a body.
      // Posting one meant every cached-token refresh failed and silently fell through to a fresh OTP.
      const refreshed = await call('POST', '/auth/refresh', { headers: { cookie: `py_refresh=${entry.refresh_token}` } });
      if (refreshed.status === 200) {
        const rotated = refreshCookieFrom(refreshed);
        cache[phone] = { access_token: refreshed.body.access_token, refresh_token: rotated ?? entry.refresh_token };
        saveCache(cache);
        return { token: refreshed.body.access_token, user: refreshed.body.user };
      }
    }
  }

  const request = await writeInRoom('/auth/otp/request', { phone, purpose: 'login' });
  if (request.status !== 202) throw new Error(`otp request failed: ${request.status} ${JSON.stringify(request.body)}`);
  const peek = await call('GET', `/dev/otp/${request.body.challenge_id}`);
  if (peek.status !== 200) throw new Error(`dev otp peek failed: ${peek.status} ${JSON.stringify(peek.body)}`);
  const verify = await writeInRoom('/auth/otp/verify', {
    challenge_id: request.body.challenge_id,
    code: peek.body.code,
  });
  if (verify.status !== 200) throw new Error(`otp verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);

  cache[phone] = { access_token: verify.body.access_token, refresh_token: refreshCookieFrom(verify) };
  saveCache(cache);
  return { token: verify.body.access_token, user: verify.body.user };
}

/** The template ids this account was told about, newest list first. */
async function templateIds(token) {
  const res = await call('GET', '/notifications?limit=50', { token });
  return (res.body?.items ?? []).map((n) => n.template_id);
}

function dayAt(dayOffset, hour) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

let stamp = '';

/** A parcel with this run's stamp in the description, so rows from earlier runs are recognisable. */
async function postParcel(senderToken, { weightKg, windowDay = 1 }) {
  const created = await call('POST', '/parcels', {
    token: senderToken,
    body: {
      origin_city_id: CITY.bareilly,
      dest_city_id: CITY.delhi,
      origin_area: 'Civil Lines',
      dest_area: 'Karol Bagh',
      category: 'documents',
      description: `A4 file of printed drawings, ref ${stamp}`,
      weight_kg: weightKg,
      dims_cm: [30, 22, 2],
      declared_value_paise: 250000,
      window_start: dayAt(windowDay, 9),
      window_end: dayAt(windowDay, 18),
      receiver_name: 'R. Sharma',
      receiver_phone: '+919000000101',
      declaration_accepted: true,
    },
  });
  if (created.status !== 201) {
    throw new Error(`parcel create failed: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
  }
  return created.body.id;
}

async function main() {
  console.log(`\nParcel Yatra traveller-discovery test → ${BASE}\n`);
  stamp = `${Date.now()}`.slice(-7);

  const health = await call('GET', '/health');
  if (health.status !== 200) throw new Error(`API not reachable at ${BASE}`);

  if (process.argv.includes('--reset')) {
    const ops = await signIn(PHONE.admin);
    const reset = await call('POST', '/dev/seed/reset', { token: ops.token });
    if (reset.status !== 200) throw new Error(`seed reset failed: ${reset.status} ${JSON.stringify(reset.body)}`);
    saveCache({});
    console.log('  ---- seeded demo data restored (--reset)\n');
  }

  const sender = await signIn(PHONE.sender);
  const imran = await signIn(PHONE.imran);
  const neha = await signIn(PHONE.neha);
  check('sender and two verified travellers signed in', Boolean(sender.token && imran.token && neha.token));

  // ---- the gate that keeps an unverified traveller out of discovery altogether
  const newcomer = await signIn(PHONE.newcomer);
  const unverifiedTrip = await call('POST', '/trips', {
    token: newcomer.token,
    body: {
      origin_city_id: CITY.bareilly,
      dest_city_id: CITY.delhi,
      mode: 'car',
      departure_at: dayAt(4, 11),
      arrival_estimate_at: dayAt(4, 17),
      capacity_kg: 6,
    },
  });
  check(
    'an unverified account cannot publish a trip at all',
    unverifiedTrip.status === 403 && unverifiedTrip.body?.error?.code === 'VERIFICATION_REQUIRED',
    `${unverifiedTrip.status} ${JSON.stringify(unverifiedTrip.body).slice(0, 200)}`,
  );

  // ---- a parcel on the corridor Imran actually drives
  const parcelId = await postParcel(sender.token, { weightKg: 1.5 });
  check('sender posted a parcel on the Bareilly → Delhi corridor', Boolean(parcelId));

  const opps = await call('GET', `/trips/${TRIP.imranDelhi}/opportunities`, { token: imran.token });
  check('the traveller reads their own trip list', opps.status === 200, `${opps.status} ${JSON.stringify(opps.body).slice(0, 200)}`);
  const shown = (opps.body?.items ?? []).find((i) => i.parcel_id === parcelId);
  check(
    'the new parcel appears in it',
    Boolean(shown),
    `ids=${JSON.stringify(opps.body?.items?.map((i) => i.parcel_id))} reasons=${JSON.stringify(
      opps.body?.no_match_reasons,
    )} remaining=${opps.body?.capacity_kg_remaining}kg — if this is a re-run without --reset the demo trip's capacity is already spent, which gates the parcel out correctly`,
  );
  check('the list reports the capacity the offer would consume', typeof opps.body?.capacity_kg_remaining === 'number');
  check(
    'a shown parcel is scored and explained, not a bare row',
    Boolean(shown) && typeof shown.score === 'number' && shown.reasons?.length > 0 && typeof shown.indicative_price_paise === 'number',
    JSON.stringify(shown ?? null).slice(0, 240),
  );
  check('the price is labelled as the sender quote, not traveller earnings', Boolean(shown) && !('traveller_share_paise' in shown));
  check('a fresh parcel is not marked as already offered', shown?.offered === false);

  // ---- the two directions agree
  const senderSide = await call('GET', `/parcels/${parcelId}/matches`, { token: sender.token });
  const tripOfferedToSender = (senderSide.body?.matches ?? []).some((m) => m.trip_id === TRIP.imranDelhi);
  check('the same pair is visible to the sender', tripOfferedToSender, JSON.stringify(senderSide.body?.matches?.map((m) => m.trip_id)));

  // ---- authorization: nothing about someone else's trip is confirmable
  const notOwner = await call('GET', `/trips/${TRIP.imranDelhi}/opportunities`, { token: neha.token });
  check(
    'another traveller gets 404 on someone else’s trip list',
    notOwner.status === 404 && notOwner.body?.error?.code === 'NOT_FOUND',
    `${notOwner.status} ${JSON.stringify(notOwner.body).slice(0, 160)}`,
  );
  const anonymous = await call('GET', `/trips/${TRIP.imranDelhi}/opportunities`);
  check('the list is not public', anonymous.status === 401, `${anonymous.status}`);
  const strangerOffer = await call('POST', `/trips/${TRIP.imranDelhi}/opportunities/${parcelId}/interest`, { token: neha.token });
  check('a traveller who does not own the trip cannot offer', strangerOffer.status === 404, `${strangerOffer.status}`);

  // ---- an empty list says so
  const nehaList = await call('GET', `/trips/${TRIP.nehaLucknow}/opportunities`, { token: neha.token });
  check('the other trip still reads', nehaList.status === 200);
  check(
    'a corridor with nothing on it returns an empty list with the engine’s reason',
    (nehaList.body?.items ?? []).length === 0 && (nehaList.body?.no_match_reasons ?? []).includes('NO_PARCEL_ON_ROUTE'),
    JSON.stringify(nehaList.body).slice(0, 220),
  );

  // ---- offering
  const offerCount = async () => (await templateIds(sender.token)).filter((t) => t === 'traveller_interested').length;
  const baseline = await offerCount();
  const offered = await call('POST', `/trips/${TRIP.imranDelhi}/opportunities/${parcelId}/interest`, { token: imran.token });
  check('the traveller offers to carry it', offered.status === 201, `${offered.status} ${JSON.stringify(offered.body).slice(0, 200)}`);
  check('the first offer tells the sender', (await offerCount()) === baseline + 1, `baseline ${baseline}`);

  const interests = await call('GET', `/parcels/${parcelId}/interests`, { token: sender.token });
  check('the sender sees who offered', interests.status === 200 && interests.body?.items?.length >= 1, JSON.stringify(interests.body).slice(0, 240));
  const offer = (interests.body?.items ?? []).find((i) => i.trip_id === TRIP.imranDelhi);
  check('the offer names the traveller and their verification state', offer?.traveller_first_name === 'Imran' && offer?.verification_state === 'verified', JSON.stringify(offer));
  check('the offer carries the trip facts the sender chooses on', Boolean(offer?.departure_at && offer?.mode && typeof offer?.capacity_kg_remaining === 'number'));
  check('the offer list leaks no phone numbers', !JSON.stringify(interests.body).includes('9000000'));

  const otherSender = await call('GET', `/parcels/${parcelId}/interests`, { token: neha.token });
  check('a stranger cannot read a parcel’s offers', otherSender.status === 404, `${otherSender.status}`);

  // ---- idempotent, and it tells the sender exactly once
  const before = await offerCount();
  const again = await call('POST', `/trips/${TRIP.imranDelhi}/opportunities/${parcelId}/interest`, { token: imran.token });
  check('a repeated offer is not an error', again.status === 200 && again.body?.already_offered === true, `${again.status} ${JSON.stringify(again.body).slice(0, 200)}`);
  check('the sender is told once, not once per tap', (await offerCount()) === before, `${before} → ${await offerCount()}`);

  const refreshed = await call('GET', `/trips/${TRIP.imranDelhi}/opportunities`, { token: imran.token });
  const stillShown = (refreshed.body?.items ?? []).find((i) => i.parcel_id === parcelId);
  check('the list now marks the parcel as already offered', stillShown?.offered === true, JSON.stringify(stillShown).slice(0, 200));

  // ---- the offer converts into the real flow
  const quote = await call('POST', `/parcels/${parcelId}/quote`, { token: sender.token });
  check('the sender gets a price', quote.status === 201, `${quote.status} ${JSON.stringify(quote.body).slice(0, 200)}`);
  const booking = await call('POST', '/bookings', {
    token: sender.token,
    body: { parcel_id: parcelId, trip_id: TRIP.imranDelhi, quote_id: quote.body.id },
  });
  check('the sender books the traveller who offered', booking.status === 201 && booking.body?.status === 'pending_traveller_acceptance', `${booking.status} ${JSON.stringify(booking.body).slice(0, 260)}`);
  check('the traveller is told a sender chose them', (await templateIds(imran.token)).includes('booking_requested'));

  // ---- the sender can find the parcel again, which is what makes an offer actionable at all
  const myList = await call('GET', '/parcels?limit=50', { token: sender.token });
  check('the sender lists their own parcels', myList.status === 200, `${myList.status} ${JSON.stringify(myList.body).slice(0, 160)}`);
  const mineRow = (myList.body?.items ?? []).find((p) => p.id === parcelId);
  check('the parcel they posted is in it', Boolean(mineRow));
  check('the list carries the offer count the sender acts on', typeof mineRow?.interests_count === 'number' && mineRow.interests_count >= 1, JSON.stringify(mineRow).slice(0, 200));
  check('the list carries the booking that now holds it', mineRow?.booking_id === booking.body?.id, JSON.stringify({ want: booking.body?.id, got: mineRow?.booking_id }));

  const nehaParcel = await postParcel(neha.token, { weightKg: 1 });
  const myListAgain = await call('GET', '/parcels?limit=50', { token: sender.token });
  check(
    'the list never contains another sender’s parcel',
    !(myListAgain.body?.items ?? []).some((p) => p.id === nehaParcel),
    JSON.stringify((myListAgain.body?.items ?? []).map((p) => p.id).slice(0, 6)),
  );
  const nehaParcels = await call('GET', '/parcels?limit=50', { token: neha.token });
  check('another sender gets their own list, not this one', (nehaParcels.body?.items ?? []).some((p) => p.id === nehaParcel));

  const otherDetail = await call('GET', `/parcels/${parcelId}`, { token: neha.token });
  check('a stranger cannot read someone else’s parcel', otherDetail.status === 404, `${otherDetail.status}`);
  const detail = await call('GET', `/parcels/${parcelId}`, { token: sender.token });
  check(
    'the parcel page says the work is already taken and where it went',
    detail.status === 200 && detail.body?.booking_id === booking.body?.id && detail.body?.booking_status === 'pending_traveller_acceptance',
    `${detail.status} ${JSON.stringify({ b: detail.body?.booking_id, s: detail.body?.booking_status }).slice(0, 200)}`,
  );

  // ---- a stale list cannot be acted on
  const lateOffer = await call('POST', `/trips/${TRIP.imranDelhi}/opportunities/${parcelId}/interest`, { token: imran.token });
  check(
    'a parcel that is now booked is refused with the engine’s reason',
    lateOffer.status === 409 && lateOffer.body?.error?.code === 'OPPORTUNITY_NOT_AVAILABLE' && lateOffer.body?.error?.details?.reason === 'PARCEL_ALREADY_ASSIGNED',
    `${lateOffer.status} ${JSON.stringify(lateOffer.body).slice(0, 240)}`,
  );

  // ---- capacity is re-checked on the offer, not only on the list
  const tightTrip = await call('POST', '/trips', {
    token: imran.token,
    body: {
      origin_city_id: CITY.bareilly,
      dest_city_id: CITY.delhi,
      origin_area: 'Civil Lines',
      mode: 'car',
      departure_at: dayAt(2, 11),
      arrival_estimate_at: dayAt(2, 17),
      capacity_kg: 1,
    },
  });
  check('a verified traveller can publish a second trip', tightTrip.status === 201, `${tightTrip.status} ${JSON.stringify(tightTrip.body).slice(0, 200)}`);
  const tightTripId = tightTrip.body?.id;
  const heavyParcel = await postParcel(sender.token, { weightKg: 3, windowDay: 2 });

  const tightList = await call('GET', `/trips/${tightTripId}/opportunities`, { token: imran.token });
  check('the 1 kg trip reads', tightList.status === 200);
  check(
    'a parcel heavier than the remaining capacity is never shown',
    !(tightList.body?.items ?? []).some((i) => i.parcel_id === heavyParcel),
    JSON.stringify(tightList.body?.items?.map((i) => [i.parcel_id, i.weight_kg])),
  );
  check(
    'and the reason it was dropped is counted, not hidden',
    Object.keys(tightList.body?.blocked_counts ?? {}).includes('NO_CAPACITY'),
    JSON.stringify(tightList.body?.blocked_counts),
  );

  const tooHeavy = await call('POST', `/trips/${tightTripId}/opportunities/${heavyParcel}/interest`, { token: imran.token });
  check(
    'offering for it is refused with NO_CAPACITY',
    tooHeavy.status === 409 && tooHeavy.body?.error?.details?.reason === 'NO_CAPACITY',
    `${tooHeavy.status} ${JSON.stringify(tooHeavy.body).slice(0, 240)}`,
  );

  // ---- a dead trip offers nothing
  const cancelled = await call('DELETE', `/trips/${tightTripId}`, { token: imran.token });
  check('a trip with nothing accepted on it can be cancelled', cancelled.status === 204, `${cancelled.status}`);
  const deadList = await call('GET', `/trips/${tightTripId}/opportunities`, { token: imran.token });
  check(
    'a cancelled trip reports TRIP_NOT_LIVE instead of a list',
    (deadList.body?.items ?? []).length === 0 && (deadList.body?.no_match_reasons ?? []).includes('TRIP_NOT_LIVE'),
    JSON.stringify(deadList.body).slice(0, 200),
  );
  const deadOffer = await call('POST', `/trips/${tightTripId}/opportunities/${heavyParcel}/interest`, { token: imran.token });
  check('and offering on it is refused', deadOffer.status === 409 && deadOffer.body?.error?.code === 'TRIP_NOT_AVAILABLE', `${deadOffer.status} ${JSON.stringify(deadOffer.body).slice(0, 160)}`);

  // ---- accepted work is not orphaned
  const busyTrip = await call('DELETE', `/trips/${TRIP.imranDelhi}`, { token: imran.token });
  check(
    'a trip carrying an accepted booking cannot be cancelled',
    busyTrip.status === 409 && busyTrip.body?.error?.code === 'TRIP_HAS_ACCEPTED_BOOKING',
    `${busyTrip.status} ${JSON.stringify(busyTrip.body).slice(0, 200)}`,
  );

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`  failing: ${failures.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n  discovery test aborted: ${err?.message ?? err}`);
  process.exit(1);
});
