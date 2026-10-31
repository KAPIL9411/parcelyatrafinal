import type { FastifyInstance } from 'fastify';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { randomToken } from '../lib/crypto.ts';
import { toIso } from '../lib/serialize.ts';
import { withIdempotency } from '../lib/idempotency.ts';
import { audit } from '../services/audit.ts';
import { newUpiReference, upiPaymentLink } from '../services/upi.ts';

/**
 * Payment intents.
 *
 * The amount always comes from the stored quote. A client-supplied amount is never read, and the
 * request body is empty by design.
 *
 * Two providers exist. `mock` fabricates a reference and is only ever driven by the signed sandbox
 * webhook. `upi_direct` returns a UPI intent link plus the merchant handle: the payer's own bank app
 * moves the money, and a finance operator records the UTR once it appears on the statement. No code
 * path here settles a booking on the payer's word alone.
 *
 * Payment is collected after delivery. `payment_pending` stays in the list only for bookings that
 * were created before the flow changed; `delivered` is the normal entry point now. `disputed` and
 * `payout_eligible` are allowed so a sender can still settle a delivery that was already handed over
 * while a case was open.
 */
const PAYABLE_STATUSES = ['payment_pending', 'delivered', 'disputed', 'payout_eligible'] as const;

const UPI_REFERENCE_ATTEMPTS = 5;

interface PaymentIntentResponse {
  id: string;
  state: string;
  amount_paise: number;
  currency: 'INR';
  provider: 'mock' | 'sandbox_provider' | 'upi_direct';
  sandbox: boolean;
  client_secret: string | null;
  provider_ref: string;
  payment_link: string | null;
  payee: { vpa: string; name: string } | null;
  created_at: string;
}

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
    if (!(PAYABLE_STATUSES as readonly string[]).includes(b.status)) {
      throw new AppError('PAYMENT_NOT_PAYABLE', { status: b.status });
    }

    const result = await withIdempotency<PaymentIntentResponse>(
      app.db,
      auth.userId,
      `payment_intent:${b.id}`,
      req,
      {},
      async () => {
      const existing = await db.query<{ id: string }>(`SELECT id FROM payments WHERE booking_id = $1 AND state <> 'failed'`, [b.id]);
      if (existing.rows[0]) throw new AppError('PAYMENT_ALREADY_EXISTS', { payment_id: existing.rows[0].id });

      // Amount is read from the immutable quote, never from the request.
      const quote = await db.query<{ total_paise: number }>(`SELECT total_paise FROM quotes WHERE id = $1`, [b.quote_id]);
      const amount = Number(quote.rows[0]?.total_paise ?? 0);
      if (amount <= 0) throw new AppError('PAYMENT_NOT_PAYABLE', { reason: 'no_quote' });

      if (config.PAYMENT_PROVIDER === 'upi_direct') {
        const reference = await availableUpiReference();
        const inserted = await db.query<{ id: string; created_at: Date }>(
          `INSERT INTO payments (booking_id, provider, provider_ref, state, amount_paise, currency, sandbox, client_secret)
           VALUES ($1,'upi_direct',$2,'created',$3,'INR',false,NULL) RETURNING id, created_at`,
          [b.id, reference, amount],
        );

        await audit(db, {
          actorId: auth.userId,
          actorKind: 'user',
          action: 'payment.intent_created',
          resource: 'payment',
          resourceId: inserted.rows[0]!.id,
          after: { amount_paise: amount, provider: 'upi_direct', reference },
        });

        return {
          status: 201,
          body: {
            id: inserted.rows[0]!.id,
            state: 'created',
            amount_paise: amount,
            currency: 'INR' as const,
            provider: 'upi_direct' as const,
            sandbox: false,
            client_secret: null,
            provider_ref: reference,
            payment_link: upiPaymentLink(amount, reference),
            payee: { vpa: config.UPI_VPA ?? '', name: config.UPI_PAYEE_NAME ?? '' },
            created_at: toIso(inserted.rows[0]!.created_at),
          },
        };
      }

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
          currency: 'INR' as const,
          provider: config.PAYMENT_PROVIDER,
          sandbox: true,
          client_secret: clientSecret,
          provider_ref: providerRef,
          payment_link: null,
          payee: null,
          created_at: toIso(inserted.rows[0]!.created_at),
        },
      };
    });

    return reply.code(result.status).send(result.body);
  });

  /**
   * A reference the payer will read off their statement, so it has to be unique among live UPI
   * payments. Collisions are vanishingly rare; checking costs one indexed read and removes the
   * question entirely.
   */
  async function availableUpiReference(): Promise<string> {
    for (let attempt = 0; attempt < UPI_REFERENCE_ATTEMPTS; attempt++) {
      const reference = newUpiReference();
      const taken = await db.query(`SELECT 1 FROM payments WHERE provider = 'upi_direct' AND provider_ref = $1`, [
        reference,
      ]);
      if (taken.rows.length === 0) return reference;
    }
    throw new AppError('CONFLICT', { reason: 'reference_generation_failed' });
  }
}
