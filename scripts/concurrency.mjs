/**
 * Duplicate-booking and idempotency test against a running API.
 *
 * Proves the two claims the pilot cannot afford to get wrong:
 *   1. N simultaneous `POST /bookings` for one parcel produce exactly one active booking.
 *   2. One `Idempotency-Key` replayed concurrently produces exactly one booking, with one body.
 *
 * Usage: node scripts/concurrency.mjs          (API must be listening on 127.0.0.1:3000)
 *
 * The test posts its own parcels, so it leaves the seeded demo data alone. It shares the sign-in
 * token cache with scripts/smoke.mjs because OTP requests are rate limited per phone number.
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN_CACHE = '.smoke-tokens.json';
const CITY = { bareilly: 'c0000000-0000-4000-8000-000000000001', delhi: 'c0000000-0000-4000-8000-000000000002' };
const PHONE_SENDER = '+919000000001';
const PHONE_TRAVELLER = '+919000000002';

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, { token, body, idempotencyKey } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
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
  return { status: res.status, body: json };
}

async function signIn(phone) {
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(TOKEN_CACHE, 'utf8'));
  } catch {
    cache = {};
  }
  const cached = cache[phone]?.access_token;
  if (cached && (await call('GET', '/me', { token: cached })).status === 200) return cached;

  const request = await call('POST', '/auth/otp/request', { body: { phone, purpose: 'login' } });
  const peek = await call('GET', `/dev/otp/${request.body.challenge_id}`);
  const verify = await call('POST', '/auth/otp/verify', {
    body: { challenge_id: request.body.challenge_id, code: peek.body.code },
  });
  if (verify.status !== 200) throw new Error(`sign-in failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  cache[phone] = { access_token: verify.body.access_token, refresh_token: verify.body.refresh_token };
  writeFileSync(TOKEN_CACHE, JSON.stringify(cache, null, 2));
  return verify.body.access_token;
}

function tomorrowAt(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const TERMINAL_BOOKING_STATUSES = new Set([
  'cancelled_by_sender', 'cancelled_by_traveller', 'cancelled_ineligible', 'cancelled_safety',
  'expired', 'refunded', 'paid_out',
]);

/** Posts a parcel, takes a quote, and returns the best match with its live remaining capacity. */
async function openParcel(token, stamp) {
  const parcel = await call('POST', '/parcels', {
    token,
    body: {
      origin_city_id: CITY.bareilly,
      dest_city_id: CITY.delhi,
      origin_area: 'Civil Lines',
      dest_area: 'Karol Bagh',
      category: 'documents',
      description: 'Box of stamped postcards for a wedding',
      weight_kg: 1.5,
      dims_cm: [30, 22, 2],
      declared_value_paise: 60000,
      window_start: tomorrowAt(9),
      window_end: tomorrowAt(18),
      receiver_name: 'R. Sharma',
      receiver_phone: '+919000000101',
      declaration_accepted: true,
    },
  });
  if (parcel.status !== 201) throw new Error(`parcel creation failed: ${parcel.status} ${JSON.stringify(parcel.body)}`);
  const quote = await call('POST', `/parcels/${parcel.body.id}/quote`, { token });
  if (quote.status !== 201) throw new Error(`quote failed: ${quote.status} ${JSON.stringify(quote.body)}`);
  const matches = await call('GET', `/parcels/${parcel.body.id}/matches`, { token });
  const best = matches.body?.matches?.[0];
  if (!best) throw new Error(`no matches for parcel ${stamp}: ${JSON.stringify(matches.body).slice(0, 200)}`);
  return { parcelId: parcel.body.id, quoteId: quote.body.id, tripId: best.trip_id };
}

/**
 * Remaining capacity on a trip. Only the traveller who owns it may read the trip row, and a parcel
 * stops producing matches the moment it is booked — so this is the only honest way to observe the
 * reservation from the outside.
 */
async function capacityRemaining(travellerToken, tripId) {
  const trip = await call('GET', `/trips/${tripId}`, { token: travellerToken });
  return Number(trip.body?.capacity_kg_remaining ?? NaN);
}

async function main() {
  console.log(`\nParcel Yatra concurrency test → ${BASE}\n`);
  const token = await signIn(PHONE_SENDER);

  // ---- 1. five simultaneous bookings for one parcel
  const travellerToken = await signIn(PHONE_TRAVELLER);
  const race = await openParcel(token, 'race');
  const capacityBefore = await capacityRemaining(travellerToken, race.tripId);

  const attempts = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      call('POST', '/bookings', {
        token,
        idempotencyKey: `concurrency-race-${Date.now()}-${i}`,
        body: { parcel_id: race.parcelId, trip_id: race.tripId, quote_id: race.quoteId },
      }),
    ),
  );

  const created = attempts.filter((a) => a.status === 201);
  const rejected = attempts.filter((a) => a.status !== 201);
  check('exactly one concurrent booking is created', created.length === 1,
    `${created.length} created: ${attempts.map((a) => `${a.status}/${a.body?.error?.code}`).join(', ')}`);
  check('every loser gets a clean 409 conflict', rejected.every((a) => a.status === 409),
    JSON.stringify(rejected.map((a) => a.status)));
  check('losers never return a booking body', rejected.every((a) => !a.body?.id),
    JSON.stringify(rejected.map((a) => a.body).slice(0, 2)));

  const listed = await call('GET', '/bookings?role=sender&limit=100', { token });
  const forParcel = (listed.body?.items ?? []).filter((b) => b.parcel_id === race.parcelId);
  const active = forParcel.filter((b) => !TERMINAL_BOOKING_STATUSES.has(b.status));
  check('the parcel has exactly one active booking row', active.length === 1,
    `${forParcel.length} rows, ${active.length} active`);
  check('the other four requests left no rows behind', forParcel.length === 1,
    `${forParcel.length} rows for the raced parcel`);

  const capacityAfter = await capacityRemaining(travellerToken, race.tripId);
  const reservedKg = 1.5 * 1.1;
  check('trip capacity is reserved exactly once',
    Number.isFinite(capacityBefore) && Number.isFinite(capacityAfter)
      && Math.abs(capacityBefore - capacityAfter - reservedKg) < 1e-6,
    Number.isNaN(capacityBefore) || Number.isNaN(capacityAfter)
      ? `capacity not readable for trip ${race.tripId} (${capacityBefore} → ${capacityAfter}) — the test traveller does not own the matched trip`
      : `${capacityBefore} → ${capacityAfter}, expected −${reservedKg}`);

  // ---- 2. the same idempotency key replayed concurrently
  const replay = await openParcel(token, 'replay');
  const key = `concurrency-replay-${Date.now()}`;
  const doubles = await Promise.all(
    Array.from({ length: 3 }, () =>
      call('POST', '/bookings', {
        token,
        idempotencyKey: key,
        body: { parcel_id: replay.parcelId, trip_id: replay.tripId, quote_id: replay.quoteId },
      }),
    ),
  );
  const ids = new Set(doubles.map((d) => d.body?.id));
  check('a concurrent idempotency replay returns one booking id', ids.size === 1, JSON.stringify([...ids]));
  check('a replay never creates a second row', doubles.every((d) => d.status === doubles[0].status),
    JSON.stringify(doubles.map((d) => d.status)));

  const replayRows = (await call('GET', '/bookings?role=sender&limit=100', { token })).body.items
    .filter((b) => b.parcel_id === replay.parcelId);
  check('the replayed parcel also has one booking', replayRows.length === 1, `${replayRows.length} rows`);

  // ---- 3. cancelling frees the parcel again (the "one active booking" index is partial)
  const cancel = await call('POST', `/bookings/${active[0].id}/transitions`, {
    token,
    idempotencyKey: `concurrency-cancel-${active[0].id}`,
    body: { command: 'cancel' },
  });
  check('sender can cancel a booking awaiting acceptance', cancel.status === 200,
    JSON.stringify(cancel.body).slice(0, 160));

  const afterCancel = await call('POST', '/bookings', {
    token,
    idempotencyKey: `concurrency-rebook-${Date.now()}`,
    body: { parcel_id: race.parcelId, trip_id: race.tripId, quote_id: race.quoteId },
  });
  check('a cancelled parcel can be booked again', afterCancel.status === 201,
    JSON.stringify(afterCancel.body).slice(0, 160));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\nConcurrency test could not complete: ${error?.message ?? error}\n`);
  process.exit(1);
});
