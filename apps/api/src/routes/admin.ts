import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { makeAuthenticate, requireRole } from '../lib/auth.ts';
import { toIso, toIsoOrNull } from '../lib/serialize.ts';
import { withDb } from '../lib/db-scope.ts';
import { idempotencyKey, withIdempotency } from '../lib/idempotency.ts';
import { audit } from '../services/audit.ts';
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

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  app.addHook('preHandler', makeAuthenticate(db));

  // ---------------------------------------------------------------- verification queue

  app.get<{ Querystring: { state?: string; limit?: string } }>('/admin/verifications', async (req) => {
    const auth = requireRole(req, 'verification_reviewer', 'trust_safety');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const params: unknown[] = [];
    let where = '1=1';
    if (req.query.state) {
      params.push(req.query.state);
      where += ` AND v.state = $${params.length}`;
    }
    params.push(limit);

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
       ORDER BY v.created_at ASC LIMIT $${params.length}`,
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

  // ---------------------------------------------------------------- bookings

  app.get<{
    Querystring: { status?: string; phone_hash?: string; created_from?: string; limit?: string };
  }>('/admin/bookings', async (req) => {
    const auth = requireRole(req, 'support_agent', 'trust_safety', 'finance', 'admin_readonly');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (req.query.status) {
      params.push(req.query.status);
      clauses.push(`b.status = $${params.length}`);
    }
    if (req.query.phone_hash) {
      params.push(req.query.phone_hash);
      clauses.push(
        `EXISTS (SELECT 1 FROM users u WHERE u.id IN (b.sender_id, b.traveller_id) AND u.phone_hash = $${params.length})`,
      );
    }
    if (req.query.created_from) {
      params.push(new Date(req.query.created_from));
      clauses.push(`b.created_at >= $${params.length}`);
    }
    params.push(limit);

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
       ORDER BY b.created_at DESC LIMIT $${params.length}`,
      params,
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'admin.booking_search',
      resource: 'booking',
      resourceId: null,
      after: { filters: { status: req.query.status ?? null, created_from: req.query.created_from ?? null } },
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
    };
  });

  // ---------------------------------------------------------------- payouts

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

    if (p.amount_paise > config.DUAL_APPROVAL_THRESHOLD_PAISE && !body.approval_id) {
      throw new AppError('APPROVAL_REQUIRED', { threshold_paise: config.DUAL_APPROVAL_THRESHOLD_PAISE });
    }

    if (!config.PAYOUTS_ENABLED) {
      // Refuse before any state changes, so nothing in the system looks paid.
      throw new AppError('PAYOUTS_NOT_ENABLED', {
        reason: 'payouts_disabled_at_pilot',
        gate: 'GATE-3',
      });
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

  app.get<{ Querystring: { state?: string; limit?: string } }>('/admin/disputes', async (req) => {
    const auth = requireRole(req, 'support_agent', 'trust_safety', 'finance', 'admin_readonly');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const params: unknown[] = [];
    let where = '1=1';
    if (req.query.state) {
      params.push(req.query.state);
      where += ` AND d.state = $${params.length}`;
    }
    params.push(limit);

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
       FROM disputes d WHERE ${where} ORDER BY d.created_at ASC LIMIT $${params.length}`,
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
        supportRole: auth.roles.includes('trust_safety') ? 'trust_safety' : 'support_lead',
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

  // ---------------------------------------------------------------- audit log

  app.get<{
    Querystring: { resource?: string; resource_id?: string; from?: string; to?: string; limit?: string };
  }>('/admin/audit-log', async (req) => {
    const auth = requireRole(
      req,
      'admin_readonly',
      'finance',
      'trust_safety',
      'support_agent',
      'verification_reviewer',
    );
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100) || 100));
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (req.query.resource) {
      params.push(req.query.resource);
      clauses.push(`resource = $${params.length}`);
    }
    if (req.query.resource_id) {
      params.push(req.query.resource_id);
      clauses.push(`resource_id = $${params.length}`);
    }
    if (req.query.from) {
      params.push(new Date(req.query.from));
      clauses.push(`created_at >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(new Date(req.query.to));
      clauses.push(`created_at <= $${params.length}`);
    }
    params.push(limit);

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
       ORDER BY audit_log.created_at DESC, audit_log.id DESC LIMIT $${params.length}`,
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
    };
  });
}

async function isPayoutEligible(app: FastifyInstance, booking: BookingRowFull): Promise<boolean> {
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
