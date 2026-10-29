import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  CATEGORIES,
  corridorKm,
  evaluateEligibility,
  haversineKm,
  rankMatches,
  quoteLaunchPrice,
  type Category,
  type TripCandidate,
  type TransportMode,
} from '@py/domain';

import { config, enabledModes } from '../config.ts';
import { matchPolicy } from '../lib/matching-policy.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { phoneHash, phoneLast4 } from '../lib/crypto.ts';
import { loadActivePolicy, legacyQuoteColumns } from '../lib/pricing-policy.ts';
import { resolveCityDistance, type ResolvedRoute } from '../lib/routing.ts';
import { num, parcelView, toIso } from '../lib/serialize.ts';
import { keyBelongsTo } from '../lib/storage.ts';
import { audit } from '../services/audit.ts';
import { loadTripRoutes } from '../services/trip-route.ts';

const createSchema = z
  .object({
    origin_city_id: z.string().uuid(),
    dest_city_id: z.string().uuid(),
    origin_area: z.string().min(2).max(80),
    dest_area: z.string().min(2).max(80),
    category: z.enum(CATEGORIES),
    description: z.string().min(5).max(300),
    weight_kg: z.number().gt(0).max(5),
    dims_cm: z.array(z.number().int().min(1).max(45)).length(3),
    declared_value_paise: z.number().int().min(100).max(500_000),
    window_start: z.string().datetime({ offset: true }).or(z.string().datetime()),
    window_end: z.string().datetime({ offset: true }).or(z.string().datetime()),
    receiver_name: z.string().min(2).max(80),
    receiver_phone: z.string().regex(/^\+91[6-9][0-9]{9}$/),
    sealed_photo_key: z.string().min(1).max(256).optional(),
    declaration_accepted: z.literal(true),
    declaration_version: z.string().max(32).optional(),
  })
  .strict();

export interface CityRow {
  id: string;
  name: string;
  state: string;
  lat: string | number;
  lng: string | number;
  is_serviceable: boolean;
  status?: string;
}

export interface ParcelRowFull {
  id: string;
  sender_id: string;
  status: string;
  origin_city_id: string;
  dest_city_id: string;
  origin_area: string;
  dest_area: string;
  category: string;
  description: string;
  weight_kg: unknown;
  dims_cm: number[];
  declared_value_paise: number;
  window_start: Date;
  window_end: Date;
  review_required: boolean;
  review_reason: string | null;
  created_at: Date;
}

/** Area names are free text; distances are only ever carried to one decimal. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export async function loadCity(app: FastifyInstance, id: string): Promise<CityRow> {
  const res = await app.db.query<CityRow>(`SELECT * FROM cities WHERE id = $1`, [id]);
  const row = res.rows[0];
  if (!row) throw new AppError('CITY_NOT_SERVICED', { city_id: id });
  return row;
}

async function loadOwnedParcel(app: FastifyInstance, parcelId: string, userId: string): Promise<ParcelRowFull> {
  const res = await app.db.query<ParcelRowFull>(`SELECT * FROM parcels WHERE id = $1`, [parcelId]);
  const row = res.rows[0];
  // Resource non-disclosure: someone else's parcel is indistinguishable from a missing one.
  if (!row || row.sender_id !== userId) throw new AppError('NOT_FOUND');
  return row;
}

export async function parcelRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.post('/parcels', async (req, reply) => {
    const auth = requireAuth(req);
    if (config.FEATURE_APP_READONLY) throw new AppError('FORBIDDEN', { reason: 'readonly' });
    const body = createSchema.parse(req.body);
    // The sealed photo must be an object this account uploaded; a borrowed key would attach
    // somebody else's image to this shipment. An absent photo stays absent — it is not faked.
    if (body.sealed_photo_key && !keyBelongsTo(body.sealed_photo_key, auth.userId)) {
      throw new AppError('VALIDATION_FAILED', { field: 'sealed_photo_key' }, 'Upload the photo again from this account.');
    }

    const [sender, origin, dest] = await Promise.all([
      db.query<{ status: string; phone_verified_at: Date | null; email_verified_at: Date | null; fraud_flag: boolean }>(
        `SELECT status, phone_verified_at, email_verified_at, fraud_flag FROM users WHERE id = $1`,
        [auth.userId],
      ),
      loadCity(app, body.origin_city_id),
      loadCity(app, body.dest_city_id),
    ]);

    const user = sender.rows[0];
    if (!user) throw new AppError('NOT_FOUND');
    if (origin.status && origin.status !== 'active') {
      throw new AppError('CITY_NOT_SERVICED', { city_id: origin.id, status: origin.status });
    }
    if (dest.status && dest.status !== 'active') {
      throw new AppError('CITY_NOT_SERVICED', { city_id: dest.id, status: dest.status });
    }

    const cancellations = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bookings
       WHERE sender_id = $1 AND status IN ('cancelled_by_sender','expired')
         AND created_at > now() - interval '30 days'`,
      [auth.userId],
    );

    const decision = evaluateEligibility({
      accountStatus: user.status as 'active' | 'suspended' | 'deleted',
      phoneVerified: Boolean(user.phone_verified_at),
      emailVerified: Boolean(user.email_verified_at),
      phoneVerificationRequired: config.PHONE_VERIFICATION_REQUIRED,
      category: body.category,
      description: body.description,
      weightKg: body.weight_kg,
      dimsCm: body.dims_cm,
      declaredValuePaise: body.declared_value_paise,
      originCityId: body.origin_city_id,
      destCityId: body.dest_city_id,
      originServiceable: origin.is_serviceable,
      destServiceable: dest.is_serviceable,
      windowStart: new Date(body.window_start),
      windowEnd: new Date(body.window_end),
      hasUnresolvedFraudFlag: user.fraud_flag,
      cancellationsLast30d: Number(cancellations.rows[0]?.count ?? 0),
    });

    if (!decision.ok) {
      const code = decision.code === 'SAME_CITY' ? 'CITY_NOT_SERVICED' : (decision.code as never);
      throw new AppError(code, { rule: decision.code }, decision.message);
    }

    const inserted = await db.query<ParcelRowFull>(
      `INSERT INTO parcels
        (sender_id, origin_city_id, dest_city_id, origin_area, dest_area, category, description,
         weight_kg, dims_cm, declared_value_paise, window_start, window_end,
         receiver_name, receiver_phone_hash, receiver_phone_last4,
         status, review_required, review_reason, sealed_photo_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'posted',$16,$17,$18)
       RETURNING *`,
      [
        auth.userId,
        body.origin_city_id,
        body.dest_city_id,
        body.origin_area,
        body.dest_area,
        body.category,
        body.description,
        body.weight_kg,
        body.dims_cm,
        body.declared_value_paise,
        new Date(body.window_start),
        new Date(body.window_end),
        body.receiver_name,
        phoneHash(body.receiver_phone),
        phoneLast4(body.receiver_phone),
        decision.reviewRequired,
        decision.reviewReason,
        body.sealed_photo_key || null,
      ],
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'parcel.created',
      resource: 'parcel',
      resourceId: inserted.rows[0]!.id,
      after: { category: body.category, review_required: decision.reviewRequired, rules: decision.passed },
    });

    return reply.code(decision.reviewRequired ? 202 : 201).send(parcelView(inserted.rows[0]! as never));
  });

  /**
   * The sender's own parcels, newest first.
   *
   * Without this the send wizard is the only place a parcel is ever visible: post it, close the tab,
   * and there is no way back to it — including when a traveller offers to carry it hours later. Each
   * row carries the offer count and the booking it resulted in so the list can say what needs
   * attention instead of leaving the account holder to guess.
   */
  app.get('/parcels', async (req) => {
    const auth = requireAuth(req);
    const q = z
      .object({
        status: z.enum(['draft', 'posted', 'matched', 'ineligible', 'cancelled', 'closed']).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .strict()
      .parse(req.query);

    const params: unknown[] = [auth.userId];
    let where = `p.sender_id = $1`;
    if (q.status) {
      params.push(q.status);
      where += ` AND p.status = $${params.length}`;
    }
    params.push(q.limit);

    const res = await db.query<
      ParcelRowFull & { interests_count: number; booking_id: string | null; booking_status: string | null }
    >(
      `SELECT p.*,
              (SELECT count(*) FROM trip_interests i WHERE i.parcel_id = p.id)::int AS interests_count,
              b.id AS booking_id,
              b.status::text AS booking_status
       FROM parcels p
       LEFT JOIN LATERAL (
         SELECT id, status FROM bookings bs
          WHERE bs.parcel_id = p.id
            AND bs.status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible',
                                  'cancelled_safety','expired','refunded','paid_out')
          ORDER BY bs.created_at DESC LIMIT 1
       ) b ON true
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return {
      items: res.rows.map((row) => ({
        ...parcelView(row as never),
        interests_count: row.interests_count,
        booking_id: row.booking_id,
        booking_status: row.booking_status,
      })),
    };
  });

  app.get<{ Params: { parcelId: string } }>('/parcels/:parcelId', async (req) => {
    const auth = requireAuth(req);
    const row = await loadOwnedParcel(app, req.params.parcelId, auth.userId);
    // The parcel page has to say whether the work is already taken, and get you to the booking that
    // took it. Without these two fields the page can only re-derive it from the matches endpoint.
    const held = await db.query<{ booking_id: string | null; booking_status: string | null }>(
      `SELECT id AS booking_id, status::text AS booking_status FROM bookings
       WHERE parcel_id = $1
         AND status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible',
                            'cancelled_safety','expired','refunded','paid_out')
       ORDER BY created_at DESC LIMIT 1`,
      [row.id],
    );
    return {
      ...parcelView(row as never),
      booking_id: held.rows[0]?.booking_id ?? null,
      booking_status: held.rows[0]?.booking_status ?? null,
    };
  });

  /**
   * Travellers who have offered to carry this parcel. The sender's side of the same table the
   * traveller writes to; it is only ever read by the parcel's own owner, and it names the traveller
   * because choosing them is the action the list exists for.
   */
  app.get<{ Params: { parcelId: string } }>('/parcels/:parcelId/interests', async (req) => {
    const auth = requireAuth(req);
    const parcel = await loadOwnedParcel(app, req.params.parcelId, auth.userId);

    const res = await db.query<{
      id: string;
      trip_id: string;
      traveller_id: string;
      created_at: Date;
      name: string | null;
      mode: string;
      origin_area: string | null;
      departure_at: Date;
      arrival_estimate_at: Date;
      capacity_kg_remaining: unknown;
      trip_status: string;
      verification_state: string | null;
    }>(
      `SELECT i.id, i.trip_id, i.traveller_id, i.created_at, u.name,
              t.mode::text AS mode, t.origin_area, t.departure_at, t.arrival_estimate_at,
              t.capacity_kg_remaining, t.status::text AS trip_status,
              (SELECT state FROM verifications v WHERE v.user_id = i.traveller_id ORDER BY v.created_at DESC LIMIT 1) AS verification_state
       FROM trip_interests i
       JOIN users u ON u.id = i.traveller_id
       JOIN trips t ON t.id = i.trip_id
       WHERE i.parcel_id = $1
       ORDER BY i.created_at`,
      [parcel.id],
    );

    return {
      parcel_id: parcel.id,
      items: res.rows.map((r) => ({
        trip_id: r.trip_id,
        traveller_first_name: r.name ? r.name.trim().split(/\s+/)[0] ?? null : null,
        verification_state: r.verification_state ?? 'not_started',
        mode: r.mode,
        origin_area: r.origin_area,
        departure_at: toIso(r.departure_at),
        arrival_estimate_at: toIso(r.arrival_estimate_at),
        capacity_kg_remaining: num(r.capacity_kg_remaining),
        trip_status: r.trip_status,
        offered_at: toIso(r.created_at),
      })),
    };
  });

  app.delete<{ Params: { parcelId: string } }>('/parcels/:parcelId', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadOwnedParcel(app, req.params.parcelId, auth.userId);

    const active = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bookings
       WHERE parcel_id = $1 AND status NOT IN ('cancelled_by_sender','cancelled_by_traveller',
         'cancelled_ineligible','cancelled_safety','expired','refunded','paid_out')`,
      [row.id],
    );
    if (Number(active.rows[0]?.count ?? 0) > 0) throw new AppError('PARCEL_HAS_ACTIVE_BOOKING');

    await db.query(`UPDATE parcels SET status = 'cancelled', updated_at = now() WHERE id = $1`, [row.id]);
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'parcel.cancelled',
      resource: 'parcel',
      resourceId: row.id,
    });
    return reply.code(204).send();
  });

  app.post<{ Params: { parcelId: string } }>('/parcels/:parcelId/quote', async (req, reply) => {
    const auth = requireAuth(req);
    const parcel = await loadOwnedParcel(app, req.params.parcelId, auth.userId);
    if (parcel.status !== 'posted' && parcel.status !== 'matched') throw new AppError('CONFLICT', { reason: 'parcel_not_posted' }, 'This parcel is not open for booking.');

    const existing = await db.query<{ id: string; expires_at: Date }>(
      `SELECT id, expires_at FROM quotes WHERE parcel_id = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [parcel.id],
    );
    if (existing.rows[0]) throw new AppError('CONFLICT', { quote_id: existing.rows[0].id }, 'A valid price already exists for this parcel.');

    const corridor = await loadCorridor(app, parcel);

    const matches = await computeMatches(app, parcel, auth.userId, corridor);
    if (matches.matches.length === 0) {
      throw new AppError('NO_MATCH', { no_match_reasons: matches.no_match_reasons });
    }

    if (corridor.route.kind === 'unavailable' || corridor.route.distanceKm === null) {
      throw new AppError('CITY_NOT_SERVICED', {
        reason: corridor.route.reason ?? 'distance_unresolved',
        route_status: corridor.route.routeStatus,
      });
    }

    const policy = await loadActivePolicy(db);
    const priced = quoteLaunchPrice({
      roadDistanceKm: corridor.route.distanceKm,
      distanceSource: corridor.route.source ?? 'estimated',
      actualWeightKg: num(parcel.weight_kg),
      dimsCm: parcel.dims_cm,
      category: parcel.category as Category,
      serviceMode: 'hub_to_hub',
      policy,
    });

    // The quote table predates the launch formula and requires subtotal + platform + tax = total.
    // `legacyQuoteColumns` performs that split; the full v2 decomposition lives in breakdown/inputs.
    const { subtotal_paise: subtotalPaise, platform_fee_paise: platformFeePaise } =
      legacyQuoteColumns(priced);

    const quoteInputs = {
      formula_version: priced.formula_version,
      policy_version: priced.policy_version,
      policy: policy,
      road_distance_km: priced.road_distance_km,
      distance_source: priced.distance_source,
      route_status: corridor.route.routeStatus,
      route_provider: corridor.route.provider,
      route_measured_at: corridor.route.travelledAt,
      actual_weight_kg: priced.actual_weight_kg,
      volumetric_weight_kg: priced.volumetric_weight_kg,
      billable_weight_kg: priced.billable_weight_kg,
      dims_cm: parcel.dims_cm,
      category: parcel.category,
      service_mode: 'hub_to_hub',
      commission_paise: priced.commission_paise,
      traveller_subsidy_paise: priced.traveller_subsidy_paise,
      discount_paise: priced.discount_paise,
      platform_net_paise: priced.platform_net_paise,
      loss_making: priced.loss_making,
      warnings: priced.warnings,
    };

    const expiresAt = new Date(Date.now() + config.QUOTE_TTL_SECONDS * 1000);

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO quotes
        (parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
         total_paise, traveller_paise, breakdown, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        parcel.id,
        priced.formula_version,
        JSON.stringify(quoteInputs),
        subtotalPaise,
        platformFeePaise,
        priced.tax_paise,
        priced.total_paise,
        priced.traveller_paise,
        JSON.stringify(priced.breakdown),
        expiresAt,
      ],
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'quote.created',
      resource: 'quote',
      resourceId: inserted.rows[0]!.id,
      after: {
        total_paise: priced.total_paise,
        formula_version: priced.formula_version,
        policy_version: priced.policy_version,
        distance_source: priced.distance_source,
        route_status: corridor.route.routeStatus,
        platform_net_paise: priced.platform_net_paise,
        loss_making: priced.loss_making,
      },
    });

    return reply.code(201).send({
      id: inserted.rows[0]!.id,
      formula_version: priced.formula_version,
      policy_version: priced.policy_version,
      subtotal_paise: subtotalPaise,
      platform_fee_paise: platformFeePaise,
      tax_paise: priced.tax_paise,
      total_paise: priced.total_paise,
      traveller_paise: priced.traveller_paise,
      commission_paise: priced.commission_paise,
      traveller_subsidy_paise: priced.traveller_subsidy_paise,
      discount_paise: priced.discount_paise,
      platform_net_paise: priced.platform_net_paise,
      loss_making: priced.loss_making,
      within_limits: priced.within_limits,
      warnings: priced.warnings,
      road_distance_km: priced.road_distance_km,
      distance_source: priced.distance_source,
      route_status: corridor.route.routeStatus,
      route_provider: corridor.route.provider,
      route_measured_at: corridor.route.travelledAt,
      billable_weight_kg: priced.billable_weight_kg,
      volumetric_weight_kg: priced.volumetric_weight_kg,
      service_mode: 'hub_to_hub',
      expires_at: toIso(expiresAt),
      breakdown: priced.breakdown,
    });
  });

  app.get<{ Params: { parcelId: string } }>(
    '/parcels/:parcelId/matches',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const auth = requireAuth(req);
      const limitQ = z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) }).strict().parse(req.query);
      const parcel = await loadOwnedParcel(app, req.params.parcelId, auth.userId);
      if (!config.FEATURE_MATCHING_ENABLED) {
        return { matches: [], low_confidence: false, no_match_reasons: [] };
      }
      const corridor = await loadCorridor(app, parcel);
      const limit = limitQ.limit;
      const result = await computeMatches(app, parcel, auth.userId, corridor);
      // `rejections` stays server-side: it names other users' trips and why they were withheld.
      return {
        matches: result.matches.slice(0, limit),
        low_confidence: result.low_confidence,
        no_match_reasons: result.no_match_reasons,
      };
    },
  );
}

interface Corridor {
  /** Measured road distance when one exists; otherwise the labelled estimate. */
  km: number;
  origin: CityRow;
  dest: CityRow;
  route: ResolvedRoute;
}

async function loadCorridor(app: FastifyInstance, parcel: ParcelRowFull): Promise<Corridor> {
  const res = await app.db.query<CityRow>(
    `SELECT id, name, state, lat, lng, is_serviceable, status FROM cities WHERE id = ANY($1::uuid[])`,
    [[parcel.origin_city_id, parcel.dest_city_id]],
  );
  const origin = res.rows.find((c) => c.id === parcel.origin_city_id);
  const dest = res.rows.find((c) => c.id === parcel.dest_city_id);
  if (!origin || !dest) throw new AppError('CITY_NOT_SERVICED', { parcel_id: parcel.id });

  const route = await resolveCityDistance(app.db, origin.id, dest.id);
  const estimateKm = corridorKm(
    { lat: Number(origin.lat), lng: Number(origin.lng) },
    { lat: Number(dest.lat), lng: Number(dest.lng) },
  );
  return {
    origin,
    dest,
    route,
    km: route.distanceKm ?? estimateKm,
  };
}

/**
 * Cities whose centroid lies within `km` of the parcel's origin city, by lat/lng box. The box is a
 * cheap prefilter; the engine itself measures the great-circle distance and applies the limit again.
 */
export async function nearbyCityIds(app: FastifyInstance, origin: CityRow, km: number): Promise<string[]> {
  if (km <= 0) return [origin.id];
  const lat = Number(origin.lat);
  const lng = Number(origin.lng);
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const res = await app.db.query<{ id: string }>(
    `SELECT id FROM cities
     WHERE is_serviceable AND (
       id = $1
       OR (lat BETWEEN $2 AND $3 AND lng BETWEEN $4 AND $5)
     )
     LIMIT 50`,
    [origin.id, lat - dLat, lat + dLat, lng - dLng, lng + dLng],
  );
  return res.rows.map((r) => r.id);
}

export async function computeMatches(
  app: FastifyInstance,
  parcel: ParcelRowFull,
  senderId: string,
  corridor: Corridor,
) {
  const policy = matchPolicy;
  const assigned = await app.db.query<{ assigned: boolean }>(
    // The status list is the predicate of the `bookings_one_active_per_parcel` partial index, written
    // out verbatim so this existence check can use that index. It is a compile-time constant.
    `SELECT EXISTS (
       SELECT 1 FROM bookings
       WHERE parcel_id = $1
         AND status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible',
                            'cancelled_safety','expired','refunded','paid_out')
     ) AS assigned`,
    [parcel.id],
  );

  const requiredKg = num(parcel.weight_kg) * policy.packagingAllowance;
  const originPoint = { lat: Number(corridor.origin.lat), lng: Number(corridor.origin.lng) };
  const destPoint = { lat: Number(corridor.dest.lat), lng: Number(corridor.dest.lng) };
  const pad = corridorPad(originPoint.lat, destPoint.lat, policy.maxCorridorKm);

  // Stage A. Two ways to be a candidate, and only two:
  //   1. the exact city pair — always valid, geometry or not; or
  //   2. the trip's stored route bounding box covers both of the parcel's cities, widened by the
  //      corridor limit. That is a plain btree comparison on four numeric columns; it deliberately
  //      does not use PostGIS, because Neon may not have it and a bounding box is enough to reject
  //      the obvious misses.
  // Eligibility is *not* decided here. The engine below still checks every gate; this query only
  // keeps the candidate set small enough to run without a routing call per trip.
  const res = await app.db.query<{
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
    status: string;
    accepts_documents_only: boolean;
    traveller_name: string | null;
    origin_lat: string | number;
    origin_lng: string | number;
  }>(
    `SELECT t.id, t.traveller_id, t.mode, t.origin_city_id, t.dest_city_id, t.origin_area, t.dest_area,
            t.departure_at, t.arrival_estimate_at, t.capacity_kg, t.capacity_kg_remaining, t.status,
            t.accepts_documents_only, u.name AS traveller_name, oc.lat AS origin_lat, oc.lng AS origin_lng
     FROM trips t
     JOIN cities oc ON oc.id = t.origin_city_id
     JOIN users u ON u.id = t.traveller_id
     WHERE t.status IN ('published','partially_booked')
       AND t.departure_at > now()
       AND t.departure_at <= $1
       AND t.capacity_kg_remaining >= $2
       AND (
         (t.origin_city_id = $3 AND t.dest_city_id = $4)
         OR (
           t.route_min_lat IS NOT NULL
           AND t.route_min_lat <= $5 AND t.route_max_lat >= $6
           AND t.route_min_lng <= $7 AND t.route_max_lng >= $8
           AND t.route_min_lat <= $9 AND t.route_max_lat >= $10
           AND t.route_min_lng <= $11 AND t.route_max_lng >= $12
         )
       )
     ORDER BY t.departure_at
     LIMIT $13`,
    [
      new Date(parcel.window_end),
      requiredKg,
      parcel.origin_city_id,
      parcel.dest_city_id,
      originPoint.lat + pad.lat,
      originPoint.lat - pad.lat,
      originPoint.lng + pad.lng,
      originPoint.lng - pad.lng,
      destPoint.lat + pad.lat,
      destPoint.lat - pad.lat,
      destPoint.lng + pad.lng,
      destPoint.lng - pad.lng,
      config.MATCH_CANDIDATE_SCAN_LIMIT,
    ],
  );

  const routes = await loadTripRoutes(
    app,
    res.rows.map((r) => r.id),
  );

  const travellerIds = [...new Set(res.rows.map((r) => r.traveller_id))];
  const verifications = await app.db.query<{ user_id: string; state: string }>(
    `SELECT DISTINCT ON (user_id) user_id, state
     FROM verifications
     WHERE user_id = ANY($1::uuid[])
     ORDER BY user_id, created_at DESC`,
    [travellerIds],
  );
  const verificationByUser = new Map(verifications.rows.map((r) => [r.user_id, r.state]));

  // docs/BUSINESS_LOGIC.md §9: reliability over the traveller's last 20 finished trips.
  const history = await app.db.query<{ traveller_id: string; completed: number; cancelled: number }>(
    `WITH recent AS (
       SELECT traveller_id, status,
              ROW_NUMBER() OVER (PARTITION BY traveller_id ORDER BY updated_at DESC, created_at DESC) AS rn
       FROM bookings
       WHERE traveller_id = ANY($1::uuid[])
         AND status IN ('delivered','payout_eligible','paid_out','cancelled_by_traveller')
     )
     SELECT traveller_id,
            count(*) FILTER (WHERE status IN ('delivered','payout_eligible','paid_out'))::int AS completed,
            count(*) FILTER (WHERE status = 'cancelled_by_traveller')::int AS cancelled
     FROM recent
     WHERE rn <= 20
     GROUP BY traveller_id`,
    [travellerIds],
  );
  const historyByUser = new Map(history.rows.map((r) => [r.traveller_id, r]));

  const candidates: TripCandidate[] = res.rows.map((r) => {
    const done = historyByUser.get(r.traveller_id);
    return {
      id: r.id,
      travellerId: r.traveller_id,
      mode: r.mode,
      originCityId: r.origin_city_id,
      destCityId: r.dest_city_id,
      originArea: r.origin_area,
      destArea: r.dest_area,
      originDetourKm:
        r.origin_city_id === parcel.origin_city_id
          ? 0
          : round1(haversineKm(originPoint, { lat: Number(r.origin_lat), lng: Number(r.origin_lng) })),
      route: routes.get(r.id)?.geometry ?? null,
      departureAt: new Date(r.departure_at),
      arrivalEstimateAt: new Date(r.arrival_estimate_at),
      capacityKg: num(r.capacity_kg),
      capacityKgRemaining: num(r.capacity_kg_remaining),
      status: r.status,
      acceptsDocumentsOnly: r.accepts_documents_only,
      travellerFirstName: r.traveller_name ? r.traveller_name.trim().split(/\s+/)[0] ?? null : null,
      travellerInitial: r.traveller_name
        ? (r.traveller_name.trim().split(/\s+/).slice(-1)[0]?.[0] ?? null)
        : null,
      verificationState: (verificationByUser.get(r.traveller_id) ?? 'not_started') as never,
      completedTrips: done?.completed ?? 0,
      travellerCancellations: done?.cancelled ?? 0,
    };
  });

  const result = rankMatches(
    {
      senderId,
      originCityId: parcel.origin_city_id,
      destCityId: parcel.dest_city_id,
      parcelOriginArea: parcel.origin_area,
      parcelDestArea: parcel.dest_area,
      parcelOrigin: originPoint,
      parcelDest: destPoint,
      originServiceable: corridor.origin.is_serviceable,
      destServiceable: corridor.dest.is_serviceable,
      category: parcel.category as Category,
      description: parcel.description,
      weightKg: num(parcel.weight_kg),
      dimsCm: parcel.dims_cm,
      windowStart: new Date(parcel.window_start),
      windowEnd: new Date(parcel.window_end),
      corridorKm: corridor.km,
      enabledModes: enabledModes(config),
      parcelStatus: parcel.status,
      parcelAlreadyAssigned: Boolean(assigned.rows[0]?.assigned),
      now: new Date(),
      policy,
    },
    candidates,
  );

  if (result.rejections.length > 0) {
    const byCode: Record<string, number> = {};
    for (const r of result.rejections) byCode[r.code] = (byCode[r.code] ?? 0) + 1;
    app.log.debug({ parcel_id: parcel.id, rejections: byCode }, 'matching rejections');
  }

  return result;
}

/**
 * Degrees of latitude/longitude that cover `km` at the parcel's latitude. Longitude degrees shrink
 * with latitude; the 0.2 floor keeps the padding finite near the poles, where a degree of longitude is
 * almost nothing and a division would otherwise explode.
 */
export function corridorPad(originLat: number, destLat: number, km: number): { lat: number; lng: number } {
  const midLat = (originLat + destLat) / 2;
  const lat = km / 111;
  const lng = km / (111 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  return { lat, lng };
}
