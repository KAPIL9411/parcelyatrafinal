/**
 * Payment after delivery — the flow the product actually uses.
 *
 * The sender is no longer asked for money when the traveller accepts. Acceptance confirms the
 * booking; the payment intent only becomes available once the parcel is `delivered`, and a capture is
 * a self-edge on `delivered`. Settlement then waits for both the problem window and the money.
 *
 * These assertions go through the real HTTP routes and the real database, including the signed
 * webhook path, so a regression in the state machine, the route gate or the journal is caught here
 * rather than in a manual demo.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';

process.env.PGLITE_PATH = './data/pgdata.payment-after-delivery';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { buildApp } = await import('../src/app.ts');
const { createSession } = await import('../src/lib/auth.ts');

const db = await getDb();
await runMigrations(db);
const app = await buildApp();
await app.ready();

test.after(async () => {
  await app.close();
  await closeDb();
});

interface Injected<T> {
  statusCode: number;
  body: T;
}

async function call<T = Record<string, unknown>>(
  method: 'GET' | 'POST',
  url: string,
  token: string | null = null,
  payload?: unknown,
): Promise<Injected<T>> {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Every state-changing route is idempotency-wrapped; a fresh key per call keeps this test
      // about the flow rather than about retries.
      ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { statusCode: res.statusCode, body: res.body ? (res.json() as T) : (undefined as T) };
}

async function user(tag: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO users (phone_hash, phone_last4, phone_masked, name)
     VALUES ($1,'0001','+91** ******0001',$2) RETURNING id`,
    [`payment-flow:${tag}:${crypto.randomUUID()}`, `Payment ${tag}`],
  );
  return res.rows[0]!.id;
}

async function city(name: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO cities (name, state, lat, lng, is_serviceable)
     VALUES ($1,'Test State',28.6,77.2,true) RETURNING id`,
    [`${name} ${crypto.randomUUID().slice(0, 6)}`],
  );
  return res.rows[0]!.id;
}

const senderId = await user('sender');
const travellerId = await user('traveller');
const sender = await createSession(db, senderId);
const traveller = await createSession(db, travellerId);
const originCity = await city('Origin');
const destCity = await city('Destination');

interface Fixture {
  bookingId: string;
  quoteTotalPaise: number;
  travellerSharePaise: number;
}

/** A booking parked in one exact state, so each test starts from the state it is about. */
async function bookingIn(status: string, opts: { disputeDeadline?: Date | null } = {}): Promise<Fixture> {
  const parcel = await db.query<{ id: string }>(
    `INSERT INTO parcels
       (sender_id, origin_city_id, dest_city_id, origin_area, dest_area, category, description,
        weight_kg, dims_cm, declared_value_paise, window_start, window_end,
        receiver_name, receiver_phone_hash, receiver_phone_last4, status)
     VALUES ($1,$2,$3,'Civil Lines','Sector 4','documents','Test documents',
             1.0, ARRAY[20,15,5], 50000, now() + interval '1 hour', now() + interval '5 hours',
             'Receiver','receiver-hash','0000','matched')
     RETURNING id`,
    [senderId, originCity, destCity],
  );
  const parcelId = parcel.rows[0]!.id;

  const trip = await db.query<{ id: string }>(
    `INSERT INTO trips
       (traveller_id, origin_city_id, dest_city_id, mode, departure_at, arrival_estimate_at,
        capacity_kg, capacity_kg_remaining, status, accepts_documents_only)
     VALUES ($1,$2,$3,'train', now() + interval '2 hours', now() + interval '6 hours',
             5, 5, 'published', true)
     RETURNING id`,
    [travellerId, originCity, destCity],
  );
  const tripId = trip.rows[0]!.id;

  const quoteTotalPaise = 10_000;
  const travellerSharePaise = 8_000;
  const quote = await db.query<{ id: string }>(
    `INSERT INTO quotes
       (parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
        total_paise, traveller_paise, breakdown, expires_at)
     VALUES ($1,'test-v1','{}'::jsonb, 9000, 500, 500, $2, $3, '{}'::jsonb, now() + interval '1 hour')
     RETURNING id`,
    [parcelId, quoteTotalPaise, travellerSharePaise],
  );

  const booking = await db.query<{ id: string }>(
    `INSERT INTO bookings
       (parcel_id, trip_id, sender_id, traveller_id, quote_id, status, accept_by,
        agreed_total_paise, traveller_share_paise, dispute_deadline)
     VALUES ($1,$2,$3,$4,$5,$6, now() + interval '30 minutes', $7, $8, $9)
     RETURNING id`,
    [
      parcelId,
      tripId,
      senderId,
      travellerId,
      quote.rows[0]!.id,
      status,
      quoteTotalPaise,
      travellerSharePaise,
      opts.disputeDeadline ?? null,
    ],
  );
  const bookingId = booking.rows[0]!.id;
  await db.query(`INSERT INTO payouts (booking_id, state, amount_paise) VALUES ($1,'not_eligible',$2)`, [
    bookingId,
    travellerSharePaise,
  ]);
  return { bookingId, quoteTotalPaise, travellerSharePaise };
}

async function ledger(bookingId: string): Promise<{ count: number; total: number }> {
  const res = await db.query<{ count: string; total: string }>(
    `SELECT COUNT(*)::text AS count, COALESCE(SUM(amount_paise),0)::text AS total
       FROM payment_ledger WHERE booking_id = $1 AND entry_type = 'capture'`,
    [bookingId],
  );
  return { count: Number(res.rows[0]!.count), total: Number(res.rows[0]!.total) };
}

test('accepting confirms the booking and no payment is asked for', async () => {
  const { bookingId } = await bookingIn('pending_traveller_acceptance');

  const accept = await call<{ status: string }>('POST', `/v1/bookings/${bookingId}/transitions`, traveller.accessToken, {
    command: 'accept',
  });
  assert.equal(accept.statusCode, 200);
  assert.equal(accept.body.status, 'confirmed');

  const early = await call<{ error: { code: string } }>(
    'POST',
    `/v1/bookings/${bookingId}/payment-intent`,
    sender.accessToken,
    {},
  );
  assert.equal(early.statusCode, 409);
  assert.equal(early.body.error.code, 'PAYMENT_NOT_PAYABLE');
});

test('a delivered booking can be paid, and two capture events journal once', async () => {
  const { bookingId, quoteTotalPaise } = await bookingIn('delivered', {
    disputeDeadline: new Date(Date.now() + 60 * 60 * 1000),
  });

  const intent = await call<{ provider_ref: string; amount_paise: number; sandbox: boolean }>(
    'POST',
    `/v1/bookings/${bookingId}/payment-intent`,
    sender.accessToken,
    {},
  );
  assert.equal(intent.statusCode, 201);
  assert.equal(intent.body.amount_paise, quoteTotalPaise);
  assert.equal(intent.body.sandbox, true);

  for (const _ of [1, 2]) {
    const capture = await call<{ webhook_status: number }>(
      'POST',
      '/v1/dev/webhooks/simulate',
      sender.accessToken,
      { type: 'payment.captured', provider_ref: intent.body.provider_ref },
    );
    assert.equal(capture.statusCode, 200);
    assert.equal(capture.body.webhook_status, 200);
  }

  // A second event id for the same provider reference must not add a second capture row.
  const journal = await ledger(bookingId);
  assert.equal(journal.count, 1);
  assert.equal(journal.total, quoteTotalPaise);

  const after = await call<{ status: string; payment: { state: string } }>(
    'GET',
    `/v1/bookings/${bookingId}`,
    sender.accessToken,
  );
  assert.equal(after.body.status, 'delivered');
  assert.equal(after.body.payment.state, 'captured');
});

test('settlement waits for the problem window and the money', async () => {
  const open = await bookingIn('delivered', { disputeDeadline: new Date(Date.now() + 60 * 60 * 1000) });
  const intent = await call<{ provider_ref: string }>(
    'POST',
    `/v1/bookings/${open.bookingId}/payment-intent`,
    sender.accessToken,
    {},
  );
  assert.equal(intent.statusCode, 201);
  await call('POST', '/v1/dev/webhooks/simulate', sender.accessToken, {
    type: 'payment.captured',
    provider_ref: intent.body.provider_ref,
  });

  // Money is in, but the sender can still raise a problem: the sweep must not settle.
  const early = await call<{ settled: number }>('POST', '/v1/dev/lifecycle/run', sender.accessToken, {});
  assert.equal(early.statusCode, 200);
  assert.equal(early.body.settled, 0);

  await db.query(`UPDATE bookings SET dispute_deadline = now() - interval '1 minute' WHERE id = $1`, [open.bookingId]);
  const sweep = await call<{ settled: number }>('POST', '/v1/dev/lifecycle/run', sender.accessToken, {});
  assert.equal(sweep.body.settled, 1);

  const settled = await call<{ status: string; payout_state: string }>(
    'GET',
    `/v1/bookings/${open.bookingId}`,
    sender.accessToken,
  );
  assert.equal(settled.body.status, 'payout_eligible');
  assert.equal(settled.body.payout_state, 'eligible');
});

test('an unpaid delivered booking is never settled', async () => {
  const unpaid = await bookingIn('delivered', { disputeDeadline: new Date(Date.now() - 60_000) });

  const sweep = await call<{ settled: number }>('POST', '/v1/dev/lifecycle/run', sender.accessToken, {});
  assert.equal(sweep.statusCode, 200);
  assert.equal(sweep.body.settled, 0);

  const view = await call<{ status: string }>('GET', `/v1/bookings/${unpaid.bookingId}`, sender.accessToken);
  assert.equal(view.body.status, 'delivered');
  assert.deepEqual(await ledger(unpaid.bookingId), { count: 0, total: 0 });
});
