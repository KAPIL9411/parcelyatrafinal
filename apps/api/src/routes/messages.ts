import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { toIso } from '../lib/serialize.ts';
import { queueNotification } from '../services/audit.ts';

/**
 * Coordination chat for one booking: sender, traveller, and — only where a real account owns the
 * recipient phone number stored on the parcel — the recipient.
 *
 * Three rules shape everything below.
 *
 *   Authorisation is membership and nothing else. A non-member gets 404, not 403: "you may not read
 *   that" would confirm the booking exists, which is a disclosure.
 *
 *   The read path writes at most once. The web client polls every few seconds, so a poll that found
 *   nothing must not be inserting on every tick; the thread is opened on the first POST, the first
 *   conversation GET, or the first message poll of a booking that has none — and then never again.
 *   Only a party to the booking can trigger that open.
 *
 *   No websocket and no push service exist in this deployment, so a new message reaches the other
 *   party on their next poll or next navigation. Messages are durable the instant the POST returns.
 */

/** A booking that can no longer move is a read-only thread. History stays readable indefinitely:
 *  it is the evidence a dispute gets decided on. */
const CLOSED_STATUSES = new Set([
  'cancelled_by_sender',
  'cancelled_by_traveller',
  'cancelled_ineligible',
  'cancelled_safety',
  'expired',
  'refunded',
  'paid_out',
]);

const SYSTEM_NOTE =
  'Use this thread to agree where and when to hand over. Do not post identity documents, handover codes, or bank details here.';

/** Control characters never reach another user's screen or our logs. Newlines and tabs survive. */
function sanitize(input: string): string {
  return input
    .replace(/[\p{Cc}]/gu, (c) => (c === '\n' || c === '\t' ? c : ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

const postSchema = z.object({ body: z.string().min(1).max(2000) }).strict();
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();

interface Thread {
  id: string;
  bookingId: string;
  bookingStatus: string;
  role: 'sender' | 'traveller' | 'recipient';
}

interface MessageRow {
  id: string;
  kind: string;
  body: string;
  sender_id: string;
  sender_name: string | null;
  created_at: Date;
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get<{ Params: { bookingId: string } }>('/bookings/:bookingId/conversation', async (req) => {
    const auth = requireAuth(req);
    const thread = await findThread(app, req.params.bookingId, auth.userId) ?? (await openThread(app, req.params.bookingId, auth.userId));
    if (!thread) throw new AppError('NOT_FOUND');

    const members = await db.query<{ user_id: string; role: string; name: string | null }>(
      `SELECT cm.user_id, cm.role::text AS role, u.name
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = $1
       ORDER BY CASE cm.role WHEN 'sender' THEN 0 WHEN 'traveller' THEN 1 ELSE 2 END`,
      [thread.id],
    );

    return {
      id: thread.id,
      booking_id: thread.bookingId,
      role: thread.role,
      closed: CLOSED_STATUSES.has(thread.bookingStatus),
      members: members.rows.map((r) => ({
        user_id: r.user_id,
        role: r.role,
        name: r.name ?? 'Parcel Yatra user',
        you: r.user_id === auth.userId,
      })),
    };
  });

  app.get<{ Params: { bookingId: string } }>('/bookings/:bookingId/conversation/messages', async (req) => {
    const auth = requireAuth(req);
    const q = listSchema.parse(req.query);
    // Same open-on-first-touch as `GET .../conversation`: this poll is the first thing the booking page
    // asks for, and a booking nobody has messaged on yet is an empty thread, not a missing one.
    const thread =
      (await findThread(app, req.params.bookingId, auth.userId)) ??
      (await openThread(app, req.params.bookingId, auth.userId));
    if (!thread) throw new AppError('NOT_FOUND');

    // Newest first for the database, then reversed: a thread is short, and "the last N messages in
    // order" is the only paging this needs.
    const res = await db.query<MessageRow>(
      `SELECT m.id, m.kind, m.body, m.sender_id, u.name AS sender_name, m.created_at
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 AND m.removed_at IS NULL
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $2`,
      [thread.id, q.limit],
    );
    const rows = res.rows.reverse();

    const read = await db.query<{ last_read_at: Date | null }>(
      `SELECT last_read_at FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
      [thread.id, auth.userId],
    );
    const lastRead = read.rows[0]?.last_read_at ?? null;
    const unread = rows.filter(
      (m) => m.sender_id !== auth.userId && m.kind !== 'system' && (!lastRead || new Date(m.created_at) > lastRead),
    ).length;

    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        sender_id: r.sender_id,
        sender_name: r.kind === 'system' ? 'Parcel Yatra' : (r.sender_name ?? 'A member'),
        mine: r.sender_id === auth.userId,
        created_at: toIso(r.created_at),
      })),
      unread_count: unread,
      closed: CLOSED_STATUSES.has(thread.bookingStatus),
    };
  });

  app.post<{ Params: { bookingId: string } }>(
    '/bookings/:bookingId/conversation/messages',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const body = sanitize(postSchema.parse(req.body).body);
      if (body.length === 0) throw new AppError('VALIDATION_FAILED', { field: 'body' }, 'Write something first.');

      const thread = await openThread(app, req.params.bookingId, auth.userId);
      if (!thread) throw new AppError('NOT_FOUND');
      if (CLOSED_STATUSES.has(thread.bookingStatus)) throw new AppError('CONVERSATION_CLOSED');

      const inserted = await db.query<{ id: string; created_at: Date }>(
        `INSERT INTO messages (conversation_id, sender_id, kind, body)
         VALUES ($1,$2,'text',$3) RETURNING id, created_at`,
        [thread.id, auth.userId, body],
      );
      const message = inserted.rows[0]!;

      // Your own post cannot be unread for you.
      await db.query(
        `UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
        [thread.id, auth.userId],
      );

      const peers = await db.query<{ user_id: string }>(
        `SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2`,
        [thread.id, auth.userId],
      );
      for (const peer of peers.rows) {
        await queueNotification(db, { userId: peer.user_id, bookingId: thread.bookingId, templateId: 'message_received' });
      }

      return reply.code(201).send({
        id: message.id,
        kind: 'text',
        body,
        sender_id: auth.userId,
        mine: true,
        created_at: toIso(message.created_at),
      });
    },
  );

  app.post<{ Params: { bookingId: string } }>('/bookings/:bookingId/conversation/read', async (req, reply) => {
    const auth = requireAuth(req);
    const thread = await findThread(app, req.params.bookingId, auth.userId);
    if (!thread) throw new AppError('NOT_FOUND');

    await db.query(
      `UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
      [thread.id, auth.userId],
    );
    return reply.code(200).send({ unread_count: 0 });
  });

  /**
   * The inbox: every thread the caller belongs to, newest activity first, with unread counts.
   * Backs the badge in the app chrome. Draft bookings are excluded — there is nothing to coordinate.
   */
  app.get('/conversations', async (req) => {
    const auth = requireAuth(req);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).strict().parse(req.query);

    const res = await db.query<{
      conversation_id: string;
      booking_id: string;
      role: string;
      last_body: string | null;
      last_at: Date | null;
      unread: string;
      counterparty: string | null;
      status: string;
    }>(
      `SELECT cm.conversation_id, c.booking_id, cm.role::text AS role, b.status::text AS status,
              last_m.body AS last_body, last_m.created_at AS last_at,
              (SELECT count(*)::text FROM messages m2
                WHERE m2.conversation_id = cm.conversation_id
                  AND m2.removed_at IS NULL
                  AND m2.kind <> 'system'
                  AND m2.sender_id <> cm.user_id
                  AND (cm.last_read_at IS NULL OR m2.created_at > cm.last_read_at)) AS unread,
              cp.name AS counterparty
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       JOIN bookings b ON b.id = c.booking_id
       LEFT JOIN users cp ON cp.id = (CASE WHEN cm.user_id = b.sender_id THEN b.traveller_id ELSE b.sender_id END)
       LEFT JOIN LATERAL (
         SELECT m.body, m.created_at FROM messages m
         WHERE m.conversation_id = cm.conversation_id AND m.removed_at IS NULL
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1
       ) last_m ON TRUE
       WHERE cm.user_id = $1 AND b.status::text <> 'draft'
       ORDER BY COALESCE(last_m.created_at, c.created_at) DESC
       LIMIT $2`,
      [auth.userId, q.limit],
    );

    return {
      items: res.rows.map((r) => ({
        conversation_id: r.conversation_id,
        booking_id: r.booking_id,
        booking_status: r.status,
        role: r.role,
        closed: CLOSED_STATUSES.has(r.status ?? ''),
        counterparty: r.counterparty,
        last_message: r.last_body,
        last_at: r.last_at ? toIso(r.last_at) : null,
        unread_count: Number(r.unread),
      })),
      total_unread: res.rows.reduce((sum, r) => sum + Number(r.unread), 0),
    };
  });
}

/**
 * The caller's thread for a booking, or null when they are not a member. Read-only: exactly two
 * SELECTs, safe to hit on every poll.
 */
export async function findThread(
  app: FastifyInstance,
  bookingId: string,
  userId: string,
): Promise<Thread | null> {
  const res = await app.db.query<{ id: string; booking_id: string; role: string; status: string }>(
    `SELECT c.id, c.booking_id, cm.role::text AS role, b.status::text AS status
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     JOIN bookings b ON b.id = c.booking_id
     WHERE c.booking_id = $1 AND cm.user_id = $2`,
    [bookingId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    bookingId: row.booking_id,
    bookingStatus: row.status,
    role: row.role as Thread['role'],
  };
}

/**
 * Create the thread for a booking if it does not exist yet, then return the caller's view of it.
 *
 * Called on the write path and by the two reads that a party may make first — the conversation GET and
 * the message poll, which is what the booking page asks for when it opens. The unique
 * `conversations.booking_id` makes two simultaneous first-touches collapse into one row, and the
 * `ON CONFLICT DO NOTHING` member inserts make two simultaneous member lists idempotent. Once the
 * thread exists, both reads stop writing: `findThread` answers and this function is never reached.
 *
 * The recipient is added only when a live account genuinely owns `parcels.receiver_phone_hash`.
 * Accounts are never invented to fill a third seat in the chat.
 */
export async function openThread(
  app: FastifyInstance,
  bookingId: string,
  userId: string,
): Promise<Thread | null> {
  const db = app.db;
  const booking = await db.query<{ id: string; sender_id: string; traveller_id: string; status: string; receiver_phone_hash: string | null }>(
    `SELECT b.id, b.sender_id, b.traveller_id, b.status::text AS status, p.receiver_phone_hash
     FROM bookings b JOIN parcels p ON p.id = b.parcel_id
     WHERE b.id = $1`,
    [bookingId],
  );
  const b = booking.rows[0];
  if (!b) return null;

  // Opening a thread is a write, so it needs the same party test the read does. Without this guard any
  // signed-in account could create conversation rows against a stranger's booking by name.
  if (b.sender_id !== userId && b.traveller_id !== userId) {
    const recipient = b.receiver_phone_hash
      ? await db.query<{ id: string }>(
          `SELECT id FROM users
           WHERE id = $1 AND phone_hash = $2 AND deleted_at IS NULL AND status = 'active'`,
          [userId, b.receiver_phone_hash],
        )
      : null;
    if (!recipient?.rows.length) return null;
  }

  const created = await db.query<{ id: string; created_at: Date }>(
    `INSERT INTO conversations (booking_id) VALUES ($1)
     ON CONFLICT (booking_id) DO UPDATE SET booking_id = EXCLUDED.booking_id
     RETURNING id, created_at`,
    [bookingId],
  );
  const conversationId = created.rows[0]!.id;

  const members = await db.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role)
     VALUES ($1,$2,'sender'), ($1,$3,'traveller')
     ON CONFLICT (conversation_id, user_id) DO NOTHING
     RETURNING user_id`,
    [conversationId, b.sender_id, b.traveller_id],
  );

  if (b.receiver_phone_hash) {
    await db.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       SELECT $1, u.id, 'recipient'
       FROM users u
       WHERE u.phone_hash = $2 AND u.deleted_at IS NULL AND u.status = 'active'
         AND u.id <> $3 AND u.id <> $4
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [conversationId, b.receiver_phone_hash, b.sender_id, b.traveller_id],
    );
  }

  // The note is posted only when this call actually created the thread's first membership row, so a
  // re-open of an existing thread cannot duplicate it.
  if (members.rowCount && members.rowCount > 0) {
    await db.query(
      `INSERT INTO messages (conversation_id, sender_id, kind, body)
       SELECT $1, $2, 'system', $3
       WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = $1 AND m.kind = 'system')`,
      [conversationId, userId === b.sender_id ? b.traveller_id : b.sender_id, SYSTEM_NOTE],
    );
  }

  return findThread(app, bookingId, userId);
}
