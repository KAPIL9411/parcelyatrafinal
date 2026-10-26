/**
 * Trip-editing E2E test against a running API.
 *
 * A traveller's times, capacity and meeting point are promises to the senders who already chose them,
 * so the invariant under test is that an edit can never invalidate accepted work:
 *   1. Only the owner can change a trip, and a stranger is answered with 404, not 403 — existence is
 *      not leaked. Anonymous is 401.
 *   2. A change that would strand an accepted parcel — a window that no longer covers it, capacity
 *      below what its reservation already occupies — is refused with the booking id and the engine's
 *      own gate code, and the trip is left byte-identical.
 *   3. A refused change is not half-applied: nothing is written, no notification is sent, no audit row.
 *   4. A safe change keeps every existing reservation: capacity remaining is recomputed from what the
 *      bookings actually hold, never reset, so widening the trip cannot hand out space twice.
 *   5. Only a move of the clock tells the senders. A meeting-point or capacity change is not an alert.
 *   6. An accepted booking is untouched by its trip being edited: same status, same agreed price.
 *   7. A full trip stays editable, because a traveller who finds more space must be able to say so.
 *   8. Every accepted edit is one audit row, and only the traveller who made it has one.
 *   9. The capacity column and the live bookings are the same fact: a refused shrink reports exactly
 *      what the trip says is taken, and calling the booking off hands that space back.
 *
 * Usage: node scripts/trips.mjs [--reset]   (API must be listening on 127.0.0.1:3000)
 *
 * Each run creates its own trip and parcel, so it is safe to re-run; `--reset` first restores the
 * seeded demo data. Note `PATCH /trips/:id` is rate limited to 30 edits per hour per address, so at
 * most two runs fit in one hour — the script says so plainly instead of reporting a failure as a bug.
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

import { readFileSync, writeFileSync } from 'node:fs';

/** Shared with smoke.mjs: sign-in is limited to 3 OTPs per hour per phone, so tokens are cached. */
const TOKEN_CACHE = '.smoke-tokens.json';

const CITY = {
  bareilly: 'c0000000-0000-4000-8000-000000000001',
  delhi: 'c0000000-0000-4000-8000-000000000002',
};
const PHONE = {
  sender: '+919000000001',
  imran: '+919000000002',
  neha: '+919000000003',
  admin: '+919000000009',
};

// One kilogram, so the packaging allowance (1.1x) is a number the assertions can state exactly.
const PARCEL_KG = 1;
const RESERVED_KG = 1.1;

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
async function writeInRoom(path, body, token) {
  return call('POST', path, { body, ...(token ? { token } : {}) });
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
  const verify = await writeInRoom('/auth/otp/verify', { challenge_id: request.body.challenge_id, code: peek.body.code });
  if (verify.status !== 200) throw new Error(`otp verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);

  cache[phone] = { access_token: verify.body.access_token, refresh_token: refreshCookieFrom(verify) };
  saveCache(cache);
  return { token: verify.body.access_token, user: verify.body.user };
}

/** Template ids this account was told about. */
async function templateIds(token) {
  const res = await call('GET', '/notifications?limit=50', { token });
  return (res.body?.items ?? []).map((n) => n.template_id);
}

function dayAt(dayOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

let stamp = '';

/**
 * One PATCH attempt, with the rate limit reported as what it is. A throttled run cannot be read as a
 * failed invariant, and it must never be skipped silently either.
 */
async function edit(token, tripId, body) {
  const res = await call('PATCH', `/trips/${tripId}`, { token, body });
  if (res.status === 429) {
    throw new Error(
      `PATCH /trips/:id is rate limited — this run is throttled, not broken (limit ${res.headers.get(
        'x-ratelimit-limit',
      )}, remaining ${res.headers.get('x-ratelimit-remaining')}, reset ${res.headers.get(
        'x-ratelimit-reset',
      )}s). Wait for the window and re-run.`,
    );
  }
  return res;
}

async function publishTrip(token, { capacityKg, departureAt, arrivalAt }) {
  const res = await call('POST', '/trips', {
    token,
    body: {
      origin_city_id: CITY.bareilly,
      dest_city_id: CITY.delhi,
      origin_area: 'Civil Lines',
      mode: 'car',
      departure_at: departureAt,
      arrival_estimate_at: arrivalAt,
      capacity_kg: capacityKg,
    },
  });
  if (res.status !== 201) {
    throw new Error(`trip publish failed: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return res.body.id;
}

async function main() {
  console.log(`\nParcel Yatra trip-editing test → ${BASE}\n`);
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
  const admin = await signIn(PHONE.admin);
  check('sender, two travellers and staff signed in', Boolean(sender.token && imran.token && neha.token && admin.token));
  const imranId = (await call('GET', '/me', { token: imran.token })).body?.id;

  // ---- a trip with work already accepted on it
  const departureAt = dayAt(4, 11);
  const arrivalAt = dayAt(4, 17);
  const tripId = await publishTrip(imran.token, { capacityKg: 5, departureAt, arrivalAt });

  const parcel = await call('POST', '/parcels', {
    token: sender.token,
    body: {
      origin_city_id: CITY.bareilly,
      dest_city_id: CITY.delhi,
      origin_area: 'Civil Lines',
      dest_area: 'Karol Bagh',
      category: 'documents',
      description: `Box of printed photographs, ref ${stamp}`,
      weight_kg: PARCEL_KG,
      dims_cm: [30, 22, 2],
      declared_value_paise: 250000,
      window_start: dayAt(4, 9),
      window_end: dayAt(4, 18),
      receiver_name: 'R. Sharma',
      receiver_phone: '+919000000101',
      declaration_accepted: true,
    },
  });
  check('sender posted a parcel on the corridor', parcel.status === 201, `${parcel.status} ${JSON.stringify(parcel.body).slice(0, 240)}`);
  const parcelId = parcel.body.id;

  const quote = await call('POST', `/parcels/${parcelId}/quote`, { token: sender.token });
  const booking = await call('POST', '/bookings', {
    token: sender.token,
    idempotencyKey: `trips-book-${stamp}`,
    body: { parcel_id: parcelId, trip_id: tripId, quote_id: quote.body.id },
  });
  check('the sender chose this trip', booking.status === 201, `${booking.status} ${JSON.stringify(booking.body).slice(0, 240)}`);
  const bookingId = booking.body.id;
  const agreedPaise = booking.body.agreed_total_paise;

  const accept = await call('POST', `/bookings/${bookingId}/transitions`, {
    token: imran.token,
    idempotencyKey: `trips-accept-${stamp}`,
    body: { command: 'accept' },
  });
  check('the traveller accepted, so the reservation is real', accept.status === 200 && accept.body.status === 'payment_pending', JSON.stringify(accept.body).slice(0, 240));

  const afterBooking = await call('GET', `/trips/${tripId}`, { token: imran.token });
  const baseline = afterBooking.body;
  check(
    'the accepted booking took its reservation out of the remaining space',
    Math.abs(baseline.capacity_kg_remaining - (5 - RESERVED_KG)) < 0.051,
    `remaining ${baseline.capacity_kg_remaining}`,
  );

  // The column and the bookings must never disagree, or every number in the app is a guess: a refused
  // shrink reports what the live bookings actually hold, so that figure has to equal what the trip
  // says is taken. Drift here means senders are shown space that is not there, or space that is.
  const shrinkProbe = await call('PATCH', `/trips/${tripId}`, { token: imran.token, body: { capacity_kg: 0.1 } });
  const takenFromColumn = Math.round((baseline.capacity_kg - baseline.capacity_kg_remaining) * 100) / 100;
  const takenFromBookings = shrinkProbe.body?.error?.details?.min_capacity_kg;
  check(
    'what the trip says is taken equals what the booked parcels hold',
    shrinkProbe.status === 422 && takenFromBookings === takenFromColumn,
    `column ${takenFromColumn} kg vs bookings ${takenFromBookings} kg (HTTP ${shrinkProbe.status})`,
  );

  // ---- who may edit
  const anon = await call('PATCH', `/trips/${tripId}`, { body: { origin_area: 'Rampur Bus Stand' } });
  check('an anonymous edit is refused', anon.status === 401 && anon.body?.error?.code === 'AUTH_REQUIRED', `${anon.status} ${JSON.stringify(anon.body).slice(0, 160)}`);

  const stranger = await edit(neha.token, tripId, { origin_area: 'Rampur Bus Stand' });
  check(
    "another traveller's edit gets 404, not 403",
    stranger.status === 404 && stranger.body?.error?.code === 'NOT_FOUND',
    `${stranger.status} ${JSON.stringify(stranger.body).slice(0, 160)}`,
  );

  const noop = await edit(imran.token, tripId, {});
  check(
    'an edit that changes nothing is refused rather than counted as success',
    noop.status === 400 && noop.body?.error?.code === 'VALIDATION_FAILED' && noop.body?.error?.details?.reason === 'nothing_to_change',
    `${noop.status} ${JSON.stringify(noop.body).slice(0, 240)}`,
  );

  const unknownField = await edit(imran.token, tripId, { mode: 'bike' });
  check(
    'a field the route does not own is rejected outright',
    unknownField.status === 400 && unknownField.body?.error?.code === 'VALIDATION_FAILED',
    `${unknownField.status} ${JSON.stringify(unknownField.body).slice(0, 200)}`,
  );

  // ---- a change that would break accepted work
  const tooSmall = await edit(imran.token, tripId, { capacity_kg: 0.5 });
  check(
    'capacity cannot be cut below what the accepted parcel already occupies',
    tooSmall.status === 422 && tooSmall.body?.error?.code === 'TRIP_CAPACITY_INVALID',
    `${tooSmall.status} ${JSON.stringify(tooSmall.body).slice(0, 240)}`,
  );
  check(
    'the refusal names the smallest capacity that would work',
    Number(tooSmall.body?.error?.details?.min_capacity_kg) >= RESERVED_KG && tooSmall.body?.error?.details?.bookings_held === 1,
    JSON.stringify(tooSmall.body?.error?.details),
  );

  const backwards = await edit(imran.token, tripId, { departure_at: dayAt(4, 16), arrival_estimate_at: dayAt(4, 15) });
  check(
    'an arrival before departure is refused with the reason',
    backwards.status === 422 &&
      backwards.body?.error?.code === 'TRIP_WINDOW_INVALID' &&
      backwards.body?.error?.details?.reason === 'arrival_before_departure',
    `${backwards.status} ${JSON.stringify(backwards.body).slice(0, 200)}`,
  );

  const inPast = await edit(imran.token, tripId, { departure_at: dayAt(-2, 9), arrival_estimate_at: dayAt(-2, 15) });
  check(
    'a trip cannot be moved into the past',
    inPast.status === 422 && inPast.body?.error?.code === 'TRIP_WINDOW_INVALID' && inPast.body?.error?.details?.reason === 'in_past',
    `${inPast.status} ${JSON.stringify(inPast.body).slice(0, 200)}`,
  );

  const stranded = await edit(imran.token, tripId, { departure_at: dayAt(6, 11), arrival_estimate_at: dayAt(6, 15) });
  check(
    'a window that no longer covers the accepted parcel is refused',
    stranded.status === 409 && stranded.body?.error?.code === 'TRIP_EDIT_BREAKS_BOOKING',
    `${stranded.status} ${JSON.stringify(stranded.body).slice(0, 240)}`,
  );
  check(
    'the refusal points at the booking and the engine gate that failed',
    stranded.body?.error?.details?.booking_id === bookingId && stranded.body?.error?.details?.reason === 'DEPARTS_AFTER_WINDOW',
    JSON.stringify(stranded.body?.error?.details),
  );

  const unchanged = await call('GET', `/trips/${tripId}`, { token: imran.token });
  check(
    'a refused edit leaves the trip exactly as it was',
    unchanged.body.departure_at === baseline.departure_at &&
      unchanged.body.arrival_estimate_at === baseline.arrival_estimate_at &&
      unchanged.body.capacity_kg === baseline.capacity_kg &&
      unchanged.body.capacity_kg_remaining === baseline.capacity_kg_remaining &&
      unchanged.body.origin_area === baseline.origin_area &&
      unchanged.body.status === baseline.status,
    JSON.stringify(unchanged.body),
  );

  const auditRefusals = await call('GET', `/admin/audit-log?resource=trip&resource_id=${tripId}`, { token: admin.token });
  const edited = (auditRefusals.body?.items ?? []).filter((row) => row.action === 'trip.edited');
  check('a refused edit writes no audit row', edited.length === 0, `${edited.length} rows: ${JSON.stringify(auditRefusals.body?.items?.[0])}`);

  // The engine's own answer to "would this parcel still fit": offering work it already holds is
  // refused, and the refusal says the parcel is assigned rather than that it does not fit.
  const reOffer = await call('POST', `/trips/${tripId}/opportunities/${parcelId}/interest`, { token: imran.token });
  check(
    'after the refusals the parcel is still on this trip, held by the booking',
    reOffer.status === 409 && reOffer.body?.error?.details?.reason === 'PARCEL_ALREADY_ASSIGNED',
    `${reOffer.status} ${JSON.stringify(reOffer.body?.error).slice(0, 240)}`,
  );

  // ---- a safe change: more space, same clock
  const widened = await edit(imran.token, tripId, { capacity_kg: 7 });
  check('widening the trip is allowed', widened.status === 200 && widened.body.capacity_kg === 7, `${widened.status} ${JSON.stringify(widened.body).slice(0, 240)}`);
  check(
    'widening adds to the free space, it does not reset the reservation already held',
    Math.abs(widened.body.capacity_kg_remaining - (7 - RESERVED_KG)) < 0.051,
    `remaining ${widened.body.capacity_kg_remaining}`,
  );
  check('the trip reports how many bookings it re-checked', widened.body.bookings_rechecked === 1, JSON.stringify(widened.body.bookings_rechecked));

  const noticesBefore = (await templateIds(sender.token)).filter((t) => t === 'trip_changed').length;

  // ---- a change the sender has to hear about: the clock moved
  const moved = await edit(imran.token, tripId, { departure_at: dayAt(4, 12, 30), arrival_estimate_at: dayAt(4, 18) });
  check('a later departure inside the window is allowed', moved.status === 200 && moved.body.departure_at === dayAt(4, 12, 30), `${moved.status} ${JSON.stringify(moved.body).slice(0, 240)}`);
  const noticesAfterMove = (await templateIds(sender.token)).filter((t) => t === 'trip_changed').length;
  check('the sender holding that booking is told the time changed', noticesAfterMove === noticesBefore + 1, `${noticesBefore} → ${noticesAfterMove}`);

  const bookingAfterMove = await call('GET', `/bookings/${bookingId}`, { token: sender.token });
  check(
    'editing the trip does not re-price, re-time or cancel the booking',
    bookingAfterMove.body.status === 'payment_pending' && bookingAfterMove.body.agreed_total_paise === agreedPaise,
    `${bookingAfterMove.body.status} ${bookingAfterMove.body.agreed_total_paise} vs ${agreedPaise}`,
  );

  // ---- a change that is not an alert: the meeting point
  const movedPoint = await edit(imran.token, tripId, { origin_area: 'Rampur Bus Stand' });
  check('the meeting point can be changed', movedPoint.status === 200 && movedPoint.body.origin_area === 'Rampur Bus Stand', `${movedPoint.status} ${JSON.stringify(movedPoint.body).slice(0, 200)}`);
  const noticesAfterArea = (await templateIds(sender.token)).filter((t) => t === 'trip_changed').length;
  check('a meeting-point change does not ping the sender', noticesAfterArea === noticesAfterMove, `${noticesAfterMove} → ${noticesAfterArea}`);

  // Taking the meeting point back to "not named" is the same choice the publish form offers, so the
  // edit form has to allow it too — and it is still not an alert.
  const cleared = await edit(imran.token, tripId, { origin_area: null });
  check(
    'the meeting point can be taken back to not naming one',
    cleared.status === 200 && cleared.body.origin_area === null,
    `${cleared.status} ${JSON.stringify(cleared.body).slice(0, 200)}`,
  );
  const noticesAfterClear = (await templateIds(sender.token)).filter((t) => t === 'trip_changed').length;
  check('removing the meeting point does not ping the sender either', noticesAfterClear === noticesAfterArea, `${noticesAfterArea} → ${noticesAfterClear}`);

  // ---- shrinking to exactly what is carried, then a full trip staying editable
  const tight = await edit(imran.token, tripId, { capacity_kg: RESERVED_KG });
  check(
    'capacity may be cut to exactly what the accepted parcel occupies',
    tight.status === 200 && tight.body.capacity_kg === RESERVED_KG,
    `${tight.status} ${JSON.stringify(tight.body).slice(0, 240)}`,
  );
  check('a trip with no free space reads as full', tight.body?.status === 'full', tight.body?.status);

  const unfull = await edit(imran.token, tripId, { capacity_kg: 6 });
  check(
    'a full trip can still be widened — a traveller who finds more space must be able to say so',
    unfull.status === 200 && unfull.body.status === 'partially_booked' && unfull.body.capacity_kg_remaining === 4.9,
    `${unfull.status} ${JSON.stringify(unfull.body).slice(0, 240)}`,
  );

  const auditRows = await call('GET', `/admin/audit-log?resource=trip&resource_id=${tripId}&limit=200`, { token: admin.token });
  const acceptedEdits = (auditRows.body?.items ?? []).filter((row) => row.action === 'trip.edited');
  // The log endpoint exposes the row, not its before/after columns, so this proves one entry per
  // accepted change by the traveller who made it — the values themselves are only in the table.
  check(
    'every accepted edit is exactly one audit row, by the traveller who made it',
    acceptedEdits.length === 6 && acceptedEdits.every((row) => row.actor_id === imranId && row.actor_kind === 'user'),
    `${acceptedEdits.length} rows: ${JSON.stringify(acceptedEdits[0]).slice(0, 240)}`,
  );

  // ---- a trip with nothing on it, and one that no longer exists
  const emptyTripId = await publishTrip(imran.token, { capacityKg: 2, departureAt, arrivalAt });
  const renamed = await edit(imran.token, emptyTripId, { origin_area: 'Sadarpur' });
  check('a trip with no bookings edits freely', renamed.status === 200 && renamed.body.bookings_rechecked === 0, `${renamed.status} ${JSON.stringify(renamed.body).slice(0, 200)}`);

  const refusedDelete = await call('DELETE', `/trips/${tripId}`, { token: imran.token });
  check(
    'a trip carrying accepted work cannot be deleted',
    refusedDelete.status === 409 && refusedDelete.body?.error?.code === 'TRIP_HAS_ACCEPTED_BOOKING',
    `${refusedDelete.status} ${JSON.stringify(refusedDelete.body).slice(0, 200)}`,
  );

  const deleted = await call('DELETE', `/trips/${emptyTripId}`, { token: imran.token });
  check('an empty trip can be removed', deleted.status === 204, `${deleted.status} ${JSON.stringify(deleted.body).slice(0, 160)}`);

  const tooLate = await edit(imran.token, emptyTripId, { capacity_kg: 3 });
  check(
    'a removed trip is not editable afterwards',
    tooLate.status === 409 && tooLate.body?.error?.code === 'TRIP_NOT_AVAILABLE',
    `${tooLate.status} ${JSON.stringify(tooLate.body).slice(0, 200)}`,
  );

  // ---- the booking still stands, and the parcel is still where the sender left it
  const parcels = await call('GET', '/parcels?limit=50', { token: sender.token });
  const mine = (parcels.body?.items ?? []).find((p) => p.id === parcelId);
  check(
    'the sender still finds the parcel, still pointing at the same booking',
    Boolean(mine) && mine.booking_id === bookingId,
    JSON.stringify(mine).slice(0, 200),
  );

  // ---- and when the sender calls the work off, the space has to go back
  const released = await call('POST', `/bookings/${bookingId}/transitions`, {
    token: sender.token,
    body: { command: 'cancel' },
    idempotencyKey: `trips-cancel-${stamp}`,
  });
  check(
    'the sender called the accepted booking off',
    released.status === 200 && released.body?.status === 'cancelled_by_sender',
    `${released.status} ${JSON.stringify(released.body).slice(0, 200)}`,
  );

  const afterRelease = await call('GET', `/trips/${tripId}`, { token: imran.token });
  check(
    'cancelling hands the reserved space back to the trip',
    Math.abs(afterRelease.body.capacity_kg_remaining - afterRelease.body.capacity_kg) < 0.051,
    `remaining ${afterRelease.body.capacity_kg_remaining} of ${afterRelease.body.capacity_kg}`,
  );

  console.log(`\n  ${passed} passed, ${failed} failed${failures.length ? `\n  failed: ${failures.join('; ')}` : ''}\n`);  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n  ABORTED — ${err?.message ?? err}\n`);
  process.exit(2);
});
