import type { FastifyInstance } from 'fastify';

import { applyBookingTransition, type BookingRowFull } from '../routes/bookings.ts';

/**
 * Time-based booking transitions.
 *
 * `expire`, `auto_expire`, `open_pickup` and `settle_window` are `system` edges. Nothing in a request
 * causes them: they happen because a clock passed a deadline. Until this module existed no process
 * ran them, so in production a confirmed booking never opened its pickup step and a delivered parcel
 * was never settled. `/dev/bookings/:id/advance` was the only thing that exercised the edges, and it
 * is not available in production.
 *
 * The sweep is deliberately idempotent and bounded: each pass takes at most `limit` rows per rule,
 * re-reads the row, and calls the same `applyBookingTransition` every other caller uses. A row that
 * changed between the query and the transition loses the optimistic-concurrency check and is skipped,
 * never forced.
 *
 * It runs from a Cloudflare Cron Trigger (`worker.ts`) and from the Node scheduler when
 * `JOBS_ENABLED` is true (`app.ts`). The `dev` route calls it directly so a local demo can move the
 * clock forward without waiting.
 */

export interface LifecycleSweepResult {
  expired: number;
  pickupOpened: number;
  settled: number;
  prunedOtpCounters: number;
  failed: number;
}

export async function runLifecycleSweep(
  app: FastifyInstance,
  opts: { limit?: number } = {},
): Promise<LifecycleSweepResult> {
  const db = app.db;
  const limit = opts.limit ?? 100;
  const result: LifecycleSweepResult = {
    expired: 0,
    pickupOpened: 0,
    settled: 0,
    prunedOtpCounters: 0,
    failed: 0,
  };

  const step = async (
    rows: BookingRowFull[],
    command: 'auto_expire' | 'open_pickup' | 'settle_window',
    counter: 'expired' | 'pickupOpened' | 'settled',
  ): Promise<void> => {
    for (const booking of rows) {
      try {
        await applyBookingTransition(app, booking, command, 'system', {
          reasonCode: 'scheduler',
          metadata: { sweep: 'lifecycle' },
        });
        result[counter] += 1;
      } catch (err) {
        // A row that moved on (accepted, cancelled, paid late) is a normal miss. Log it and keep
        // walking: one bad row must not stop the rest of the sweep.
        result.failed += 1;
        app.log.warn({ err, booking_id: booking.id, command }, 'lifecycle sweep: transition skipped');
      }
    }
  };

  // 1. An unanswered request expires, and its reserved capacity goes back to the trip.
  const expired = await db.query<BookingRowFull>(
    `SELECT * FROM bookings
      WHERE status = 'pending_traveller_acceptance'
        AND accept_by IS NOT NULL AND accept_by < now()
      ORDER BY accept_by ASC
      LIMIT $1`,
    [limit],
  );
  await step(expired.rows, 'auto_expire', 'expired');

  // 2. Pickup opens when the parcel's pickup window starts.
  const toOpen = await db.query<BookingRowFull>(
    `SELECT b.* FROM bookings b
       JOIN parcels p ON p.id = b.parcel_id
      WHERE b.status = 'confirmed' AND p.window_start <= now()
      ORDER BY p.window_start ASC
      LIMIT $1`,
    [limit],
  );
  await step(toOpen.rows, 'open_pickup', 'pickupOpened');

  // 3. Settlement: the problem window has closed AND the sender's money is in the journal. The
  //    domain guard repeats both checks; the SQL only narrows the candidates.
  const toSettle = await db.query<BookingRowFull>(
    `SELECT b.* FROM bookings b
      WHERE b.status = 'delivered'
        AND b.dispute_deadline IS NOT NULL AND b.dispute_deadline < now()
        AND COALESCE((
          SELECT SUM(l.amount_paise) FROM payment_ledger l
           WHERE l.booking_id = b.id AND l.entry_type = 'capture'
        ), 0) >= b.traveller_share_paise
      ORDER BY b.dispute_deadline ASC
      LIMIT $1`,
    [limit],
  );
  await step(toSettle.rows, 'settle_window', 'settled');

  // 4. Housekeeping: expired OTP rate-limit rows are harmless but accumulate.
  try {
    const pruned = await db.query(
      `DELETE FROM otp_sms_counters WHERE window_end < now() - interval '1 hour'`,
    );
    result.prunedOtpCounters = pruned.rowCount ?? 0;
  } catch (err) {
    app.log.warn({ err }, 'lifecycle sweep: otp counter prune failed (non-fatal)');
  }

  return result;
}
