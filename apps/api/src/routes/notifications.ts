import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { toIso, toIsoOrNull } from '../lib/serialize.ts';

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
    unread_only: z
      .enum(['true', 'false'])
      .default('false')
      .transform((s) => s === 'true'),
  })
  .strict();

/**
 * Notification history. Rows carry a template id, never a rendered body: the body is resolved
 * server-side so no personal data lands in this table or this response.
 *
 * `read_at` (migration 0007) is separate from `status`. `status` records delivery to a channel;
 * `read_at` records whether the person looked at it.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get('/notifications', async (req) => {
    const auth = requireAuth(req);
    const q = listQuery.parse(req.query);
    const limit = q.limit;
    const params: unknown[] = [auth.userId];
    let where = `user_id = $1`;
    if (q.unread_only) where += ` AND read_at IS NULL`;
    if (q.cursor) {
      params.push(new Date(q.cursor));
      where += ` AND created_at < $${params.length}`;
    }
    params.push(limit + 1);

    const res = await db.query<{
      id: string;
      channel: string;
      template_id: string;
      status: string;
      booking_id: string | null;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT id, channel, template_id, status, booking_id, created_at, read_at
       FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );

    const rows = res.rows.slice(0, limit);
    if (rows.length === 0 && q.cursor) throw new AppError('NOT_FOUND', { reason: 'cursor' });

    const unread = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications
       WHERE user_id = $1 AND read_at IS NULL AND channel = 'in_app'`,
      [auth.userId],
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        template_id: r.template_id,
        status: r.status,
        booking_id: r.booking_id,
        created_at: toIso(r.created_at),
        read_at: toIsoOrNull(r.read_at),
      })),
      unread_count: Number(unread.rows[0]?.count ?? 0),
      next_cursor: res.rows.length > limit ? toIso(rows[rows.length - 1]?.created_at) : null,
    };
  });

  app.post<{ Params: { notificationId: string } }>('/notifications/:notificationId/read', async (req, reply) => {
    const auth = requireAuth(req);
    const updated = await db.query(
      `UPDATE notifications SET read_at = now()
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [req.params.notificationId, auth.userId],
    );
    if (updated.rowCount === 0) {
      const mine = await db.query<{ id: string }>(
        `SELECT id FROM notifications WHERE id = $1 AND user_id = $2`,
        [req.params.notificationId, auth.userId],
      );
      if (mine.rows.length === 0) throw new AppError('NOT_FOUND');
    }
    return reply.code(200).send({ id: req.params.notificationId, read: true });
  });

  app.post('/notifications/read-all', async (req, reply) => {
    const auth = requireAuth(req);
    const updated = await db.query(
      `UPDATE notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL AND channel = 'in_app'`,
      [auth.userId],
    );
    return reply.code(200).send({ marked_read: updated.rowCount ?? 0 });
  });
}
