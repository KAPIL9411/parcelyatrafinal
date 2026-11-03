import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { trackingStore } from '../services/redis.ts';
import { historyWorker } from '../services/history-worker.ts';
import { trackingService, type RawDriverUpdate } from '../services/tracking-service.ts';
import { getOsrmRoute } from '../services/osrm.ts';

const batchSyncSchema = z.object({
  booking_id: z.string().uuid(),
  points: z.array(
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      speed: z.number().optional(),
      bearing: z.number().optional(),
      accuracy: z.number().optional(),
      timestamp: z.number().positive(),
    }),
  ).min(1).max(1000),
});

export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/tracking/parcels/:parcelId/latest
   * Returns the most recent live location and route for a parcel.
   */
  app.get('/tracking/parcels/:parcelId/latest', async (req, reply) => {
    const auth = requireAuth(req);
    const { parcelId } = z.object({ parcelId: z.string().uuid() }).parse(req.params);

    // Authorisation: viewer must be sender, traveller, or staff
    const authCheck = await app.db.query<{ id: string; dest_lat: string | null; dest_lng: string | null }>(
      `SELECT b.id, c.lat AS dest_lat, c.lng AS dest_lng
       FROM bookings b
       JOIN parcels p ON p.id = b.parcel_id
       LEFT JOIN cities c ON c.id = p.dest_city_id
       WHERE b.parcel_id = $1
         AND (b.sender_id = $2 OR b.traveller_id = $2 OR p.sender_id = $2)`,
      [parcelId, auth.userId],
    );

    if (authCheck.rows.length === 0 && !auth.roles.includes('staff')) {
      throw new AppError('NOT_FOUND');
    }

    const row = authCheck.rows[0];
    const latest = await trackingStore.getLatestLocation(parcelId);

    let routePolyline: Array<[number, number]> = [];
    if (latest && row?.dest_lat && row?.dest_lng) {
      const route = await getOsrmRoute(
        latest.lat,
        latest.lng,
        Number(row.dest_lat),
        Number(row.dest_lng),
        row.id,
      );
      routePolyline = route.polyline;
    }

    return reply.send({
      latest,
      polyline: routePolyline,
    });
  });

  /**
   * GET /v1/tracking/bookings/:bookingId/history
   * Dispute / audit trail: returns sampled recorded location points for a completed or disputed booking.
   */
  app.get('/tracking/bookings/:bookingId/history', async (req, reply) => {
    const auth = requireAuth(req);
    const { bookingId } = z.object({ bookingId: z.string().uuid() }).parse(req.params);

    const authCheck = await app.db.query<{ id: string }>(
      `SELECT id FROM bookings
       WHERE id = $1 AND (sender_id = $2 OR traveller_id = $2)`,
      [bookingId, auth.userId],
    );

    if (authCheck.rows.length === 0 && !auth.roles.includes('staff')) {
      throw new AppError('NOT_FOUND');
    }

    const history = await app.db.query<{
      id: string;
      lat: string;
      lng: string;
      bearing: string | null;
      speed: string | null;
      accuracy: string | null;
      recorded_at: Date;
    }>(
      `SELECT id, lat, lng, bearing, speed, accuracy, recorded_at
       FROM location_history
       WHERE booking_id = $1
       ORDER BY recorded_at ASC
       LIMIT 2000`,
      [bookingId],
    );

    return reply.send({
      booking_id: bookingId,
      points: history.rows.map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        bearing: r.bearing ? Number(r.bearing) : null,
        speed: r.speed ? Number(r.speed) : null,
        accuracy: r.accuracy ? Number(r.accuracy) : null,
        recorded_at: r.recorded_at.toISOString(),
      })),
    });
  });

  /**
   * POST /v1/tracking/batch
   * Offline synchronization: Driver app bulk-syncs points collected while cellular network was offline.
   */
  app.post('/tracking/batch', async (req, reply) => {
    const auth = requireAuth(req);
    const body = batchSyncSchema.parse(req.body);

    // Verify driver is the assigned traveller
    const session = await trackingService.getOrLoadSession(body.booking_id);
    if (!session || (session.travellerId !== auth.userId && !auth.roles.includes('staff'))) {
      throw new AppError('FORBIDDEN');
    }

    // Sort points chronologically
    const sortedPoints = [...body.points].sort((a, b) => a.timestamp - b.timestamp);

    // Queue points to history worker
    for (const pt of sortedPoints) {
      historyWorker.enqueueIfEligible({
        bookingId: body.booking_id,
        parcelId: session.parcelId,
        travellerId: session.travellerId,
        lat: pt.lat,
        lng: pt.lng,
        bearing: pt.bearing ?? null,
        speed: pt.speed ?? null,
        accuracy: pt.accuracy ?? null,
        recordedAt: new Date(pt.timestamp),
      });
    }

    // Process the newest point through live tracking to immediately update customers
    const latestPoint = sortedPoints[sortedPoints.length - 1];
    if (latestPoint) {
      const update: RawDriverUpdate = {
        b: body.booking_id,
        lat: latestPoint.lat,
        lng: latestPoint.lng,
        s: latestPoint.speed,
        h: latestPoint.bearing,
        a: latestPoint.accuracy,
        t: latestPoint.timestamp,
      };
      await trackingService.processDriverLocation(update);
    }

    return reply.status(202).send({
      synced_points_count: sortedPoints.length,
      status: 'accepted',
    });
  });

  /**
   * GET /v1/tracking/parcels/:parcelId/status-log
   * Returns milestone status changes (picked up -> in transit -> out for delivery -> delivered).
   */
  app.get('/tracking/parcels/:parcelId/status-log', async (req, reply) => {
    const auth = requireAuth(req);
    const { parcelId } = z.object({ parcelId: z.string().uuid() }).parse(req.params);

    const logs = await app.db.query<{
      id: string;
      stage: string;
      lat: string | null;
      lng: string | null;
      note: string | null;
      created_at: Date;
    }>(
      `SELECT psl.id, psl.stage, psl.lat, psl.lng, psl.note, psl.created_at
       FROM parcel_status_log psl
       JOIN bookings b ON b.id = psl.booking_id
       WHERE psl.parcel_id = $1 
         AND (b.sender_id = $2 OR b.traveller_id = $2 OR $3 = true)
       ORDER BY psl.created_at ASC`,
      [parcelId, auth.userId, auth.roles.includes('staff')],
    );

    return reply.send({
      parcel_id: parcelId,
      stages: logs.rows.map((l) => ({
        id: l.id,
        stage: l.stage,
        lat: l.lat ? Number(l.lat) : null,
        lng: l.lng ? Number(l.lng) : null,
        note: l.note,
        created_at: l.created_at.toISOString(),
      })),
    });
  });
}

