/**
 * Direct UPI collection.
 *
 * There is no gateway and no webhook in this rail: the intent returns a UPI link, and money is only
 * recorded when a finance operator enters the bank reference (UTR) they can see on the statement.
 *
 * The tests that matter here are the ones about trust: a sender cannot confirm their own payment, the
 * same statement line cannot settle two bookings, and an unpayable booking cannot open an intent.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';

process.env.PAYMENT_PROVIDER = 'upi_direct';
process.env.PAYMENTS_LIVE = 'true';
process.env.UPI_VPA = 'parcelyatra@okhdfcbank';
process.env.UPI_PAYEE_NAME = 'Parcel Yatra';
process.env.PGLITE_PATH = './data/pgdata.upi-payment';
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
    [`upi-payment:${tag}:${crypto.randomUUID()}`, `Upi ${tag}`],
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
const financeId = await user('finance');
await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'finance'::role_name)`, [financeId]);

const sender = await createSession(db, senderId);
const finance = await createSession(db, financeId);
const originCity = await city('Origin');
const destCity = await city('Destination');

const QUOTE_TOTAL_PAISE = 10_000;

/** A booking parked in one exact state, so each test starts from the state it is about. */
async function bookingIn(status: string): Promise<string> {
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

  const quote = await db.query<{ id: string }>(
    `INSERT INTO quotes
       (parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
        total_paise, traveller_paise, breakdown, expires_at)
     VALUES ($1,'test-v1','{}'::jsonb, 9000, 500, 500, $2, 8000, '{}'::jsonb, now() + interval '1 hour')
     RETURNING id`,
    [parcelId, QUOTE_TOTAL_PAISE],
  );

  const booking = await db.query<{ id: string }>(
    `INSERT INTO bookings
       (parcel_id, trip_id, sender_id, traveller_id, quote_id, status, accept_by,
        agreed_total_paise, traveller_share_paise, dispute_deadline)
     VALUES ($1,$2,$3,$4,$5,$6, now() + interval '30 minutes', $7, 8000, now() + interval '72 hours')
     RETURNING id`,
    [parcelId, tripId, senderId, travellerId, quote.rows[0]!.id, status, QUOTE_TOTAL_PAISE],
  );
  return booking.rows[0]!.id;
}

interface IntentBody {
  id: string;
  provider: string;
  sandbox: boolean;
  amount_paise: number;
  client_secret: string | null;
  provider_ref: string;
  payment_link: string | null;
  payee: { vpa: string; name: string } | null;
}

async function intentFor(bookingId: string): Promise<IntentBody> {
  const res = await call<IntentBody>('POST', `/v1/bookings/${bookingId}/payment-intent`, sender.accessToken, {});
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body;
}

async function ledger(bookingId: string): Promise<{ count: number; total: number }> {
  const res = await db.query<{ count: string; total: string }>(
    `SELECT COUNT(*)::text AS count, COALESCE(SUM(amount_paise),0)::text AS total
       FROM payment_ledger WHERE booking_id = $1 AND entry_type = 'capture'`,
    [bookingId],
  );
  return { count: Number(res.rows[0]!.count), total: Number(res.rows[0]!.total) };
}

test('an intent carries the exact amount, a unique reference and a payable UPI link', async () => {
  const bookingId = await bookingIn('delivered');
  const intent = await intentFor(bookingId);

  assert.equal(intent.provider, 'upi_direct');
  assert.equal(intent.sandbox, false, 'a real UPI collection is never labelled sandbox');
  assert.equal(intent.amount_paise, QUOTE_TOTAL_PAISE);
  assert.equal(intent.client_secret, null);
  assert.match(intent.provider_ref, /^PY[A-Z0-9]{8}$/);
  assert.deepEqual(intent.payee, { vpa: 'parcelyatra@okhdfcbank', name: 'Parcel Yatra' });

  const link = new URL(intent.payment_link!);
  assert.equal(link.protocol, 'upi:');
  assert.equal(link.hostname, 'pay');
  assert.equal(link.searchParams.get('pa'), 'parcelyatra@okhdfcbank');
  assert.equal(link.searchParams.get('am'), '100.00', 'the amount is the stored quote, in exact rupees');
  assert.equal(link.searchParams.get('cu'), 'INR');
  assert.equal(link.searchParams.get('tr'), intent.provider_ref);
  assert.equal(link.searchParams.get('tn'), intent.provider_ref);
});

test('a sender cannot confirm their own receipt, and finance can only once', async () => {
  const bookingId = await bookingIn('delivered');
  await intentFor(bookingId);

  const self = await call('POST', `/v1/admin/bookings/${bookingId}/payment/receipt`, sender.accessToken, {
    utr: '412345678901',
  });
  assert.equal(self.statusCode, 403, 'no money is recorded on the payer’s word');
  assert.equal((await ledger(bookingId)).count, 0);

  const confirmed = await call<{ state: string; utr: string; booking_status: string }>(
    'POST',
    `/v1/admin/bookings/${bookingId}/payment/receipt`,
    finance.accessToken,
    { utr: '412345678901' },
  );
  assert.equal(confirmed.statusCode, 201, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.state, 'captured');
  assert.equal(confirmed.body.utr, '412345678901');
  assert.equal(confirmed.body.booking_status, 'delivered', 'the capture is a self-edge on delivered');

  const journal = await ledger(bookingId);
  assert.equal(journal.count, 1);
  assert.equal(journal.total, QUOTE_TOTAL_PAISE);

  const again = await call<{ error: { code: string } }>(
    'POST',
    `/v1/admin/bookings/${bookingId}/payment/receipt`,
    finance.accessToken,
    { utr: '412345678902' },
  );
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error.code, 'PAYMENT_ALREADY_EXISTS');
  assert.equal((await ledger(bookingId)).count, 1, 'a repeated confirmation never journals twice');
});

test('one bank reference cannot settle two bookings', async () => {
  const first = await bookingIn('delivered');
  const second = await bookingIn('delivered');
  await intentFor(first);
  await intentFor(second);

  const ok = await call('POST', `/v1/admin/bookings/${first}/payment/receipt`, finance.accessToken, {
    utr: 'UTRDUP123456',
  });
  assert.equal(ok.statusCode, 201);

  const reused = await call<{ error: { code: string; details?: { reason?: string } } }>(
    'POST',
    `/v1/admin/bookings/${second}/payment/receipt`,
    finance.accessToken,
    { utr: 'utrdup123456' },
  );
  assert.equal(reused.statusCode, 409);
  assert.equal(reused.body.error.code, 'CONFLICT');
  assert.equal(reused.body.error.details?.reason, 'utr_already_recorded');
  assert.equal((await ledger(second)).count, 0, 'the second booking stays unpaid');
});

test('a booking that is not payable cannot open an intent', async () => {
  const bookingId = await bookingIn('confirmed');
  const res = await call<{ error: { code: string } }>(
    'POST',
    `/v1/bookings/${bookingId}/payment-intent`,
    sender.accessToken,
    {},
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'PAYMENT_NOT_PAYABLE');
});

test('the receipts queue lists awaiting UPI payments to finance and nobody else', async () => {
  const bookingId = await bookingIn('delivered');
  const intent = await intentFor(bookingId);

  const mine = await call<{ items: Array<{ payment_id: string; reference: string; amount_paise: number }> }>(
    'GET',
    '/v1/admin/payments/upi-awaiting',
    finance.accessToken,
  );
  assert.equal(mine.statusCode, 200);
  const row = mine.body.items.find((item) => item.payment_id === intent.id);
  assert.ok(row, 'the awaiting payment is listed');
  assert.equal(row!.reference, intent.provider_ref);
  assert.equal(row!.amount_paise, QUOTE_TOTAL_PAISE);

  const denied = await call('GET', '/v1/admin/payments/upi-awaiting', sender.accessToken);
  assert.equal(denied.statusCode, 403);
});
