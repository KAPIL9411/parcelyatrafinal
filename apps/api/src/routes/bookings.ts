import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  applyTransition,
  allowedCommands,
  type ActorKind,
  type BookingCommand,
  type BookingStatus,
  type PayoutState,
  type TransportMode,
  type VerificationState,
} from '@py/domain';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { generateOtp, hashCode, safeEqual } from '../lib/crypto.ts';
import { rememberCode } from '../lib/dev-store.ts';
import { open as openSealed, seal } from '../lib/seal.ts';
import { bookingView, num, toIso } from '../lib/serialize.ts';
import { withIdempotency } from '../lib/idempotency.ts';
import { audit, emitOutbox, queueNotification } from '../services/audit.ts';

const createSchema = z
  .object({
    parcel_id: z.string().uuid(),
    trip_id: z.string().uuid(),
    quote_id: z.string().uuid(),
  })
  .strict();

const transitionSchema = z
  .object({
    command: z.enum([
      'submit',
      'accept',
      'decline',
      'cancel',
      'confirm_pickup',
      'start_transit',
      'arrive',
      'confirm_delivery',
      'receiver_unavailable',
      'raise_dispute',
      'report_incident',
    ]),
    reason_code: z.string().max(64).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

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

  return {
    row,
    role,
    view: bookingView(
      { ...detail.rows[0]!, timeline: events.rows, open_dispute: dispute.rows[0] ?? null },
      cmds as string[],
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
    openDispute: false,
    pickupConsumed: Boolean(pickup.rows[0]?.used_at),
    ledgerBalancePaise: booking.agreed_total_paise,
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
    supportRole?: 'support_lead' | 'trust_safety' | 'finance' | 'verification_reviewer' | 'admin_readonly' | null;
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

  // Optimistic concurrency: the status must still be what we read.
  const updated = await db.query(
    `UPDATE bookings SET status = $2, updated_at = now() WHERE id = $1 AND status = $3`,
    [booking.id, result.to, booking.status],
  );
  if (updated.rowCount === 0) throw new AppError('TRANSITION_CONFLICT');

  await db.query(
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

  // ---- side effects ----
  if (result.to === 'pickup_ready') {
    await ensureHandoverOtp(app, booking.id, 'pickup');
    await queueNotification(db, { userId: booking.sender_id, bookingId: booking.id, templateId: 'pickup_code_ready' });
  }
  if (result.to === 'arrived') {
    await ensureHandoverOtp(app, booking.id, 'delivery');
  }
  if (result.to === 'delivered') {
    const deadline = new Date(Date.now() + config.DISPUTE_WINDOW_HOURS * 3_600_000);
    await db.query(`UPDATE bookings SET dispute_deadline = $2, delivered_at = now() WHERE id = $1`, [booking.id, deadline]);
    await db.query(`UPDATE payouts SET state = 'not_eligible' WHERE booking_id = $1`, [booking.id]);
    await queueNotification(db, { userId: booking.sender_id, bookingId: booking.id, templateId: 'delivered' });
  }
  if (result.to === 'payout_eligible') {
    await db.query(`UPDATE payouts SET state = 'eligible' WHERE booking_id = $1`, [booking.id]);
  }
  if (result.to.startsWith('cancelled_') || result.to === 'expired') {
    const parcel = await db.query<{ weight_kg: unknown }>(`SELECT weight_kg FROM parcels WHERE id = $1`, [booking.parcel_id]);
    const releaseKg = num(parcel.rows[0]?.weight_kg) * 1.1;
    await db.query(
      `UPDATE trips SET capacity_kg_remaining = LEAST(capacity_kg, capacity_kg_remaining + $2),
              status = CASE WHEN status = 'full' THEN 'partially_booked'::trip_status ELSE status END
       WHERE id = $1`,
      [booking.trip_id, releaseKg],
    );
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
  if (existing.rows[0] && !existing.rows[0].used_at && !opts.force) {
    // Still valid and unused: keep it. A sender who asks again sees the same code.
    if (new Date(existing.rows[0].expires_at).getTime() > Date.now()) return;
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 6 * 3_600_000);
  await app.db.query(
    `INSERT INTO handover_otps (booking_id, phase, code_hash, code_sealed, expires_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (booking_id, phase)
     DO UPDATE SET code_hash = EXCLUDED.code_hash, code_sealed = EXCLUDED.code_sealed,
                   expires_at = EXCLUDED.expires_at, used_at = NULL, attempts = 0`,
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
  bookingId: string,
  phase: 'pickup' | 'delivery',
  code: string,
): Promise<void> {
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
      await app.db.query(`UPDATE bookings SET status = 'locked_for_review', updated_at = now() WHERE id = $1`, [bookingId]);
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

      const reservedKg = num(p.weight_kg) * 1.1;
      const booking = await db.transaction(async (tx) => {
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
        await tx.query(`UPDATE parcels SET status = 'matched', updated_at = now() WHERE id = $1`, [p.id]);
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

  app.get<{ Querystring: { role?: string; status?: string; limit?: string; cursor?: string } }>('/bookings', async (req) => {
    const auth = requireAuth(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
    const params: unknown[] = [];
    const clauses: string[] = [];

    // `trips` also has `traveller_id`, so every column here must be qualified with the `b` alias.
    if (req.query.role === 'sender') {
      params.push(auth.userId);
      clauses.push(`b.sender_id = $${params.length}`);
    } else if (req.query.role === 'traveller') {
      params.push(auth.userId);
      clauses.push(`b.traveller_id = $${params.length}`);
    } else {
      params.push(auth.userId, auth.userId);
      clauses.push(`(b.sender_id = $${params.length - 1} OR b.traveller_id = $${params.length})`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      clauses.push(`b.status = $${params.length}`);
    }
    if (req.query.cursor) {
      params.push(new Date(req.query.cursor));
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
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT b.id, b.status, b.sender_id, b.traveller_id, b.agreed_total_paise, t.mode, b.created_at, b.updated_at
       FROM bookings b JOIN trips t ON t.id = b.trip_id
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

  app.post<{ Params: { bookingId: string } }>('/bookings/:bookingId/otp/regenerate', async (req, reply) => {
    const auth = requireAuth(req);
    const body = z.object({ phase: z.enum(['pickup', 'delivery']) }).strict().parse(req.body);
    const { row, role } = await loadForViewer(app, req.params.bookingId, auth.userId);
    if (role !== 'sender') throw new AppError('FORBIDDEN', { reason: 'only_sender_may_reissue' });

    const applicable =
      (body.phase === 'pickup' && row.status === 'pickup_ready') ||
      (body.phase === 'delivery' && row.status === 'arrived');
    if (!applicable) throw new AppError('OTP_NOT_APPLICABLE');

    await ensureHandoverOtp(app, row.id, body.phase, { force: true });
    return reply.code(202).send({
      phase: body.phase,
      expires_at: toIso(new Date(Date.now() + 6 * 3_600_000)),
      attempts_remaining: 5,
    });
  });

  app.post<{ Params: { bookingId: string } }>('/bookings/:bookingId/handover/pickup', async (req, reply) => {
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

    await verifyHandoverOtp(app, row.id, 'pickup', body.otp);
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
  });

  app.post<{ Params: { bookingId: string } }>('/bookings/:bookingId/handover/delivery', async (req, reply) => {
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

    await verifyHandoverOtp(app, row.id, 'delivery', body.otp);
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
  });

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
