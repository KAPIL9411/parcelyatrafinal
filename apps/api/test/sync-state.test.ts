/**
 * The synchronisation feed.
 *
 * These tests pin the contract the clients depend on: the response is scoped to the caller, a
 * revision changes when (and only when) something the caller can see changes, staff queues are
 * absent for non-staff, and the endpoint refuses an unauthenticated call. They do not test
 * transport — the clients poll this endpoint, so the server contract is the whole surface.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.PGLITE_PATH = './data/pgdata.sync-state';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';

// Every run starts from an empty database: the assertions compare revisions across writes, and a
// leftover row from a previous run would make the first snapshot non-empty for the wrong reason.
rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

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

interface SyncBody {
  generated_at: string;
  revision: string;
  scopes: Record<string, string>;
  counts: { notifications_unread: number; messages_unread: number };
  admin?: { pending_verifications: number; open_disputes: number; pending_payouts: number };
}

let seeded = 0;
async function newUser(roles: string[] = ['sender']): Promise<{ id: string; token: string }> {
  seeded += 1;
  const id = crypto.randomUUID();
  await app.db.query(
    `INSERT INTO users (id, phone_hash, phone_last4, phone_masked, phone_verified_at, status)
     VALUES ($1, $2, '0000', '+91******0000', now(), 'active')`,
    [id, `sync-state-${seeded}-${id}`],
  );
  for (const role of roles) {
    await app.db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
  }
  const session = await createSession(app.db, id);
  return { id, token: session.accessToken };
}

async function sync(token: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/sync/state',
    headers: { authorization: `Bearer ${token}` },
  });
  return { res, body: res.statusCode === 200 ? (res.json() as SyncBody) : null };
}

async function cityIds(): Promise<[string, string]> {
  const res = await app.db.query<{ id: string }>(`SELECT id FROM cities ORDER BY name LIMIT 2`);
  assert.equal(res.rows.length, 2, 'migrations must seed at least two cities');
  return [res.rows[0]!.id, res.rows[1]!.id];
}

test('an unauthenticated caller is refused', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/sync/state' });
  assert.equal(res.statusCode, 401);
});

test('the response is scoped to the caller and never cached', async () => {
  const user = await newUser();
  const { res, body } = await sync(user.token);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(body);
  for (const scope of ['bookings', 'parcels', 'trips', 'notifications', 'messages', 'verification', 'interests']) {
    assert.equal(typeof body.scopes[scope], 'string', `${scope} revision is present`);
    assert.match(body.scopes[scope]!, /^[0-9a-f]{20}$/, `${scope} revision is opaque`);
  }
  assert.equal(body.admin, undefined, 'a non-staff caller gets no staff figures');
  assert.equal(body.counts.notifications_unread, 0);
  assert.equal(body.counts.messages_unread, 0);
});

test('a change to a booking moves the parties revisions, not a stranger’s', async () => {
  const sender = await newUser(['sender']);
  const traveller = await newUser(['traveller']);
  const stranger = await newUser(['sender']);
  const [origin, dest] = await cityIds();

  const strangerBefore = await sync(stranger.token);

  const parcel = await app.db.query<{ id: string }>(
    `INSERT INTO parcels (sender_id, origin_city_id, dest_city_id, origin_area, dest_area, category,
                          description, weight_kg, dims_cm, declared_value_paise, window_start, window_end,
                          receiver_name, receiver_phone_hash, receiver_phone_last4, status)
     VALUES ($1, $2, $3, 'A', 'B', 'documents', 'papers', 1, ARRAY[10,10,10], 10000,
             now() + interval '1 day', now() + interval '2 day', 'Receiver', 'hash', '0000', 'posted')
     RETURNING id`,
    [sender.id, origin, dest],
  );
  const trip = await app.db.query<{ id: string }>(
    `INSERT INTO trips (traveller_id, origin_city_id, dest_city_id, mode, departure_at, arrival_estimate_at,
                        capacity_kg, capacity_kg_remaining, status)
     VALUES ($1, $2, $3, 'train', now() + interval '1 day', now() + interval '2 day', 5, 5, 'published')
     RETURNING id`,
    [traveller.id, origin, dest],
  );
  const quote = await app.db.query<{ id: string }>(
    `INSERT INTO quotes (parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
                         total_paise, traveller_paise, breakdown, expires_at)
     VALUES ($1, 'test', '{}'::jsonb, 10000, 1000, 500, 11500, 9000, '{}'::jsonb, now() + interval '1 hour')
     RETURNING id`,
    [parcel.rows[0]!.id],
  );

  const senderBefore = await sync(sender.token);
  const travellerBefore = await sync(traveller.token);

  await app.db.query(
    `INSERT INTO bookings (parcel_id, trip_id, sender_id, traveller_id, quote_id, status,
                           agreed_total_paise, traveller_share_paise)
     VALUES ($1, $2, $3, $4, $5, 'pending_traveller_acceptance', 11500, 9000)`,
    [parcel.rows[0]!.id, trip.rows[0]!.id, sender.id, traveller.id, quote.rows[0]!.id],
  );

  const senderAfter = await sync(sender.token);
  const travellerAfter = await sync(traveller.token);
  const strangerAfter = await sync(stranger.token);

  assert.ok(senderAfter.body);
  assert.ok(travellerAfter.body);
  assert.notEqual(senderAfter.body.scopes.bookings, senderBefore.body!.scopes.bookings);
  assert.notEqual(travellerAfter.body.scopes.bookings, travellerBefore.body!.scopes.bookings);
  assert.notEqual(senderAfter.body.revision, senderBefore.body!.revision);

  // The stranger is not a party: their feed must be byte-for-byte unchanged, including the
  // aggregate revision. This is the non-disclosure assertion.
  assert.equal(strangerAfter.body!.revision, strangerBefore.body!.revision);
});

test('unread notifications and messages are counted and move the revision', async () => {
  const sender = await newUser(['sender']);
  const traveller = await newUser(['traveller']);
  const [origin, dest] = await cityIds();

  const parcel = await app.db.query<{ id: string }>(
    `INSERT INTO parcels (sender_id, origin_city_id, dest_city_id, origin_area, dest_area, category,
                          description, weight_kg, dims_cm, declared_value_paise, window_start, window_end,
                          receiver_name, receiver_phone_hash, receiver_phone_last4, status)
     VALUES ($1, $2, $3, 'A', 'B', 'documents', 'papers', 1, ARRAY[10,10,10], 10000,
             now() + interval '1 day', now() + interval '2 day', 'Receiver', 'hash', '0000', 'posted')
     RETURNING id`,
    [sender.id, origin, dest],
  );
  const trip = await app.db.query<{ id: string }>(
    `INSERT INTO trips (traveller_id, origin_city_id, dest_city_id, mode, departure_at, arrival_estimate_at,
                        capacity_kg, capacity_kg_remaining, status)
     VALUES ($1, $2, $3, 'train', now() + interval '1 day', now() + interval '2 day', 5, 5, 'published')
     RETURNING id`,
    [traveller.id, origin, dest],
  );
  const quote = await app.db.query<{ id: string }>(
    `INSERT INTO quotes (parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
                         total_paise, traveller_paise, breakdown, expires_at)
     VALUES ($1, 'test', '{}'::jsonb, 10000, 1000, 500, 11500, 9000, '{}'::jsonb, now() + interval '1 hour')
     RETURNING id`,
    [parcel.rows[0]!.id],
  );
  const booking = await app.db.query<{ id: string }>(
    `INSERT INTO bookings (parcel_id, trip_id, sender_id, traveller_id, quote_id, status,
                           agreed_total_paise, traveller_share_paise)
     VALUES ($1, $2, $3, $4, $5, 'confirmed', 11500, 9000)
     RETURNING id`,
    [parcel.rows[0]!.id, trip.rows[0]!.id, sender.id, traveller.id, quote.rows[0]!.id],
  );
  const conversation = await app.db.query<{ id: string }>(
    `INSERT INTO conversations (booking_id) VALUES ($1) RETURNING id`,
    [booking.rows[0]!.id],
  );
  await app.db.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'sender'), ($1, $3, 'traveller')`,
    [conversation.rows[0]!.id, sender.id, traveller.id],
  );

  const before = await sync(sender.token);
  assert.equal(before.body!.counts.messages_unread, 0);

  await app.db.query(
    `INSERT INTO notifications (user_id, channel, template_id, status) VALUES ($1, 'in_app', 'booking.confirmed', 'queued')`,
    [sender.id],
  );
  await app.db.query(
    `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, 'I can pick it up at 6')`,
    [conversation.rows[0]!.id, traveller.id],
  );

  const after = await sync(sender.token);
  assert.ok(after.body);
  assert.equal(after.body.counts.notifications_unread, 1);
  assert.equal(after.body.counts.messages_unread, 1);
  assert.notEqual(after.body.scopes.notifications, before.body!.scopes.notifications);
  assert.notEqual(after.body.scopes.messages, before.body!.scopes.messages);

  // Marking the notification read is itself a change: the badge has to clear without a reload.
  const read = await app.inject({
    method: 'POST',
    url: '/v1/notifications/read-all',
    headers: { authorization: `Bearer ${sender.token}` },
  });
  assert.equal(read.statusCode, 200);

  const readBack = await sync(sender.token);
  assert.equal(readBack.body!.counts.notifications_unread, 0);
  assert.notEqual(readBack.body!.scopes.notifications, after.body.scopes.notifications);
});

test('staff queues appear only for staff', async () => {
  const staff = await newUser(['sender', 'verification_reviewer', 'finance']);
  const { body } = await sync(staff.token);

  assert.ok(body?.admin, 'staff receive the queue figures');
  assert.equal(typeof body.admin.pending_verifications, 'number');
  assert.equal(typeof body.admin.open_disputes, 'number');
  assert.equal(typeof body.admin.pending_payouts, 'number');
  assert.match(body.scopes.admin ?? '', /^[0-9a-f]{20}$/);
});
