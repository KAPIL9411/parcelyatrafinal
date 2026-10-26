import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  corridorKm,
  haversineKm,
  rankMatches,
  TRANSPORT_MODES,
  type MatchInput,
  type TransportMode,
  type TripCandidate,
  type VerificationState,
} from '@py/domain';

import { config, enabledModes } from '../config.ts';
import { matchPolicy } from '../lib/matching-policy.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { num, tripView, toIso } from '../lib/serialize.ts';
import { audit, queueNotification } from '../services/audit.ts';
import { loadCity, nearbyCityIds, round1, type CityRow, type ParcelRowFull } from './parcels.ts';

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

const editSchema = z
  .object({
    departure_at: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
    arrival_estimate_at: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
    capacity_kg: z.number().gt(0).max(20).optional(),
    // Nullable as well as optional: a traveller who moves their meeting point must be able to go back
    // to not naming one, which is the choice the publish form gives them.
    origin_area: z.string().min(2).max(80).nullable().optional(),
  })
  .strict();

type EditInput = z.infer<typeof editSchema>;

/** The only columns `PATCH /trips/:id` will write. A route that could change the route or the mode
 *  would have to re-check bookings against a different trip entirely, so it does not offer them. */
const EDITABLE_FIELDS: readonly (keyof EditInput)[] = [
  'departure_at',
  'arrival_estimate_at',
  'capacity_kg',
  'origin_area',
];

interface TripRowFull {
  id: string;
  traveller_id: string;
  mode: TransportMode;
  origin_city_id: string;
  dest_city_id: string;
  origin_area: string | null;
  dest_area: string | null;
  departure_at: Date;
  arrival_estimate_at: Date;
  capacity_kg: unknown;
  capacity_kg_remaining: unknown;
  accepts_documents_only: boolean;
  status: string;
  created_at: Date;
}

/** The statuses in which a trip can be offered work at all. */
const LIVE_TRIP_STATUSES = new Set(['published', 'partially_booked']);

/**
 * The statuses an itinerary may be changed in. `full` is included on purpose: a traveller who has just
 * filled their boot can legitimately find more space, and refusing the edit here would strand the trip.
 * Every held parcel is re-validated by the route, so widening a full trip cannot break a booking.
 */
const EDITABLE_TRIP_STATUSES = new Set(['published', 'partially_booked', 'full']);

async function loadOwnedTrip(app: FastifyInstance, tripId: string, userId: string): Promise<TripRowFull> {
  const res = await app.db.query<TripRowFull>(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  const row = res.rows[0];
  if (!row || row.traveller_id !== userId) throw new AppError('NOT_FOUND');
  return row;
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

  /**
   * What this trip could carry — the traveller's side of the same engine the sender uses.
   *
   * The two directions have to agree. A parcel the sender was shown a trip for must appear here, and
   * a parcel that fails a hard gate upstairs must never appear, which is why this route runs every
   * candidate through `rankMatches` instead of writing a second, cheaper SQL filter that drifts.
   * The gates (verified traveller, capacity, prohibited content, window, mode) are the engine's; the
   * query below only narrows the scan.
   *
   * Nothing here invents demand: an empty list says so and gives the reason codes the engine actually
   * returned.
   */
  app.get<{ Params: { tripId: string } }>(
    '/trips/:tripId/opportunities',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const auth = requireAuth(req);
      const q = z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) }).strict().parse(req.query);
      const trip = await loadOwnedTrip(app, req.params.tripId, auth.userId);

      if (!config.FEATURE_MATCHING_ENABLED) {
        return { trip_id: trip.id, trip_status: trip.status, items: [], no_match_reasons: ['MATCHING_DISABLED'] };
      }
      if (!LIVE_TRIP_STATUSES.has(trip.status)) {
        return { trip_id: trip.id, trip_status: trip.status, items: [], no_match_reasons: ['TRIP_NOT_LIVE'] };
      }

      const policy = matchPolicy;
      const originCity = await loadCity(app, trip.origin_city_id);
      const originIds = await nearbyCityIds(app, originCity, policy.maxOriginDetourKm);

      const found = await db.query<ParcelRowFull>(
        `SELECT * FROM parcels
         WHERE status IN ('posted','matched')
           AND dest_city_id = $1
           AND origin_city_id = ANY($2::uuid[])
           AND sender_id <> $3
           AND window_end >= now()
         ORDER BY window_start
         LIMIT $4`,
        [trip.dest_city_id, originIds, auth.userId, config.MATCH_CANDIDATE_SCAN_LIMIT],
      );
      const parcels = found.rows;
      if (parcels.length === 0) {
        return { trip_id: trip.id, trip_status: trip.status, items: [], no_match_reasons: ['NO_PARCEL_ON_ROUTE'] };
      }

      const { items, blocked } = await scoreParcelsForTrip(app, trip, parcels);
      items.sort((a, b) => Number(b.score) - Number(a.score));

      // What this traveller has already offered for, so the list does not invite a second offer.
      const offeredRes = await db.query<{ parcel_id: string }>(
        `SELECT parcel_id FROM trip_interests WHERE trip_id = $1 AND traveller_id = $2`,
        [trip.id, auth.userId],
      );
      const offered = new Set(offeredRes.rows.map((r) => r.parcel_id));
      for (const item of items) item.offered = offered.has(String(item.parcel_id));

      return {
        trip_id: trip.id,
        trip_status: trip.status,
        capacity_kg_remaining: num(trip.capacity_kg_remaining),
        items: items.slice(0, q.limit),
        no_match_reasons: items.length === 0 ? [...blocked.keys()] : [],
        blocked_counts: Object.fromEntries(blocked),
      };
    },
  );

  /**
   * "I am going that way." The traveller's only outbound action, and it is a flag, not a booking: the
   * sender still chooses, still gets quoted, and still creates the booking, so nothing about the money
   * or the capacity reservation changes here.
   *
   * The eligibility is re-computed server-side on every call. A client that kept an old list open
   * cannot offer for a parcel that has since been booked, been weighed out of the trip's remaining
   * capacity, or been closed — the same engine that produced the list refuses it now.
   */
  app.post<{ Params: { tripId: string; parcelId: string } }>(
    '/trips/:tripId/opportunities/:parcelId/interest',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const trip = await loadOwnedTrip(app, req.params.tripId, auth.userId);
      if (!LIVE_TRIP_STATUSES.has(trip.status)) throw new AppError('TRIP_NOT_AVAILABLE');

      const found = await db.query<ParcelRowFull>(`SELECT * FROM parcels WHERE id = $1`, [req.params.parcelId]);
      const parcel = found.rows[0];
      // Someone else's parcel and a parcel that does not exist answer the same way.
      if (!parcel || parcel.sender_id === auth.userId) throw new AppError('NOT_FOUND');

      const { items, blocked, gateByParcel } = await scoreParcelsForTrip(app, trip, [parcel]);
      if (items.length === 0) {
        throw new AppError('OPPORTUNITY_NOT_AVAILABLE', {
          // The gate this parcel actually failed, not the summarised reason the list shows: the
          // traveller is holding a specific parcel and needs the specific answer.
          reason: gateByParcel.get(parcel.id) ?? [...blocked.keys()][0] ?? 'PARCEL_NOT_OPEN',
        });
      }

      const inserted = await db.query<{ id: string; created_at: Date }>(
        `INSERT INTO trip_interests (parcel_id, trip_id, traveller_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (parcel_id, trip_id) DO NOTHING
         RETURNING id, created_at`,
        [parcel.id, trip.id, auth.userId],
      );
      const interest = inserted.rows[0];

      if (interest) {
        await queueNotification(db, { userId: parcel.sender_id, templateId: 'traveller_interested' });
        await audit(db, {
          actorId: auth.userId,
          actorKind: 'user',
          action: 'trip.interest_offered',
          resource: 'trip',
          resourceId: trip.id,
          after: { parcel_id: parcel.id },
        });
      }

      return reply.code(interest ? 201 : 200).send({
        parcel_id: parcel.id,
        trip_id: trip.id,
        already_offered: !interest,
        offered_at: toIso(interest?.created_at ?? new Date()),
      });
    },
  );

  /**
   * Change the drive without breaking what has already been accepted.
   *
   * A traveller's times and space are promises to the senders who chose them, so an edit is allowed
   * only if every parcel already booked on this trip still passes the same engine gates it passed when
   * the sender chose it, and capacity cannot be cut below what those bookings hold. Nothing here
   * re-prices, re-times or cancels an existing booking: if the change would break one, it is refused
   * and the traveller makes a different change.
   */
  app.patch<{ Params: { tripId: string } }>(
    '/trips/:tripId',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req) => {
      const auth = requireAuth(req);
      const body = editSchema.parse(req.body);
      const trip = await loadOwnedTrip(app, req.params.tripId, auth.userId);
      if (!EDITABLE_TRIP_STATUSES.has(trip.status)) throw new AppError('TRIP_NOT_AVAILABLE');

      const changed = EDITABLE_FIELDS.filter((field) => body[field] !== undefined);
      if (changed.length === 0) throw new AppError('VALIDATION_FAILED', { reason: 'nothing_to_change' });

      const departure = body.departure_at ? new Date(body.departure_at) : new Date(trip.departure_at);
      const arrival = body.arrival_estimate_at ? new Date(body.arrival_estimate_at) : new Date(trip.arrival_estimate_at);
      if (arrival <= departure) throw new AppError('TRIP_WINDOW_INVALID', { reason: 'arrival_before_departure' });
      if (departure.getTime() < Date.now() - 60_000) throw new AppError('TRIP_WINDOW_INVALID', { reason: 'in_past' });

      const held = await db.query<ParcelRowFull & { booking_id: string; sender_id: string }>(
        `SELECT p.*, b.id AS booking_id, b.sender_id
         FROM bookings b
         JOIN parcels p ON p.id = b.parcel_id
         WHERE b.trip_id = $1
           AND b.status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible',
                                'cancelled_safety','expired','refunded','paid_out')
         ORDER BY b.created_at`,
        [trip.id],
      );

      // Measured the way the reservation is taken at booking time, so the two can never disagree.
      const reservedKg = held.rows.reduce((sum, row) => sum + num(row.weight_kg) * matchPolicy.packagingAllowance, 0);
      const nextCapacity = body.capacity_kg ?? num(trip.capacity_kg);
      const remaining = round1(nextCapacity - reservedKg);
      if (remaining < 0) {
        throw new AppError(
          'TRIP_CAPACITY_INVALID',
          { min_capacity_kg: round1(reservedKg), bookings_held: held.rows.length },
          `You cannot take back space that ${held.rows.length} booked ${held.rows.length === 1 ? 'parcel is' : 'parcels are'} already using.`,
        );
      }

      // `undefined` keeps the current value; an explicit null clears it. Collapsing the two with `??`
      // would make "no meeting point" impossible to go back to.
      const nextOriginArea = body.origin_area === undefined ? trip.origin_area : body.origin_area;
      const nextStatus = remaining <= 0 ? 'full' : reservedKg > 0 ? 'partially_booked' : 'published';

      // Checked one parcel at a time, and with its own reservation given back to it: "is there room for
      // this parcel" is the question the sender answered when they chose this trip, and the space the
      // other parcels on the trip already occupy is not this parcel's problem.
      for (const row of held.rows) {
        const ownKg = num(row.weight_kg) * matchPolicy.packagingAllowance;
        const proposed: TripRowFull = {
          ...trip,
          departure_at: departure,
          arrival_estimate_at: arrival,
          origin_area: nextOriginArea,
          capacity_kg: nextCapacity,
          capacity_kg_remaining: round1(Math.max(0, nextCapacity - (reservedKg - ownKg))),
          // A `full` trip is hidden from *new* senders, and that is the right rule for discovery, but
          // not for this check: this parcel's own space has just been given back to it, so the trip is
          // open for it by construction. Saying `nextStatus` here refused the last kilogram of a boot —
          // a traveller could never fill their trip exactly. The capacity gate above decides if there
          // is room; the status only decides who gets to ask.
          status: 'partially_booked',
        };
        const { items, blocked, gateByParcel } = await scoreParcelsForTrip(app, proposed, [row], [row.booking_id]);
        if (items.length === 0) {
          throw new AppError('TRIP_EDIT_BREAKS_BOOKING', {
            booking_id: row.booking_id,
            reason: gateByParcel.get(row.id) ?? [...blocked.keys()][0] ?? 'WINDOW_TOO_TIGHT',
          });
        }
      }

      const updated = await db.query<TripRowFull>(
        `UPDATE trips
           SET departure_at = $2, arrival_estimate_at = $3, capacity_kg = $4, capacity_kg_remaining = $5,
               origin_area = $6, status = $7::trip_status
         WHERE id = $1
         RETURNING *`,
        [trip.id, departure, arrival, nextCapacity, Math.max(0, remaining), nextOriginArea, nextStatus],
      );
      const row = updated.rows[0]!;

      await audit(db, {
        actorId: auth.userId,
        actorKind: 'user',
        action: 'trip.edited',
        resource: 'trip',
        resourceId: trip.id,
        before: {
          departure_at: toIso(trip.departure_at),
          arrival_estimate_at: toIso(trip.arrival_estimate_at),
          capacity_kg: num(trip.capacity_kg),
          origin_area: trip.origin_area,
        },
        after: {
          departure_at: toIso(row.departure_at),
          arrival_estimate_at: toIso(row.arrival_estimate_at),
          capacity_kg: nextCapacity,
          origin_area: nextOriginArea,
          fields: changed,
        },
      });

      // Only a change of time is something the sender has to be told about. Space they never used, or
      // a meeting point they already agreed, is not an alert.
      const timingMoved =
        (body.departure_at !== undefined && new Date(trip.departure_at).getTime() !== departure.getTime()) ||
        (body.arrival_estimate_at !== undefined && new Date(trip.arrival_estimate_at).getTime() !== arrival.getTime());
      if (timingMoved) {
        for (const booking of held.rows) {
          await queueNotification(db, {
            userId: booking.sender_id,
            bookingId: booking.booking_id,
            templateId: 'trip_changed',
          });
        }
      }

      return { ...tripView(row as never), bookings_rechecked: held.rows.length };
    },
  );

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

interface ScoredParcels {
  items: Array<Record<string, unknown>>;
  /** Why each dropped candidate was dropped, counted. Server-side only detail; the client gets the keys. */
  blocked: Map<string, number>;
  /** The exact gate each dropped parcel failed, when the caller has to name it to a person. */
  gateByParcel: Map<string, string>;
}

/**
 * Run one trip against a set of parcels through the sender-side engine, and keep only the pairs that
 * pass every hard gate.
 *
 * This is the whole point of sharing `rankMatches`: a parcel a traveller is offered is a parcel the
 * engine would have shown the sender, and a gate that fails here fails for both. The route-level SQL
 * narrows the scan; it never decides eligibility.
 */
async function scoreParcelsForTrip(
  app: FastifyInstance,
  trip: TripRowFull,
  parcels: ParcelRowFull[],
  /**
   * Bookings whose own parcel should not count as "already assigned". A parcel being booked is what
   * makes it assigned, so a check that asks "would this still work for the parcel I already carry"
   * has to ignore that booking and keep every other one.
   */
  ignoreBookings: string[] = [],
): Promise<ScoredParcels> {
  const db = app.db;
  if (parcels.length === 0) return { items: [], blocked: new Map(), gateByParcel: new Map() };

  const policy = matchPolicy;
  const [originCity, destCity] = await Promise.all([loadCity(app, trip.origin_city_id), loadCity(app, trip.dest_city_id)]);

  const [assignedRes, citiesRes, senderVerifications, myVerification, myHistory] = await Promise.all([
    // The same partial-index predicate the sender side uses: an active booking already holds it.
    db.query<{ parcel_id: string }>(
      `SELECT DISTINCT parcel_id FROM bookings b
       WHERE b.parcel_id = ANY($1::uuid[])
         AND NOT (b.id = ANY($2::uuid[]))
         AND b.status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible',
                              'cancelled_safety','expired','refunded','paid_out')`,
      [parcels.map((p) => p.id), ignoreBookings],
    ),
    db.query<CityRow>(
      `SELECT id, name, state, lat, lng, is_serviceable FROM cities WHERE id = ANY($1::uuid[])`,
      [[...new Set([...parcels.map((p) => p.origin_city_id), trip.origin_city_id, trip.dest_city_id])]],
    ),
    db.query<{ user_id: string; state: string }>(
      `SELECT DISTINCT ON (user_id) user_id, state FROM verifications
       WHERE user_id = ANY($1::uuid[]) ORDER BY user_id, created_at DESC`,
      [[...new Set(parcels.map((p) => p.sender_id))]],
    ),
    db.query<{ state: string }>(
      `SELECT state FROM verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [trip.traveller_id],
    ),
    db.query<{ completed: number; cancelled: number }>(
      `WITH recent AS (
         SELECT status, ROW_NUMBER() OVER (ORDER BY updated_at DESC, created_at DESC) AS rn
         FROM bookings
         WHERE traveller_id = $1
           AND status IN ('delivered','payout_eligible','paid_out','cancelled_by_traveller')
       )
       SELECT count(*) FILTER (WHERE status IN ('delivered','payout_eligible','paid_out'))::int AS completed,
              count(*) FILTER (WHERE status = 'cancelled_by_traveller')::int AS cancelled
       FROM recent WHERE rn <= 20`,
      [trip.traveller_id],
    ),
  ]);

  const assigned = new Set(assignedRes.rows.map((r) => r.parcel_id));
  const cityById = new Map(citiesRes.rows.map((c) => [c.id, c]));
  const senderVerified = new Set(senderVerifications.rows.filter((r) => r.state === 'verified').map((r) => r.user_id));
  const originPoint = { lat: Number(originCity.lat), lng: Number(originCity.lng) };

  const base: Omit<TripCandidate, 'originDetourKm'> = {
    id: trip.id,
    travellerId: trip.traveller_id,
    mode: trip.mode,
    originCityId: trip.origin_city_id,
    destCityId: trip.dest_city_id,
    originArea: trip.origin_area,
    destArea: trip.dest_area,
    departureAt: new Date(trip.departure_at),
    arrivalEstimateAt: new Date(trip.arrival_estimate_at),
    capacityKg: num(trip.capacity_kg),
    capacityKgRemaining: num(trip.capacity_kg_remaining),
    status: trip.status,
    acceptsDocumentsOnly: trip.accepts_documents_only,
    // The traveller is reading their own list; there is no reason to echo their name back.
    travellerFirstName: null,
    travellerInitial: null,
    verificationState: (myVerification.rows[0]?.state ?? 'not_started') as VerificationState,
    completedTrips: myHistory.rows[0]?.completed ?? 0,
    travellerCancellations: myHistory.rows[0]?.cancelled ?? 0,
  };

  const items: Array<Record<string, unknown>> = [];
  const blocked = new Map<string, number>();
  const gateByParcel = new Map<string, string>();

  for (const p of parcels) {
    const pOrigin = cityById.get(p.origin_city_id) ?? originCity;
    const result = rankMatches(
      {
        senderId: p.sender_id,
        originCityId: p.origin_city_id,
        destCityId: p.dest_city_id,
        parcelOriginArea: p.origin_area,
        parcelDestArea: p.dest_area,
        originServiceable: pOrigin.is_serviceable,
        destServiceable: destCity.is_serviceable,
        category: p.category as MatchInput['category'],
        description: p.description,
        weightKg: num(p.weight_kg),
        dimsCm: p.dims_cm,
        windowStart: new Date(p.window_start),
        windowEnd: new Date(p.window_end),
        corridorKm: corridorKm(
          { lat: Number(pOrigin.lat), lng: Number(pOrigin.lng) },
          { lat: Number(destCity.lat), lng: Number(destCity.lng) },
        ),
        enabledModes: enabledModes(config),
        parcelStatus: p.status,
        parcelAlreadyAssigned: assigned.has(p.id),
        now: new Date(),
        policy,
      },
      [
        {
          ...base,
          originDetourKm:
            p.origin_city_id === trip.origin_city_id
              ? 0
              : round1(haversineKm(originPoint, { lat: Number(pOrigin.lat), lng: Number(pOrigin.lng) })),
        },
      ],
    );

    const match = result.matches[0];
    if (!match) {
      // Counted rather than listed: the traveller needs the shape of the problem ("nothing fits the
      // capacity you have left"), not a page of codes per parcel.
      for (const code of [result.no_match_reasons[0], result.rejections[0]?.code]) {
        if (code) blocked.set(code, (blocked.get(code) ?? 0) + 1);
      }
      // The gate itself, kept per parcel for the caller that has to name it to a person.
      const gate = result.rejections[0]?.code ?? result.no_match_reasons[0];
      if (gate) gateByParcel.set(p.id, gate);
      continue;
    }
    items.push({
      parcel_id: p.id,
      category: p.category,
      weight_kg: num(p.weight_kg),
      dims_cm: p.dims_cm,
      origin_area: p.origin_area,
      dest_area: p.dest_area,
      window_start: toIso(p.window_start),
      window_end: toIso(p.window_end),
      declared_value_paise: p.declared_value_paise,
      sender_verified: senderVerified.has(p.sender_id),
      score: match.score,
      band: match.band,
      reasons: match.reasons,
      pickup_distance_band_km: match.pickup_distance_band_km,
      // What the sender is quoted, not what the traveller is paid: the share is only fixed when the
      // booking is created, and calling this "your earnings" would be a claim this build cannot keep.
      indicative_price_paise: match.indicative_price_paise,
      score_breakdown: match.score_breakdown,
    });
  }

  return { items, blocked, gateByParcel };
}
