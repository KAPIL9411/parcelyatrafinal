import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { safeEqual, webhookSignature } from '../lib/crypto.ts';
import { audit, queueNotification } from '../services/audit.ts';
import { applyBookingTransition, type BookingRowFull } from './bookings.ts';
import { isPayoutEligible } from './admin.ts';

const eventSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.enum([
      'payment.authorised',
      'payment.captured',
      'payment.failed',
      'payment.refunded',
      'payout.succeeded',
      'payout.failed',
    ]),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const TOLERANCE_SECONDS = 300;

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Keep the exact bytes: an HMAC over a re-serialised body is not the same signature.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    if (!body || body === '') return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post<{ Params: { provider: string } }>('/webhooks/payments/:provider', async (req, reply) => {
    const provider = req.params.provider;
    if (provider !== 'mock' && provider !== 'sandbox_provider') throw new AppError('NOT_FOUND');

    const signature = String(req.headers['x-provider-signature'] ?? '');
    const timestamp = String(req.headers['x-provider-timestamp'] ?? '');
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});

    if (!signature || !timestamp) throw new AppError('WEBHOOK_SIGNATURE_INVALID');

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
      throw new AppError('WEBHOOK_TIMESTAMP_INVALID');
    }
    const expected = webhookSignature(timestamp, rawBody);
    if (!safeEqual(expected, signature)) {
      req.log.warn({ provider }, 'webhook signature mismatch');
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('WEBHOOK_UNKNOWN_TYPE');
    const event = parsed.data;

    const db = app.db;

    // Replay protection: the provider event id is the idempotency key. A duplicate is a no-op.
    const claimed = await db.query(
      `INSERT INTO webhook_events (event_id, provider, type) VALUES ($1,$2,$3)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id, provider, event.type],
    );
    if (claimed.rows.length === 0) {
      return reply.code(200).send({ received: true, duplicate: true });
    }

    const payment = await db.query<{
      id: string;
      booking_id: string;
      state: string;
      amount_paise: number;
    }>(
      // Only the sandbox rail accepts this signature scheme. A real provider's payment must never be
      // captured by a webhook signed with the development secret.
      `SELECT id, booking_id, state, amount_paise FROM payments
        WHERE provider_ref = $1 AND provider IN ('mock','sandbox_provider')`,
      [String(event.data.provider_ref ?? '')],
    );

    const p = payment.rows[0];
    if (!p) {
      // Unknown reference: accept the event (so the provider stops retrying) but raise it.
      req.log.error({ event_id: event.id, type: event.type }, 'webhook for unknown payment reference');
      return reply.code(200).send({ received: true, applied: false });
    }

    const bookingRes = await db.query<BookingRowFull>(`SELECT * FROM bookings WHERE id = $1`, [p.booking_id]);
    const booking = bookingRes.rows[0];

    if (event.type === 'payment.authorised') {
      // Authorisation is a hold, not settled money. Record the state, do not confirm the booking.
      await db.query(`UPDATE payments SET state = 'authorised', updated_at = now() WHERE id = $1`, [p.id]);
    }

    if (event.type === 'payment.captured') {
      await db.query(`UPDATE payments SET state = 'captured', updated_at = now() WHERE id = $1`, [p.id]);

      // The journal is the money truth, and a capture is recorded exactly once per provider
      // reference even if the provider sends two different event ids for the same capture.
      await db.query(
        `INSERT INTO payment_ledger (booking_id, entry_type, amount_paise, provider_ref, memo)
         SELECT $1,'capture',$2,$3,'sandbox capture'
          WHERE NOT EXISTS (
            SELECT 1 FROM payment_ledger
             WHERE booking_id = $1 AND entry_type = 'capture' AND provider_ref = $3
          )`,
        [p.booking_id, p.amount_paise, String(event.data.provider_ref ?? '')],
      );

      if (booking && booking.status === 'payment_pending') {
        // Legacy bookings created before payment moved to the delivery step.
        await applyBookingTransition(app, booking, 'payment_authorised', 'system', {
          reasonCode: event.type,
          metadata: { provider_ref: String(event.data.provider_ref ?? '') },
        });
      } else if (booking && booking.status === 'delivered') {
        // The normal path now: the parcel is already delivered, so the capture is a self-edge. It
        // keeps the timeline honest and tells both sides that the money arrived.
        await applyBookingTransition(app, booking, 'payment_authorised', 'system', {
          reasonCode: event.type,
          metadata: { provider_ref: String(event.data.provider_ref ?? '') },
        });
      }
    }

    if (event.type === 'payment.failed') {
      await db.query(`UPDATE payments SET state = 'failed', updated_at = now() WHERE id = $1`, [p.id]);
      if (booking && booking.status === 'payment_pending') {
        // Only a booking that was waiting on payment can be cancelled by a failure. A delivered
        // parcel must never be cancelled because the sender's card was declined.
        await applyBookingTransition(app, booking, 'payment_failed', 'system', { reasonCode: 'provider_failed' });
      } else if (booking) {
        await queueNotification(db, {
          userId: booking.sender_id,
          bookingId: booking.id,
          templateId: 'payment_failed',
        });
      }
    }

    if (event.type === 'payment.refunded') {
      await db.query(`UPDATE payments SET state = 'refunded', updated_at = now() WHERE id = $1`, [p.id]);
      await db.query(
        `INSERT INTO payment_ledger (booking_id, entry_type, amount_paise, provider_ref, memo)
         VALUES ($1,'refund',$2,$3,'sandbox refund')`,
        [p.booking_id, -Math.abs(p.amount_paise), String(event.data.provider_ref ?? '')],
      );
      // The queue row this refund came from can now be closed. Nothing else ever moves a refund out
      // of `pending`, so without this the staff list fills with money that has already gone back.
      await db.query(
        `UPDATE refunds SET state = 'processed'
         WHERE id = (SELECT id FROM refunds
                      WHERE payment_id = $1 AND state IN ('pending','pending_approval')
                      ORDER BY amount_paise DESC, created_at LIMIT 1)`,
        [p.id],
      );
    }

    if (event.type === 'payout.succeeded' || event.type === 'payout.failed') {
      if (!booking) throw new AppError('NOT_FOUND', { reason: 'unknown_booking' });

      // A provider notice reports that money moved; it does not authorise it to move. The pilot
      // refuses payouts at the rail, so a payout event arriving here is a misconfiguration or an
      // attack, and either way nothing in the database may claim the traveller was paid.
      const blocked: string | null = !config.PAYOUTS_ENABLED
        ? 'payouts_disabled_at_pilot'
        : !(await isPayoutEligible(app, booking))
          ? 'payout_not_eligible'
          : null;

      if (blocked) {
        await audit(db, {
          actorId: null,
          actorKind: 'system',
          action: `webhook.${event.type}.refused`,
          resource: 'booking',
          resourceId: booking.id,
          reasonCode: blocked,
          after: { event_id: event.id, status: booking.status },
        });
        req.log.error({ event_id: event.id, type: event.type, reason: blocked }, 'payout event refused: payout controls failed');
        return reply.code(200).send({ received: true, applied: false, reason: blocked });
      }

      if (event.type === 'payout.succeeded') {
        await db.query(
          `UPDATE payouts SET state = 'released', released_at = now(), provider_ref = $2, frozen_reason = NULL
           WHERE booking_id = $1`,
          [p.booking_id, String(event.data.provider_ref ?? event.id)],
        );
        if (booking.status === 'payout_eligible') {
          await applyBookingTransition(app, booking, 'release', 'system', { reasonCode: 'payout_succeeded' });
        }
      } else {
        await db.query(`UPDATE payouts SET state = 'eligible', frozen_reason = 'provider_failed' WHERE booking_id = $1`, [
          p.booking_id,
        ]);
      }
    }

    await audit(db, {
      actorId: null,
      actorKind: 'system',
      action: `webhook.${event.type}`,
      resource: 'payment',
      resourceId: p.id,
      reasonCode: event.id,
    });

    req.log.info({ event_id: event.id, type: event.type, sandbox: true }, 'webhook processed');
    return reply.code(200).send({ received: true });
  });
}
