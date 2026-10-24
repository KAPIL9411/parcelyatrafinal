import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { userProfile } from '../lib/serialize.ts';
import { audit, enqueueJob } from '../services/audit.ts';

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
      phone_last4: string;
      status: 'active' | 'suspended' | 'deleted';
      risk_tier: number;
      locale: string;
      created_at: Date;
      verification_state: string | null;
    }>(
      `SELECT u.id, u.name, u.email, u.phone_last4, u.status, u.risk_tier, u.locale, u.created_at,
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

    const before = await db.query(`SELECT name, email, locale FROM users WHERE id = $1`, [auth.userId]);
    if (before.rows.length === 0) throw new AppError('NOT_FOUND');

    await db.query(
      `UPDATE users SET
         name = COALESCE($2, name),
         email = COALESCE($3, email),
         locale = COALESCE($4, locale),
         updated_at = now()
       WHERE id = $1`,
      [auth.userId, body.name ?? null, body.email ?? null, body.locale ?? null],
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'me.update',
      resource: 'user',
      resourceId: auth.userId,
      before: before.rows[0],
      after: body,
    });

    const res = await db.query<{
      id: string;
      name: string | null;
      email: string | null;
      phone_last4: string;
      status: 'active' | 'suspended' | 'deleted';
      risk_tier: number;
      locale: string;
      created_at: Date;
      verification_state: string | null;
    }>(
      `SELECT u.id, u.name, u.email, u.phone_last4, u.status, u.risk_tier, u.locale, u.created_at,
              (SELECT v.state FROM verifications v WHERE v.user_id = u.id ORDER BY v.created_at DESC LIMIT 1) AS verification_state
       FROM users u WHERE u.id = $1`,
      [auth.userId],
    );
    return userProfile(res.rows[0] as never, await rolesFor(auth.userId));
  });

  app.post('/me/export', async (req, reply) => {
    const auth = requireAuth(req);
    const requestId = crypto.randomUUID();
    await enqueueJob(db, 'data_export', { user_id: auth.userId, request_id: requestId });
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'me.export_requested',
      resource: 'user',
      resourceId: auth.userId,
    });
    return reply.code(202).send({ request_id: requestId, status: 'queued' });
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

    return reply.code(202).send({
      request_id: crypto.randomUUID(),
      hard_delete_after: hardDeleteAfter.toISOString(),
      retained_categories: [
        'payment and refund records (statutory retention)',
        'booking and dispute records tied to a financial event',
        'audit log entries',
      ],
    });
  });
}
