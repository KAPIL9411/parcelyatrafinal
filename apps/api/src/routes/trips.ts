import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { TRANSPORT_MODES, type TransportMode } from '@py/domain';

import { config, enabledModes } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { tripView, toIso } from '../lib/serialize.ts';
import { audit } from '../services/audit.ts';

const createSchema = z
  .object({
    origin_city_id: z.string().uuid(),
    dest_city_id: z.string().uuid(),
    origin_area: z.string().max(80).optional(),
    mode: z.enum(TRANSPORT_MODES),
    departure_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
    arrival_estimate_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
    capacity_kg: z.number().gt(0).max(20),
    accepts_documents_only: z.boolean().optional(),
  })
  .strict();

interface TripRowFull {
  id: string;
  traveller_id: string;
  mode: TransportMode;
  origin_city_id: string;
  dest_city_id: string;
  origin_area: string | null;
  departure_at: Date;
  arrival_estimate_at: Date;
  capacity_kg: unknown;
  capacity_kg_remaining: unknown;
  accepts_documents_only: boolean;
  status: string;
  created_at: Date;
}

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.post('/trips', async (req, reply) => {
    const auth = requireAuth(req);
    const body = createSchema.parse(req.body);

    if (!enabledModes(config).includes(body.mode)) {
      throw new AppError('MODE_DISABLED', { mode: body.mode });
    }
    if (body.origin_city_id === body.dest_city_id) {
      throw new AppError('TRIP_WINDOW_INVALID', { reason: 'same_city' }, 'Origin and destination must differ.');
    }

    const departure = new Date(body.departure_at);
    const arrival = new Date(body.arrival_estimate_at);
    if (arrival <= departure) throw new AppError('TRIP_WINDOW_INVALID', { reason: 'arrival_before_departure' });
    if (departure.getTime() < Date.now() - 60_000) throw new AppError('TRIP_WINDOW_INVALID', { reason: 'in_past' });

    const verification = await db.query<{ state: string }>(
      `SELECT state FROM verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [auth.userId],
    );
    if (verification.rows[0]?.state !== 'verified') throw new AppError('VERIFICATION_REQUIRED');

    const inserted = await db.query<TripRowFull>(
      `INSERT INTO trips
        (traveller_id, origin_city_id, dest_city_id, origin_area, mode, departure_at,
         arrival_estimate_at, capacity_kg, capacity_kg_remaining, accepts_documents_only)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING *`,
      [
        auth.userId,
        body.origin_city_id,
        body.dest_city_id,
        body.origin_area ?? null,
        body.mode,
        departure,
        arrival,
        body.capacity_kg,
        body.accepts_documents_only ?? true,
      ],
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'trip.published',
      resource: 'trip',
      resourceId: inserted.rows[0]!.id,
      after: { mode: body.mode, capacity_kg: body.capacity_kg },
    });

    return reply.code(201).send(tripView(inserted.rows[0]! as never));
  });

  app.get('/trips', async (req) => {
    const auth = requireAuth(req);
    const q = z
      .object({
        status: z.enum(['published', 'partially_booked', 'full', 'in_progress', 'completed', 'cancelled', 'expired']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
      })
      .strict()
      .parse(req.query);
    const limit = q.limit;
    const params: unknown[] = [auth.userId];
    let where = `traveller_id = $1`;
    if (q.status) {
      params.push(q.status);
      where += ` AND status = $${params.length}`;
    }
    if (q.cursor) {
      params.push(new Date(q.cursor));
      where += ` AND departure_at < $${params.length}`;
    }
    params.push(limit + 1);

    const res = await db.query<TripRowFull>(
      `SELECT * FROM trips WHERE ${where} ORDER BY departure_at DESC LIMIT $${params.length}`,
      params,
    );
    const rows = res.rows.slice(0, limit);
    return {
      items: rows.map((r) => tripView(r as never)),
      next_cursor: res.rows.length > limit ? toIso(rows[rows.length - 1]?.departure_at) : null,
    };
  });

  app.get<{ Params: { tripId: string } }>('/trips/:tripId', async (req) => {
    const auth = requireAuth(req);
    const res = await db.query<TripRowFull>(`SELECT * FROM trips WHERE id = $1`, [req.params.tripId]);
    const row = res.rows[0];
    if (!row || row.traveller_id !== auth.userId) throw new AppError('NOT_FOUND');
    return tripView(row as never);
  });

  app.delete<{ Params: { tripId: string } }>('/trips/:tripId', async (req, reply) => {
    const auth = requireAuth(req);
    const res = await db.query<TripRowFull>(`SELECT * FROM trips WHERE id = $1`, [req.params.tripId]);
    const row = res.rows[0];
    if (!row || row.traveller_id !== auth.userId) throw new AppError('NOT_FOUND');

    const accepted = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bookings WHERE trip_id = $1
       AND status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible',
                          'cancelled_safety','expired','refunded','paid_out')`,
      [row.id],
    );
    if (Number(accepted.rows[0]?.count ?? 0) > 0) throw new AppError('TRIP_HAS_ACCEPTED_BOOKING');

    await db.query(`UPDATE trips SET status = 'cancelled' WHERE id = $1`, [row.id]);
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'trip.cancelled',
      resource: 'trip',
      resourceId: row.id,
    });
    return reply.code(204).send();
  });
}
