import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  CATEGORIES,
  corridorKm,
  evaluateEligibility,
  rankMatches,
  quotePrice,
  type Category,
  type TransportMode,
} from '@py/domain';

import { config, enabledModes } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { phoneHash, phoneLast4 } from '../lib/crypto.ts';
import { num, parcelView, toIso } from '../lib/serialize.ts';
import { audit } from '../services/audit.ts';

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
    sealed_photo_key: z.string().max(256),
    declaration_accepted: z.literal(true),
    declaration_version: z.string().max(32).optional(),
  })
  .strict();

interface CityRow {
  id: string;
  name: string;
  state: string;
  lat: string | number;
  lng: string | number;
  is_serviceable: boolean;
}

interface ParcelRowFull {
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

async function loadCity(app: FastifyInstance, id: string): Promise<CityRow> {
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

    const [sender, origin, dest] = await Promise.all([
      db.query<{ status: string; phone_verified_at: Date | null; fraud_flag: boolean }>(
        `SELECT status, phone_verified_at, fraud_flag FROM users WHERE id = $1`,
        [auth.userId],
      ),
      loadCity(app, body.origin_city_id),
      loadCity(app, body.dest_city_id),
    ]);

    const user = sender.rows[0];
    if (!user) throw new AppError('NOT_FOUND');

    const cancellations = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bookings
       WHERE sender_id = $1 AND status IN ('cancelled_by_sender','expired')
         AND created_at > now() - interval '30 days'`,
      [auth.userId],
    );

    const decision = evaluateEligibility({
      accountStatus: user.status as 'active' | 'suspended' | 'deleted',
      phoneVerified: Boolean(user.phone_verified_at),
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

  app.get<{ Params: { parcelId: string } }>('/parcels/:parcelId', async (req) => {
    const auth = requireAuth(req);
    const row = await loadOwnedParcel(app, req.params.parcelId, auth.userId);
    return parcelView(row as never);
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

    const [origin, dest] = await Promise.all([
      loadCity(app, parcel.origin_city_id),
      loadCity(app, parcel.dest_city_id),
    ]);
    const km = corridorKm(
      { lat: Number(origin.lat), lng: Number(origin.lng) },
      { lat: Number(dest.lat), lng: Number(dest.lng) },
    );

    const matches = await computeMatches(app, parcel, auth.userId, km);
    if (matches.matches.length === 0) {
      throw new AppError('NO_MATCH', { no_match_reasons: matches.no_match_reasons });
    }

    const priced = quotePrice({
      corridorKm: km,
      weightKg: num(parcel.weight_kg),
      category: parcel.category as Category,
    });
    const expiresAt = new Date(Date.now() + config.QUOTE_TTL_SECONDS * 1000);

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO quotes
        (parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
         total_paise, traveller_paise, breakdown, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        parcel.id,
        priced.formula_version,
        JSON.stringify(priced.inputs),
        priced.subtotal_paise,
        priced.platform_fee_paise,
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
      after: { total_paise: priced.total_paise, formula_version: priced.formula_version },
    });

    return reply.code(201).send({
      id: inserted.rows[0]!.id,
      formula_version: priced.formula_version,
      subtotal_paise: priced.subtotal_paise,
      platform_fee_paise: priced.platform_fee_paise,
      tax_paise: priced.tax_paise,
      total_paise: priced.total_paise,
      traveller_paise: priced.traveller_paise,
      expires_at: toIso(expiresAt),
      breakdown: priced.breakdown,
    });
  });

  app.get<{ Params: { parcelId: string }; Querystring: { limit?: string } }>(
    '/parcels/:parcelId/matches',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const auth = requireAuth(req);
      const parcel = await loadOwnedParcel(app, req.params.parcelId, auth.userId);
      if (!config.FEATURE_MATCHING_ENABLED) {
        return { matches: [], low_confidence: false, no_match_reasons: [] };
      }
      const [origin, dest] = await Promise.all([
        loadCity(app, parcel.origin_city_id),
        loadCity(app, parcel.dest_city_id),
      ]);
      const km = corridorKm(
        { lat: Number(origin.lat), lng: Number(origin.lng) },
        { lat: Number(dest.lat), lng: Number(dest.lng) },
      );
      const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 10) || 10));
      const result = await computeMatches(app, parcel, auth.userId, km);
      return { ...result, matches: result.matches.slice(0, limit) };
    },
  );
}

export async function computeMatches(
  app: FastifyInstance,
  parcel: ParcelRowFull,
  senderId: string,
  km: number,
) {
  const res = await app.db.query<{
    id: string;
    traveller_id: string;
    mode: TransportMode;
    origin_city_id: string;
    dest_city_id: string;
    departure_at: Date;
    arrival_estimate_at: Date;
    capacity_kg: unknown;
    capacity_kg_remaining: unknown;
    status: string;
    accepts_documents_only: boolean;
    traveller_name: string | null;
    verification_state: string | null;
  }>(
    `SELECT t.id, t.traveller_id, t.mode, t.origin_city_id, t.dest_city_id, t.departure_at,
            t.arrival_estimate_at, t.capacity_kg, t.capacity_kg_remaining, t.status,
            t.accepts_documents_only, u.name AS traveller_name,
            (SELECT v.state FROM verifications v WHERE v.user_id = t.traveller_id ORDER BY v.created_at DESC LIMIT 1) AS verification_state
     FROM trips t JOIN users u ON u.id = t.traveller_id
     WHERE t.origin_city_id = $1 AND t.dest_city_id = $2
       AND t.status IN ('published','partially_booked')
       AND t.departure_at > now()`,
    [parcel.origin_city_id, parcel.dest_city_id],
  );

  const completed = await app.db.query<{ traveller_id: string; done: string }>(
    `SELECT traveller_id, count(*)::text AS done FROM bookings
     WHERE status IN ('delivered','payout_eligible','paid_out')
     GROUP BY traveller_id`,
  );
  const doneMap = new Map(completed.rows.map((r) => [r.traveller_id, Number(r.done)]));

  return rankMatches(
    {
      senderId,
      originCityId: parcel.origin_city_id,
      destCityId: parcel.dest_city_id,
      originServiceable: true,
      destServiceable: true,
      category: parcel.category as Category,
      weightKg: num(parcel.weight_kg),
      windowStart: new Date(parcel.window_start),
      windowEnd: new Date(parcel.window_end),
      corridorKm: km,
      enabledModes: enabledModes(config),
      now: new Date(),
    },
    res.rows.map((r) => {
      const done = doneMap.get(r.traveller_id) ?? 0;
      return {
        id: r.id,
        travellerId: r.traveller_id,
        mode: r.mode,
        originCityId: r.origin_city_id,
        destCityId: r.dest_city_id,
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
        verificationState: (r.verification_state ?? 'not_started') as never,
        reliabilityBand: done >= 20 ? 'highly_reliable' : done >= 5 ? 'reliable' : done >= 1 ? 'building' : 'new',
        completedTrips: done,
      };
    }),
  );
}
