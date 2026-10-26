import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { userProfile } from '../lib/serialize.ts';
import { audit } from '../services/audit.ts';

const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    email: z.string().max(254).optional(),
    locale: z.enum(['en-IN', 'hi-IN']).optional(),
  })
  .strict();

const deletionSchema = z
  .object({
    confirm: z.literal(true),
    reason: z.string().max(500).optional(),
  })
  .strict();

export async function meRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  /**
   * The caller's own roles. `role` is a Postgres enum, so cast to text before it reaches JSON.
   */
  async function rolesFor(userId: string): Promise<string[]> {
    const res = await db.query<{ role: string }>(
      `SELECT role::text AS role FROM user_roles WHERE user_id = $1 ORDER BY role::text ASC`,
      [userId],
    );
    return res.rows.map((r) => r.role);
  }

  app.get('/me', async (req) => {
    const auth = requireAuth(req);
    const res = await db.query<{
      id: string;
      name: string | null;
      email: string | null;
      phone_last4: string | null;
      status: 'active' | 'suspended' | 'deleted';
      risk_tier: number;
      locale: string;
      created_at: Date;
      verification_state: string | null;
      phone_verified: boolean;
      email_verified: boolean;
    }>(
      `SELECT u.id, u.name, u.email, u.phone_last4, u.status, u.risk_tier, u.locale, u.created_at,
              u.phone_verified_at IS NOT NULL AS phone_verified,
              u.email_verified_at IS NOT NULL AS email_verified,
              (SELECT v.state FROM verifications v WHERE v.user_id = u.id ORDER BY v.created_at DESC LIMIT 1) AS verification_state
       FROM users u WHERE u.id = $1`,
      [auth.userId],
    );
    const row = res.rows[0];
    if (!row) throw new AppError('NOT_FOUND');
    return userProfile(row as never, await rolesFor(auth.userId));
  });

  app.patch('/me', async (req) => {
    const auth = requireAuth(req);
    const body = patchSchema.parse(req.body);

    const before = await db.query<{ name: string | null; locale: string; google_sub: string | null }>(
      `SELECT name, locale, google_sub FROM users WHERE id = $1`,
      [auth.userId],
    );
    const account = before.rows[0];
    if (!account) throw new AppError('NOT_FOUND');

    const emailChanged = body.email !== undefined && body.email !== null;
    // The address is the Google identity for an OAuth account, and it is what the staff policy and
    // rule E2 trust. It is set by the provider at sign-in, never here.
    if (emailChanged && account.google_sub) {
      throw new AppError('FORBIDDEN', { field: 'email' }, 'Your sign-in address is managed by your Google account.');
    }

    await db.query(
      `UPDATE users SET
         name = COALESCE($2, name),
         email = COALESCE($3, email),
         locale = COALESCE($4, locale),
         email_verified_at = CASE WHEN $3 IS NULL THEN email_verified_at ELSE NULL END,
         updated_at = now()
       WHERE id = $1`,
      [auth.userId, body.name ?? null, body.email ?? null, body.locale ?? null],
    );

    // A self-declared address is not a verified one: rule E2 stops counting it the moment it changes.
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'me.update',
      resource: 'user',
      resourceId: auth.userId,
      before: { name: account.name, locale: account.locale },
      after: { name: body.name, locale: body.locale, email_changed: emailChanged },
    });

    const res = await db.query<{
      id: string;
      name: string | null;
      email: string | null;
      phone_last4: string | null;
      status: 'active' | 'suspended' | 'deleted';
      risk_tier: number;
      locale: string;
      created_at: Date;
      verification_state: string | null;
      phone_verified: boolean;
      email_verified: boolean;
    }>(
      `SELECT u.id, u.name, u.email, u.phone_last4, u.status, u.risk_tier, u.locale, u.created_at,
              u.phone_verified_at IS NOT NULL AS phone_verified,
              u.email_verified_at IS NOT NULL AS email_verified,
              (SELECT v.state FROM verifications v WHERE v.user_id = u.id ORDER BY v.created_at DESC LIMIT 1) AS verification_state
       FROM users u WHERE u.id = $1`,
      [auth.userId],
    );
    return userProfile(res.rows[0] as never, await rolesFor(auth.userId));
  });

  app.post('/me/export', async (req, reply) => {
    const auth = requireAuth(req);
    // The pilot runs no background worker. Enqueueing the job here would produce a
    // `202 queued` response for work nothing ever does — a fake success message. Refuse
    // honestly and point the user at a support path.
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'me.export_requested',
      resource: 'user',
      resourceId: auth.userId,
    });
    throw new AppError(
      'BACKGROUND_WORKER_UNAVAILABLE',
      { reason: 'data_export' },
      'Your data export needs a background worker that is not deployed here. Contact support and we will produce it manually.',
    );
  });

  app.post('/me/deletion-request', async (req, reply) => {
    const auth = requireAuth(req);
    deletionSchema.parse(req.body);

    const open = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bookings
       WHERE (sender_id = $1 OR traveller_id = $1)
         AND status NOT IN ('paid_out','refunded','expired','cancelled_by_sender',
                            'cancelled_by_traveller','cancelled_ineligible','cancelled_safety')`,
      [auth.userId],
    );
    if (Number(open.rows[0]?.count ?? 0) > 0) {
      throw new AppError('CONFLICT', { reason: 'open_booking' }, 'Finish or cancel your open bookings first.');
    }

    const hardDeleteAfter = new Date(Date.now() + 30 * 24 * 3_600_000);
    await db.query(`UPDATE users SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1`, [
      auth.userId,
    ]);
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'me.deletion_requested',
      resource: 'user',
      resourceId: auth.userId,
    });

    return reply.code(200).send({
      deleted_at: new Date().toISOString(),
      hard_delete_after: hardDeleteAfter.toISOString(),
      hard_delete_worker: false,
      note: 'Your account is soft-deleted and no longer visible to you or to other users. The row-level purge after the retention window is a deploy-time job in this build: no background worker executes it here, so the timestamp above is a target, not a scheduled event.',
      retained_categories: [
        'payment and refund records (statutory retention)',
        'booking and dispute records tied to a financial event',
        'audit log entries',
      ],
    });
  });
}
