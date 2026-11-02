import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { DISPUTE_CATEGORIES } from '@py/domain';

import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { toIso, toIsoOrNull } from '../lib/serialize.ts';
import { withDb } from '../lib/db-scope.ts';
import { withIdempotency } from '../lib/idempotency.ts';
import { keyBelongsTo } from '../lib/storage.ts';
import { audit, queueNotification } from '../services/audit.ts';
import { applyBookingTransition, type BookingRowFull } from './bookings.ts';

const createSchema = z
  .object({
    booking_id: z.string().uuid(),
    category: z.enum(DISPUTE_CATEGORIES),
    description: z.string().min(10).max(2000),
  })
  .strict();

const evidenceSchema = z
  .object({
    note: z.string().min(1).max(1000),
    object_key: z.string().max(256).optional(),
  })
  .strict();

interface DisputeRow {
  id: string;
  booking_id: string;
  raised_by: string;
  category: string;
  description: string;
  state: string;
  outcome_code: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

interface EvidenceRow {
  id: string;
  note: string;
  object_key: string | null;
  created_at: Date;
}

async function loadEvidence(app: FastifyInstance, disputeId: string) {
  const res = await app.db.query<EvidenceRow>(
    `SELECT id, note, object_key, created_at FROM dispute_evidence
     WHERE dispute_id = $1 ORDER BY created_at ASC`,
    [disputeId],
  );
  return res.rows.map((e) => ({
    id: e.id,
    note: e.note,
    object_key: e.object_key,
    created_at: toIso(e.created_at),
  }));
}

async function disputeView(app: FastifyInstance, row: DisputeRow) {
  return {
    id: row.id,
    booking_id: row.booking_id,
    category: row.category,
    state: row.state,
    outcome_code: row.outcome_code,
    evidence: await loadEvidence(app, row.id),
    created_at: toIso(row.created_at),
    resolved_at: toIsoOrNull(row.resolved_at),
  };
}

/** Both parties to the booking, and only them, may see a dispute. */
async function loadForParty(app: FastifyInstance, disputeId: string, userId: string): Promise<DisputeRow> {
  const res = await app.db.query<DisputeRow>(
    `SELECT d.* FROM disputes d
     JOIN bookings b ON b.id = d.booking_id
     WHERE d.id = $1 AND (b.sender_id = $2 OR b.traveller_id = $2)`,
    [disputeId, userId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND'); // resource non-disclosure
  return row;
}

export async function disputeRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.post('/disputes', async (req, reply) => {
    const auth = requireAuth(req);
    const body = createSchema.parse(req.body);

    const result = await withIdempotency(app.db, auth.userId, `create_dispute:${body.booking_id}`, req, body, async () => {
      const bookingRes = await db.query<BookingRowFull & { dispute_deadline: Date | null; delivered_at: Date | null }>(
        `SELECT * FROM bookings WHERE id = $1`,
        [body.booking_id],
      );
      const booking = bookingRes.rows[0];
      if (!booking) throw new AppError('NOT_FOUND');
      const isParty = booking.sender_id === auth.userId || booking.traveller_id === auth.userId;
      if (!isParty) throw new AppError('NOT_FOUND');

      // The state machine allows `raise_dispute` only from `delivered`. Accepting other finished
      // states here produced a 409 from the transition after the route had already said yes.
      if (booking.status !== 'delivered') {
        throw new AppError('DISPUTE_WINDOW_CLOSED', { status: booking.status });
      }
      if (booking.dispute_deadline && Date.now() > new Date(booking.dispute_deadline).getTime()) {
        throw new AppError('DISPUTE_WINDOW_CLOSED', { deadline: toIso(booking.dispute_deadline) });
      }

      const open = await db.query(
        `SELECT 1 FROM disputes WHERE booking_id = $1 AND state IN ('open','evidence_requested','under_review')`,
        [booking.id],
      );
      if (open.rows.length > 0) throw new AppError('DISPUTE_ALREADY_OPEN');

      // The case row, the payout freeze and the booking move are one act. If any part fails the
      // person sees an error and nothing changed.
      const dispute = await db.transaction(async (tx) => {
        const created = await tx.query<DisputeRow>(
          `INSERT INTO disputes (booking_id, raised_by, category, description, state)
           VALUES ($1,$2,$3,$4,'open') RETURNING *`,
          [booking.id, auth.userId, body.category, body.description],
        );
        const row = created.rows[0]!;

        await tx.query(`UPDATE payouts SET state = 'frozen', frozen_reason = 'dispute_open' WHERE booking_id = $1`, [
          booking.id,
        ]);

        if (booking.status !== 'disputed') {
          const actor = booking.sender_id === auth.userId ? 'sender' : 'traveller';
          await applyBookingTransition(withDb(app, tx), booking, 'raise_dispute', actor, {
            actorId: auth.userId,
            reasonCode: body.category,
            metadata: { dispute_id: row.id },
          });
        }
        return row;
      });

      await queueNotification(db, {
        userId: booking.sender_id === auth.userId ? booking.traveller_id : booking.sender_id,
        bookingId: booking.id,
        templateId: 'dispute_opened',
      });
      await audit(db, {
        actorId: auth.userId,
        actorKind: 'user',
        action: 'dispute.opened',
        resource: 'dispute',
        resourceId: dispute.id,
        after: { category: body.category, booking_id: booking.id },
      });

      return { status: 201, body: await disputeView(app, dispute) };
    });

    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { disputeId: string } }>('/disputes/:disputeId', async (req) => {
    const auth = requireAuth(req);
    const row = await loadForParty(app, req.params.disputeId, auth.userId);
    return disputeView(app, row);
  });

  app.post<{ Params: { disputeId: string } }>('/disputes/:disputeId/evidence', async (req, reply) => {
    const auth = requireAuth(req);
    const body = evidenceSchema.parse(req.body);
    const dispute = await loadForParty(app, req.params.disputeId, auth.userId);

    if (['resolved', 'closed'].includes(dispute.state)) throw new AppError('DISPUTE_CLOSED');
    if (body.object_key && !keyBelongsTo(body.object_key, auth.userId)) {
      throw new AppError('VALIDATION_FAILED', { field: 'object_key' }, 'Upload the evidence again from this account.');
    }

    const created = await db.query<EvidenceRow>(
      `INSERT INTO dispute_evidence (dispute_id, uploaded_by, object_key, note)
       VALUES ($1,$2,$3,$4) RETURNING id, note, object_key, created_at`,
      [dispute.id, auth.userId, body.object_key ?? null, body.note],
    );
    const row = created.rows[0]!;

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'dispute.evidence_added',
      resource: 'dispute',
      resourceId: dispute.id,
    });

    return reply.code(201).send({
      id: row.id,
      note: row.note,
      object_key: row.object_key,
      created_at: toIso(row.created_at),
    });
  });
}
