import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { STAFF_ROLES } from '../lib/admin-access.ts';
import { makeAuthenticate, requireRole } from '../lib/auth.ts';
import { AppError } from '../lib/errors.ts';
import { parsePolicy, policyTunables } from '../lib/pricing-policy.ts';
import { refreshCityPairs, routingConfigured } from '../lib/routing.ts';
import { audit } from '../services/audit.ts';

/**
 * Staff controls for geography and pricing.
 *
 * The status ladders are enforced in the database (migration 0010) and again here so a staff member
 * gets a clear refusal instead of a constraint error:
 *
 *   hotspot:  candidate → verified → active        (verification is a separate field from status)
 *   route:    candidate → calculated → approved → operational
 *   policy:   draft → active → retired              (at most one active)
 *
 * Every write is audited with the before and after state.
 */

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

const hotspotPatch = z
  .object({
    address: z.string().min(2).max(200).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    service_radius_m: z.number().int().min(50).max(5_000).optional(),
    pickup_enabled: z.boolean().optional(),
    dropoff_enabled: z.boolean().optional(),
    service_modes: z.array(z.enum(['hub_to_hub', 'doorstep'])).min(1).optional(),
    operating_hours: z.record(z.string(), z.unknown()).optional(),
    max_weight_kg: z.number().positive().max(20).optional(),
    max_dimension_cm: z.number().int().positive().max(100).optional(),
    status: z.enum(['candidate', 'active', 'paused']).optional(),
    verification_status: z.enum(['unverified', 'verified', 'rejected', 'suspended']).optional(),
    verification_notes: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');

const hotspotVerify = z
  .object({
    decision: z.enum(['verify', 'reject', 'suspend']),
    notes: z.string().max(500).optional(),
  })
  .strict();

const routeDecision = z
  .object({
    action: z.enum(['approve', 'operational', 'retire']),
    notes: z.string().max(500).optional(),
  })
  .strict();

const refreshSchema = z
  .object({
    pairs: z
      .array(z.object({ origin_city_id: uuid, dest_city_id: uuid }).strict())
      .min(1)
      .max(10),
  })
  .strict();

const policyCreate = z
  .object({
    version: z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/i),
    name: z.string().min(2).max(120),
    params: z.record(z.string(), z.unknown()),
    notes: z.string().max(500).optional(),
  })
  .strict();

const benchmarkCreate = z
  .object({
    provider: z.string().min(2).max(60),
    service: z.string().min(2).max(60),
    category: z.string().min(2).max(60),
    weight_band: z.string().min(1).max(60),
    amount_paise: z.number().int().min(0),
    source_url: z.string().url().max(500),
    retrieved_at: isoDateTime,
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

interface HotspotRow {
  id: string;
  city_id: string;
  name: string;
  address: string | null;
  lat: number | string | null;
  lng: number | string | null;
  service_radius_m: number | null;
  pickup_enabled: boolean;
  dropoff_enabled: boolean;
  service_modes: string[];
  operating_hours: Record<string, unknown>;
  max_weight_kg: number | string | null;
  max_dimension_cm: number | null;
  verification_status: string;
  verification_notes: string | null;
  verified_by: string | null;
  verified_at: Date | null;
  status: string;
}

export async function adminGeoRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  app.addHook('preHandler', makeAuthenticate(db));

  app.get('/admin/geo/hotspots', async (req) => {
    requireRole(req, ...STAFF_ROLES);
    const q = z
      .object({
        city_id: uuid.optional(),
        status: z.enum(['candidate', 'active', 'paused', 'retired']).optional(),
        verification_status: z.enum(['unverified', 'verified', 'rejected', 'suspended']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .strict()
      .parse(req.query);

    const params: unknown[] = [];
    const where = ['1=1'];
    if (q.city_id) {
      params.push(q.city_id);
      where.push(`h.city_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`h.status = $${params.length}`);
    }
    if (q.verification_status) {
      params.push(q.verification_status);
      where.push(`h.verification_status = $${params.length}`);
    }
    params.push(q.limit);

    const res = await db.query<HotspotRow & { city: string; zone: string | null }>(
      `SELECT h.*, c.name AS city, z.name AS zone
       FROM hotspots h
       JOIN cities c ON c.id = h.city_id
       LEFT JOIN zones z ON z.id = h.zone_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.name, h.name
       LIMIT $${params.length}`,
      params,
    );

    return {
      items: res.rows.map((h) => ({
        id: h.id,
        city: h.city,
        city_id: h.city_id,
        zone: h.zone,
        name: h.name,
        address: h.address,
        lat: h.lat === null ? null : Number(h.lat),
        lng: h.lng === null ? null : Number(h.lng),
        service_radius_m: h.service_radius_m,
        pickup_enabled: h.pickup_enabled,
        dropoff_enabled: h.dropoff_enabled,
        service_modes: h.service_modes,
        operating_hours: h.operating_hours,
        max_weight_kg: h.max_weight_kg === null ? null : Number(h.max_weight_kg),
        max_dimension_cm: h.max_dimension_cm,
        status: h.status,
        verification_status: h.verification_status,
        verification_notes: h.verification_notes,
        verified_at: h.verified_at ? h.verified_at.toISOString() : null,
      })),
    };
  });

  app.patch<{ Params: { hotspotId: string } }>('/admin/geo/hotspots/:hotspotId', async (req) => {
    const auth = requireRole(req, 'trust_safety');
    uuid.parse(req.params.hotspotId);
    const body = hotspotPatch.parse(req.body);

    const current = await db.query<HotspotRow>(`SELECT * FROM hotspots WHERE id = $1`, [req.params.hotspotId]);
    const row = current.rows[0];
    if (!row) throw new AppError('NOT_FOUND');

    const lat = body.lat ?? (row.lat === null ? null : Number(row.lat));
    const lng = body.lng ?? (row.lng === null ? null : Number(row.lng));
    if ((lat === null) !== (lng === null)) {
      throw new AppError('VALIDATION_FAILED', { fields: ['lat', 'lng'] }, 'Both coordinates are required.');
    }
    const coordsChanged =
      (body.lat !== undefined && body.lat !== (row.lat === null ? null : Number(row.lat))) ||
      (body.lng !== undefined && body.lng !== (row.lng === null ? null : Number(row.lng)));

    let verificationStatus = body.verification_status ?? row.verification_status;
    // Moving a verified point invalidates that verification unless the operator re-verifies it in
    // the same request. An active point cannot silently keep its old approval at a new coordinate.
    if (coordsChanged && body.verification_status === undefined) {
      if (row.verification_status === 'verified') verificationStatus = 'unverified';
      if (row.status === 'active') {
        throw new AppError(
          'VALIDATION_FAILED',
          { reason: 'coordinates_changed_on_active_hotspot' },
          'Pause the hotspot or re-verify it in the same request before moving its coordinates.',
        );
      }
    }
    if (verificationStatus === 'verified' && (lat === null || lng === null)) {
      throw new AppError('VALIDATION_FAILED', { fields: ['lat', 'lng'] }, 'Verified hotspots need coordinates.');
    }

    const nextStatus = body.status ?? row.status;
    if (nextStatus === 'active' && (verificationStatus !== 'verified' || lat === null || lng === null)) {
      throw new AppError(
        'VALIDATION_FAILED',
        { reason: 'hotspot_not_verified' },
        'A hotspot can only be active after a human verification with coordinates.',
      );
    }

    const verified = verificationStatus === 'verified';
    const reverified = body.verification_status === 'verified';
    const verifiedBy = verified ? (reverified ? auth.userId : row.verified_by) : null;
    const verifiedAt = verified ? (reverified ? new Date() : row.verified_at) : null;

    const updated = await db.query<HotspotRow>(
      `UPDATE hotspots SET
         address = $2, lat = $3, lng = $4, service_radius_m = $5, pickup_enabled = $6,
         dropoff_enabled = $7, service_modes = $8, operating_hours = $9, max_weight_kg = $10,
         max_dimension_cm = $11, status = $12, verification_status = $13, verification_notes = $14,
         verified_by = $15, verified_at = $16, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        row.id,
        body.address ?? row.address,
        lat,
        lng,
        body.service_radius_m ?? row.service_radius_m,
        body.pickup_enabled ?? row.pickup_enabled,
        body.dropoff_enabled ?? row.dropoff_enabled,
        body.service_modes ?? row.service_modes,
        JSON.stringify(body.operating_hours ?? row.operating_hours),
        body.max_weight_kg ?? (row.max_weight_kg === null ? null : Number(row.max_weight_kg)),
        body.max_dimension_cm ?? row.max_dimension_cm,
        nextStatus,
        verificationStatus,
        body.verification_notes ?? row.verification_notes,
        verifiedBy,
        verifiedAt,
      ],
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'hotspot.updated',
      resource: 'hotspot',
      resourceId: row.id,
      before: {
        lat: row.lat === null ? null : Number(row.lat),
        lng: row.lng === null ? null : Number(row.lng),
        status: row.status,
        verification_status: row.verification_status,
        pickup_enabled: row.pickup_enabled,
        dropoff_enabled: row.dropoff_enabled,
      },
      after: {
        lat,
        lng,
        status: nextStatus,
        verification_status: verificationStatus,
        pickup_enabled: body.pickup_enabled ?? row.pickup_enabled,
        dropoff_enabled: body.dropoff_enabled ?? row.dropoff_enabled,
      },
    });

    const out = updated.rows[0]!;
    return {
      id: out.id,
      status: out.status,
      verification_status: out.verification_status,
      lat: out.lat === null ? null : Number(out.lat),
      lng: out.lng === null ? null : Number(out.lng),
      pickup_enabled: out.pickup_enabled,
      dropoff_enabled: out.dropoff_enabled,
      service_modes: out.service_modes,
    };
  });

  app.post<{ Params: { hotspotId: string } }>('/admin/geo/hotspots/:hotspotId/verify', async (req) => {
    const auth = requireRole(req, 'trust_safety');
    uuid.parse(req.params.hotspotId);
    const body = hotspotVerify.parse(req.body);

    const current = await db.query<HotspotRow>(`SELECT * FROM hotspots WHERE id = $1`, [req.params.hotspotId]);
    const row = current.rows[0];
    if (!row) throw new AppError('NOT_FOUND');

    if (body.decision === 'verify') {
      if (row.lat === null || row.lng === null) {
        throw new AppError(
          'VALIDATION_FAILED',
          { reason: 'coordinates_required' },
          'Set the hotspot coordinates before verifying it.',
        );
      }
      await db.query(
        `UPDATE hotspots SET verification_status = 'verified', verification_notes = $2,
                verified_by = $3, verified_at = now(), status = 'candidate', updated_at = now()
         WHERE id = $1`,
        [row.id, body.notes ?? row.verification_notes, auth.userId],
      );
    } else if (body.decision === 'reject') {
      await db.query(
        `UPDATE hotspots SET verification_status = 'rejected', verification_notes = $2,
                verified_by = NULL, verified_at = NULL, status = 'candidate', updated_at = now()
         WHERE id = $1`,
        [row.id, body.notes ?? row.verification_notes],
      );
    } else {
      await db.query(
        `UPDATE hotspots SET verification_status = 'suspended', verification_notes = $2,
                status = 'paused', updated_at = now()
         WHERE id = $1`,
        [row.id, body.notes ?? row.verification_notes],
      );
    }

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action:
        body.decision === 'verify'
          ? 'hotspot.verified'
          : body.decision === 'reject'
            ? 'hotspot.rejected'
            : 'hotspot.suspended',
      resource: 'hotspot',
      resourceId: row.id,
      before: { verification_status: row.verification_status, status: row.status },
      after: {
        verification_status:
          body.decision === 'verify' ? 'verified' : body.decision === 'reject' ? 'rejected' : 'suspended',
      },
    });

    return { id: row.id, decision: body.decision };
  });

  app.get('/admin/geo/routes', async (req) => {
    requireRole(req, ...STAFF_ROLES);
    const q = z
      .object({
        status: z
          .enum(['candidate', 'calculated', 'approved', 'operational', 'failed', 'retired'])
          .optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .strict()
      .parse(req.query);

    const params: unknown[] = [];
    let where = '1=1';
    if (q.status) {
      params.push(q.status);
      where = `e.status = $${params.length}`;
    }
    params.push(q.limit);

    const res = await db.query<{
      id: string;
      origin_city_id: string;
      dest_city_id: string;
      origin: string;
      dest: string;
      status: string;
      distance_m: number | null;
      duration_s: number | null;
      provider: string | null;
      calculated_at: Date | null;
      approved_at: Date | null;
      notes: string | null;
    }>(
      `SELECT e.id, e.origin_city_id, e.dest_city_id, o.name AS origin, d.name AS dest, e.status,
              e.distance_m, e.duration_s,
              e.provider, e.calculated_at, e.approved_at, e.notes
       FROM route_edges e
       JOIN cities o ON o.id = e.origin_city_id
       JOIN cities d ON d.id = e.dest_city_id
       WHERE ${where}
       ORDER BY o.name, d.name
       LIMIT $${params.length}`,
      params,
    );

    return {
      items: res.rows.map((r) => ({
        id: r.id,
        origin_city_id: r.origin_city_id,
        dest_city_id: r.dest_city_id,
        origin: r.origin,
        dest: r.dest,
        status: r.status,
        distance_km: r.distance_m === null ? null : Math.round(r.distance_m / 10) / 100,
        duration_minutes: r.duration_s === null ? null : Math.round(r.duration_s / 60),
        provider: r.provider,
        measured_at: r.calculated_at ? r.calculated_at.toISOString() : null,
        approved_at: r.approved_at ? r.approved_at.toISOString() : null,
        notes: r.notes,
      })),
    };
  });

  app.post<{ Params: { routeId: string } }>('/admin/geo/routes/:routeId/decision', async (req) => {
    const auth = requireRole(req, 'trust_safety');
    uuid.parse(req.params.routeId);
    const body = routeDecision.parse(req.body);

    const current = await db.query<{
      id: string;
      origin_city_id: string;
      dest_city_id: string;
      status: string;
      distance_m: number | null;
    }>(`SELECT id, origin_city_id, dest_city_id, status, distance_m FROM route_edges WHERE id = $1`, [
      req.params.routeId,
    ]);
    const row = current.rows[0];
    if (!row) throw new AppError('NOT_FOUND');

    if (body.action === 'approve') {
      if (row.distance_m === null) {
        throw new AppError('VALIDATION_FAILED', { reason: 'distance_required' }, 'Measure the route first.');
      }
      if (row.status !== 'calculated') {
        throw new AppError('CONFLICT', { status: row.status }, 'Only a calculated route can be approved.');
      }
      await db.query(
        `UPDATE route_edges SET status = 'approved', approved_by = $2, approved_at = now(),
                notes = COALESCE($3, notes), updated_at = now() WHERE id = $1`,
        [row.id, auth.userId, body.notes ?? null],
      );
    } else if (body.action === 'operational') {
      if (row.status !== 'approved') {
        throw new AppError('CONFLICT', { status: row.status }, 'Only an approved route can be made operational.');
      }
      const cities = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM cities WHERE id = ANY($1::uuid[])`,
        [[row.origin_city_id, row.dest_city_id]],
      );
      if (cities.rows.some((c) => c.status !== 'active')) {
        throw new AppError('CITY_NOT_SERVICED', { reason: 'endpoint_city_not_active' });
      }
      await db.query(
        `UPDATE route_edges SET status = 'operational', notes = COALESCE($2, notes), updated_at = now()
         WHERE id = $1`,
        [row.id, body.notes ?? null],
      );
    } else {
      await db.query(
        `UPDATE route_edges SET status = 'retired', notes = COALESCE($2, notes), updated_at = now()
         WHERE id = $1 AND status <> 'retired'`,
        [row.id, body.notes ?? null],
      );
    }

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: `route.${body.action}`,
      resource: 'route_edge',
      resourceId: row.id,
      before: { status: row.status, distance_m: row.distance_m },
      after: { status: body.action === 'retire' ? 'retired' : body.action === 'approve' ? 'approved' : 'operational' },
    });

    return { id: row.id, action: body.action };
  });

  app.post('/admin/geo/routes/refresh', async (req) => {
    const auth = requireRole(req, 'trust_safety');
    const body = refreshSchema.parse(req.body);
    if (!routingConfigured()) {
      throw new AppError(
        'ROUTING_UNAVAILABLE',
        { reason: 'routing_provider_not_configured' },
        'Configure ROUTING_PROVIDER=google and GOOGLE_MAPS_API_KEY before refreshing routes.',
      );
    }

    const summary = await refreshCityPairs(
      db,
      body.pairs.map((p) => ({ originCityId: p.origin_city_id, destCityId: p.dest_city_id })),
      { onlyMissing: false },
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'route.refreshed',
      resource: 'route_edge',
      after: summary,
      reasonCode: 'provider_matrix',
    });

    return summary;
  });

  app.get('/admin/geo/coverage', async (req) => {
    requireRole(req, ...STAFF_ROLES);
    const [cities, routes, hotspots, benchmarks, policies] = await Promise.all([
      db.query<{ status: string; n: string }>(
        `SELECT status, count(*)::text AS n FROM cities GROUP BY status ORDER BY status`,
      ),
      db.query<{ status: string; n: string; with_distance: string }>(
        `SELECT status, count(*)::text AS n,
                count(*) FILTER (WHERE distance_m IS NOT NULL)::text AS with_distance
         FROM route_edges GROUP BY status ORDER BY status`,
      ),
      db.query<{ city: string; total: string; verified: string; active: string; with_coords: string }>(
        `SELECT c.name AS city, count(h.id)::text AS total,
                count(*) FILTER (WHERE h.verification_status = 'verified')::text AS verified,
                count(*) FILTER (WHERE h.status = 'active')::text AS active,
                count(*) FILTER (WHERE h.lat IS NOT NULL)::text AS with_coords
         FROM cities c LEFT JOIN hotspots h ON h.city_id = c.id
         GROUP BY c.name ORDER BY c.name`,
      ),
      db.query<{ n: string }>(`SELECT count(*)::text AS n FROM postal_benchmarks`),
      db.query<{ version: string; status: string }>(
        `SELECT version, status FROM pricing_policies ORDER BY created_at DESC`,
      ),
    ]);

    const routeTotal = routes.rows.reduce((sum, r) => sum + Number(r.n), 0);
    const operational = Number(routes.rows.find((r) => r.status === 'operational')?.n ?? 0);
    const measured = routes.rows.reduce((sum, r) => sum + Number(r.with_distance), 0);

    return {
      cities: Object.fromEntries(cities.rows.map((r) => [r.status, Number(r.n)])),
      routes: {
        total: routeTotal,
        measured,
        operational,
        by_status: Object.fromEntries(routes.rows.map((r) => [r.status, Number(r.n)])),
        operational_share: routeTotal === 0 ? null : Math.round((operational / routeTotal) * 1000) / 1000,
      },
      hotspots: hotspots.rows.map((r) => ({
        city: r.city,
        total: Number(r.total),
        verified: Number(r.verified),
        active: Number(r.active),
        with_coordinates: Number(r.with_coords),
      })),
      postal_benchmarks: Number(benchmarks.rows[0]?.n ?? 0),
      pricing_policies: policies.rows,
    };
  });

  // ------------------------------------------------------------------ pricing policies

  app.get('/admin/geo/policies', async (req) => {
    requireRole(req, ...STAFF_ROLES);
    const res = await db.query<{
      id: string;
      version: string;
      name: string;
      params: Record<string, unknown>;
      status: string;
      notes: string | null;
      activated_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, version, name, params, status, notes, activated_at, created_at
       FROM pricing_policies ORDER BY created_at DESC`,
    );
    return {
      items: res.rows.map((r) => ({
        id: r.id,
        version: r.version,
        name: r.name,
        params: r.params,
        status: r.status,
        notes: r.notes,
        activated_at: r.activated_at ? r.activated_at.toISOString() : null,
        created_at: r.created_at.toISOString(),
      })),
    };
  });

  app.post('/admin/geo/policies', async (req, reply) => {
    const auth = requireRole(req, 'finance');
    const body = policyCreate.parse(req.body);
    // Validate by building the complete policy before it is stored, so a draft cannot be activated
    // into a mispriced state later.
    const validated = parsePolicy(body.version, body.params);

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO pricing_policies (version, name, params, status, notes, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5) RETURNING id`,
      [body.version, body.name, JSON.stringify(policyTunables(validated)), body.notes ?? null, auth.userId],
    );

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'pricing_policy.created',
      resource: 'pricing_policy',
      resourceId: inserted.rows[0]!.id,
      after: { version: body.version, params: policyTunables(validated) },
    });

    return reply.code(201).send({ id: inserted.rows[0]!.id, version: body.version, status: 'draft' });
  });

  app.post<{ Params: { policyId: string } }>('/admin/geo/policies/:policyId/activate', async (req) => {
    const auth = requireRole(req, 'finance');
    uuid.parse(req.params.policyId);

    const policy = await db.query<{
      id: string;
      version: string;
      params: Record<string, unknown>;
      status: string;
    }>(`SELECT id, version, params, status FROM pricing_policies WHERE id = $1`, [req.params.policyId]);
    const row = policy.rows[0];
    if (!row) throw new AppError('NOT_FOUND');
    if (row.status === 'retired') throw new AppError('CONFLICT', { status: row.status }, 'A retired policy cannot be reactivated.');
    if (row.status === 'active') return { id: row.id, version: row.version, status: 'active' };

    // Re-validate on activation: the row may have been edited since it was created.
    parsePolicy(row.version, row.params);

    await db.transaction(async (tx) => {
      await tx.query(`UPDATE pricing_policies SET status = 'retired' WHERE status = 'active' AND id <> $1`, [row.id]);
      await tx.query(
        `UPDATE pricing_policies SET status = 'active', activated_at = now() WHERE id = $1`,
        [row.id],
      );
    });

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'pricing_policy.activated',
      resource: 'pricing_policy',
      resourceId: row.id,
      after: { version: row.version },
    });

    return { id: row.id, version: row.version, status: 'active' };
  });

  // ------------------------------------------------------------------ postal benchmarks

  app.get('/admin/geo/benchmarks', async (req) => {
    requireRole(req, ...STAFF_ROLES);
    const res = await db.query<{
      id: string;
      provider: string;
      service: string;
      category: string;
      weight_band: string;
      amount_paise: number;
      source_url: string;
      retrieved_at: Date;
      effective_from: string | null;
      notes: string | null;
    }>(
      `SELECT id, provider, service, category, weight_band, amount_paise, source_url,
              retrieved_at, effective_from::text AS effective_from, notes
       FROM postal_benchmarks ORDER BY provider, service, category, weight_band`,
    );
    return {
      items: res.rows.map((r) => ({
        ...r,
        retrieved_at: r.retrieved_at.toISOString(),
      })),
      note: 'Third-party tariffs are recorded here and never copied into our own prices.',
    };
  });

  app.post('/admin/geo/benchmarks', async (req, reply) => {
    const auth = requireRole(req, 'finance');
    const body = benchmarkCreate.parse(req.body);

    // `effective_from` is nullable and NULLs are distinct in a unique constraint, so the conflict
    // target cannot dedupe an undated tariff. Delete the matching undated row explicitly.
    const inserted = await db.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM postal_benchmarks
         WHERE provider = $1 AND service = $2 AND category = $3 AND weight_band = $4
           AND effective_from IS NOT DISTINCT FROM $5::date`,
        [body.provider, body.service, body.category, body.weight_band, body.effective_from ?? null],
      );
      return tx.query<{ id: string }>(
        `INSERT INTO postal_benchmarks
           (provider, service, category, weight_band, amount_paise, source_url, retrieved_at,
            effective_from, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          body.provider,
          body.service,
          body.category,
          body.weight_band,
          body.amount_paise,
          body.source_url,
          new Date(body.retrieved_at),
          body.effective_from ?? null,
          body.notes ?? null,
        ],
      );
    });

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'postal_benchmark.recorded',
      resource: 'postal_benchmark',
      resourceId: inserted.rows[0]!.id,
      after: body,
    });

    return reply.code(201).send({ id: inserted.rows[0]!.id });
  });

  app.delete<{ Params: { benchmarkId: string } }>('/admin/geo/benchmarks/:benchmarkId', async (req, reply) => {
    const auth = requireRole(req, 'finance');
    uuid.parse(req.params.benchmarkId);
    const deleted = await db.query<{ id: string }>(
      `DELETE FROM postal_benchmarks WHERE id = $1 RETURNING id`,
      [req.params.benchmarkId],
    );
    if (!deleted.rows[0]) throw new AppError('NOT_FOUND');

    await audit(db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'postal_benchmark.deleted',
      resource: 'postal_benchmark',
      resourceId: deleted.rows[0].id,
    });
    return reply.code(204).send();
  });
}
