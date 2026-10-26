/**
 * End-to-end smoke test against a running API.
 *
 * Proves the pilot happy path with real HTTP calls: sign in with an OTP, post a parcel, get a
 * quote, match a traveller, book, accept, pay in sandbox, pick up, travel, deliver, review.
 *
 * Usage: node scripts/smoke.mjs [--reset]   (API must be listening on 127.0.0.1:3000)
 *
 * `--reset` restores the seeded demo data first. Run it on a database that a previous smoke run
 * has already advanced.
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Tokens are cached between runs. Sign-in is rate limited per phone number (3 per hour, the
 * documented pilot limit), so a smoke test that re-authenticated on every run would lock itself
 * out. A cached token is used while it is valid, then refreshed, then re-issued.
 */
const TOKEN_CACHE = '.smoke-tokens.json';

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

const CITY = {
  bareilly: 'c0000000-0000-4000-8000-000000000001',
  delhi: 'c0000000-0000-4000-8000-000000000002',
};
const TRIP_IMRAN_DELHI = 'b0000000-0000-4000-8000-000000000001';
const PHONE = {
  sender: '+919000000001',
  traveller: '+919000000002',
  admin: '+919000000009',
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

async function call(method, path, { token, body, idempotencyKey, headers = {} } = {}) {
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
  return { status: res.status, body: json };
}

async function signIn(phone) {
  const cache = loadCache();
  const entry = cache[phone];

  if (entry?.access_token) {
    const me = await call('GET', '/me', { token: entry.access_token });
    if (me.status === 200) return { token: entry.access_token, user: me.body };

    if (entry.refresh_token) {
      const refreshed = await call('POST', '/auth/refresh', { body: { refresh_token: entry.refresh_token } });
      if (refreshed.status === 200) {
        cache[phone] = {
          access_token: refreshed.body.access_token,
          refresh_token: refreshed.body.refresh_token,
        };
        saveCache(cache);
        return { token: refreshed.body.access_token, user: refreshed.body.user };
      }
    }
  }

  const request = await call('POST', '/auth/otp/request', { body: { phone, purpose: 'login' } });
  if (request.status !== 202) throw new Error(`otp request failed: ${request.status} ${JSON.stringify(request.body)}`);
  const peek = await call('GET', `/dev/otp/${request.body.challenge_id}`);
  if (peek.status !== 200) throw new Error(`dev otp peek failed: ${peek.status} ${JSON.stringify(peek.body)}`);
  const verify = await call('POST', '/auth/otp/verify', {
    body: { challenge_id: request.body.challenge_id, code: peek.body.code },
  });
  if (verify.status !== 200) throw new Error(`otp verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);

  cache[phone] = { access_token: verify.body.access_token, refresh_token: verify.body.refresh_token };
  saveCache(cache);
  return { token: verify.body.access_token, user: verify.body.user };
}


/**
 * Uploads a real 1×1 PNG through the documented two-step path and returns the object key. The API
 * now refuses a photo key that the account did not upload, so the smoke test cannot use a made-up
 * string any more than a client could.
 */
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
  console.log(`\nParcel Yatra smoke test → ${BASE}\n`);

  // This test drives the seeded demo booking all the way to a dispute, so a second run would
  // otherwise start from the state the first run left behind. `--reset` restores the seed first.
  if (process.argv.includes('--reset')) {
    const ops = await signIn(PHONE.admin);
    const reset = await call('POST', '/dev/seed/reset', { token: ops.token });
    if (reset.status !== 200) throw new Error(`seed reset failed: ${reset.status} ${JSON.stringify(reset.body)}`);
    writeFileSync(TOKEN_CACHE, '{}');
    console.log('  ---- seeded demo data restored (--reset)\n');
  }

  // ---- health
  const health = await call('GET', '/health');
  check('health returns 200', health.status === 200, `status ${health.status}`);
  check('health reports database ok', health.body?.checks?.find((c) => c.name === 'database')?.status === 'ok');

  const cities = await call('GET', '/cities');
  check('catalogue lists cities', cities.status === 200 && cities.body.items.length >= 5);

  const config = await call('GET', '/config');
  check('config says payments are sandbox', config.body?.payments?.sandbox === true && config.body?.payments?.live === false);

  // ---- sign in
  const sender = await signIn(PHONE.sender);
  check('sender signed in', Boolean(sender.token));
  check('profile exposes only the last four digits', /^[0-9]{4}$/.test(sender.user.phone_last4 ?? ''));

  const me = await call('GET', '/me', { token: sender.token });
  check('GET /me works', me.status === 200 && me.body.id === sender.user.id);
  check('GET /me leaks no phone number', !JSON.stringify(me.body).includes(PHONE.sender.slice(-10, -4)));

  // ---- uploads (real bytes, real keys)
  const sealedKey = await uploadPhoto(sender.token, 'parcel_sealed');
  check('an authenticated upload returns an owned object key', sealedKey.startsWith('parcel_sealed/'), sealedKey);

  // ---- parcel
  const parcel = await call('POST', '/parcels', {
    token: sender.token,
    body: {
      origin_city_id: CITY.bareilly,
      dest_city_id: CITY.delhi,
      origin_area: 'Civil Lines',
      dest_area: 'Karol Bagh',
      category: 'documents',
      description: 'A4 envelope with a signed lease agreement',
      weight_kg: 1.5,
      dims_cm: [30, 22, 2],
      declared_value_paise: 250000,
      window_start: tomorrowAt(9),
      window_end: tomorrowAt(18),
      receiver_name: 'R. Sharma',
      receiver_phone: '+919000000101',
      sealed_photo_key: sealedKey,
      declaration_accepted: true,
    },
  });
  check('POST /parcels creates a posted parcel', parcel.status === 201 && parcel.body.status === 'posted', `${parcel.status} ${JSON.stringify(parcel.body).slice(0, 200)}`);

  const prohibited = await call('POST', '/parcels', {
    token: sender.token,
    body: {
      origin_city_id: CITY.bareilly,
      dest_city_id: CITY.delhi,
      origin_area: 'Civil Lines',
      dest_area: 'Karol Bagh',
      category: 'documents',
      description: 'Envelope with 50000 cash inside',
      weight_kg: 0.5,
      dims_cm: [20, 15, 2],
      declared_value_paise: 500000,
      window_start: tomorrowAt(9),
      window_end: tomorrowAt(18),
      receiver_name: 'R. Sharma',
      receiver_phone: '+919000000101',
      sealed_photo_key: sealedKey,
      declaration_accepted: true,
    },
  });
  check('prohibited content is refused with ITEM_PROHIBITED', prohibited.status === 422 && prohibited.body?.error?.code === 'ITEM_PROHIBITED', JSON.stringify(prohibited.body).slice(0, 200));

  // ---- matches and quote
  const matches = await call('GET', `/parcels/${parcel.body.id}/matches`, { token: sender.token });
  check('matches return at least one trip', matches.status === 200 && matches.body.matches.length > 0, JSON.stringify(matches.body).slice(0, 300));
  const bestMatch = matches.body.matches?.[0];
  check('match explains itself with reason codes', Array.isArray(bestMatch?.reasons) && bestMatch.reasons.length > 0);

  const quote = await call('POST', `/parcels/${parcel.body.id}/quote`, { token: sender.token });
  check('quote is created', quote.status === 201, `${quote.status} ${JSON.stringify(quote.body).slice(0, 200)}`);
  const q = quote.body;
  check(
    'quote arithmetic is exact',
    q.subtotal_paise + q.platform_fee_paise + q.tax_paise === q.total_paise,
    `${q.subtotal_paise}+${q.platform_fee_paise}+${q.tax_paise} != ${q.total_paise}`,
  );
  check(
    'quote breakdown sums to the total',
    q.breakdown.reduce((a, l) => a + l.amount_paise, 0) === q.total_paise,
  );

  // ---- booking
  const booking = await call('POST', '/bookings', {
    token: sender.token,
    idempotencyKey: `smoke-book-${Date.now()}`,
    body: { parcel_id: parcel.body.id, trip_id: bestMatch.trip_id, quote_id: q.id },
  });
  check('booking is created and submitted', booking.status === 201 && booking.body.status === 'pending_traveller_acceptance', `${booking.status} ${JSON.stringify(booking.body).slice(0, 300)}`);
  const bookingId = booking.body.id;
  check('booking exposes allowed_commands', Array.isArray(booking.body.allowed_commands));

  // ---- traveller accepts
  const traveller = await signIn(PHONE.traveller);
  const accept = await call('POST', `/bookings/${bookingId}/transitions`, {
    token: traveller.token,
    idempotencyKey: `smoke-accept-${bookingId}`,
    body: { command: 'accept' },
  });
  check('traveller accepts', accept.status === 200 && accept.body.status === 'payment_pending', JSON.stringify(accept.body).slice(0, 300));

  // ---- sandbox payment
  const intent = await call('POST', `/bookings/${bookingId}/payment-intent`, {
    token: sender.token,
    idempotencyKey: `smoke-pay-${bookingId}`,
  });
  check('payment intent is created in sandbox', intent.status === 201 && intent.body.sandbox === true && intent.body.amount_paise === q.total_paise, JSON.stringify(intent.body).slice(0, 300));

  const webhook = await call('POST', '/dev/webhooks/simulate', {
    token: sender.token,
    body: { type: 'payment.captured', provider_ref: intent.body.provider_ref },
  });
  check('signed webhook is accepted', webhook.status === 200 && webhook.body.webhook_status === 200, JSON.stringify(webhook.body).slice(0, 300));

  const afterPay = await call('GET', `/bookings/${bookingId}`, { token: sender.token });
  check('payment moves the booking to confirmed', afterPay.body.status === 'confirmed', afterPay.body.status);

  const badSignature = await call('POST', '/webhooks/payments/mock', {
    body: { id: 'evt_forged', type: 'payment.captured', data: { provider_ref: intent.body.provider_ref } },
    headers: { 'x-provider-signature': 'deadbeef', 'x-provider-timestamp': String(Math.floor(Date.now() / 1000)) },
  });
  check('forged webhook is rejected', badSignature.status === 401 && badSignature.body?.error?.code === 'WEBHOOK_SIGNATURE_INVALID');

  // ---- pickup
  const openPickup = await call('POST', `/dev/bookings/${bookingId}/advance`, { token: sender.token });
  check('booking reaches pickup_ready', openPickup.body.to === 'pickup_ready', JSON.stringify(openPickup.body));

  const pickupOtp = await call('GET', `/dev/handover-otp/${bookingId}/pickup`, { token: sender.token });
  check('pickup OTP exists in the dev store', pickupOtp.status === 200 && /^[0-9]{6}$/.test(pickupOtp.body.code));

  const travellerPickupKey = await uploadPhoto(traveller.token, 'parcel_sealed');
  const wrongOtp = await call('POST', `/bookings/${bookingId}/handover/pickup`, {
    token: traveller.token,
    body: { otp: '000000', photo_key: travellerPickupKey },
  });
  check('wrong pickup OTP is refused', wrongOtp.status === 400 && wrongOtp.body?.error?.code === 'OTP_INVALID', JSON.stringify(wrongOtp.body).slice(0, 200));

  const pickup = await call('POST', `/bookings/${bookingId}/handover/pickup`, {
    token: traveller.token,
    body: { otp: pickupOtp.body.code, photo_key: travellerPickupKey, checklist: { seal_intact: true } },
  });
  check('pickup with the right OTP succeeds', pickup.status === 200 && pickup.body.status === 'picked_up', JSON.stringify(pickup.body).slice(0, 300));

  // ---- transit and delivery
  for (const [command, expected] of [
    ['start_transit', 'in_transit'],
    ['arrive', 'arrived'],
  ]) {
    const step = await call('POST', `/bookings/${bookingId}/transitions`, {
      token: traveller.token,
      idempotencyKey: `smoke-${command}-${bookingId}`,
      body: { command },
    });
    check(`${command} moves the booking to ${expected}`, step.status === 200 && step.body.status === expected, JSON.stringify(step.body).slice(0, 200));
  }

  const deliveryKey = await uploadPhoto(traveller.token, 'parcel_delivery');
  const deliveryOtp = await call('GET', `/dev/handover-otp/${bookingId}/delivery`, { token: sender.token });
  const delivery = await call('POST', `/bookings/${bookingId}/handover/delivery`, {
    token: traveller.token,
    body: { otp: deliveryOtp.body.code, photo_key: deliveryKey, receiver_name_confirmed: true },
  });
  check('delivery succeeds', delivery.status === 200 && delivery.body.status === 'delivered', JSON.stringify(delivery.body).slice(0, 300));
  check('delivery opens the dispute window', Boolean(delivery.body.dispute_deadline));

  // ---- settlement and payout
  const settle = await call('POST', `/dev/bookings/${bookingId}/advance`, { token: sender.token });
  check('booking settles to payout_eligible', settle.body.to === 'payout_eligible', JSON.stringify(settle.body));

  const admin = await signIn(PHONE.admin);
  const release = await call('POST', `/admin/payouts/${bookingId}/release`, {
    token: admin.token,
    idempotencyKey: `smoke-release-${bookingId}`,
    body: { reason_code: 'smoke_test' },
  });
  check(
    'payout release is refused while payouts are disabled',
    release.status === 501 && release.body?.error?.code === 'PAYOUTS_NOT_ENABLED',
    `${release.status} ${JSON.stringify(release.body).slice(0, 200)}`,
  );

  // ---- review, while the booking is still settled and undisputed
  const review = await call('POST', `/bookings/${bookingId}/review`, {
    token: sender.token,
    body: { stars: 5, tags: ['on_time', 'careful_handling'] },
  });
  check('review is recorded', review.status === 201 && review.body.stars === 5, JSON.stringify(review.body).slice(0, 200));

  // ---- dispute, on the seeded demo booking, driven to delivery with the dev advance helper
  const DEMO_BOOKING = '90000000-0000-4000-8000-000000000001';
  let demoStatus = '';
  for (let i = 0; i < 10; i += 1) {
    const step = await call('POST', `/dev/bookings/${DEMO_BOOKING}/advance`, { token: sender.token });
    if (step.status !== 200) {
      check('seeded demo booking advances', false, JSON.stringify(step.body).slice(0, 200));
      break;
    }
    demoStatus = step.body.to;
    if (demoStatus === 'delivered') break;
  }
  check('seeded demo booking reaches delivered', demoStatus === 'delivered', demoStatus);

  const dispute = await call('POST', '/disputes', {
    token: sender.token,
    idempotencyKey: `smoke-dispute-${bookingId}`,
    body: { booking_id: DEMO_BOOKING, category: 'damaged', description: 'Corner of the envelope was torn on arrival.' },
  });
  check('dispute opens', dispute.status === 201 && dispute.body.state === 'open', JSON.stringify(dispute.body).slice(0, 200));

  const disputedBooking = await call('GET', `/bookings/${DEMO_BOOKING}`, { token: sender.token });
  check('dispute moves the booking to disputed', disputedBooking.body.status === 'disputed', disputedBooking.body.status);
  check('dispute freezes the payout', disputedBooking.body.payout_state === 'frozen', disputedBooking.body.payout_state);

  // ---- authorisation boundaries
  const stranger = await call('GET', `/bookings/${bookingId}`, { token: (await signIn('+919000000009')).token });
  check('staff cannot read a booking through the user route', stranger.status === 404, `status ${stranger.status}`);

  const noAuth = await call('GET', '/me');
  check('unauthenticated request is refused', noAuth.status === 401 && noAuth.body?.error?.code === 'AUTH_REQUIRED');

  // ---- admin
  const queue = await call('GET', '/admin/verifications', { token: admin.token });
  check('admin reads the verification queue', queue.status === 200 && Array.isArray(queue.body.items));

  const adminBookings = await call('GET', '/admin/bookings?limit=5', { token: admin.token });
  check('admin searches bookings', adminBookings.status === 200 && adminBookings.body.items.length > 0);

  const audit = await call('GET', '/admin/audit-log?limit=5', { token: admin.token });
  check('admin reads the audit log', audit.status === 200 && audit.body.items.length > 0);

  const senderAdmin = await call('GET', '/admin/audit-log', { token: sender.token });
  check('a non-staff user is refused the audit log', senderAdmin.status === 403 && senderAdmin.body?.error?.code === 'ROLE_REQUIRED');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`Failures: ${failures.join('; ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nSmoke test aborted:', err.message);
  process.exitCode = 1;
});
