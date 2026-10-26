import type { Db } from '../db/client.ts';
import { sha256 } from '../lib/crypto.ts';

export interface AuditInput {
  actorId?: string | null;
  actorKind: 'user' | 'system' | 'support';
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  reasonCode?: string | null;
}

/**
 * Append-only audit log with a hash chain. `payment_ledger` and `audit_log` are append-only at the
 * database role level in production (database/SCHEMA.md §13); this module never updates or deletes.
 */
export async function audit(db: Db, input: AuditInput): Promise<void> {
  const prev = await db.query<{ entry_hash: string }>(
    `SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1`,
  );
  const prevHash = prev.rows[0]?.entry_hash ?? null;
  const payload = JSON.stringify({
    actorId: input.actorId ?? null,
    actorKind: input.actorKind,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    reasonCode: input.reasonCode ?? null,
    prevHash,
  });
  const entryHash = sha256(payload);

  await db.query(
    `INSERT INTO audit_log
      (actor_id, actor_kind, action, resource, resource_id, before_state, after_state, reason_code, prev_hash, entry_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.actorId ?? null,
      input.actorKind,
      input.action,
      input.resource,
      input.resourceId ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.reasonCode ?? null,
      prevHash,
      entryHash,
    ],
  );
}

/**
 * Notification queue. Templates carry no personal data: the body is looked up by `template_id` at
 * send time, and the recipient is resolved server-side from the booking. See docs/NOTIFICATIONS.md.
 *
 * Honesty about channels in this build:
 *   - `in_app` — the row itself IS the delivery. Users read it via GET /v1/notifications, so
 *     we mark the row `delivered` and stamp `sent_at` at write time.
 *   - any other channel — no worker dispatches SMS/email/push. The row stays `queued` with
 *     `sent_at = NULL`. A future worker flips it to `sent` or `failed`; until one exists, we
 *     do not claim delivery we did not perform.
 */
export async function queueNotification(
  db: Db,
  input: { userId: string | null; bookingId?: string | null; channel?: string; templateId: string },
): Promise<void> {
  const channel = input.channel ?? 'in_app';
  if (channel === 'in_app') {
    await db.query(
      `INSERT INTO notifications (user_id, booking_id, channel, template_id, status, sent_at)
       VALUES ($1,$2,$3,$4,'delivered', now())`,
      [input.userId, input.bookingId ?? null, channel, input.templateId],
    );
    return;
  }
  await db.query(
    `INSERT INTO notifications (user_id, booking_id, channel, template_id, status)
     VALUES ($1,$2,$3,$4,'queued')`,
    [input.userId, input.bookingId ?? null, channel, input.templateId],
  );
}

/**
 * Job queue. This deployment runs no worker: rows are written for the operator's audit trail
 * and to give a future worker a stable place to attach, but nothing here will pick them up.
 * Callers that need a synchronously-completed effect must not use this.
 */
export async function enqueueJob(db: Db, kind: string, payload: Record<string, unknown>, runAt?: Date): Promise<void> {
  await db.query(`INSERT INTO jobs (kind, payload, run_at) VALUES ($1,$2,$3)`, [
    kind,
    JSON.stringify(payload),
    runAt ?? new Date(),
  ]);
}

/**
 * Transactional outbox. Same caveat as `enqueueJob`: no dispatcher reads these rows in this
 * build. The write is durable and auditable, but "queued" is the honest state until a worker
 * exists.
 */
export async function emitOutbox(db: Db, topic: string, payload: Record<string, unknown>): Promise<void> {
  await db.query(`INSERT INTO outbox (topic, payload) VALUES ($1,$2)`, [topic, JSON.stringify(payload)]);
}
