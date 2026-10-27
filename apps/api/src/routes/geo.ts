import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { resolveCityDistance } from '../lib/routing.ts';

/**
 * Public geography and serviceability.
 *
 * Nothing here equates "on the map" with "bookable". A route edge carries its own status
 * (candidate / calculated / approved / operational / failed), a distance carries its source
 * (routed / estimated), and a hotspot is only listed once it is verified and active.
 */

const uuid = z.string().uuid();

interface CityGeoRow {
  id: string;
  name: string;
  state: string;
  state_code: string | null;
  country_code: string | null;
  lat: number | string;
  lng: number | string;
  is_serviceable: boolean;
  status: string;
  coordinate_source: string | null;
  coordinate_verified_at: Date | null;
}

const toKm = (metres: number | null): number | null =>
  metres === null ? null : Math.round(metres / 10) / 100;

export async function geoRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get('/geo/cities', async () => {
    const [countries, states, cities, zones] = await Promise.all([
      db.query<{ code: string; name: string }>(
        `SELECT code, name FROM countries WHERE is_active ORDER BY name`,
      ),
      db.query<{ id: string; country_code: string; name: string; code: string | null; status: string }>(
        `SELECT id, country_code, name, code, status FROM states WHERE status <> 'retired' ORDER BY name`,
      ),
      db.query<CityGeoRow>(
        `SELECT c.id, c.name, c.state, s.code AS state_code, s.country_code,
                c.lat, c.lng, c.is_serviceable, c.status, c.coordinate_source, c.coordinate_verified_at
         FROM cities c LEFT JOIN states s ON s.id = c.state_id
         WHERE c.status <> 'retired'
         ORDER BY c.name`,
      ),
      db.query<{ city_id: string; id: string; name: string; status: string }>(
        `SELECT city_id, id, name, status FROM zones ORDER BY name`,
      ),
    ]);

    const zonesByCity = new Map<string, Array<{ id: string; name: string; status: string }>>();
    for (const zone of zones.rows) {
      const list = zonesByCity.get(zone.city_id) ?? [];
      list.push({ id: zone.id, name: zone.name, status: zone.status });
      zonesByCity.set(zone.city_id, list);
    }

    return {
      countries: countries.rows,
      states: states.rows,
      cities: cities.rows.map((c) => ({
        id: c.id,
        name: c.name,
        state: c.state,
        state_code: c.state_code,
        country_code: c.country_code,
        lat: Number(c.lat),
        lng: Number(c.lng),
        status: c.status,
        is_serviceable: c.is_serviceable,
        coordinate_source: c.coordinate_source,
        coordinate_verified_at: c.coordinate_verified_at ? c.coordinate_verified_at.toISOString() : null,
        zones: zonesByCity.get(c.id) ?? [],
      })),
    };
  });

  app.get<{ Params: { cityId: string } }>('/geo/cities/:cityId/hotspots', async (req) => {
    uuid.parse(req.params.cityId);
    const city = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM cities WHERE id = $1 AND status <> 'retired'`,
      [req.params.cityId],
    );
    if (!city.rows[0]) throw new AppError('NOT_FOUND');

    const [hotspots, withheld] = await Promise.all([
      db.query<{
        id: string;
        name: string;
        address: string | null;
        zone: string | null;
        lat: number | string;
        lng: number | string;
        service_radius_m: number | null;
        pickup_enabled: boolean;
        dropoff_enabled: boolean;
        service_modes: string[];
        operating_hours: Record<string, unknown>;
        max_weight_kg: number | string | null;
        max_dimension_cm: number | null;
        verified_at: Date | null;
      }>(
        `SELECT h.id, h.name, h.address, z.name AS zone, h.lat, h.lng, h.service_radius_m,
                h.pickup_enabled, h.dropoff_enabled, h.service_modes, h.operating_hours,
                h.max_weight_kg, h.max_dimension_cm, h.verified_at
         FROM hotspots h LEFT JOIN zones z ON z.id = h.zone_id
         WHERE h.city_id = $1 AND h.status = 'active' AND h.verification_status = 'verified'
         ORDER BY h.name`,
        [req.params.cityId],
      ),
      db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hotspots WHERE city_id = $1 AND status <> 'active'`,
        [req.params.cityId],
      ),
    ]);

    return {
      city_id: req.params.cityId,
      city_name: city.rows[0].name,
      hotspots: hotspots.rows.map((h) => ({
        id: h.id,
        name: h.name,
        address: h.address,
        zone: h.zone,
        lat: Number(h.lat),
        lng: Number(h.lng),
        service_radius_m: h.service_radius_m,
        pickup_enabled: h.pickup_enabled,
        dropoff_enabled: h.dropoff_enabled,
        service_modes: h.service_modes,
        operating_hours: h.operating_hours,
        max_weight_kg: h.max_weight_kg === null ? null : Number(h.max_weight_kg),
        max_dimension_cm: h.max_dimension_cm,
        verified_at: h.verified_at ? h.verified_at.toISOString() : null,
      })),
      // Candidates are counted, not shown: a location the operator has not verified is not an
      // authorised pickup or drop-off point.
      withheld_candidates: Number(withheld.rows[0]?.n ?? 0),
    };
  });

  app.get('/geo/routes', async (req) => {
    const q = z
      .object({
        origin_city_id: uuid.optional(),
        status: z
          .enum(['candidate', 'calculated', 'approved', 'operational', 'failed'])
          .optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .strict()
      .parse(req.query);

    const params: unknown[] = [];
    const where = ['e.status <> \'retired\''];
    if (q.origin_city_id) {
      params.push(q.origin_city_id);
      where.push(`e.origin_city_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`e.status = $${params.length}`);
    }
    params.push(q.limit);

    const res = await db.query<{
      id: string;
      origin_city_id: string;
      origin: string;
      dest_city_id: string;
      dest: string;
      status: string;
      distance_m: number | null;
      duration_s: number | null;
      provider: string | null;
      calculated_at: Date | null;
      approved_at: Date | null;
    }>(
      `SELECT e.id, e.origin_city_id, o.name AS origin, e.dest_city_id, d.name AS dest,
              e.status, e.distance_m, e.duration_s, e.provider, e.calculated_at, e.approved_at
       FROM route_edges e
       JOIN cities o ON o.id = e.origin_city_id
       JOIN cities d ON d.id = e.dest_city_id
       WHERE ${where.join(' AND ')}
       ORDER BY o.name, d.name
       LIMIT $${params.length}`,
      params,
    );

    return {
      items: res.rows.map((r) => ({
        id: r.id,
        origin_city_id: r.origin_city_id,
        origin: r.origin,
        dest_city_id: r.dest_city_id,
        dest: r.dest,
        status: r.status,
        distance_km: toKm(r.distance_m),
        duration_minutes: r.duration_s === null ? null : Math.round(r.duration_s / 60),
        provider: r.provider,
        measured_at: r.calculated_at ? r.calculated_at.toISOString() : null,
        approved_at: r.approved_at ? r.approved_at.toISOString() : null,
        bookable: r.status === 'operational' && r.distance_m !== null,
      })),
    };
  });

  app.get('/geo/serviceability', async (req) => {
    const q = z
      .object({
        origin_city_id: uuid,
        dest_city_id: uuid,
        origin_hotspot_id: uuid.optional(),
        dest_hotspot_id: uuid.optional(),
      })
      .strict()
      .parse(req.query);

    if (q.origin_city_id === q.dest_city_id) throw new AppError('CITY_NOT_SERVICED', { reason: 'same_city' });

    const cities = await db.query<{ id: string; name: string; status: string; is_serviceable: boolean }>(
      `SELECT id, name, status, is_serviceable FROM cities WHERE id = ANY($1::uuid[])`,
      [[q.origin_city_id, q.dest_city_id]],
    );
    const origin = cities.rows.find((c) => c.id === q.origin_city_id);
    const dest = cities.rows.find((c) => c.id === q.dest_city_id);
    if (!origin) throw new AppError('CITY_NOT_SERVICED', { city_id: q.origin_city_id });
    if (!dest) throw new AppError('CITY_NOT_SERVICED', { city_id: q.dest_city_id });

    const route = await resolveCityDistance(db, q.origin_city_id, q.dest_city_id);
    const citiesActive = origin.status === 'active' && dest.status === 'active';

    const hubReason = !citiesActive
      ? 'city_not_active'
      : !origin.is_serviceable || !dest.is_serviceable
        ? 'city_not_serviceable'
        : route.kind === 'unavailable'
          ? (route.reason ?? 'distance_unresolved')
          : null;

    const hotspots = await db.query<{
      id: string;
      city_id: string;
      pickup_enabled: boolean;
      dropoff_enabled: boolean;
      service_modes: string[];
      max_weight_kg: number | string | null;
      max_dimension_cm: number | null;
    }>(
      `SELECT id, city_id, pickup_enabled, dropoff_enabled, service_modes, max_weight_kg, max_dimension_cm
       FROM hotspots
       WHERE city_id = ANY($1::uuid[]) AND status = 'active' AND verification_status = 'verified'
       ORDER BY name`,
      [[q.origin_city_id, q.dest_city_id]],
    );

    const originHotspots = hotspots.rows.filter((h) => h.city_id === q.origin_city_id);
    const destHotspots = hotspots.rows.filter((h) => h.city_id === q.dest_city_id);
    const eligiblePickup = originHotspots.filter(
      (h) => h.pickup_enabled && h.service_modes.includes('doorstep'),
    );
    const eligibleDropoff = destHotspots.filter(
      (h) => h.dropoff_enabled && h.service_modes.includes('doorstep'),
    );

    let doorstepReason: string | null = null;
    if (hubReason) doorstepReason = hubReason;
    else if (eligiblePickup.length === 0) doorstepReason = 'no_verified_pickup_hotspot';
    else if (eligibleDropoff.length === 0) doorstepReason = 'no_verified_dropoff_hotspot';

    if (q.origin_hotspot_id) {
      const chosen = originHotspots.find((h) => h.id === q.origin_hotspot_id);
      if (!chosen) doorstepReason = 'origin_hotspot_not_verified';
      else if (!chosen.pickup_enabled) doorstepReason = 'origin_hotspot_no_pickup';
    }
    if (q.dest_hotspot_id) {
      const chosen = destHotspots.find((h) => h.id === q.dest_hotspot_id);
      if (!chosen) doorstepReason = 'dest_hotspot_not_verified';
      else if (!chosen.dropoff_enabled) doorstepReason = 'dest_hotspot_no_dropoff';
    }

    return {
      origin: { id: origin.id, name: origin.name, status: origin.status },
      dest: { id: dest.id, name: dest.name, status: dest.status },
      hub_to_hub: {
        bookable: hubReason === null,
        reason: hubReason,
        distance_km: route.distanceKm,
        distance_source: route.source,
        route_status: route.routeStatus,
        provider: route.provider,
        measured_at: route.travelledAt,
      },
      doorstep: {
        bookable: doorstepReason === null,
        reason: doorstepReason,
        origin_pickup_hotspots: eligiblePickup.length,
        dest_dropoff_hotspots: eligibleDropoff.length,
        origin_hotspot_id: q.origin_hotspot_id ?? null,
        dest_hotspot_id: q.dest_hotspot_id ?? null,
      },
      // A hotspot may cap weight or dimensions more tightly than the pilot limits.
      limits: {
        max_weight_kg: Math.min(
          config.PILOT_MAX_WEIGHT_KG,
          ...hotspots.rows.map((h) => (h.max_weight_kg === null ? Infinity : Number(h.max_weight_kg))),
        ),
        max_dimension_cm: Math.min(
          config.PILOT_MAX_DIMENSION_CM,
          ...hotspots.rows.map((h) => h.max_dimension_cm ?? Infinity),
        ),
      },
      notes: [
        'hub_to_hub bookable means a distance is resolvable for this direction; operational-route gating may still apply.',
        'doorstep requires a verified, active pickup hotspot at the origin and drop-off hotspot at the destination.',
      ],
    };
  });

  app.get('/geo/journeys', async (req) => {
    const q = z
      .object({
        origin_city_id: uuid,
        dest_city_id: uuid,
        max_legs: z.coerce.number().int().min(1).max(3).default(2),
        include_calculated: z.enum(['true', 'false']).default('false'),
      })
      .strict()
      .parse(req.query);

    if (q.origin_city_id === q.dest_city_id) throw new AppError('CITY_NOT_SERVICED', { reason: 'same_city' });

    const statuses =
      q.include_calculated === 'true'
        ? ['calculated', 'approved', 'operational']
        : ['operational'];

    const res = await db.query<{
      id: string;
      origin_city_id: string;
      origin: string;
      dest_city_id: string;
      dest: string;
      status: string;
      distance_m: number;
      provider: string | null;
      calculated_at: Date | null;
    }>(
      `SELECT e.id, e.origin_city_id, o.name AS origin, e.dest_city_id, d.name AS dest,
              e.status, e.distance_m, e.provider, e.calculated_at
       FROM route_edges e
       JOIN cities o ON o.id = e.origin_city_id
       JOIN cities d ON d.id = e.dest_city_id
       WHERE e.status = ANY($1::text[]) AND e.distance_m IS NOT NULL`,
      [statuses],
    );

    const adjacency = new Map<string, typeof res.rows>();
    for (const edge of res.rows) {
      const list = adjacency.get(edge.origin_city_id) ?? [];
      list.push(edge);
      adjacency.set(edge.origin_city_id, list);
    }

    // Dijkstra on measured distance, bounded by leg count. The graph is eight nodes; a full
    // shortest-path search is cheaper than a queue implementation and easier to reason about.
    interface Path {
      cityId: string;
      distanceM: number;
      legs: typeof res.rows;
    }
    const best = new Map<string, Path>();
    const start: Path = { cityId: q.origin_city_id, distanceM: 0, legs: [] };
    const queue: Path[] = [start];
    best.set(`${q.origin_city_id}:0`, start);
    let answer: Path | null = null;

    while (queue.length > 0) {
      queue.sort((a, b) => a.distanceM - b.distanceM);
      const current = queue.shift()!;
      if (current.cityId === q.dest_city_id) {
        answer = current;
        break;
      }
      if (current.legs.length >= q.max_legs) continue;

      for (const edge of adjacency.get(current.cityId) ?? []) {
        if (current.legs.some((l) => l.dest_city_id === edge.dest_city_id)) continue;
        const next: Path = {
          cityId: edge.dest_city_id,
          distanceM: current.distanceM + edge.distance_m,
          legs: [...current.legs, edge],
        };
        const key = `${next.cityId}:${next.legs.length}`;
        const known = best.get(key);
        if (!known || next.distanceM < known.distanceM) {
          best.set(key, next);
          queue.push(next);
        }
      }
    }

    if (!answer) {
      return {
        origin_city_id: q.origin_city_id,
        dest_city_id: q.dest_city_id,
        found: false,
        max_legs: q.max_legs,
        statuses_considered: statuses,
        legs: [],
        total_distance_km: null,
        bookable: false,
        reason: 'no_connected_route',
      };
    }

    const bookable =
      answer.legs.length === 1 &&
      answer.legs[0]!.status === 'operational' &&
      config.FEATURE_NEW_BOOKINGS_ENABLED;

    return {
      origin_city_id: q.origin_city_id,
      dest_city_id: q.dest_city_id,
      found: true,
      max_legs: q.max_legs,
      statuses_considered: statuses,
      legs: answer.legs.map((l) => ({
        edge_id: l.id,
        origin_city_id: l.origin_city_id,
        origin: l.origin,
        dest_city_id: l.dest_city_id,
        dest: l.dest,
        status: l.status,
        distance_km: toKm(l.distance_m),
        provider: l.provider,
        measured_at: l.calculated_at ? l.calculated_at.toISOString() : null,
      })),
      total_distance_km: toKm(answer.distanceM),
      bookable,
      note:
        answer.legs.length > 1
          ? 'A multi-leg plan is informational: bookings are single-traveller, and no custody handover between legs is implemented.'
          : null,
    };
  });
}
