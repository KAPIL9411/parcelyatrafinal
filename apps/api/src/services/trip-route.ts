/**
 * Trip route geometry: measure it once, store it, reuse it for every match.
 *
 * Matching needs the road a traveller is actually taking, not the straight line between the two city
 * centroids. Measuring that line is the only part of corridor matching that touches the network, so
 * it is kept here and deliberately out of the request path:
 *
 *  - a trip is measured in the background after it is published (and re-measured after it expires);
 *  - the matching queries read the stored polyline and never call the provider per candidate;
 *  - if the provider is down, the trip is stored as `estimated` with a straight-line fallback that is
 *    labelled as such, or as `unavailable` — never as a road it did not measure.
 *
 * Nothing here is required for correctness of an exact city pair: a trip with no geometry still
 * matches a parcel with the same origin and destination. Geometry is what lets a Ghaziabad parcel ride
 * on a Delhi-bound trip.
 */
import type { FastifyInstance } from 'fastify';

import type { RouteGeometry, RouteSource } from '@py/domain';

import { config } from '../config.ts';
import { decodePolyline, encodePolyline } from '../lib/geo.ts';
import { getOsrmRoute } from './osrm.ts';

export type TripRouteStatus = 'pending' | 'ready' | 'estimated' | 'unavailable';

export interface TripRoute {
  geometry: RouteGeometry | null;
  status: TripRouteStatus;
  source: RouteSource | null;
  distanceKm: number | null;
}

interface RouteRow {
  id: string;
  route_geometry: string | null;
  route_distance_m: number | null;
  route_duration_s: number | null;
  route_source: string | null;
  route_status: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toStatus(value: string | null | undefined): TripRouteStatus {
  return value === 'ready' || value === 'estimated' || value === 'unavailable' ? value : 'pending';
}

function toSource(value: string | null | undefined): RouteSource | null {
  return value === 'routed' || value === 'estimated' ? value : null;
}

/**
 * Read stored geometry for a set of trips. One query, bounded by the caller's id list, no network.
 *
 * A row whose geometry fails to decode is returned as `pending` with `geometry: null`: corrupt data
 * must degrade to "exact matches only", not to a crash inside a match request.
 */
export async function loadTripRoutes(
  app: FastifyInstance,
  tripIds: readonly string[],
): Promise<Map<string, TripRoute>> {
  const out = new Map<string, TripRoute>();
  if (tripIds.length === 0) return out;

  const res = await app.db.query<RouteRow>(
    `SELECT id, route_geometry, route_distance_m, route_duration_s, route_source, route_status
     FROM trips WHERE id = ANY($1::uuid[])`,
    [tripIds],
  );

  for (const row of res.rows) {
    const status = toStatus(row.route_status);
    let geometry: RouteGeometry | null = null;
    if (row.route_geometry) {
      const points = decodePolyline(row.route_geometry);
      if (points.length >= 2) {
        geometry = {
          points,
          distanceM: Number(row.route_distance_m ?? 0),
          durationS: Number(row.route_duration_s ?? 0),
          source: toSource(row.route_source) ?? (status === 'estimated' ? 'estimated' : 'routed'),
        };
      }
    }
    out.set(row.id, {
      geometry,
      status: geometry ? status : status === 'ready' || status === 'estimated' ? 'pending' : status,
      source: toSource(row.route_source),
      distanceKm: row.route_distance_m === null ? null : Math.round(Number(row.route_distance_m) / 100) / 10,
    });
  }

  return out;
}

/**
 * Measure (or re-measure) one trip's route and store it.
 *
 * Safe to call concurrently and repeatedly: the write only lands if this attempt is newer than what
 * is already stored, so two requests that both notice a pending route cannot leave the row with the
 * older measurement. Failures are logged and recorded as `unavailable`; they never throw into a
 * request that only wanted to publish a trip.
 */
export async function ensureTripRoute(
  app: FastifyInstance,
  tripId: string,
  options: { force?: boolean } = {},
): Promise<TripRoute | null> {
  try {
    const found = await app.db.query<{
      id: string;
      origin_lat: string | number | null;
      origin_lng: string | number | null;
      dest_lat: string | number | null;
      dest_lng: string | number | null;
      route_status: string;
      route_expires_at: Date | null;
    }>(
      `SELECT t.id, oc.lat AS origin_lat, oc.lng AS origin_lng, dc.lat AS dest_lat, dc.lng AS dest_lng,
              t.route_status, t.route_expires_at
       FROM trips t
       JOIN cities oc ON oc.id = t.origin_city_id
       JOIN cities dc ON dc.id = t.dest_city_id
       WHERE t.id = $1`,
      [tripId],
    );
    const row = found.rows[0];
    if (!row) return null;

    const now = Date.now();
    const fresh =
      row.route_status !== 'pending' &&
      row.route_status !== 'unavailable' &&
      (!row.route_expires_at || new Date(row.route_expires_at).getTime() > now);
    if (!options.force && fresh) {
      const stored = await loadTripRoutes(app, [tripId]);
      return stored.get(tripId) ?? null;
    }

    const originLat = Number(row.origin_lat);
    const originLng = Number(row.origin_lng);
    const destLat = Number(row.dest_lat);
    const destLng = Number(row.dest_lng);
    if (![originLat, originLng, destLat, destLng].every(Number.isFinite)) {
      // A city without coordinates cannot have a route. Saying so is better than storing a route
      // between two (0, 0) points, which would then match parcels off the coast of Africa.
      await app.db.query(`UPDATE trips SET route_status = 'unavailable', route_source = NULL WHERE id = $1`, [tripId]);
      return { geometry: null, status: 'unavailable', source: null, distanceKm: null };
    }

    const result = await getOsrmRoute(originLat, originLng, destLat, destLng, `trip:${tripId}`);
    if (result.polyline.length < 2) {
      await app.db.query(`UPDATE trips SET route_status = 'unavailable', route_source = NULL WHERE id = $1`, [tripId]);
      return { geometry: null, status: 'unavailable', source: null, distanceKm: null };
    }

    const points = result.polyline;
    const lats = points.map((p) => p[0]);
    const lngs = points.map((p) => p[1]);
    const status: TripRouteStatus = result.source === 'routed' ? 'ready' : 'estimated';
    const source: RouteSource = result.source;
    // An estimate is retried much sooner than a measured road: the provider may simply have been
    // asleep, and a straight line is the weakest evidence the matcher can use.
    const ttlMs = (source === 'routed' ? config.MATCH_ROUTE_TTL_DAYS : 1) * DAY_MS;
    const computedAt = new Date();

    await app.db.query(
      `UPDATE trips
          SET route_geometry = $2,
              route_distance_m = $3,
              route_duration_s = $4,
              route_provider = 'osrm',
              route_source = $5,
              route_status = $6,
              route_computed_at = $7,
              route_expires_at = $8,
              route_min_lat = $9,
              route_max_lat = $10,
              route_min_lng = $11,
              route_max_lng = $12
        WHERE id = $1
          AND (route_computed_at IS NULL OR route_computed_at <= $7)`,
      [
        tripId,
        encodePolyline(points),
        Math.round(result.distanceMeters),
        Math.round(result.durationSeconds),
        source,
        status,
        computedAt,
        new Date(computedAt.getTime() + ttlMs),
        Math.min(...lats),
        Math.max(...lats),
        Math.min(...lngs),
        Math.max(...lngs),
      ],
    );

    return {
      geometry: {
        points,
        distanceM: Math.round(result.distanceMeters),
        durationS: Math.round(result.durationSeconds),
        source,
      },
      status,
      source,
      distanceKm: Math.round(result.distanceMeters / 100) / 10,
    };
  } catch (err) {
    app.log.warn({ err, trip_id: tripId }, 'trip route measurement failed');
    // Recorded, not thrown: the trip remains publishable and exact-endpoint matching still works.
    await app.db
      .query(`UPDATE trips SET route_status = 'unavailable', route_source = NULL WHERE id = $1`, [tripId])
      .catch(() => undefined);
    return null;
  }
}

/** Fire-and-forget wrapper for request handlers. Never blocks the response on a routing call. */
export function queueTripRoute(app: FastifyInstance, tripId: string): void {
  void ensureTripRoute(app, tripId).catch((err) => {
    app.log.warn({ err, trip_id: tripId }, 'queued trip route measurement failed');
  });
}

/**
 * Background queue: measure live trips that have no usable route, oldest departure first.
 *
 * Runs one at a time so a burst of new trips cannot hammer the public OSRM instance, and each tick is
 * unref'd so it never holds the process open. Idempotent by construction — the query selects work, it
 * does not claim it, and `ensureTripRoute` re-reads the row before writing.
 */
export function startRouteBackfill(app: FastifyInstance): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const due = await app.db.query<{ id: string }>(
        `SELECT id FROM trips
         WHERE status IN ('published','partially_booked')
           AND departure_at > now()
           AND (
             route_status IN ('pending','unavailable')
             OR (route_expires_at IS NOT NULL AND route_expires_at < now())
           )
         ORDER BY departure_at
         LIMIT $1`,
        [config.MATCH_ROUTE_BACKFILL_BATCH],
      );
      for (const row of due.rows) {
        if (stopped) return;
        await ensureTripRoute(app, row.id);
      }
    } catch (err) {
      app.log.warn({ err }, 'trip route backfill tick failed (non-fatal)');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), 10 * 60 * 1000);
        timer.unref();
      }
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
