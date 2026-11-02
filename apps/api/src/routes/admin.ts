import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { makeAuthenticate, requireRole } from '../lib/auth.ts';
import { toIso, toIsoOrNull } from '../lib/serialize.ts';
import { withDb } from '../lib/db-scope.ts';
import { idempotencyKey, withIdempotency } from '../lib/idempotency.ts';
import { audit, queueNotification } from '../services/audit.ts';
import { signObjectKey } from '../lib/storage.ts';
import { applyBookingTransition, type BookingRowFull } from './bookings.ts';

/**
 * Staff surfaces.
 *
 * Every route here is separately authenticated and role-gated. Reading a verification document or
 * exporting the audit log is itself audited. Staff roles are never inferred from a user-supplied
 * field: they come from `user_roles`.
 */

const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'request_more']),
    reason_code: z.enum([
      'id_clear',
      'id_unreadable',
      'id_expired',
      'id_mismatch',
      'selfie_mismatch',
      'suspected_forgery',
      'incomplete_document',
    ]),
  })
  .strict();

const releaseSchema = z
  .object({
    reason_code: z.string().min(1).max(64),
    approval_id: z.string().uuid().optional(),
  })
  .strict();

const refundSchema = z
  .object({
    booking_id: z.string().uuid(),
    amount_paise: z.number().int().min(1),
    reason_code: z.enum([
      'cancel_before_accept',
      'cancel_gt_2h',
      'cancel_lt_2h',
      'ineligible_after_booking',
      'dispute_sender_favour',
      'goodwill',
    ]),
    note: z.string().max(500).optional(),
  })
  .strict();

const resolveDisputeSchema = z
  .object({
    outcome: z.enum(['sender', 'traveller', 'split']),
    outcome_code: z.string().min(1).max(64),
    refund_paise: z.number().int().min(0).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

// ---- querystring schemas (Fastify delivers these as raw strings; parse before they reach SQL)

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'))
  .transform((s) => new Date(s));

const verificationQueueQuery = z
  .object({
    state: z.enum(['pending', 'verified', 'rejected', 'expired', 'awaiting_user']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

const adminBookingsQuery = z
  .object({
    status: z.string().min(1).max(64).optional(),
    phone_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    created_from: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

const disputeQueueQuery = z
  .object({
    state: z.enum(['open', 'under_review', 'evidence_requested', 'resolved', 'escalated']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

const auditQuery = z
  .object({
    resource: z.string().min(1).max(64).optional(),
    resource_id: z.string().uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  app.addHook('preHandler', makeAuthenticate(db));

  // ---------------------------------------------------------------- verification queue

  app.get('/admin/verifications', async (req) => {
    const auth = requireRole(req, 'verification_reviewer', 'trust_safety');
    const q = verificationQueueQuery.parse(req.query);
    const params: unknown[] = [];
    let where = '1=1';
    if (q.state) {
      params.push(q.state);
      where += ` AND v.state = $${params.length}`;
    }
    params.push(q.limit);
    params.push(q.offset);

    const res = await db.query<{
      id: string;
      user_id: string;
      state: string;
      id_type: string | null;
      reason_code: string | null;
      decided_at: Date | null;
      created_at: Date;
      attempts: string;
    }>(
      `SELECT v.id, v.user_id, v.state, v.id_type, v.reason_code, v.decided_at, v.created_at,
              (SELECT count(*)::text FROM verifications x WHERE x.user_id = v.user_id) AS attempts
       FROM verifications v WHERE ${where}
       ORDER BY v.created_at ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'admin.verification_queue_read',
      resource: 'verification',
      resourceId: null,
    });

    return {
      items: res.rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        state: r.state,
        id_type: r.id_type,
        reason_code: r.reason_code,
        attempts: Math.min(3, Number(r.attempts)),
        decided_at: toIsoOrNull(r.decided_at),
        created_at: toIso(r.created_at),
      })),
      page: { limit: q.limit, offset: q.offset },
    };
  });

  app.post<{ Params: { verificationId: string } }>(
    '/admin/verifications/:verificationId/decision',
    async (req, reply) => {
      const auth = requireRole(req, 'verification_reviewer', 'trust_safety');
      const body = decisionSchema.parse(req.body);

      const found = await db.query<{ id: string; user_id: string; state: string; id_type: string | null; decided_at: Date | null; created_at: Date }>(
        `SELECT * FROM verifications WHERE id = $1`,
        [req.params.verificationId],
      );
      const v = found.rows[0];
      if (!v) throw new AppError('NOT_FOUND');
      if (v.state !== 'pending') throw new AppError('CONFLICT', { reason: 'not_pending' }, 'This verification is already decided.');

      const nextState = body.decision === 'approve' ? 'verified' : body.decision === 'reject' ? 'rejected' : 'pending';

      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE verifications
             SET state = $2, reason_code = $3, reviewer_id = $4, decided_at = $5, updated_at = now()
           WHERE id = $1`,
          [v.id, nextState, body.reason_code, auth.userId, body.decision === 'request_more' ? null : new Date()],
        );
        if (body.decision === 'approve') {
          await tx.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'traveller') ON CONFLICT DO NOTHING`, [
            v.user_id,
          ]);
        }
      });

      await audit(db, {
        actorId: auth.userId,
        actorKind: 'support',
        action: `verification.${body.decision}`,
        resource: 'verification',
        resourceId: v.id,
        before: { state: v.state },
        after: { state: nextState, reason_code: body.reason_code },
      });

      // The person who submitted the ID is the one waiting on this. The reason code is a machine
      // label, so the notification names the outcome and the verification page explains it.
      if (body.decision !== 'request_more') {
        await queueNotification(db, {
          userId: v.user_id,
          templateId: body.decision === 'approve' ? 'verification_approved' : 'verification_rejected',
        });
      }

      const refreshed = await db.query<{
        id: string;
        user_id: string;
        state: string;
        id_type: string | null;
        reason_code: string | null;
        decided_at: Date | null;
        created_at: Date;
      }>(`SELECT * FROM verifications WHERE id = $1`, [v.id]);
      const row = refreshed.rows[0]!;

      return reply.code(200).send({
        id: row.id,
        user_id: row.user_id,
        state: row.state,
        id_type: row.id_type,
        reason_code: row.reason_code,
        attempts: 1,
        decided_at: toIsoOrNull(row.decided_at),
        created_at: toIso(row.created_at),
      });
    },
  );

  // ---------------------------------------------------------------- the documents themselves
  //
  // A reviewer cannot judge an identity without looking at it, and an identity document is the most
  // sensitive object this system holds. So the images are deliberately absent from the queue
  // payload: opening them is its own role-gated request, it writes its own audit entry, and what
  // comes back is a short-lived URL that grants one object for one TTL and nothing else.

  const DOCUMENT_KIND_LABELS: Record<string, string> = {
    id_front: 'ID document, front',
    id_back: 'ID document, back',
    selfie: 'Selfie with the document',
  };

  app.get<{ Params: { verificationId: string } }>('/admin/verifications/:verificationId/documents', async (req) => {
    const auth = requireRole(req, 'verification_reviewer', 'trust_safety');

    const found = await db.query<{
      id: string;
      user_id: string;
      state: string;
      id_type: string | null;
      reason_code: string | null;
      created_at: Date;
      attempts: string;
      name: string | null;
      email: string | null;
      phone_masked: string;
      risk_tier: number;
      fraud_flag: boolean;
      member_since: Date;
    }>(
      `SELECT v.id, v.user_id, v.state, v.id_type, v.reason_code, v.created_at,
              (SELECT count(*)::text FROM verifications x WHERE x.user_id = v.user_id) AS attempts,
              u.name, u.email, u.phone_masked, u.risk_tier, u.fraud_flag, u.created_at AS member_since
       FROM verifications v JOIN users u ON u.id = v.user_id
       WHERE v.id = $1`,
      [req.params.verificationId],
    );
    const v = found.rows[0];
    if (!v) throw new AppError('NOT_FOUND');

    const stored = await db.query<{
      id: string;
      kind: string;
      object_key: string;
      content_sha256: string;
      mime_type: string;
      byte_size: number;
      created_at: Date;
      purge_after: Date;
    }>(
      `SELECT id, kind, object_key, content_sha256, mime_type, byte_size, created_at, purge_after
       FROM verification_documents WHERE verification_id = $1 ORDER BY created_at ASC`,
      [v.id],
    );

    const documents = stored.rows.map((d) => {
      // The submission told the person their images would not be kept past this date. Once that
      // date has passed the console stops handing out reads, whether or not the bytes are still on
      // the volume — a retention promise the reviewer can quietly ignore is not a promise.
      const retained = d.purge_after.getTime() > Date.now();
      const signed = retained ? signObjectKey(d.object_key) : null;
      return {
        id: d.id,
        kind: d.kind,
        label: DOCUMENT_KIND_LABELS[d.kind] ?? 'Document',
        mime_type: d.mime_type,
        byte_size: d.byte_size,
        content_sha256: d.content_sha256,
        captured_at: toIso(d.created_at),
        purge_after: toIso(d.purge_after),
        view_url: signed?.url ?? null,
        view_expires_at: signed ? toIso(signed.expiresAt) : null,
      };
    });

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'admin.verification_documents_read',
      resource: 'verification',
      resourceId: v.id,
      // Kinds and counts, never object keys: the audit log is readable by more staff than the
      // documents are, and a key is a pointer into somebody's identity file.
      after: {
        owner: v.user_id,
        kinds: documents.map((d) => d.kind),
        withheld_past_retention: documents.filter((d) => !d.view_url).length,
      },
    });

    return {
      verification: {
        id: v.id,
        state: v.state,
        id_type: v.id_type,
        reason_code: v.reason_code,
        attempts: Math.min(3, Number(v.attempts)),
        created_at: toIso(v.created_at),
      },
      // What a reviewer is actually comparing: the name on the document against the name on the
      // account. The phone stays masked, because the reviewer never needs to reach the person.
      applicant: {
        user_id: v.user_id,
        name: v.name,
        email: v.email,
        phone_masked: v.phone_masked,
        risk_tier: v.risk_tier,
        fraud_flag: v.fraud_flag,
        member_since: toIso(v.member_since),
      },
      documents,
    };
  });

  // ---------------------------------------------------------------- bookings

  app.get('/admin/bookings', async (req) => {
    const auth = requireRole(req, 'support_agent', 'trust_safety', 'finance', 'admin_readonly');
    const q = adminBookingsQuery.parse(req.query);
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (q.status) {
      params.push(q.status);
      clauses.push(`b.status = $${params.length}`);
    }
    if (q.phone_hash) {
      params.push(q.phone_hash);
      clauses.push(
        `EXISTS (SELECT 1 FROM users u WHERE u.id IN (b.sender_id, b.traveller_id) AND u.phone_hash = $${params.length})`,
      );
    }
    if (q.created_from) {
      params.push(q.created_from);
      clauses.push(`b.created_at >= $${params.length}`);
    }
    params.push(q.limit);
    params.push(q.offset);

    const res = await db.query<{
      id: string;
      status: string;
      mode: string;
      agreed_total_paise: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT b.id, b.status, t.mode, b.agreed_total_paise, b.created_at, b.updated_at
       FROM bookings b JOIN trips t ON t.id = b.trip_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'admin.booking_search',
      resource: 'booking',
      resourceId: null,
      after: { filters: { status: q.status ?? null, created_from: q.created_from ? q.created_from.toISOString() : null } },
    });

    return {
      items: res.rows.map((r) => ({
        id: r.id,
        status: r.status,
        mode: r.mode,
        agreed_total_paise: Number(r.agreed_total_paise),
        created_at: toIso(r.created_at),
        updated_at: toIso(r.updated_at),
      })),
      page: { limit: q.limit, offset: q.offset },
    };
  });

  // ---------------------------------------------------------------- payouts

  // Records a second-approver sign-off so a subsequent release of a payout above
  // DUAL_APPROVAL_THRESHOLD_PAISE can reference it. The actor must already hold finance; the
  // release path additionally checks that the actor at release time is a different user.
  app.post<{ Params: { bookingId: string } }>('/admin/payouts/:bookingId/approve', async (req, reply) => {
    const auth = requireRole(req, 'finance');
    idempotencyKey(req);
    const bookingRes = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM bookings WHERE id = $1`,
      [req.params.bookingId],
    );
    const booking = bookingRes.rows[0];
    if (!booking) throw new AppError('NOT_FOUND');
    const payout = await db.query<{ amount_paise: number; state: string }>(
      `SELECT amount_paise, state FROM payouts WHERE booking_id = $1`,
      [booking.id],
    );
    const p = payout.rows[0];
    if (!p) throw new AppError('PAYOUT_NOT_ELIGIBLE', { reason: 'no_payout_row' });
    if (p.state === 'released' || p.state === 'void') throw new AppError('PAYOUT_NOT_ELIGIBLE', { state: p.state });

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'payout.approved',
      resource: 'payout',
      resourceId: booking.id,
      after: { amount_paise: Number(p.amount_paise), approver_roles: auth.roles },
    });

    return reply.code(201).send({ booking_id: booking.id, approved_by: auth.userId, amount_paise: Number(p.amount_paise) });
  });

  app.post<{ Params: { bookingId: string } }>('/admin/payouts/:bookingId/release', async (req, reply) => {
    const auth = requireRole(req, 'finance');
    const body = releaseSchema.parse(req.body);
    idempotencyKey(req);

    const bookingRes = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [req.params.bookingId]);
    const booking = bookingRes.rows[0];
    if (!booking) throw new AppError('NOT_FOUND');

    if (!(await isPayoutEligible(app, booking))) {
      throw new AppError('PAYOUT_NOT_ELIGIBLE', { status: booking.status });
    }

    const payout = await db.query<{
      state: string;
      amount_paise: number;
      provider_ref: string | null;
      released_at: Date | null;
      frozen_reason: string | null;
    }>(`SELECT state, amount_paise, provider_ref, released_at, frozen_reason FROM payouts WHERE booking_id = $1`, [
      booking.id,
    ]);
    const p = payout.rows[0];
    if (!p) throw new AppError('PAYOUT_NOT_ELIGIBLE', { reason: 'no_payout_row' });

    if (!config.PAYOUTS_ENABLED) {
      // Refuse before any state changes, so nothing in the system looks paid.
      throw new AppError('PAYOUTS_NOT_ENABLED', {
        reason: 'payouts_disabled_at_pilot',
        gate: 'GATE-3',
      });
    }

    if (p.amount_paise > config.DUAL_APPROVAL_THRESHOLD_PAISE) {
      // The approval_id is the id of a *different* finance approver whose prior audit-log entry
      // recorded a payout.approval event for this booking. A truthy string is not enough.
      if (!body.approval_id) {
        throw new AppError('APPROVAL_REQUIRED', { threshold_paise: config.DUAL_APPROVAL_THRESHOLD_PAISE });
      }
      if (body.approval_id === auth.userId) {
        throw new AppError('SELF_APPROVAL_FORBIDDEN');
      }
      const approver = await db.query<{ id: string }>(
        `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id
          WHERE u.id = $1 AND r.role = 'finance' AND u.status = 'active'`,
        [body.approval_id],
      );
      if (!approver.rows[0]) throw new AppError('NOT_FOUND', { reason: 'approver_not_finance', approval_id: body.approval_id });
      const prior = await db.query(
        `SELECT 1 FROM audit_log
          WHERE resource = 'payout' AND resource_id = $1 AND actor_id = $2 AND action = 'payout.approved'
          LIMIT 1`,
        [booking.id, body.approval_id],
      );
      if (prior.rows.length === 0) {
        throw new AppError('NOT_FOUND', { reason: 'no_prior_approval_event', booking_id: booking.id });
      }
    }

    // Unreachable while the pilot rail holds. Kept as the documented seam for the day a provider
    // is contracted; the guard above is the only thing that makes this branch live.
    await applyBookingTransition(app, booking, 'release', 'support', {
      actorId: auth.userId,
      reasonCode: body.reason_code,
      supportRole: 'finance',
    });
    await db.query(`UPDATE payouts SET state = 'released', released_at = now() WHERE booking_id = $1`, [booking.id]);

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'payout.released',
      resource: 'payout',
      resourceId: booking.id,
      after: { amount_paise: Number(p.amount_paise), reason_code: body.reason_code },
    });

    return reply.code(202).send({
      booking_id: booking.id,
      state: 'released',
      amount_paise: Number(p.amount_paise),
      provider_ref: p.provider_ref,
      released_at: toIso(new Date()),
      frozen_reason: null,
    });
  });

  // ---------------------------------------------------------------- direct UPI receipts

  /**
   * The bank line is the evidence. Finance reads the UTR off the statement, enters it here, and only
   * then does the payment become money in the journal. The UTR is unique across payments, so the same
   * statement line can never settle two bookings.
   */
  const receiptSchema = z
    .object({
      utr: z
        .string()
        .trim()
        .min(6)
        .max(30)
        .regex(/^[A-Za-z0-9]+$/, 'Use the bank reference exactly as it appears: letters and digits only.'),
      note: z.string().trim().max(300).optional(),
    })
    .strict();

  app.get('/admin/payments/upi-awaiting', async (req) => {
    requireRole(req, 'finance');

    const rows = await db.query<{
      payment_id: string;
      booking_id: string;
      amount_paise: number;
      reference: string | null;
      created_at: Date;
      booking_status: string;
      sender_name: string | null;
      sender_phone: string | null;
    }>(
      `SELECT p.id AS payment_id, p.booking_id, p.amount_paise, p.provider_ref AS reference, p.created_at,
              b.status AS booking_status, u.name AS sender_name, u.phone_masked AS sender_phone
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         JOIN users u ON u.id = b.sender_id
        WHERE p.provider = 'upi_direct' AND p.state = 'created'
        ORDER BY p.created_at ASC
        LIMIT 200`,
    );

    return {
      items: rows.rows.map((row) => ({
        payment_id: row.payment_id,
        booking_id: row.booking_id,
        amount_paise: Number(row.amount_paise),
        reference: row.reference,
        created_at: toIso(row.created_at),
        booking_status: row.booking_status,
        sender_name: row.sender_name,
        sender_phone: row.sender_phone,
      })),
    };
  });

  app.post<{ Params: { bookingId: string } }>('/admin/bookings/:bookingId/payment/receipt', async (req, reply) => {
    const auth = requireRole(req, 'finance');
    const body = receiptSchema.parse(req.body);
    const utr = body.utr.toUpperCase();

    const found = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [req.params.bookingId]);
    const booking = found.rows[0];
    if (!booking) throw new AppError('NOT_FOUND');
    if (booking.status !== 'delivered' && booking.status !== 'payment_pending') {
      throw new AppError('PAYMENT_NOT_PAYABLE', { status: booking.status });
    }

    const paymentRes = await db.query<{ id: string; amount_paise: number; provider_ref: string | null }>(
      `SELECT id, amount_paise, provider_ref FROM payments
        WHERE booking_id = $1 AND provider = 'upi_direct' AND state = 'created'
        ORDER BY created_at DESC LIMIT 1`,
      [booking.id],
    );
    const payment = paymentRes.rows[0];
    if (!payment) {
      // A second click on the same receipt is a repeat, not an unpayable booking. Say which.
      const settled = await db.query(
        `SELECT 1 FROM payments WHERE booking_id = $1 AND provider = 'upi_direct'
          AND state IN ('captured','refunded','partially_refunded')`,
        [booking.id],
      );
      if (settled.rows.length > 0) throw new AppError('PAYMENT_ALREADY_EXISTS');
      throw new AppError('PAYMENT_NOT_PAYABLE', { reason: 'no_awaiting_upi_payment' });
    }

    try {
      await db.transaction(async (tx) => {
        const updated = await tx.query(
          `UPDATE payments SET state = 'captured', provider_event_id = $2, updated_at = now()
            WHERE id = $1 AND state = 'created'`,
          [payment.id, utr],
        );
        if (updated.rowCount === 0) throw new AppError('PAYMENT_ALREADY_EXISTS');

        await tx.query(
          `INSERT INTO payment_ledger (booking_id, entry_type, amount_paise, provider_ref, memo)
           SELECT $1,'capture',$2,$3,$4
            WHERE NOT EXISTS (
              SELECT 1 FROM payment_ledger
               WHERE booking_id = $1 AND entry_type = 'capture' AND provider_ref = $3
            )`,
          [
            booking.id,
            payment.amount_paise,
            payment.provider_ref ?? payment.id,
            `UPI receipt ${utr}${body.note ? ` — ${body.note}` : ''}`,
          ],
        );

        await applyBookingTransition(withDb(app, tx), booking, 'payment_authorised', 'system', {
          actorId: auth.userId,
          reasonCode: 'upi_receipt_confirmed',
          metadata: { utr, reference: payment.provider_ref },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(
          'CONFLICT',
          { reason: 'utr_already_recorded', utr },
          'That bank reference is already recorded against another payment.',
        );
      }
      throw err;
    }

    const next = await db.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [booking.id]);

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'payment.upi_receipt_confirmed',
      resource: 'payment',
      resourceId: payment.id,
      after: {
        utr,
        amount_paise: Number(payment.amount_paise),
        reference: payment.provider_ref,
        booking_status: next.rows[0]?.status ?? booking.status,
      },
    });

    return reply.code(201).send({
      booking_id: booking.id,
      payment_id: payment.id,
      state: 'captured',
      utr,
      amount_paise: Number(payment.amount_paise),
      booking_status: next.rows[0]?.status ?? booking.status,
    });
  });

  // ---------------------------------------------------------------- refunds

  app.post('/admin/refunds', async (req, reply) => {
    const auth = requireRole(req, 'finance');
    const body = refundSchema.parse(req.body);

    const result = await withIdempotency(app.db, auth.userId, `refund:${body.booking_id}`, req, body, async () => {
      const captured = await db.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_paise), 0)::text AS total FROM payment_ledger
         WHERE booking_id = $1 AND entry_type = 'capture'`,
        [body.booking_id],
      );
      const refunded = await db.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_paise), 0)::text AS total FROM refunds
         WHERE payment_id IN (SELECT id FROM payments WHERE booking_id = $1)
           AND state IN ('pending_approval','pending','processed')`,
        [body.booking_id],
      );

      const capturedPaise = Number(captured.rows[0]?.total ?? 0);
      const refundedPaise = Number(refunded.rows[0]?.total ?? 0);
      if (body.amount_paise + refundedPaise > capturedPaise) {
        throw new AppError('REFUND_EXCEEDS_CAPTURED_AMOUNT', { captured_paise: capturedPaise, refunded_paise: refundedPaise });
      }

      const payment = await db.query<{ id: string }>(
        `SELECT id FROM payments WHERE booking_id = $1 AND state IN ('captured','authorised')
         ORDER BY created_at DESC LIMIT 1`,
        [body.booking_id],
      );
      const paymentId = payment.rows[0]?.id;
      if (!paymentId) throw new AppError('PAYMENT_NOT_PAYABLE', { reason: 'no_captured_payment' });

      const needsApproval = body.amount_paise > config.DUAL_APPROVAL_THRESHOLD_PAISE;
      const created = await db.query<{
        id: string;
        amount_paise: number;
        state: string;
        reason_code: string;
        approved_by: string | null;
        created_at: Date;
      }>(
        `INSERT INTO refunds (payment_id, amount_paise, reason_code, state, requested_by, note)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, amount_paise, state, reason_code, approved_by, created_at`,
        [paymentId, body.amount_paise, body.reason_code, needsApproval ? 'pending_approval' : 'pending', auth.userId, body.note ?? null],
      );
      const r = created.rows[0]!;

      await audit(db, {
        actorId: auth.userId,
        actorKind: 'support',
        action: 'refund.requested',
        resource: 'refund',
        resourceId: r.id,
        after: { amount_paise: body.amount_paise, state: r.state, reason_code: body.reason_code },
      });

      return {
        status: 201,
        body: {
          id: r.id,
          amount_paise: Number(r.amount_paise),
          state: r.state,
          reason_code: r.reason_code,
          approved_by: r.approved_by,
          created_at: toIso(r.created_at),
        },
      };
    });

    return reply.code(result.status).send(result.body);
  });

  /**
   * Second-approver action for a refund above the dual-approval threshold.
   * Additive: the contract describes the requirement but defines no approval endpoint
   * (docs/BUILD_NOTES.md, DEFECT-008).
   */
  app.post<{ Params: { refundId: string } }>('/admin/refunds/:refundId/approve', async (req, reply) => {
    const auth = requireRole(req, 'finance', 'admin_readonly');
    const found = await db.query<{
      id: string;
      state: string;
      requested_by: string | null;
      amount_paise: number;
      reason_code: string;
      created_at: Date;
    }>(`SELECT id, state, requested_by, amount_paise, reason_code, created_at FROM refunds WHERE id = $1`, [
      req.params.refundId,
    ]);
    const r = found.rows[0];
    if (!r) throw new AppError('NOT_FOUND');
    if (r.state !== 'pending_approval') throw new AppError('CONFLICT', { reason: 'not_pending_approval' });
    if (r.requested_by === auth.userId) throw new AppError('SELF_APPROVAL_FORBIDDEN');

    await db.query(`UPDATE refunds SET state = 'pending', approved_by = $2 WHERE id = $1`, [r.id, auth.userId]);
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'refund.approved',
      resource: 'refund',
      resourceId: r.id,
      before: { state: r.state },
      after: { state: 'pending' },
    });

    return reply.code(200).send({
      id: r.id,
      amount_paise: Number(r.amount_paise),
      state: 'pending',
      reason_code: r.reason_code,
      approved_by: auth.userId,
      created_at: toIso(r.created_at),
    });
  });

  // ---------------------------------------------------------------- disputes (additive, DEFECT-008)

  app.get('/admin/disputes', async (req) => {
    const auth = requireRole(req, 'support_agent', 'trust_safety', 'finance', 'admin_readonly');
    const q = disputeQueueQuery.parse(req.query);
    const params: unknown[] = [];
    let where = '1=1';
    if (q.state) {
      params.push(q.state);
      where += ` AND d.state = $${params.length}`;
    }
    params.push(q.limit);
    params.push(q.offset);

    const res = await db.query<{
      id: string;
      booking_id: string;
      category: string;
      description: string;
      state: string;
      outcome_code: string | null;
      raised_by: string;
      created_at: Date;
      resolved_at: Date | null;
    }>(
      `SELECT d.id, d.booking_id, d.category, d.description, d.state, d.outcome_code, d.raised_by,
              d.created_at, d.resolved_at
       FROM disputes d WHERE ${where} ORDER BY d.created_at ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Resolving a case without reading what both sides sent would be deciding blind. One extra
    // query for the whole page beats a per-row fetch.
    const ids = res.rows.map((r) => r.id);
    const evidenceRows = ids.length
      ? await db.query<{
          id: string;
          dispute_id: string;
          note: string;
          object_key: string | null;
          uploaded_by: string;
          created_at: Date;
        }>(
          `SELECT id, dispute_id, note, object_key, uploaded_by, created_at
           FROM dispute_evidence
           WHERE dispute_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})
           ORDER BY created_at ASC`,
          ids,
        )
      : { rows: [] as Array<{ id: string; dispute_id: string; note: string; object_key: string | null; uploaded_by: string; created_at: Date }> };

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'admin.dispute_queue_read',
      resource: 'dispute',
      resourceId: null,
    });

    return {
      items: res.rows.map((r) => ({
        id: r.id,
        booking_id: r.booking_id,
        category: r.category,
        description: r.description,
        state: r.state,
        outcome_code: r.outcome_code,
        created_at: toIso(r.created_at),
        resolved_at: toIsoOrNull(r.resolved_at),
        evidence: evidenceRows.rows
          .filter((e) => e.dispute_id === r.id)
          .map((e) => {
            const signed = e.object_key ? signObjectKey(e.object_key) : null;
            return {
              id: e.id,
              note: e.note,
              object_key: e.object_key,
              // A short-lived signed read URL. The console shows the photo; the URL expires and
              // grants exactly this object, so it is safe to hand to a browser.
              view_url: signed?.url ?? null,
              view_expires_at: signed ? toIso(signed.expiresAt) : null,
              // "opener" / "counterparty" is what a reviewer needs; user ids are noise here.
              side: e.uploaded_by === r.raised_by ? 'opener' : 'counterparty',
              created_at: toIso(e.created_at),
            };
          }),
      })),
      page: { limit: q.limit, offset: q.offset },
    };
  });

  app.post<{ Params: { disputeId: string } }>('/admin/disputes/:disputeId/resolve', async (req, reply) => {
    const auth = requireRole(req, 'support_agent', 'trust_safety');
    const body = resolveDisputeSchema.parse(req.body);

    const found = await db.query<{
      id: string;
      booking_id: string;
      state: string;
      category: string;
      created_at: Date;
    }>(`SELECT id, booking_id, state, category, created_at FROM disputes WHERE id = $1`, [req.params.disputeId]);
    const dispute = found.rows[0];
    if (!dispute) throw new AppError('NOT_FOUND');
    if (['resolved', 'closed'].includes(dispute.state)) throw new AppError('DISPUTE_CLOSED');

    const bookingRes = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [dispute.booking_id]);
    const booking = bookingRes.rows[0];
    if (!booking) throw new AppError('NOT_FOUND');

    // The UI used to offer "split", but there is no settlement design behind it: choosing it
    // applied the sender outcome and voided the whole payout row. Refuse rather than silently
    // do something the reviewer did not choose.
    if (body.outcome === 'split') throw new AppError('SPLIT_SETTLEMENT_NOT_ENABLED');

    const command = body.outcome === 'traveller' ? 'resolve_traveller' : 'resolve_sender';

    // One transaction: the booking move, the case state and the payout row describe a single
    // decision. A half-applied resolution is worse than a failed request.
    await db.transaction(async (tx) => {
      await applyBookingTransition(withDb(app, tx), booking, command, 'support', {
        actorId: auth.userId,
        reasonCode: body.outcome_code,
        supportRole: auth.roles.includes('trust_safety') ? 'trust_safety' : 'support_agent',
        metadata: { dispute_id: dispute.id, outcome: body.outcome },
      });

      await tx.query(
        `UPDATE disputes SET state = 'resolved', outcome_code = $2, resolved_at = now() WHERE id = $1`,
        [dispute.id, body.outcome_code],
      );
      await tx.query(
        `UPDATE payouts
         SET state = $2::payout_state,
             frozen_reason = CASE WHEN $2::payout_state = 'frozen' THEN frozen_reason ELSE NULL END
         WHERE booking_id = $1`,
        [booking.id, body.outcome === 'traveller' ? 'eligible' : 'void'],
      );
    });

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'dispute.resolved',
      resource: 'dispute',
      resourceId: dispute.id,
      before: { state: dispute.state },
      after: { state: 'resolved', outcome: body.outcome, outcome_code: body.outcome_code },
    });

    return reply.code(200).send({
      id: dispute.id,
      booking_id: dispute.booking_id,
      category: dispute.category,
      state: 'resolved',
      outcome_code: body.outcome_code,
      evidence: [],
      created_at: toIso(dispute.created_at),
      resolved_at: toIso(new Date()),
    });
  });

  // ---------------------------------------------------------------- incidents
  //
  // `report_incident` is available to both parties from `picked_up`, `in_transit`, `arrived` and
  // `delivery_attempt_failed`. Until this pair of routes existed, a booking could enter
  // `incident_open` but nothing in the product could take it out: `compensate` and `clear` are
  // support-only commands with no surface, so an escalated parcel stayed escalated forever with its
  // payout frozen. An openable queue is the point.

  const incidentQuery = z
    .object({
      state: z.enum(['incident_open', 'locked_for_review']).default('incident_open'),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    })
    .strict();

  app.get('/admin/incidents', async (req) => {
    requireRole(req, 'support_agent', 'trust_safety', 'admin_readonly');
    const q = incidentQuery.parse(req.query);

    const res = await db.query<{
      id: string;
      status: string;
      parcel_id: string;
      sender_name: string | null;
      traveller_name: string | null;
      agreed_total_paise: number;
      payout_state: string;
      updated_at: Date;
      opened_at: Date | null;
      opened_by_role: string | null;
      reason_code: string | null;
      capture_paise: string;
    }>(
      `SELECT b.id, b.status::text AS status, b.parcel_id, su.name AS sender_name, tu.name AS traveller_name,
              b.agreed_total_paise, COALESCE(p.state,'not_eligible') AS payout_state, b.updated_at,
              e.occurred_at AS opened_at, e.actor_kind AS opened_by_role, e.reason_code,
              (SELECT COALESCE(SUM(l.amount_paise),0)::text FROM payment_ledger l
                WHERE l.booking_id = b.id AND l.entry_type = 'capture') AS capture_paise
       FROM bookings b
       JOIN users su ON su.id = b.sender_id
       JOIN users tu ON tu.id = b.traveller_id
       LEFT JOIN payouts p ON p.booking_id = b.id
       LEFT JOIN LATERAL (
         SELECT ev.occurred_at, ev.actor_kind, ev.reason_code
         FROM booking_events ev
         WHERE ev.booking_id = b.id AND ev.to_state::text = $1
         ORDER BY ev.occurred_at DESC LIMIT 1
       ) e ON TRUE
       WHERE b.status::text = $1
       ORDER BY b.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [q.state, q.limit, q.offset],
    );

    return {
      items: res.rows.map((r) => ({
        booking_id: r.id,
        parcel_id: r.parcel_id,
        status: r.status,
        sender_name: r.sender_name,
        traveller_name: r.traveller_name,
        agreed_total_paise: r.agreed_total_paise,
        captured_paise: Number(r.capture_paise),
        payout_state: r.payout_state,
        opened_at: r.opened_at ? toIso(r.opened_at) : null,
        opened_by: r.opened_by_role,
        reason_code: r.reason_code,
        updated_at: toIso(r.updated_at),
      })),
      limit: q.limit,
      offset: q.offset,
    };
  });

  const resolveIncidentSchema = z
    .object({
      // `clear` = the parcel is accounted for and the traveller keeps their share.
      // `compensate` = the sender is made whole; it only exists when money was actually captured.
      action: z.enum(['clear', 'compensate']),
      reason_code: z.string().min(1).max(64),
      note: z.string().max(500).optional(),
    })
    .strict();

  app.post<{ Params: { bookingId: string } }>('/admin/bookings/:bookingId/incident', async (req, reply) => {
    const auth = requireRole(req, 'support_agent', 'trust_safety');
    const body = resolveIncidentSchema.parse(req.body);

    const found = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [req.params.bookingId]);
    const booking = found.rows[0];
    if (!booking) throw new AppError('NOT_FOUND');
    if (booking.status !== 'incident_open') {
      throw new AppError('CONFLICT', { status: booking.status }, 'This booking is not an open incident.');
    }

    let refundId: string | null = null;

    if (body.action === 'compensate') {
      const captured = await db.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_paise),0)::text AS total FROM payment_ledger
         WHERE booking_id = $1 AND entry_type = 'capture'`,
        [booking.id],
      );
      const capturedPaise = Number(captured.rows[0]?.total ?? 0);
      if (capturedPaise === 0) {
        // No capture means there is nothing to send back. Marking a booking `refunded` in that case
        // would put a state in the database that no money agrees with.
        throw new AppError(
          'PAYMENT_NOT_PAYABLE',
          { reason: 'no_captured_payment', booking_id: booking.id },
          'Nothing was captured for this booking, so it cannot be compensated. Use "clear" once the parcel is accounted for.',
        );
      }

      const payment = await db.query<{ id: string }>(
        `SELECT id FROM payments WHERE booking_id = $1 AND state = 'captured' ORDER BY created_at DESC LIMIT 1`,
        [booking.id],
      );
      const paymentId = payment.rows[0]?.id;
      if (!paymentId) throw new AppError('PAYMENT_NOT_PAYABLE', { reason: 'no_captured_payment' });

      const needsApproval = capturedPaise > config.DUAL_APPROVAL_THRESHOLD_PAISE;
      const created = await db.query<{ id: string }>(
        `INSERT INTO refunds (payment_id, amount_paise, reason_code, state, requested_by, note)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          paymentId,
          capturedPaise,
          body.reason_code,
          needsApproval ? 'pending_approval' : 'pending',
          auth.userId,
          body.note ?? null,
        ],
      );
      refundId = created.rows[0]!.id;
    }

    await db.transaction(async (tx) => {
      await applyBookingTransition(withDb(app, tx), booking, body.action, 'support', {
        actorId: auth.userId,
        reasonCode: body.reason_code,
        supportRole: auth.roles.includes('trust_safety') ? 'trust_safety' : 'support_agent',
        metadata: { refund_id: refundId, note: body.note ?? null },
      });
      await tx.query(
        `UPDATE payouts SET state = $2::payout_state, frozen_reason = NULL WHERE booking_id = $1`,
        [booking.id, body.action === 'clear' ? 'eligible' : 'void'],
      );
    });

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: `incident.${body.action}`,
      resource: 'booking',
      resourceId: booking.id,
      before: { status: booking.status },
      after: { status: body.action === 'clear' ? 'payout_eligible' : 'refunded', reason_code: body.reason_code, refund_id: refundId },
    });

    return reply.code(200).send({
      booking_id: booking.id,
      action: body.action,
      refund_id: refundId,
      reason_code: body.reason_code,
    });
  });

  // ---------------------------------------------------------------- chat review
  //
  // Staff read a booking's thread only through these two routes, and every read is audited. The
  // thread is not on the public web: `GET /bookings/:id/conversation*` answers 404 for anyone who is
  // not a member, staff included.

  app.get<{ Params: { bookingId: string } }>('/admin/bookings/:bookingId/messages', async (req) => {
    const auth = requireRole(req, 'support_agent', 'trust_safety', 'admin_readonly');
    const booking = await db.query<{ id: string }>(`SELECT id FROM bookings WHERE id = $1`, [req.params.bookingId]);
    if (!booking.rows[0]) throw new AppError('NOT_FOUND');

    const res = await db.query<{
      id: string;
      kind: string;
      body: string;
      sender_name: string | null;
      sender_role: string | null;
      created_at: Date;
      removed_at: Date | null;
      removed_reason: string | null;
    }>(
      `SELECT m.id, m.kind, m.body, u.name AS sender_name, cm.role::text AS sender_role,
              m.created_at, m.removed_at, m.removed_reason
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id AND c.booking_id = $1
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = m.sender_id
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT 500`,
      [req.params.bookingId],
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'admin.conversation_read',
      resource: 'booking',
      resourceId: req.params.bookingId,
      after: { message_count: res.rows.length },
    });

    return {
      booking_id: req.params.bookingId,
      items: res.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        sender_name: r.kind === 'system' ? 'Parcel Yatra' : (r.sender_name ?? 'A member'),
        sender_role: r.sender_role,
        created_at: toIso(r.created_at),
        removed_at: r.removed_at ? toIso(r.removed_at) : null,
        removed_reason: r.removed_reason,
      })),
    };
  });

  const removeMessageSchema = z.object({ reason_code: z.string().min(1).max(64) }).strict();

  app.post<{ Params: { messageId: string } }>('/admin/messages/:messageId/remove', async (req, reply) => {
    const auth = requireRole(req, 'trust_safety');
    const body = removeMessageSchema.parse(req.body);

    const found = await db.query<{ id: string; removed_at: Date | null }>(
      `SELECT removed_at FROM messages WHERE id = $1`,
      [req.params.messageId],
    );
    const message = found.rows[0];
    if (!message) throw new AppError('NOT_FOUND');
    // Refuse rather than re-stamp: a second removal would silently rewrite the moderation record.
    if (message.removed_at) throw new AppError('CONFLICT', { reason: 'already_removed' });

    await db.query(`UPDATE messages SET removed_at = now(), removed_by = $2, removed_reason = $3 WHERE id = $1`, [
      req.params.messageId,
      auth.userId,
      body.reason_code,
    ]);
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'message.removed',
      resource: 'message',
      resourceId: req.params.messageId,
      after: { reason_code: body.reason_code },
    });

    return reply.code(200).send({ id: req.params.messageId, removed: true, reason_code: body.reason_code });
  });

  // ---------------------------------------------------------------- audit log

  app.get('/admin/audit-log', async (req) => {
    const auth = requireRole(
      req,
      'admin_readonly',
      'finance',
      'trust_safety',
      'support_agent',
      'verification_reviewer',
    );
    const q = auditQuery.parse(req.query);
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (q.resource) {
      params.push(q.resource);
      clauses.push(`resource = $${params.length}`);
    }
    if (q.resource_id) {
      params.push(q.resource_id);
      clauses.push(`resource_id = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from);
      clauses.push(`created_at >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      clauses.push(`created_at <= $${params.length}`);
    }
    params.push(q.limit);
    params.push(q.offset);

    const res = await db.query<{
      id: string;
      actor_id: string | null;
      actor_kind: string;
      action: string;
      resource: string;
      resource_id: string | null;
      reason_code: string | null;
      created_at: Date;
    }>(
      // `id::text AS id` makes the bare name `id` resolve to the text output column, so
      // `ORDER BY id` sorted 9 above 39. Order by the table's own columns instead.
      `SELECT id::text AS id, actor_id, actor_kind, action, resource, resource_id, reason_code, created_at
       FROM audit_log ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY audit_log.created_at DESC, audit_log.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'admin.audit_log_read',
      resource: 'audit_log',
      resourceId: null,
    });

    return {
      items: res.rows.map((r) => ({
        id: Number(r.id),
        actor_id: r.actor_id,
        actor_kind: r.actor_kind,
        action: r.action,
        resource: r.resource,
        resource_id: r.resource_id,
        reason_code: r.reason_code,
        created_at: toIso(r.created_at),
      })),
      page: { limit: q.limit, offset: q.offset },
    };
  });
}

/**
 * Whether the money may actually leave. Shared with the webhook handler: a provider message saying a
 * payout succeeded is a report, not an authorisation, so both paths ask the same questions.
 */
export async function isPayoutEligible(app: FastifyInstance, booking: BookingRowFull): Promise<boolean> {
  if (booking.status !== 'payout_eligible') return false;

  const dispute = await app.db.query(
    `SELECT 1 FROM disputes WHERE booking_id = $1 AND state IN ('open','evidence_requested','under_review','appealed')`,
    [booking.id],
  );
  if (dispute.rows.length > 0) return false;

  const traveller = await app.db.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [booking.traveller_id]);
  if (traveller.rows[0]?.status !== 'active') return false;

  const captured = await app.db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount_paise),0)::text AS total FROM payment_ledger
     WHERE booking_id = $1 AND entry_type = 'capture'`,
    [booking.id],
  );
  return Number(captured.rows[0]?.total ?? 0) >= booking.traveller_share_paise;
}

/** Postgres unique violation. The UTR index is what stops one bank line settling two bookings. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
