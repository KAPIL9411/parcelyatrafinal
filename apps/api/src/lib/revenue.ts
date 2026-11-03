import type { Db } from '../db/client.ts';

/**
 * Gateway charges are journalled apart from the fare — the plan requires customer payment, traveller
 * payable, commission, refunds, cancellations and gateway charges to stay separately traceable.
 * The figure is read from the stored quote snapshot, never from a client: it is the server-computed
 * `processing_fee_paise` and is 0 while no approved provider rate is configured, so nothing is
 * journaled until one is.
 */
export async function journalGatewayFee(
  db: Pick<Db, 'query'>,
  bookingId: string,
  providerRef: string,
): Promise<void> {
  const res = await db.query<{ fee: string | null }>(
    `SELECT q.inputs->>'processing_fee_paise' AS fee
     FROM bookings b JOIN quotes q ON q.id = b.quote_id
     WHERE b.id = $1`,
    [bookingId],
  );
  const fee = Number(res.rows[0]?.fee ?? 0);
  if (!Number.isFinite(fee) || fee <= 0) return;

  // A cost to the platform, so negative, and idempotent on the same provider reference as the capture.
  await db.query(
    `INSERT INTO payment_ledger (booking_id, entry_type, amount_paise, provider_ref, memo)
     SELECT $1,'fee',-$2,$3,'payment gateway charge'
      WHERE NOT EXISTS (
        SELECT 1 FROM payment_ledger
         WHERE booking_id = $1 AND entry_type = 'fee' AND provider_ref = $3
      )`,
    [bookingId, Math.round(fee), providerRef],
  );
}
