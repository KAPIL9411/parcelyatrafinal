import type { FastifyInstance } from 'fastify';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { randomToken } from '../lib/crypto.ts';
import { toIso } from '../lib/serialize.ts';
import { withIdempotency } from '../lib/idempotency.ts';
import { audit } from '../services/audit.ts';

/**
 * Sandbox payment intents.
 *
 * The amount always comes from the stored quote. A client-supplied amount is never read, and the
 * request body is empty by design. `sandbox` is true for every pilot payment and the UI must label
 * it as test mode.
 */
export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.post<{ Params: { bookingId: string } }>('/bookings/:bookingId/payment-intent', async (req, reply) => {
    const auth = requireAuth(req);

    const booking = await db.query<{
      id: string;
      sender_id: string;
      status: string;
      quote_id: string;
      agreed_total_paise: number;
    }>(`SELECT id, sender_id, status, quote_id, agreed_total_paise FROM bookings WHERE id = $1`, [req.params.bookingId]);

    const b = booking.rows[0];
    if (!b || b.sender_id !== auth.userId) throw new AppError('NOT_FOUND');

    if (!config.FEATURE_PAYMENTS_ENABLED) throw new AppError('PAYMENTS_NOT_ENABLED');
    if (config.PAYMENTS_LIVE) throw new AppError('PAYMENTS_NOT_ENABLED', { reason: 'live_payments_not_permitted_at_pilot' });
    if (b.status !== 'payment_pending') throw new AppError('PAYMENT_NOT_PAYABLE', { status: b.status });

    const result = await withIdempotency(app.db, auth.userId, `payment_intent:${b.id}`, req, {}, async () => {
      const existing = await db.query<{ id: string }>(`SELECT id FROM payments WHERE booking_id = $1 AND state <> 'failed'`, [b.id]);
      if (existing.rows[0]) throw new AppError('PAYMENT_ALREADY_EXISTS', { payment_id: existing.rows[0].id });

      // Amount is read from the immutable quote, never from the request.
      const quote = await db.query<{ total_paise: number }>(`SELECT total_paise FROM quotes WHERE id = $1`, [b.quote_id]);
      const amount = Number(quote.rows[0]?.total_paise ?? 0);
      if (amount <= 0) throw new AppError('PAYMENT_NOT_PAYABLE', { reason: 'no_quote' });

      const providerRef = `mock_pi_${randomToken(12)}`;
      const clientSecret = `mock_secret_${randomToken(16)}`;
      const inserted = await db.query<{ id: string; created_at: Date }>(
        `INSERT INTO payments (booking_id, provider, provider_ref, state, amount_paise, currency, sandbox, client_secret)
         VALUES ($1,$2,$3,'created',$4,'INR',true,$5) RETURNING id, created_at`,
        [b.id, config.PAYMENT_PROVIDER, providerRef, amount, clientSecret],
      );

      await audit(db, {
        actorId: auth.userId,
        actorKind: 'user',
        action: 'payment.intent_created',
        resource: 'payment',
        resourceId: inserted.rows[0]!.id,
        after: { amount_paise: amount, provider: config.PAYMENT_PROVIDER, sandbox: true },
      });

      return {
        status: 201,
        body: {
          id: inserted.rows[0]!.id,
          state: 'created',
          amount_paise: amount,
          currency: 'INR',
          provider: config.PAYMENT_PROVIDER,
          sandbox: true,
          client_secret: clientSecret,
          provider_ref: providerRef,
          created_at: toIso(inserted.rows[0]!.created_at),
        },
      };
    });

    return reply.code(result.status).send(result.body);
  });
}
