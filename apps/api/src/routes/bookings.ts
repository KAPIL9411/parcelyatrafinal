import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  allowedCommands,
  CLIENT_COMMANDS,
  HANDOVER_ONLY_COMMANDS,
  applyTransition,
  type ActorKind,
  type BookingCommand,
  type BookingStatus,
  type PayoutState,
  type TransportMode,
  type VerificationState,
} from '@py/domain';

import { config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { dbIsScoped } from '../lib/db-scope.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { generateOtp, hashCode, safeEqual } from '../lib/crypto.ts';
import { rememberCode } from '../lib/dev-store.ts';
import { open as openSealed, seal } from '../lib/seal.ts';
import { bookingView, num, toIso } from '../lib/serialize.ts';
import { keyBelongsTo } from '../lib/storage.ts';
import { matchPolicy } from '../lib/matching-policy.ts';
import { withIdempotency } from '../lib/idempotency.ts';
import { audit, emitOutbox, queueNotification } from '../services/audit.ts';
import { trackingService } from '../services/tracking-service.ts';

const createSchema = z
  .object({
    parcel_id: z.string().uuid(),
    trip_id: z.string().uuid(),
    quote_id: z.string().uuid(),
  })
  .strict();

const transitionSchema = z
  .object({
    // Derived from the domain list, so the route can never drift ahead of (or behind) what a party is
    // actually allowed to ask for. Handover proofs are deliberately not in that list.
    command: z.enum(CLIENT_COMMANDS as [BookingCommand, ...BookingCommand[]]),
    reason_code: z.string().max(64).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

/**
 * Which command tells which side that something happened.
 *
 * Without this table the notification list only covers the three states that also mint a handover
 * code, so a sender who is waiting to hear whether the traveller said yes hears nothing at all. The
 * actor is never notified about their own action, and the handover-code states are absent because
 * `applyBookingTransition` already announces those.
 */
const TRANSITION_ALERTS: Partial<
  Record<BookingCommand, { template: string; audience: 'sender' | 'traveller' | 'both' | 'counterparty' }>
> = {
  accept: { template: 'booking_accepted', audience: 'sender' },
  decline: { template: 'booking_declined', audience: 'sender' },
  cancel: { template: 'booking_cancelled', audience: 'counterparty' },
  payment_authorised: { template: 'payment_captured', audience: 'both' },
  payment_failed: { template: 'payment_failed', audience: 'both' },
  confirm_pickup: { template: 'pickup_confirmed', audience: 'sender' },
  start_transit: { template: 'in_transit', audience: 'sender' },
  receiver_unavailable: { template: 'delivery_failed', audience: 'sender' },
  resolve_sender: { template: 'dispute_resolved', audience: 'both' },
  resolve_traveller: { template: 'dispute_resolved', audience: 'both' },
};

export interface BookingRowFull {
  id: string;
  parcel_id: string;
  trip_id: string;
  sender_id: string;
  traveller_id: string;
  quote_id: string;
  status: BookingStatus;
  accept_by: Date | null;
  agreed_total_paise: number;
  traveller_share_paise: number;
  dispute_deadline: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BookingContextRow extends BookingRowFull {
  origin_area: string | null;
  dest_area: string | null;
  mode: TransportMode;
  window_start: Date;
  window_end: Date;
  counterparty_name: string | null;
  counterparty_phone_masked: string | null;
  counterparty_verification: VerificationState | null;
  payout_state: PayoutState;
}

export async function loadBookingContext(app: FastifyInstance, bookingId: string): Promise<BookingContextRow | null> {
  const res = await app.db.query<BookingContextRow>(
    `SELECT b.*, p.origin_area, p.dest_area, p.window_start, p.window_end, t.mode,
            cp.name AS counterparty_name, cp.phone_masked AS counterparty_phone_masked,
            (SELECT v.state FROM verifications v WHERE v.user_id = cp.id ORDER BY v.created_at DESC LIMIT 1) AS counterparty_verification,
            COALESCE(po.state, 'not_eligible') AS payout_state
     FROM bookings b
     JOIN parcels p ON p.id = b.parcel_id
     JOIN trips t ON t.id = b.trip_id
     LEFT JOIN payouts po ON po.booking_id = b.id
     JOIN users cp ON cp.id = b.traveller_id
     WHERE b.id = $1`,
    [bookingId],
  );
  return res.rows[0] ?? null;
}

async function loadForViewer(app: FastifyInstance, bookingId: string, userId: string) {
  const base = await app.db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const row = base.rows[0];
  if (!row) throw new AppError('NOT_FOUND');
  const role: 'sender' | 'traveller' | null =
    row.sender_id === userId ? 'sender' : row.traveller_id === userId ? 'traveller' : null;
  if (!role) throw new AppError('NOT_FOUND'); // resource non-disclosure

  const detail = await app.db.query<BookingContextRow>(
    `SELECT b.*, p.origin_area, p.dest_area, p.window_start, p.window_end, t.mode,
            cp.name AS counterparty_name, cp.phone_masked AS counterparty_phone_masked,
            (SELECT v.state FROM verifications v WHERE v.user_id = cp.id ORDER BY v.created_at DESC LIMIT 1) AS counterparty_verification,
            COALESCE(po.state, 'not_eligible') AS payout_state
     FROM bookings b
     JOIN parcels p ON p.id = b.parcel_id
     JOIN trips t ON t.id = b.trip_id
     LEFT JOIN payouts po ON po.booking_id = b.id
     JOIN users cp ON cp.id = $2
     WHERE b.id = $1`,
    [bookingId, role === 'sender' ? row.traveller_id : row.sender_id],
  );

  const events = await app.db.query<{
    from_state: string | null;
    to_state: string;
    actor_kind: string;
    actor_id: string | null;
    reason_code: string | null;
    occurred_at: Date;
  }>(
    `SELECT from_state, to_state, actor_kind, actor_id, reason_code, occurred_at
     FROM booking_events WHERE booking_id = $1 ORDER BY occurred_at ASC, id ASC`,
    [bookingId],
  );

  const ctx = await transitionContext(app, detail.rows[0]!, role, 'system');
  const cmds = allowedCommands(row.status, ctx);

  // The case reference is needed on the booking page: the API has a case route, and telling a
  // person to "add evidence from the case page" is only honest if the page can link to it.
  // Additive to the contract: docs/BUILD_NOTES.md DEFECT-012.
  const dispute = await app.db.query<{ id: string; state: string; category: string; created_at: Date }>(
    `SELECT id, state, category, created_at FROM disputes
     WHERE booking_id = $1 AND state IN ('open','evidence_requested','under_review')
     ORDER BY created_at DESC LIMIT 1`,
    [bookingId],
  );

  const payment = await app.db.query<{ state: string; amount_paise: number; sandbox: boolean }>(
    `SELECT state, amount_paise, sandbox FROM payments
     WHERE booking_id = $1 AND state <> 'failed'
     ORDER BY created_at DESC LIMIT 1`,
    [bookingId],
  );

  return {
    row,
    role,
    view: bookingView(
      {
        ...detail.rows[0]!,
        timeline: events.rows,
        open_dispute: dispute.rows[0] ?? null,
        payment: payment.rows[0] ?? null,
      },
      cmds as string[],
      role,
    ),
  };
}

async function transitionContext(
  app: FastifyInstance,
  booking: BookingContextRow,
  role: 'sender' | 'traveller' | null,
  actor: ActorKind,
) {
  const now = new Date();
  const hoursUntilWindowStart = (new Date(booking.window_start).getTime() - now.getTime()) / 3_600_000;

  const payout = await app.db.query<{ state: string }>(`SELECT state FROM payouts WHERE booking_id = $1`, [booking.id]);
  const pickup = await app.db.query<{ used_at: Date | null }>(
    `SELECT used_at FROM handover_otps WHERE booking_id = $1 AND phase = 'pickup'`,
    [booking.id],
  );
  // Money truth comes from the journal, not from the price the booking agreed to. Feeding
  // `agreed_total_paise` in here made the release guard unable to fail, so a payout could be called
  // settled for a booking whose capture never arrived.
  const ledger = await app.db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount_paise), 0)::text AS total FROM payment_ledger WHERE booking_id = $1`,
    [booking.id],
  );
  const openDispute = await app.db.query(
    `SELECT 1 FROM disputes
     WHERE booking_id = $1 AND state IN ('open','evidence_requested','under_review','appealed')
     LIMIT 1`,
    [booking.id],
  );

  return {
    now,
    actor: role === 'sender' ? 'sender' : role === 'traveller' ? 'traveller' : actor,
    acceptBy: booking.accept_by,
    quoteValid: true,
    capacityHeld: true,
    travellerVerified: booking.counterparty_verification === 'verified' || role === 'traveller',
    hoursUntilWindowStart,
    disputeDeadline: booking.dispute_deadline,
    disputeWindowElapsed: booking.dispute_deadline ? now > new Date(booking.dispute_deadline) : false,
    openDispute: openDispute.rows.length > 0,
    pickupConsumed: Boolean(pickup.rows[0]?.used_at),
    ledgerBalancePaise: Number(ledger.rows[0]?.total ?? 0),
    payoutAmountPaise: booking.traveller_share_paise,
    supportRole: null,
    payoutState: payout.rows[0]?.state ?? 'not_eligible',
  };
}

export async function applyBookingTransition(
  app: FastifyInstance,
  booking: BookingRowFull,
  command: BookingCommand,
  actor: ActorKind,
  opts: {
    actorId?: string | null;
    reasonCode?: string | null;
    otpValid?: boolean;
    photoPresent?: boolean;
    supportRole?: 'support_agent' | 'trust_safety' | 'finance' | 'verification_reviewer' | 'admin_readonly' | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<{ status: BookingStatus }> {
  const db = app.db;
  const role = actor === 'sender' ? 'sender' : actor === 'traveller' ? 'traveller' : null;
  const context = (await loadBookingContext(app, booking.id)) ?? (booking as unknown as BookingContextRow);
  const ctx = {
    ...(await transitionContext(app, context, role, actor)),
    actor,
    ...(opts.otpValid !== undefined ? { otpValid: opts.otpValid } : {}),
    ...(opts.photoPresent !== undefined ? { photoPresent: opts.photoPresent } : {}),
    ...(opts.supportRole !== undefined ? { supportRole: opts.supportRole } : {}),
  };

  const result = applyTransition(booking.status, command, ctx);
  if (!result.ok) throw new AppError(result.code as never, { command, from: booking.status }, result.message);

  // The status flip, the event row and the capacity hand-back are one transaction. Run separately, a
  // process that stopped between them left the trip charging a sender for space that no booking holds —
  // invisible afterwards, because every read (matching, the trip card, the traveller's edit checks)
  // trusts that column.
  //
  // A caller that already holds a transaction passes a scoped app (see lib/db-scope.ts: the staff and
  // dispute routes), whose `db` *is* that transaction. This interface refuses to nest, so there the
  // statements join the caller's transaction and commit with it instead.
  const releasesCapacity = result.to.startsWith('cancelled_') || result.to === 'expired';
  const alreadyScoped = dbIsScoped(app);

  const write = async (q: Db) => {
    // Optimistic concurrency: the status must still be what we read.
    const updated = await q.query(
      `UPDATE bookings SET status = $2, updated_at = now() WHERE id = $1 AND status = $3`,
      [booking.id, result.to, booking.status],
    );
    if (updated.rowCount === 0) throw new AppError('TRANSITION_CONFLICT');

    await q.query(
      `INSERT INTO booking_events (booking_id, from_state, to_state, actor_id, actor_kind, command, reason_code, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        booking.id,
        booking.status,
        result.to,
        opts.actorId ?? null,
        actor === 'sender' || actor === 'traveller' ? 'user' : actor,
        command,
        opts.reasonCode ?? null,
        JSON.stringify(opts.metadata ?? {}),
      ],
    );

    if (releasesCapacity) {
      const parcel = await q.query<{ weight_kg: unknown }>(`SELECT weight_kg FROM parcels WHERE id = $1`, [
        booking.parcel_id,
      ]);
      // Measured with the same allowance the reservation took and the engine gates on, so the three can
      // never disagree about how much of the trip a parcel occupies.
      const releaseKg = num(parcel.rows[0]?.weight_kg) * matchPolicy.packagingAllowance;
      await q.query(
        `UPDATE trips SET capacity_kg_remaining = LEAST(capacity_kg, capacity_kg_remaining + $2),
                status = CASE WHEN status = 'full' THEN 'partially_booked'::trip_status ELSE status END
         WHERE id = $1`,
        [booking.trip_id, releaseKg],
      );
    }
  };

  if (alreadyScoped) await write(db);
  else await db.transaction(write);

  // ---- side effects ----
  if (result.to === 'pickup_ready') {
    await ensureHandoverOtp(app, booking.id, 'pickup');
    await queueNotification(db, { userId: booking.sender_id, bookingId: booking.id, templateId: 'pickup_code_ready' });
  }
  if (result.to === 'arrived') {
    await ensureHandoverOtp(app, booking.id, 'delivery');
    // The receiver has no account, so the sender is the one who has to read the delivery code out
    // to them. Nothing tells the sender that the code exists unless this is queued here.
    await queueNotification(db, { userId: booking.sender_id, bookingId: booking.id, templateId: 'delivery_code_ready' });
  }
  if (result.to === 'delivered' && booking.status !== 'delivered') {
    const deadline = new Date(Date.now() + config.DISPUTE_WINDOW_HOURS * 3_600_000);
    await db.query(`UPDATE bookings SET dispute_deadline = $2, delivered_at = now() WHERE id = $1`, [booking.id, deadline]);
    await db.query(`UPDATE payouts SET state = 'not_eligible' WHERE booking_id = $1`, [booking.id]);
    await queueNotification(db, { userId: booking.sender_id, bookingId: booking.id, templateId: 'delivered' });
  }
  if (result.to === 'payout_eligible') {
    await db.query(`UPDATE payouts SET state = 'eligible' WHERE booking_id = $1`, [booking.id]);
  }

  const stageMap: Partial<Record<BookingStatus, string>> = {
    picked_up: 'picked_up',
    in_transit: 'in_transit',
    arrived: 'out_for_delivery',
    delivered: 'delivered',
  };
  const trackedStage = stageMap[result.to];
  if (trackedStage && booking.status !== result.to) {
    await db.query(
      `INSERT INTO parcel_status_log (parcel_id, booking_id, stage, actor_id, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [booking.parcel_id, booking.id, trackedStage, opts.actorId ?? null, `Transitioned via ${command}`],
    ).catch(() => {});
  }

  if (result.to === 'delivered' || releasesCapacity) {
    await trackingService.stopTracking(booking.id).catch(() => {});
  }

  const alert = TRANSITION_ALERTS[command];
  if (alert) {
    const told: Array<string | null> =
      alert.audience === 'sender'
        ? [booking.sender_id]
        : alert.audience === 'traveller'
          ? [booking.traveller_id]
          : alert.audience === 'counterparty'
            ? actor === 'sender'
              ? [booking.traveller_id]
              : actor === 'traveller'
                ? [booking.sender_id]
                : [booking.sender_id, booking.traveller_id]
            : [booking.sender_id, booking.traveller_id];
    for (const userId of told) {
      // Nobody gets a notification about a change they just made themselves.
      if (!userId || userId === opts.actorId) continue;
      await queueNotification(db, { userId, bookingId: booking.id, templateId: alert.template });
    }
  }

  await emitOutbox(db, `booking.${result.to}`, { booking_id: booking.id, command });
  await audit(db, {
    actorId: opts.actorId ?? null,
    actorKind: actor === 'sender' || actor === 'traveller' ? 'user' : actor,
    action: `booking.${command}`,
    resource: 'booking',
    resourceId: booking.id,
    before: { status: booking.status },
    after: { status: result.to },
    reasonCode: opts.reasonCode ?? null,
  });

  return { status: result.to };
}

export async function ensureHandoverOtp(
  app: FastifyInstance,
  bookingId: string,
  phase: 'pickup' | 'delivery',
  opts: { force?: boolean } = {},
): Promise<void> {
  const existing = await app.db.query<{ id: string; used_at: Date | null; expires_at: Date }>(
    `SELECT id, used_at, expires_at FROM handover_otps WHERE booking_id = $1 AND phase = $2`,
    [bookingId, phase],
  );
  if (existing.rows[0]?.used_at) {
    // That step already happened. Re-issuing here would make a spent code live again.
    return;
  }
  if (existing.rows[0] && !opts.force) {
    // Still valid and unused: keep it. A sender who asks again sees the same code.
    if (new Date(existing.rows[0].expires_at).getTime() > Date.now()) return;
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 6 * 3_600_000);
  // `attempts` is deliberately not reset. A fresh code with a clean budget could be issued as many
  // times as the guesser likes, which turns the five-try limit into five tries per request.
  await app.db.query(
    `INSERT INTO handover_otps (booking_id, phase, code_hash, code_sealed, expires_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (booking_id, phase)
     DO UPDATE SET code_hash = EXCLUDED.code_hash, code_sealed = EXCLUDED.code_sealed,
                   expires_at = EXCLUDED.expires_at`,
    [bookingId, phase, hashCode(code), seal(code), expiresAt],
  );

  // The receiver has no account and no stored phone number, so this code is shown to the sender in
  // the app rather than texted. Keep the log line for operators; never send the code to a client
  // other than the sender's own authenticated session (see GET /bookings/:id/handover-code/:phase).
  app.log.info({ booking_id: bookingId, phase, delivery: 'sender-in-app' }, 'handover OTP issued');
  if (config.ENABLE_DEV_ENDPOINTS) rememberCode(`${bookingId}:${phase}`, code, phase, 6 * 3_600_000);
}

async function verifyHandoverOtp(
  app: FastifyInstance,
  booking: BookingRowFull,
  phase: 'pickup' | 'delivery',
  code: string,
): Promise<void> {
  const bookingId = booking.id;
  const res = await app.db.query<{
    id: string;
    code_hash: string;
    attempts: number;
    max_attempts: number;
    expires_at: Date;
    used_at: Date | null;
  }>(`SELECT * FROM handover_otps WHERE booking_id = $1 AND phase = $2`, [bookingId, phase]);

  const row = res.rows[0];
  if (!row || row.used_at) throw new AppError('OTP_NOT_APPLICABLE');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new AppError('OTP_EXPIRED');
  if (row.attempts >= row.max_attempts) throw new AppError('BOOKING_LOCKED');

  if (!safeEqual(row.code_hash, hashCode(code))) {
    const next = await app.db.query<{ attempts: number; max_attempts: number }>(
      `UPDATE handover_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts, max_attempts`,
      [row.id],
    );
    const r = next.rows[0]!;
    if (r.attempts >= r.max_attempts) {
      // Pausing the booking is a transition like any other: it has to appear in the timeline, or the
      // history tells anyone who reads it that nothing happened while the parcel sits unmovable.
      await applyBookingTransition(app, booking, 'lock', 'system', {
        reasonCode: 'OTP_ATTEMPTS_EXCEEDED',
        metadata: { phase },
      });
      throw new AppError('BOOKING_LOCKED');
    }
    throw new AppError('OTP_INVALID', { attempts_remaining: r.max_attempts - r.attempts });
  }

  await app.db.query(`UPDATE handover_otps SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [row.id]);
}

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.post('/bookings', async (req, reply) => {
    const auth = requireAuth(req);
    if (!config.FEATURE_NEW_BOOKINGS_ENABLED) throw new AppError('FORBIDDEN', { reason: 'new_bookings_disabled' });
    const body = createSchema.parse(req.body);

    const result = await withIdempotency(app.db, auth.userId, 'create_booking', req, body, async () => {
      const parcel = await db.query<{
        id: string;
        sender_id: string;
        status: string;
        weight_kg: unknown;
        origin_city_id: string;
        dest_city_id: string;
      }>(`SELECT id, sender_id, status, weight_kg, origin_city_id, dest_city_id FROM parcels WHERE id = $1`, [body.parcel_id]);
      const p = parcel.rows[0];
      if (!p || p.sender_id !== auth.userId) throw new AppError('NOT_FOUND');
      if (p.status !== 'posted' && p.status !== 'matched') throw new AppError('CONFLICT', { reason: 'parcel_not_posted' });

      const quote = await db.query<{
        id: string;
        parcel_id: string;
        total_paise: number;
        traveller_paise: number;
        expires_at: Date;
      }>(`SELECT id, parcel_id, total_paise, traveller_paise, expires_at FROM quotes WHERE id = $1`, [body.quote_id]);
      const q = quote.rows[0];
      if (!q || q.parcel_id !== body.parcel_id) throw new AppError('QUOTE_MISMATCH');
      if (new Date(q.expires_at).getTime() < Date.now()) throw new AppError('QUOTE_EXPIRED');

      const trip = await db.query<{
        id: string;
        traveller_id: string;
        status: string;
        capacity_kg_remaining: unknown;
        origin_city_id: string;
        dest_city_id: string;
      }>(`SELECT id, traveller_id, status, capacity_kg_remaining, origin_city_id, dest_city_id FROM trips WHERE id = $1`, [body.trip_id]);
      const t = trip.rows[0];
      if (!t) throw new AppError('TRIP_NOT_AVAILABLE');
      if (!['published', 'partially_booked'].includes(t.status)) throw new AppError('TRIP_NOT_AVAILABLE');
      if (t.traveller_id === auth.userId) throw new AppError('SELF_BOOKING_FORBIDDEN');

      // The same allowance the release hands back and the engine gates on, taken from the policy rather
      // than written out again here.
      const reservedKg = num(p.weight_kg) * matchPolicy.packagingAllowance;
      const booking = await db.transaction(async (tx) => {
        // The parcel is re-checked *inside* the transaction. This takes the row lock, so two senders
        // requesting the same parcel at the same moment cannot both get through: the second one waits,
        // finds an active booking, and loses cleanly. The unique index stays as the backstop.
        // The status list mirrors the `bookings_one_active_per_parcel` partial index predicate.
        const claimed = await tx.query(
          `UPDATE parcels SET status = 'matched', updated_at = now()
           WHERE id = $1
             AND status IN ('posted','matched')
             AND NOT EXISTS (
               SELECT 1 FROM bookings b
               WHERE b.parcel_id = parcels.id
                 AND b.status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible',
                                      'cancelled_safety','expired','refunded','paid_out')
             )
           RETURNING id`,
          [p.id],
        );
        if (claimed.rowCount === 0) throw new AppError('PARCEL_HAS_ACTIVE_BOOKING');

        // Atomic capacity reservation. Losing this race is a normal, expected outcome.
        const reserved = await tx.query(
          `UPDATE trips SET capacity_kg_remaining = capacity_kg_remaining - $2,
                  status = CASE WHEN capacity_kg_remaining - $2 <= 0 THEN 'full'::trip_status ELSE 'partially_booked'::trip_status END
           WHERE id = $1 AND capacity_kg_remaining >= $2 AND status IN ('published','partially_booked')`,
          [t.id, reservedKg],
        );
        if (reserved.rowCount === 0) throw new AppError('CAPACITY_UNAVAILABLE');

        const created = await tx.query<BookingRowFull>(
          `INSERT INTO bookings
            (parcel_id, trip_id, sender_id, traveller_id, quote_id, status,
             agreed_total_paise, traveller_share_paise, accept_by)
           VALUES ($1,$2,$3,$4,$5,'draft',$6,$7, now() + ($8 * interval '1 second'))
           RETURNING *`,
          [p.id, t.id, auth.userId, t.traveller_id, q.id, q.total_paise, q.traveller_paise, config.ACCEPT_WINDOW_SECONDS],
        );
        const b = created.rows[0]!;
        await tx.query(`INSERT INTO handovers (booking_id) VALUES ($1)`, [b.id]);
        await tx.query(
          `INSERT INTO payouts (booking_id, state, amount_paise) VALUES ($1,'not_eligible',$2)`,
          [b.id, q.traveller_paise],
        );
        await tx.query(
          `INSERT INTO booking_events (booking_id, from_state, to_state, actor_id, actor_kind, command)
           VALUES ($1, NULL, 'draft', $2, 'user', 'create')`,
          [b.id, auth.userId],
        );
        await tx.query(`INSERT INTO outbox (topic, payload) VALUES ('booking.requested', $1)`, [
          JSON.stringify({ booking_id: b.id }),
        ]);
        return b;
      });

      await applyBookingTransition(app, booking, 'submit', 'sender', { actorId: auth.userId });
      await queueNotification(db, { userId: t.traveller_id, bookingId: booking.id, templateId: 'booking_requested' });

      const fresh = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [booking.id]);
      return { status: 201, body: await renderBooking(app, fresh.rows[0]!, auth.userId) };
    });

    return reply.code(result.status).send(result.body);
  });

  app.get('/bookings', async (req) => {
    const auth = requireAuth(req);
    const q = z
      .object({
        role: z.enum(['sender', 'traveller']).optional(),
        status: z.string().min(1).max(64).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
      })
      .strict()
      .parse(req.query);
    const limit = q.limit;
    const params: unknown[] = [];
    const clauses: string[] = [];

    // `trips` also has `traveller_id`, so every column here must be qualified with the `b` alias.
    if (q.role === 'sender') {
      params.push(auth.userId);
      clauses.push(`b.sender_id = $${params.length}`);
    } else if (q.role === 'traveller') {
      params.push(auth.userId);
      clauses.push(`b.traveller_id = $${params.length}`);
    } else {
      params.push(auth.userId, auth.userId);
      clauses.push(`(b.sender_id = $${params.length - 1} OR b.traveller_id = $${params.length})`);
    }
    if (q.status) {
      params.push(q.status);
      clauses.push(`b.status = $${params.length}`);
    }
    if (q.cursor) {
      params.push(new Date(q.cursor));
      clauses.push(`b.created_at < $${params.length}`);
    }
    params.push(limit + 1);

    const res = await db.query<{
      id: string;
      status: string;
      sender_id: string;
      traveller_id: string;
      agreed_total_paise: number;
      mode: string;
      parcel_id: string;
      category: string;
      weight_kg: unknown;
      origin_city: string;
      dest_city: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT b.id, b.status, b.sender_id, b.traveller_id, b.agreed_total_paise, t.mode,
              b.parcel_id, p.category, p.weight_kg, oc.name AS origin_city, dc.name AS dest_city,
              b.created_at, b.updated_at
       FROM bookings b
       JOIN trips t ON t.id = b.trip_id
       JOIN parcels p ON p.id = b.parcel_id
       JOIN cities oc ON oc.id = p.origin_city_id
       JOIN cities dc ON dc.id = p.dest_city_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY b.created_at DESC LIMIT $${params.length}`,
      params,
    );

    const rows = res.rows.slice(0, limit);
    return {
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        role: r.sender_id === auth.userId ? 'sender' : 'traveller',
        mode: r.mode,
        parcel_id: r.parcel_id,
        category: r.category,
        weight_kg: num(r.weight_kg),
        origin_city: r.origin_city,
        dest_city: r.dest_city,
        agreed_total_paise: Number(r.agreed_total_paise),
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
      })),
      next_cursor: res.rows.length > limit ? toIso(rows[rows.length - 1]?.created_at) : null,
    };
  });

  app.get<{ Params: { bookingId: string } }>('/bookings/:bookingId', async (req) => {
    const auth = requireAuth(req);
    const { view } = await loadForViewer(app, req.params.bookingId, auth.userId);
    return view;
  });

  app.post<{ Params: { bookingId: string } }>('/bookings/:bookingId/transitions', async (req, reply) => {
    const auth = requireAuth(req);

    // A handover is proved with a code and a photo, and only the two handover endpoints take them.
    // Saying so beats letting it fall through as an anonymous validation error.
    const asked = (req.body as { command?: unknown } | null)?.command;
    if (typeof asked === 'string' && (HANDOVER_ONLY_COMMANDS as readonly string[]).includes(asked)) {
      throw new AppError(
        'HANDOVER_NOT_ALLOWED_IN_STATE',
        { command: asked, use: asked === 'confirm_pickup' ? '/bookings/:id/handover/pickup' : '/bookings/:id/handover/delivery' },
        'Confirming a handover needs the code and a photo. Use the handover step instead.',
      );
    }

    const body = transitionSchema.parse(req.body);
    const { row, role } = await loadForViewer(app, req.params.bookingId, auth.userId);

    const result = await withIdempotency(app.db, auth.userId, `transition:${row.id}`, req, body, async () => {
      await applyBookingTransition(app, row, body.command as BookingCommand, role, {
        actorId: auth.userId,
        reasonCode: body.reason_code ?? null,
        metadata: body.note ? { note: body.note } : {},
      });
      const fresh = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [row.id]);
      return { status: 200, body: await renderBooking(app, fresh.rows[0]!, auth.userId) };
    });

    return reply.code(result.status).send(result.body);
  });

  /**
   * The sender's own handover code. The receiver has no account and no stored phone number, so the
   * only zero-cost way to complete a handover is for the sender to read the code here and say it out
   * loud. The traveller deliberately cannot read it: that would defeat the proof.
   */
  app.get<{ Params: { bookingId: string; phase: string } }>(
    '/bookings/:bookingId/handover-code/:phase',
    async (req, reply) => {
      const auth = requireAuth(req);
      const phase = z.enum(['pickup', 'delivery']).parse(req.params.phase);
      const { row, role } = await loadForViewer(app, req.params.bookingId, auth.userId);
      if (role !== 'sender') throw new AppError('NOT_FOUND');

      const found = await app.db.query<{ code_sealed: string | null; used_at: Date | null; expires_at: Date }>(
        `SELECT code_sealed, used_at, expires_at FROM handover_otps WHERE booking_id = $1 AND phase = $2`,
        [row.id, phase],
      );
      const otp = found.rows[0];
      if (!otp || otp.used_at || !otp.code_sealed || new Date(otp.expires_at).getTime() < Date.now()) {
        throw new AppError('OTP_NOT_APPLICABLE');
      }
      const code = openSealed(otp.code_sealed);
      if (!code) throw new AppError('OTP_NOT_APPLICABLE');

      await audit(app.db, {
        actorId: auth.userId,
        actorKind: 'user',
        action: 'booking.handover_code_read',
        resource: 'booking',
        resourceId: row.id,
        after: { phase },
      });

      return reply.code(200).send({ phase, code, expires_at: toIso(otp.expires_at) });
    },
  );

  app.post<{ Params: { bookingId: string } }>(
    '/bookings/:bookingId/otp/regenerate',
    { config: { rateLimit: { max: 6, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const body = z.object({ phase: z.enum(['pickup', 'delivery']) }).strict().parse(req.body);
      const { row, role } = await loadForViewer(app, req.params.bookingId, auth.userId);
      if (role !== 'sender') throw new AppError('FORBIDDEN', { reason: 'only_sender_may_reissue' });

      const applicable =
        (body.phase === 'pickup' && row.status === 'pickup_ready') ||
        // A receiver who was not there the first time often comes back the next day, by which point
        // the code has expired. The sender has to be able to issue a new one — with the attempt
        // budget carried over, that stays safe.
        (body.phase === 'delivery' && (row.status === 'arrived' || row.status === 'delivery_attempt_failed'));
      if (!applicable) throw new AppError('OTP_NOT_APPLICABLE');

      await ensureHandoverOtp(app, row.id, body.phase, { force: true });

      // The attempt budget survives a re-issue, so the honest answer is what is actually left rather
      // than a constant that promises five more guesses every time.
      const after = await app.db.query<{ attempts: number; max_attempts: number; expires_at: Date }>(
        `SELECT attempts, max_attempts, expires_at FROM handover_otps WHERE booking_id = $1 AND phase = $2`,
        [row.id, body.phase],
      );
      const otp = after.rows[0]!;
      return reply.code(202).send({
        phase: body.phase,
        expires_at: toIso(otp.expires_at),
        attempts_remaining: Math.max(0, otp.max_attempts - otp.attempts),
      });
    },
  );

  app.post<{ Params: { bookingId: string } }>(
    '/bookings/:bookingId/handover/pickup',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const body = z
        .object({
          otp: z.string().regex(/^[0-9]{6}$/),
          photo_key: z.string().min(1).max(256),
          checklist: z
            .object({ seal_intact: z.boolean().optional(), weight_matches_declaration: z.boolean().optional() })
            .strict()
            .optional(),
        })
        .strict()
        .parse(req.body);

      const { row, role } = await loadForViewer(app, req.params.bookingId, auth.userId);
      if (role !== 'traveller') throw new AppError('TRANSITION_NOT_PERMITTED');
      if (row.status !== 'pickup_ready') throw new AppError('HANDOVER_NOT_ALLOWED_IN_STATE');

      // The handover photo must be the uploader's own object.
      if (!keyBelongsTo(body.photo_key, auth.userId)) {
        throw new AppError('VALIDATION_FAILED', { field: 'photo_key' }, 'Upload the photo again from this account.');
      }
      await verifyHandoverOtp(app, row, 'pickup', body.otp);
      await db.query(`UPDATE handovers SET pickup_photo_key = $2, pickup_at = now() WHERE booking_id = $1`, [
        row.id,
        body.photo_key,
      ]);

      await applyBookingTransition(app, row, 'confirm_pickup', 'traveller', {
        actorId: auth.userId,
        otpValid: true,
        photoPresent: true,
        metadata: body.checklist ?? {},
      });

      const fresh = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [row.id]);
      return reply.code(200).send(await renderBooking(app, fresh.rows[0]!, auth.userId));
    },
  );

  app.post<{ Params: { bookingId: string } }>(
    '/bookings/:bookingId/handover/delivery',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const body = z
        .object({
          otp: z.string().regex(/^[0-9]{6}$/),
          photo_key: z.string().min(1).max(256),
          receiver_name_confirmed: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);

      const { row, role } = await loadForViewer(app, req.params.bookingId, auth.userId);
      if (role !== 'traveller') throw new AppError('TRANSITION_NOT_PERMITTED');
      if (row.status !== 'arrived' && row.status !== 'delivery_attempt_failed') {
        throw new AppError('HANDOVER_NOT_ALLOWED_IN_STATE');
      }

      // The handover photo must be the uploader's own object.
      if (!keyBelongsTo(body.photo_key, auth.userId)) {
        throw new AppError('VALIDATION_FAILED', { field: 'photo_key' }, 'Upload the photo again from this account.');
      }
      await verifyHandoverOtp(app, row, 'delivery', body.otp);
      await db.query(`UPDATE handovers SET delivery_photo_key = $2, delivered_at = now() WHERE booking_id = $1`, [
        row.id,
        body.photo_key,
      ]);

      await applyBookingTransition(app, row, 'confirm_delivery', 'traveller', {
        actorId: auth.userId,
        otpValid: true,
        photoPresent: true,
        metadata: { receiver_name_confirmed: body.receiver_name_confirmed ?? false },
      });

      const fresh = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [row.id]);
      return reply.code(200).send(await renderBooking(app, fresh.rows[0]!, auth.userId));
    },
  );

  app.post<{ Params: { bookingId: string } }>('/bookings/:bookingId/review', async (req, reply) => {
    const auth = requireAuth(req);
    const body = z
      .object({
        stars: z.number().int().min(1).max(5),
        tags: z
          .array(
            z.enum(['on_time', 'careful_handling', 'clear_communication', 'late', 'poor_packaging', 'unresponsive']),
          )
          .max(5)
          .optional(),
      })
      .strict()
      .parse(req.body);

    const { row, role } = await loadForViewer(app, req.params.bookingId, auth.userId);
    if (!['delivered', 'payout_eligible', 'paid_out'].includes(row.status)) throw new AppError('CONFLICT', { reason: 'not_delivered' });
    if (row.delivered_at && Date.now() - new Date(row.delivered_at).getTime() > config.REVIEW_WINDOW_DAYS * 86_400_000) {
      throw new AppError('REVIEW_WINDOW_CLOSED');
    }

    const exists = await db.query(`SELECT 1 FROM reviews WHERE booking_id = $1 AND author_id = $2`, [row.id, auth.userId]);
    if (exists.rows.length > 0) throw new AppError('REVIEW_ALREADY_SUBMITTED');

    const subject = role === 'sender' ? row.traveller_id : row.sender_id;
    const inserted = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO reviews (booking_id, author_id, subject_id, stars, tags) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, created_at`,
      [row.id, auth.userId, subject, body.stars, body.tags ?? []],
    );

    return reply.code(201).send({
      id: inserted.rows[0]!.id,
      booking_id: row.id,
      stars: body.stars,
      tags: body.tags ?? [],
      created_at: toIso(inserted.rows[0]!.created_at),
    });
  });
}

async function renderBooking(app: FastifyInstance, row: BookingRowFull, userId: string) {
  const { view } = await loadForViewer(app, row.id, userId);
  return view;
}
