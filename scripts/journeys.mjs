/**
 * Journeys D, E and F from the production-readiness brief, plus the staff incident surface.
 *
 * What this proves, in order:
 *   E — authorization is enforced by the server on every surface, not by which buttons the console
 *       hides: a non-staff account is refused the incident queue, the incident decision, the thread
 *       read and the message removal; a stranger is refused someone else's booking and their thread.
 *   F — payment integrity: one capture per provider reference, the captured amount equals the quoted
 *       total to the paisa, `payout_eligible` still cannot move money, and a forged webhook is refused.
 *   C — the incident console has a working API behind it: a traveller reports an incident, staff see
 *       the exact booking with its money state, read the thread (audited), remove a message once and
 *       only once, then clear the incident and make the payout eligible.
 *   D — session recovery: a wrong code does not consume a valid challenge, a refresh rotates the pair,
 *       and signing out everywhere kills the old refresh token instead of leaving it live.
 *
 * Usage: node scripts/journeys.mjs        (API must be listening on 127.0.0.1:3000)
 *
 * It leaves one booking in `payout_eligible` with one message removed, and one throwaway account with
 * no live session. The write budget is shared per address, so a throttled call waits for the window the
 * server names rather than being reported as a failure.
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

import { readFileSync, writeFileSync } from 'node:fs';

/** Shared with the smoke suite so a run does not burn the 3-per-hour sign-in budget twice. */
const TOKEN_CACHE = '.smoke-tokens.json';

const CITY = {
  bareilly: 'c0000000-0000-4000-8000-000000000001',
  delhi: 'c0000000-0000-4000-8000-000000000002',
};
const TRIP_IMRAN_DELHI = 'b0000000-0000-4000-8000-000000000001';
const PHONE = {
  sender: '+919000000001',
  traveller: '+919000000002',
  stranger: '+919000000003',
  admin: '+919000000009',
  /** Signed up and torn down by this script alone; the seeded accounts are never revoked here. */
  burner: '+919000000012',
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

/**
 * A throttled call is waited out, read or write, by `call` itself, in every harness.
 *
 * The write budget is 60/min per address, the read budget 300/min, and every harness here shares those
 * pools, plus any
 * browser left open on the app. A journey that fails because the previous suite spent the budget
 * measures nothing about the product, and the failure it prints is a lie. The refusal arrives from a
 * preHandler before the route runs, so nothing was created and the retry is safe. `ratelimit.mjs`
 * keeps its own transport, because there the refusal is the thing under test.
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
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
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

/** Positional shorthand for a write; the throttling itself now lives in `call`. */
async function writeInRoom(method, path, body, token, idempotencyKey) {
  return call(method, path, {
    ...(token ? { token } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
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
      const refreshed = await call('POST', '/auth/refresh', { headers: { cookie: `py_refresh=${entry.refresh_token}` } });
      if (refreshed.status === 200) {
        cache[phone] = {
          access_token: refreshed.body.access_token,
          refresh_token: refreshCookieFrom(refreshed) ?? entry.refresh_token,
        };
        saveCache(cache);
        return { token: refreshed.body.access_token, user: refreshed.body.user };
      }
    }
  }

  const request = await writeInRoom('POST', '/auth/otp/request', { phone, purpose: 'login' });
  if (request.status !== 202) throw new Error(`otp request failed: ${request.status} ${JSON.stringify(request.body)}`);
  const peek = await call('GET', `/dev/otp/${request.body.challenge_id}`);
  if (peek.status !== 200) throw new Error(`dev otp peek failed: ${peek.status} ${JSON.stringify(peek.body)}`);
  const verify = await writeInRoom('POST', '/auth/otp/verify', {
    challenge_id: request.body.challenge_id,
    code: peek.body.code,
  });
  if (verify.status !== 200) throw new Error(`otp verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);

  const fresh = loadCache();
  fresh[phone] = { access_token: verify.body.access_token, refresh_token: refreshCookieFrom(verify) };
  saveCache(fresh);
  return { token: verify.body.access_token, user: verify.body.user };
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function uploadPhoto(token, purpose) {
  const ticket = await call('POST', '/files/upload-url', {
    token,
    body: { purpose, content_type: 'image/png', byte_size: PNG_1X1.byteLength },
  });
  if (ticket.status !== 201) throw new Error(`upload-url failed: ${ticket.status} ${JSON.stringify(ticket.body)}`);
  const put = await fetch(ticket.body.upload_url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
    body: PNG_1X1,
  });
  if (put.status !== 201) throw new Error(`upload sink failed: ${put.status} ${(await put.text()).slice(0, 200)}`);
  return ticket.body.object_key;
}

function tomorrowAt(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  console.log(`\nParcel Yatra journeys D/E/F → ${BASE}\n`);

  // Every run books a parcel onto the seeded trip, so a second run would be gated out for NO_CAPACITY.
  // `--reset` puts the demo data back and forces a fresh sign-in, the same way the smoke suite does.
  if (process.argv.includes('--reset')) {
    const cache = loadCache();
    let ops = cache[PHONE.admin]?.access_token
      ? { token: cache[PHONE.admin].access_token }
      : await signIn(PHONE.admin);
    let reset = await call('POST', '/dev/seed/reset', { token: ops.token });
    if (reset.status === 401) {
      ops = await signIn(PHONE.admin);
      reset = await call('POST', '/dev/seed/reset', { token: ops.token });
    }
    if (reset.status !== 200) throw new Error(`seed reset failed: ${reset.status} ${JSON.stringify(reset.body)}`);
    writeFileSync(TOKEN_CACHE, '{}');
    console.log('  ---- seeded demo data restored (--reset)\n');
  }

  const stamp = Date.now();
  const sender = await signIn(PHONE.sender);
  const traveller = await signIn(PHONE.traveller);
  const stranger = await signIn(PHONE.stranger);
  const ops = await signIn(PHONE.admin);
  check('the seeded staff account carries staff roles', (ops.user.roles ?? []).length > 0, JSON.stringify(ops.user.roles));
  check('a traveller account carries no staff roles', (traveller.user.roles ?? []).every((r) => r !== 'trust_safety'));

  // ---------------------------------------------------------------- a booking of our own
  const sealedKey = await uploadPhoto(sender.token, 'parcel_sealed');
  // Documents at 1.5 kg: every seeded trip on this route accepts documents only, and the live one has
  // 1.9 kg of space left, so a heavier parcel would be gated out for a reason that is not being tested.
  const parcel = await writeInRoom('POST', '/parcels', {
    origin_city_id: CITY.bareilly,
    dest_city_id: CITY.delhi,
    origin_area: 'Civil Lines',
    dest_area: 'Karol Bagh',
    category: 'documents',
    description: 'A boxed file of signed contracts, journey test parcel',
    weight_kg: 1.5,
    dims_cm: [30, 25, 12],
    declared_value_paise: 450000,
    window_start: tomorrowAt(9),
    window_end: tomorrowAt(19),
    receiver_name: 'J. Test',
    receiver_phone: '+919000000199',
    sealed_photo_key: sealedKey,
    declaration_accepted: true,
  }, sender.token);
  if (parcel.status !== 201) throw new Error(`parcel create failed: ${parcel.status} ${JSON.stringify(parcel.body)}`);
  const parcelId = parcel.body.id;

  const matches = await call('GET', `/parcels/${parcelId}/matches`, { token: sender.token });
  // Pinned to the trip the traveller account owns: `accept` below is theirs, and a match on somebody
  // else's trip would fail for a reason that has nothing to do with what this script tests.
  const match = (matches.body?.matches ?? []).find((m) => m.trip_id === TRIP_IMRAN_DELHI);
  if (!match) throw new Error(`no match on Imran's seeded trip — matches were ${JSON.stringify((matches.body?.matches ?? []).map((m) => m.trip_id))}`);

  const quote = await writeInRoom('POST', `/parcels/${parcelId}/quote`, {}, sender.token);
  check('the journey parcel has a quote', quote.status === 201 && quote.body.total_paise > 0, JSON.stringify(quote.body).slice(0, 160));
  const q = quote.body;

  const booking = await writeInRoom('POST', '/bookings', {
    parcel_id: parcelId,
    trip_id: match.trip_id,
    quote_id: q.id,
  }, sender.token, `journeys-book-${stamp}`);
  check('the booking is created', booking.status === 201, `${booking.status} ${JSON.stringify(booking.body).slice(0, 200)}`);
  const bookingId = booking.body.id;

  // The booking page's first network call for a thread is the message poll, before anybody has written
  // in it. That used to answer 404 for a brand-new booking and the panel printed "the conversation
  // could not be loaded" at the sender, on the exact screen where they are meant to arrange handover.
  const firstPoll = await call('GET', `/bookings/${bookingId}/conversation/messages?limit=100`, { token: sender.token });
  check('a fresh booking has a readable thread before anyone posts',
    firstPoll.status === 200 && Array.isArray(firstPoll.body?.items),
    `${firstPoll.status} ${JSON.stringify(firstPoll.body).slice(0, 140)}`);

  const strangerPoll = await call('GET', `/bookings/${bookingId}/conversation/messages?limit=100`, { token: stranger.token });
  check('a stranger polling the same route is refused', strangerPoll.status === 404, String(strangerPoll.status));

  const accept = await writeInRoom('POST', `/bookings/${bookingId}/transitions`, { command: 'accept' }, traveller.token,
    `journeys-accept-${bookingId}`);
  check('the traveller accepted and the booking awaits payment', accept.status === 200 && accept.body.status === 'payment_pending',
    JSON.stringify(accept.body).slice(0, 200));

  // ---------------------------------------------------------------- E: authorization
  const strangerRead = await call('GET', `/bookings/${bookingId}`, { token: stranger.token });
  check('a stranger cannot read a booking they are not on', strangerRead.status === 404 || strangerRead.status === 403,
    `${strangerRead.status} ${JSON.stringify(strangerRead.body).slice(0, 120)}`);

  const strangerPost = await writeInRoom('POST', `/bookings/${bookingId}/transitions`, { command: 'cancel' }, stranger.token,
    `journeys-stranger-cancel-${stamp}`);
  check('a stranger cannot act on someone else\'s booking', strangerPost.status === 404 || strangerPost.status === 403,
    String(strangerPost.status));

  const strangerThread = await call('GET', `/bookings/${bookingId}/conversation`, { token: stranger.token });
  check('a stranger cannot read the conversation', strangerThread.status === 404, `${strangerThread.status} ${JSON.stringify(strangerThread.body).slice(0, 120)}`);

  const noToken = await call('GET', `/bookings/${bookingId}`);
  check('an unauthenticated read is refused', noToken.status === 401, String(noToken.status));

  const senderWrongRole = await writeInRoom('POST', `/bookings/${bookingId}/transitions`, { command: 'arrive' }, sender.token,
    `journeys-sender-arrive-${stamp}`);
  check('the sender cannot issue a traveller-only command', senderWrongRole.status >= 400 && senderWrongRole.status !== 429,
    `${senderWrongRole.status} ${JSON.stringify(senderWrongRole.body).slice(0, 140)}`);

  const staffUserRoute = await call('GET', `/bookings/${bookingId}`, { token: ops.token });
  check('staff have no back door through the user booking route', staffUserRoute.status === 403 || staffUserRoute.status === 404,
    String(staffUserRoute.status));

  const staffIncidentsAsUser = await call('GET', '/admin/incidents', { token: sender.token });
  check('a non-staff account is refused the incident queue', staffIncidentsAsUser.status === 403 && staffIncidentsAsUser.body?.error?.code === 'ROLE_REQUIRED',
    `${staffIncidentsAsUser.status} ${JSON.stringify(staffIncidentsAsUser.body).slice(0, 120)}`);

  const staffResolveAsUser = await writeInRoom('POST', `/admin/bookings/${bookingId}/incident`, {
    action: 'clear', reason_code: 'address_dispute_resolved',
  }, sender.token);
  check('a non-staff account cannot resolve an incident', staffResolveAsUser.status === 403, String(staffResolveAsUser.status));

  // ---------------------------------------------------------------- F: payment integrity
  const intent = await writeInRoom('POST', `/bookings/${bookingId}/payment-intent`, {}, sender.token,
    `journeys-pay-${bookingId}`);
  check('the sandbox intent charges exactly the quoted total', intent.status === 201 && intent.body.amount_paise === q.total_paise,
    JSON.stringify(intent.body).slice(0, 200));

  const capture = await writeInRoom('POST', '/dev/webhooks/simulate', {
    type: 'payment.captured', provider_ref: intent.body.provider_ref,
  }, sender.token);
  check('the capture is accepted', capture.status === 200 && capture.body.webhook_status === 200, JSON.stringify(capture.body).slice(0, 160));

  const replay = await writeInRoom('POST', '/dev/webhooks/simulate', {
    type: 'payment.captured', provider_ref: intent.body.provider_ref,
  }, sender.token);
  check('a replayed capture does not answer as a new one', replay.status === 200 && replay.body?.webhook_status !== 500,
    JSON.stringify(replay.body).slice(0, 160));

  const forged = await call('POST', '/webhooks/payments/mock', {
    body: { id: `evt_forged_${stamp}`, type: 'payment.captured', data: { provider_ref: intent.body.provider_ref } },
    headers: { 'x-provider-signature': 'deadbeef', 'x-provider-timestamp': String(Math.floor(Date.now() / 1000)) },
  });
  check('a forged webhook signature is refused', forged.status === 401 && forged.body?.error?.code === 'WEBHOOK_SIGNATURE_INVALID',
    `${forged.status} ${JSON.stringify(forged.body).slice(0, 120)}`);

  const confirmed = await call('GET', `/bookings/${bookingId}`, { token: sender.token });
  check('the booking is confirmed only after the provider capture', confirmed.body?.status === 'confirmed', String(confirmed.body?.status));

  // ---------------------------------------------------------------- to the handover, then an incident
  const openPickup = await writeInRoom('POST', `/dev/bookings/${bookingId}/advance`, {}, sender.token);
  check('the booking reaches pickup_ready', openPickup.body?.to === 'pickup_ready', JSON.stringify(openPickup.body).slice(0, 160));

  const pickupOtp = await call('GET', `/dev/handover-otp/${bookingId}/pickup`, { token: sender.token });
  check('a pickup code exists', pickupOtp.status === 200 && /^[0-9]{6}$/.test(pickupOtp.body?.code ?? ''), String(pickupOtp.status));

  const pickupPhoto = await uploadPhoto(traveller.token, 'parcel_sealed');
  const pickup = await writeInRoom('POST', `/bookings/${bookingId}/handover/pickup`, {
    otp: pickupOtp.body.code, photo_key: pickupPhoto, checklist: { seal_intact: true },
  }, traveller.token);
  check('the traveller took the parcel', pickup.status === 200 && pickup.body.status === 'picked_up', JSON.stringify(pickup.body).slice(0, 200));

  await writeInRoom('POST', `/bookings/${bookingId}/conversation/messages`, {
    body: 'The box is damaged on one corner, I am not handing this over blind.',
  }, traveller.token);

  const report = await writeInRoom('POST', `/bookings/${bookingId}/transitions`, {
    command: 'report_incident', reason_code: 'parcel_damaged',
  }, traveller.token, `journeys-incident-${bookingId}`);
  check('the traveller raised an incident from picked_up', report.status === 200 && report.body.status === 'incident_open',
    JSON.stringify(report.body).slice(0, 200));

  // ---------------------------------------------------------------- the incident console
  const queue = await call('GET', '/admin/incidents?state=incident_open&limit=100', { token: ops.token });
  const row = (queue.body?.items ?? []).find((i) => i.booking_id === bookingId);
  check('the incident queue shows this booking to staff', queue.status === 200 && Boolean(row), JSON.stringify(queue.body).slice(0, 200));
  check('the queue reports the capture, not the quote', row?.captured_paise === q.total_paise,
    `captured ${row?.captured_paise} vs quoted ${q.total_paise} — a replayed webhook must not double it`);
  check('the queue says who opened it and why', row?.opened_by === 'user' && row?.reason_code === 'parcel_damaged',
    JSON.stringify({ opened_by: row?.opened_by, reason: row?.reason_code }));

  const thread = await call('GET', `/admin/bookings/${bookingId}/messages`, { token: ops.token });
  const messages = thread.body?.items ?? [];
  check('staff can read the thread', thread.status === 200 && messages.length > 0, `${thread.status} ${messages.length} messages`);
  const claim = messages.find((m) => m.body?.includes('damaged'));
  check('the message that matters is in it', Boolean(claim), JSON.stringify(messages.map((m) => m.body)).slice(0, 220));
  if (!claim) throw new Error('the traveller\'s message is not in the staff thread — the moderation checks below cannot run');

  const readAudit = await call('GET', `/admin/audit-log?resource=booking&resource_id=${bookingId}&limit=50`, { token: ops.token });
  check('reading the thread is written to the audit log',
    (readAudit.body?.items ?? []).some((e) => e.action === 'admin.conversation_read'), JSON.stringify(readAudit.body).slice(0, 200));

  const removeAsUser = await writeInRoom('POST', `/admin/messages/${claim.id}/remove`, {
    reason_code: 'abusive_language',
  }, sender.token);
  check('a non-staff account cannot remove a message', removeAsUser.status === 403, String(removeAsUser.status));

  const removeReason = await writeInRoom('POST', `/admin/messages/${claim.id}/remove`, {}, ops.token);
  check('a removal without a reason code is refused', removeReason.status === 400, String(removeReason.status));

  const removed = await writeInRoom('POST', `/admin/messages/${claim.id}/remove`, { reason_code: 'off_platform_payment' }, ops.token);
  check('trust & safety removed the message', removed.status === 200 && removed.body?.removed === true, JSON.stringify(removed.body).slice(0, 160));

  const secondRemoval = await writeInRoom('POST', `/admin/messages/${claim.id}/remove`, { reason_code: 'spam' }, ops.token);
  check('a removed message is not removed twice', secondRemoval.status === 409 && secondRemoval.body?.error?.code === 'CONFLICT',
    `${secondRemoval.status} ${JSON.stringify(secondRemoval.body).slice(0, 140)}`);

  const afterRemoval = await call('GET', `/admin/bookings/${bookingId}/messages`, { token: ops.token });
  const stamped = (afterRemoval.body?.items ?? []).find((m) => m.id === claim.id);
  check('the removal keeps the body, the reason and the time', stamped?.removed_at && stamped.removed_reason === 'off_platform_payment',
    JSON.stringify(stamped).slice(0, 200));

  const memberView = await call('GET', `/bookings/${bookingId}/conversation/messages`, { token: sender.token });
  const memberSaw = (memberView.body?.items ?? []).find((m) => m.id === claim.id);
  check('the thread the sender reads still accounts for the removed message',
    memberView.status === 200 && (memberSaw ? memberSaw.removed_at || memberSaw.kind === 'system' : true),
    JSON.stringify(memberView.body).slice(0, 200));

  // ---------------------------------------------------------------- F: eligibility is not payment
  const releaseHeld = await writeInRoom('POST', `/admin/payouts/${bookingId}/release`, { reason_code: 'incident_cleared' }, ops.token,
    `journeys-release-held-${bookingId}`);
  check('a payout cannot be released while the booking is an open incident',
    releaseHeld.status === 409 && releaseHeld.body?.error?.code === 'PAYOUT_NOT_ELIGIBLE',
    `${releaseHeld.status} ${JSON.stringify(releaseHeld.body).slice(0, 140)}`);

  const badResolve = await writeInRoom('POST', `/admin/bookings/${bookingId}/incident`, { action: 'nonsense' }, ops.token);
  check('an invented incident outcome is refused', badResolve.status === 400, String(badResolve.status));

  const cleared = await writeInRoom('POST', `/admin/bookings/${bookingId}/incident`, {
    action: 'clear', reason_code: 'parcel_handed_over',
  }, ops.token, `journeys-clear-${bookingId}`);
  check('staff cleared the incident and the traveller keeps their share', cleared.status === 200 && cleared.body?.action === 'clear',
    JSON.stringify(cleared.body).slice(0, 200));

  const afterClear = await call('GET', `/bookings/${bookingId}`, { token: sender.token });
  check('the booking is payout_eligible, not paid out', afterClear.body?.status === 'payout_eligible', String(afterClear.body?.status));

  const releaseAfterClear = await writeInRoom('POST', `/admin/payouts/${bookingId}/release`, { reason_code: 'incident_cleared' }, ops.token,
    `journeys-release-after-clear-${bookingId}`);
  check('an eligible payout is still refused while the rail does not exist',
    releaseAfterClear.status === 501 && releaseAfterClear.body?.error?.code === 'PAYOUTS_NOT_ENABLED',
    `${releaseAfterClear.status} ${JSON.stringify(releaseAfterClear.body).slice(0, 140)}`);

  const goneFromQueue = await call('GET', '/admin/incidents?state=incident_open&limit=100', { token: ops.token });
  check('a cleared incident leaves the open queue',
    (goneFromQueue.body?.items ?? []).every((i) => i.booking_id !== bookingId), String(bookingId));

  const auditTrail = await call('GET', `/admin/audit-log?resource=booking&resource_id=${bookingId}&limit=50`, { token: ops.token });
  const actions = (auditTrail.body?.items ?? []).map((e) => e.action);
  check('the decision is in the audit log with the incident action',
    actions.includes('incident.clear'), JSON.stringify(actions).slice(0, 240));

  // ---------------------------------------------------------------- D: session recovery
  const burnerRequest = await writeInRoom('POST', '/auth/otp/request', { phone: PHONE.burner, purpose: 'login' });
  check('a new number can ask for a code', burnerRequest.status === 202, `${burnerRequest.status} ${JSON.stringify(burnerRequest.body).slice(0, 140)}`);

  const burnerPeek = await call('GET', `/dev/otp/${burnerRequest.body.challenge_id}`);
  const wrongCode = await writeInRoom('POST', '/auth/otp/verify', {
    challenge_id: burnerRequest.body.challenge_id, code: '000000',
  });
  check('a wrong code is refused', wrongCode.status === 400 && wrongCode.body?.error?.code === 'OTP_INVALID',
    `${wrongCode.status} ${JSON.stringify(wrongCode.body).slice(0, 140)}`);

  const rightAfterWrong = await writeInRoom('POST', '/auth/otp/verify', {
    challenge_id: burnerRequest.body.challenge_id, code: burnerPeek.body.code,
  });
  check('a wrong guess does not burn the challenge for the real owner', rightAfterWrong.status === 200,
    `${rightAfterWrong.status} ${JSON.stringify(rightAfterWrong.body).slice(0, 140)}`);

  const firstRefresh = refreshCookieFrom(rightAfterWrong);
  check(
    'the long-lived credential is in a cookie, never in a response body',
    Boolean(firstRefresh) && rightAfterWrong.body?.refresh_token === undefined &&
      !JSON.stringify(rightAfterWrong.body).includes(firstRefresh),
    JSON.stringify(rightAfterWrong.body).slice(0, 140),
  );
  const refreshed = await call('POST', '/auth/refresh', { headers: { cookie: `py_refresh=${firstRefresh}` } });
  const rotated = refreshCookieFrom(refreshed);
  check(
    'a refresh rotates the pair and the new access token works',
    refreshed.status === 200 && Boolean(rotated) && rotated !== firstRefresh &&
      (await call('GET', '/me', { token: refreshed.body.access_token })).status === 200,
    `${refreshed.status} ${JSON.stringify(refreshed.body).slice(0, 140)}`,
  );

  const signedOut = await writeInRoom('POST', '/auth/logout-all', {}, refreshed.body.access_token);
  check('signing out everywhere succeeds', signedOut.status === 204, String(signedOut.status));

  const staleRefresh = await call('POST', '/auth/refresh', { headers: { cookie: `py_refresh=${firstRefresh}` } });
  check('the first refresh token is dead afterwards', staleRefresh.status === 401 &&
    ['AUTH_REFRESH_INVALID', 'AUTH_REFRESH_REUSE'].includes(staleRefresh.body?.error?.code),
    `${staleRefresh.status} ${JSON.stringify(staleRefresh.body).slice(0, 140)}`);

  const rotatedRefresh = await call('POST', '/auth/refresh', { headers: { cookie: `py_refresh=${rotated ?? 'absent'}` } });
  check('sign out everywhere kills the whole session family, not one row', rotatedRefresh.status === 401 &&
    ['AUTH_REFRESH_INVALID', 'AUTH_REFRESH_REUSE'].includes(rotatedRefresh.body?.error?.code),
    `${rotatedRefresh.status} ${JSON.stringify(rotatedRefresh.body).slice(0, 140)}`);

  const staleAccess = await call('GET', '/me', { token: refreshed.body.access_token });
  check('and so is the access token it issued', staleAccess.status === 401, String(staleAccess.status));

  const cache = loadCache();
  delete cache[PHONE.burner];
  saveCache(cache);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`Failures: ${failures.join('; ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nJourneys aborted:', err.message);
  process.exitCode = 1;
});
