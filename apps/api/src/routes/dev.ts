import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { makeAuthenticate, requireAuth, requireRole } from '../lib/auth.ts';
import { recallCode } from '../lib/dev-store.ts';
import { randomToken, webhookSignature } from '../lib/crypto.ts';
import { seedDatabase } from '../db/seed.ts';
import { applyBookingTransition, ensureHandoverOtp, type BookingRowFull } from './bookings.ts';

/**
 * Development endpoints.
 *
 * These exist so a demo can be driven end to end without an SMS gateway or a payment provider.
 * They are registered only when ENABLE_DEV_ENDPOINTS is true, and `assertSafetyRails` refuses to
 * start in production with that flag on. Nothing here is a production feature.
 */

const simulateSchema = z
  .object({
    type: z.enum(['payment.authorised', 'payment.captured', 'payment.failed', 'payment.refunded']),
    provider_ref: z.string().min(1).max(128),
    event_id: z.string().min(1).max(128).optional(),
  })
  .strict();

export async function devRoutes(app: FastifyInstance): Promise<void> {
  if (config.NODE_ENV === 'production') throw new Error('dev routes must not be registered in production');
  const db = app.db;
  const authenticate = makeAuthenticate(db);

  // ---- OTP peek. Only the in-memory dev store is read; the database holds HMACs only.

  app.get<{ Params: { challengeId: string } }>('/dev/otp/:challengeId', async (req) => {
    const hit = recallCode(req.params.challengeId);
    if (!hit) throw new AppError('NOT_FOUND', { reason: 'code_not_in_dev_store' });
    return { challenge_id: req.params.challengeId, code: hit.code, kind: hit.kind, sandbox: true };
  });

  app.get<{ Params: { bookingId: string; phase: string } }>(
    '/dev/handover-otp/:bookingId/:phase',
    { preHandler: authenticate },
    async (req) => {
      const phase = req.params.phase === 'pickup' || req.params.phase === 'delivery' ? req.params.phase : null;
      if (!phase) throw new AppError('VALIDATION_FAILED', { reason: 'phase' });
      const hit = recallCode(`${req.params.bookingId}:${phase}`);
      if (!hit) throw new AppError('NOT_FOUND', { reason: 'code_not_in_dev_store' });
      return { booking_id: req.params.bookingId, phase, code: hit.code, sandbox: true };
    },
  );

  // ---- Webhook simulation: signs the exact body and calls the real webhook route.

  app.post('/dev/webhooks/simulate', async (req, reply) => {
    const body = simulateSchema.parse(req.body);
    const eventId = body.event_id ?? `evt_dev_${randomUUID()}`;
    const payload = {
      id: eventId,
      type: body.type,
      data: { provider_ref: body.provider_ref },
    };
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = webhookSignature(timestamp, raw);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/payments/mock',
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': signature,
        'x-provider-timestamp': timestamp,
      },
      payload: raw,
    });

    return reply.code(res.statusCode).send({
      simulated: true,
      event_id: eventId,
      type: body.type,
      webhook_status: res.statusCode,
      webhook_body: res.json(),
    });
  });

  // ---- Advance a booking through the next step, supplying what a human would supply.

  app.post<{ Params: { bookingId: string } }>('/dev/bookings/:bookingId/advance', { preHandler: authenticate }, async (req, reply) => {
    const auth = requireAuth(req);
    const found = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [req.params.bookingId]);
    const booking = found.rows[0];
    if (!booking) throw new AppError('NOT_FOUND');
    if (booking.sender_id !== auth.userId && booking.traveller_id !== auth.userId) {
      const staff = auth.roles.some((r) =>
        ['support_agent', 'trust_safety', 'finance', 'admin_readonly', 'verification_reviewer'].includes(r),
      );
      if (!staff) throw new AppError('NOT_FOUND');
    }

    const isSender = booking.sender_id === auth.userId;
    const actor = isSender ? 'sender' : 'traveller';

    switch (booking.status) {
      case 'pending_traveller_acceptance': {
        await applyBookingTransition(app, booking, 'accept', 'traveller', { actorId: auth.userId });
        break;
      }
      case 'payment_pending': {
        const payment = await db.query<{ id: string; provider_ref: string | null }>(
          `SELECT id, provider_ref FROM payments WHERE booking_id = $1 AND state <> 'failed' ORDER BY created_at DESC LIMIT 1`,
          [booking.id],
        );
        let providerRef = payment.rows[0]?.provider_ref ?? null;
        if (!providerRef) {
          providerRef = `mock_pi_${randomToken(12)}`;
          await db.query(
            `INSERT INTO payments (booking_id, provider, provider_ref, state, amount_paise, currency, sandbox)
             VALUES ($1,'mock',$2,'created',$3,'INR',true)`,
            [booking.id, providerRef, booking.agreed_total_paise],
          );
        }
        await db.query(`UPDATE payments SET state = 'captured', updated_at = now() WHERE provider_ref = $1`, [
          providerRef,
        ]);
        await db.query(
          `INSERT INTO payment_ledger (booking_id, entry_type, amount_paise, provider_ref, memo)
           VALUES ($1,'capture',$2,$3,'dev capture')`,
          [booking.id, booking.agreed_total_paise, providerRef],
        );
        await applyBookingTransition(app, booking, 'payment_authorised', 'system', {
          reasonCode: 'dev_simulated',
          metadata: { provider_ref: providerRef },
        });
        break;
      }
      case 'confirmed': {
        await applyBookingTransition(app, booking, 'open_pickup', 'system', {});
        break;
      }
      case 'pickup_ready': {
        await ensureHandoverOtp(app, booking.id, 'pickup');
        const code = recallCode(`${booking.id}:pickup`)?.code;
        if (!code) throw new AppError('OTP_NOT_APPLICABLE', { reason: 'no_dev_code' });
        // Consume the code exactly as the traveller would.
        await db.query(`UPDATE handover_otps SET used_at = now() WHERE booking_id = $1 AND phase = 'pickup'`, [
          booking.id,
        ]);
        await db.query(`UPDATE handovers SET pickup_at = now(), pickup_photo_key = $2 WHERE booking_id = $1`, [
          booking.id,
          `dev/parcel_sealed/${booking.id}.jpg`,
        ]);
        await applyBookingTransition(app, booking, 'confirm_pickup', 'traveller', {
          actorId: booking.traveller_id,
          otpValid: true,
          photoPresent: true,
          metadata: { dev: true },
        });
        break;
      }
      case 'picked_up': {
        await applyBookingTransition(app, booking, 'start_transit', 'traveller', { actorId: booking.traveller_id });
        break;
      }
      case 'in_transit': {
        await applyBookingTransition(app, booking, 'arrive', 'traveller', { actorId: booking.traveller_id });
        break;
      }
      case 'arrived': {
        await ensureHandoverOtp(app, booking.id, 'delivery');
        const code = recallCode(`${booking.id}:delivery`)?.code;
        if (!code) throw new AppError('OTP_NOT_APPLICABLE', { reason: 'no_dev_code' });
        await db.query(`UPDATE handover_otps SET used_at = now() WHERE booking_id = $1 AND phase = 'delivery'`, [
          booking.id,
        ]);
        await db.query(`UPDATE handovers SET delivered_at = now(), delivery_photo_key = $2 WHERE booking_id = $1`, [
          booking.id,
          `dev/parcel_delivery/${booking.id}.jpg`,
        ]);
        await applyBookingTransition(app, booking, 'confirm_delivery', 'traveller', {
          actorId: booking.traveller_id,
          otpValid: true,
          photoPresent: true,
          metadata: { dev: true },
        });
        break;
      }
      case 'delivery_attempt_failed': {
        await applyBookingTransition(app, booking, 'escalate', 'system', {});
        break;
      }
      case 'delivered': {
        // Move the dispute deadline into the past so settlement can be demonstrated.
        await db.query(`UPDATE bookings SET dispute_deadline = now() - interval '1 minute' WHERE id = $1`, [
          booking.id,
        ]);
        await applyBookingTransition(app, booking, 'settle_window', 'system', {});
        break;
      }
      default:
        throw new AppError('INVALID_TRANSITION', { status: booking.status });
    }

    const fresh = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [booking.id]);
    return reply.code(200).send({
      booking_id: booking.id,
      from: booking.status,
      to: fresh.rows[0]?.status ?? booking.status,
      advanced_by: actor,
      sandbox: true,
    });
  });

  // ---- Seed helpers

  app.post('/dev/seed/reset', { config: { rateLimit: false }, preHandler: authenticate }, async (_req, reply) => {
    requireRole(_req, 'admin_readonly', 'trust_safety', 'support_agent');
    await db.exec(`
      TRUNCATE TABLE
        dispute_evidence, disputes, reviews, refunds, payment_ledger, payments, webhook_events,
        handover_otps, handovers, booking_events, payouts, bookings, quotes, parcels, trips,
        idempotency_keys, notifications, audit_log, jobs, outbox, feature_flags,
        verification_documents, verifications, payout_accounts, consents, otp_challenges,
        sessions, user_roles, users, areas, cities
      RESTART IDENTITY CASCADE;
    `);
    await seedDatabase(db);
    return reply.code(200).send({ reset: true, seeded: true });
  });
}
