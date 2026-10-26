import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { toIso } from '../lib/serialize.ts';

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  })
  .strict();

/**
 * Notification history. Rows carry a template id, never a rendered body: the body is resolved
 * server-side so no personal data lands in this table or this response.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notifications', async (req) => {
    const auth = requireAuth(req);
    const q = listQuery.parse(req.query);
    const limit = q.limit;
    const params: unknown[] = [auth.userId];
    let where = `user_id = $1`;
    if (q.cursor) {
      params.push(new Date(q.cursor));
      where += ` AND created_at < $${params.length}`;
    }
    params.push(limit + 1);

    const res = await app.db.query<{
      id: string;
      channel: string;
      template_id: string;
      status: string;
      booking_id: string | null;
      created_at: Date;
    }>(
      `SELECT id, channel, template_id, status, booking_id, created_at
       FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );

    const rows = res.rows.slice(0, limit);
    if (rows.length === 0 && q.cursor) throw new AppError('NOT_FOUND', { reason: 'cursor' });

    return {
      items: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        template_id: r.template_id,
        status: r.status,
        booking_id: r.booking_id,
        created_at: toIso(r.created_at),
      })),
      next_cursor: res.rows.length > limit ? toIso(rows[rows.length - 1]?.created_at) : null,
    };
  });
}
