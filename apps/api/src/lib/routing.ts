import { corridorKm } from '@py/domain';

import { config } from '../config.ts';
import type { Db } from '../db/client.ts';

/**
 * Road-distance routing.
 *
 * The request path never calls a routing provider. A quote reads, in order:
 *
 *   1. `route_edges`   — the reviewed row for this directed city pair;
 *   2. `distance_cache` — a successful provider response that has not expired;
 *   3. a labelled estimate, only when the deployment allows it.
 *
 * The matrix is filled out of band by `npm run geo:matrix`, which is the only caller of the
 * provider. That keeps latency and per-render cost off the user path, and it means a missing
 * credential produces an unresolved pair rather than an invented distance.
 */

export const ROUTING_PROVIDER_GOOGLE = 'google';
export const GOOGLE_ROUTES_ENDPOINT = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
/** Stored as `route_edges.provider` so the origin of a number is never ambiguous. */
export const GOOGLE_PROVIDER_TAG = 'google_routes';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface MatrixOrigin extends GeoPoint {
  /** Caller's opaque key (a city id in practice); echoed back on the element. */
  key: string;
}

export interface MatrixDestination extends GeoPoint {
  key: string;
}

export interface MatrixElement {
  originKey: string;
  destinationKey: string;
  distanceM: number | null;
  durationS: number | null;
  error: string | null;
}

export interface MatrixOptions {
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RawMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  status?: { code?: number; message?: string };
  condition?: string;
  distanceMeters?: number;
  duration?: string;
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

function parseRawElements(text: string): RawMatrixElement[] {
  // The endpoint returns a JSON array; older revisions streamed one object per line.
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? (parsed as RawMatrixElement[]) : [parsed as RawMatrixElement];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RawMatrixElement);
  }
}

/**
 * Calls Google's `computeRouteMatrix` for one block of origins × destinations. Throws only on a
 * transport or authentication failure; a per-pair failure is returned as an element with `error`,
 * so one bad pair does not discard the rest of the block.
 */
export async function computeRouteMatrix(
  origins: readonly MatrixOrigin[],
  destinations: readonly MatrixDestination[],
  opts: MatrixOptions,
): Promise<MatrixElement[]> {
  if (!opts.apiKey) throw new Error('routing provider key is missing');
  if (origins.length === 0 || destinations.length === 0) return [];

  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = {
    origins: origins.map((o) => ({
      waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
    })),
    destinations: destinations.map((d) => ({
      waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
  };

  const response = await fetchImpl(GOOGLE_ROUTES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': opts.apiKey,
      'X-Goog-FieldMask':
        'originIndex,destinationIndex,status,condition,distanceMeters,duration',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? config.ROUTING_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`routing provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const raw = parseRawElements(await response.text());
  return raw.map((element) => {
    const originIndex = element.originIndex ?? -1;
    const destinationIndex = element.destinationIndex ?? -1;
    const originKey = origins[originIndex]?.key;
    const destinationKey = destinations[destinationIndex]?.key;
    if (!originKey || !destinationKey) {
      throw new Error('routing provider returned an element with an unknown index');
    }

    const statusCode = element.status?.code ?? 0;
    const distanceM = typeof element.distanceMeters === 'number' && element.distanceMeters > 0
      ? Math.round(element.distanceMeters)
      : null;
    const durationS = parseDurationSeconds(element.duration);
    const providerError =
      statusCode !== 0
        ? element.status?.message || `provider status ${statusCode}`
        : element.condition && element.condition !== 'ROUTE_EXISTS'
          ? element.condition
          : distanceM === null
            ? 'provider returned no distance'
            : null;

    return {
      originKey,
      destinationKey,
      distanceM: providerError ? null : distanceM,
      durationS: providerError ? null : durationS,
      error: providerError,
    };
  });
}

export function routingConfigured(): boolean {
  return config.ROUTING_PROVIDER === ROUTING_PROVIDER_GOOGLE && Boolean(config.GOOGLE_MAPS_API_KEY);
}

/** Rounds metres to a two-decimal kilometre value; the engine treats it as an input, not a display. */
export function metresToKm(distanceM: number): number {
  return Math.round(distanceM / 10) / 100;
}

export type DistanceSource = 'routed' | 'estimated';

export interface ResolvedRoute {
  kind: 'routed' | 'estimated' | 'unavailable';
  /** Null only when `kind === 'unavailable'`. */
  distanceKm: number | null;
  source: DistanceSource | null;
  provider: string | null;
  /** `route_edges.status`, `cached`, or `unverified` for an estimate. */
  routeStatus: string | null;
  travelledAt: string | null;
  reason: string | null;
}

interface CityPointRow {
  id: string;
  name: string;
  lat: number | string;
  lng: number | string;
}

async function loadCityPoints(
  db: Db,
  originCityId: string,
  destCityId: string,
): Promise<{ origin: CityPointRow; dest: CityPointRow } | null> {
  const res = await db.query<CityPointRow>(
    `SELECT id, name, lat, lng FROM cities WHERE id = ANY($1::uuid[])`,
    [[originCityId, destCityId]],
  );
  const origin = res.rows.find((c) => c.id === originCityId);
  const dest = res.rows.find((c) => c.id === destCityId);
  return origin && dest ? { origin, dest } : null;
}

/**
 * Resolves the distance a quote should use for a directed city pair. Never invents a distance: the
 * estimate branch is explicit, labelled, and can be disabled from configuration.
 */
export async function resolveCityDistance(
  db: Db,
  originCityId: string,
  destCityId: string,
): Promise<ResolvedRoute> {
  if (originCityId === destCityId) {
    return {
      kind: 'unavailable',
      distanceKm: null,
      source: null,
      provider: null,
      routeStatus: null,
      travelledAt: null,
      reason: 'origin_equals_destination',
    };
  }

  const points = await loadCityPoints(db, originCityId, destCityId);
  if (!points) {
    return {
      kind: 'unavailable',
      distanceKm: null,
      source: null,
      provider: null,
      routeStatus: null,
      travelledAt: null,
      reason: 'city_unknown',
    };
  }

  const edge = await db.query<{
    status: string;
    distance_m: number | null;
    provider: string | null;
    calculated_at: Date | null;
  }>(
    `SELECT status, distance_m, provider, calculated_at
     FROM route_edges WHERE origin_city_id = $1 AND dest_city_id = $2`,
    [originCityId, destCityId],
  );
  const row = edge.rows[0];

  if (row?.distance_m) {
    if (config.REQUIRE_OPERATIONAL_ROUTE && row.status !== 'operational') {
      return {
        kind: 'unavailable',
        distanceKm: null,
        source: null,
        provider: row.provider,
        routeStatus: row.status,
        travelledAt: row.calculated_at ? row.calculated_at.toISOString() : null,
        reason: 'route_not_operational',
      };
    }
    return {
      kind: 'routed',
      distanceKm: metresToKm(row.distance_m),
      source: 'routed',
      provider: row.provider,
      routeStatus: row.status,
      travelledAt: row.calculated_at ? row.calculated_at.toISOString() : null,
      reason: null,
    };
  }

  const cached = await db.query<{
    distance_m: number;
    duration_s: number | null;
    provider: string;
    fetched_at: Date;
  }>(
    `SELECT distance_m, duration_s, provider, fetched_at
     FROM distance_cache
     WHERE from_kind = 'city' AND from_id = $1 AND to_kind = 'city' AND to_id = $2
       AND status = 'ok' AND distance_m IS NOT NULL AND expires_at > now()
     ORDER BY fetched_at DESC LIMIT 1`,
    [originCityId, destCityId],
  );
  const hit = cached.rows[0];
  if (hit) {
    if (config.REQUIRE_OPERATIONAL_ROUTE) {
      return {
        kind: 'unavailable',
        distanceKm: null,
        source: null,
        provider: hit.provider,
        routeStatus: 'cached',
        travelledAt: hit.fetched_at.toISOString(),
        reason: 'route_not_operational',
      };
    }
    return {
      kind: 'routed',
      distanceKm: metresToKm(hit.distance_m),
      source: 'routed',
      provider: hit.provider,
      routeStatus: 'cached',
      travelledAt: hit.fetched_at.toISOString(),
      reason: null,
    };
  }

  if (!config.ALLOW_ESTIMATED_DISTANCE) {
    return {
      kind: 'unavailable',
      distanceKm: null,
      source: null,
      provider: null,
      routeStatus: 'unresolved',
      travelledAt: null,
      reason: 'distance_unresolved',
    };
  }

  const km = corridorKm(
    { lat: Number(points.origin.lat), lng: Number(points.origin.lng) },
    { lat: Number(points.dest.lat), lng: Number(points.dest.lng) },
  );
  return {
    kind: 'estimated',
    distanceKm: km,
    source: 'estimated',
    provider: null,
    routeStatus: 'unverified',
    travelledAt: null,
    reason: 'no_measured_route',
  };
}

export interface RouteMeasurement extends MatrixElement {
  provider: string;
}

export interface RefreshSummary {
  pairs: number;
  resolved: number;
  failed: number;
  skippedApproved: number;
  errors: string[];
}

export interface RefreshOptions {
  /** Only refresh pairs that are candidate/failed or have no distance. */
  onlyMissing?: boolean;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Measures the given directed city pairs and records both the cache row and the route edge.
 * An `approved` or `operational` edge is never overwritten: those are operator decisions.
 */
export async function refreshCityPairs(
  db: Db,
  pairs: ReadonlyArray<{ originCityId: string; destCityId: string }>,
  opts: RefreshOptions = {},
): Promise<RefreshSummary> {
  const summary: RefreshSummary = {
    pairs: pairs.length,
    resolved: 0,
    failed: 0,
    skippedApproved: 0,
    errors: [],
  };
  if (pairs.length === 0) return summary;

  const apiKey = opts.apiKey ?? config.GOOGLE_MAPS_API_KEY ?? '';
  if (!apiKey) {
    summary.errors.push('GOOGLE_MAPS_API_KEY is not configured');
    summary.failed = pairs.length;
    return summary;
  }

  const cityIds = [...new Set(pairs.flatMap((p) => [p.originCityId, p.destCityId]))];
  const cities = await db.query<CityPointRow>(
    `SELECT id, name, lat, lng FROM cities WHERE id = ANY($1::uuid[])`,
    [cityIds],
  );
  const byId = new Map(cities.rows.map((c) => [c.id, c]));
  const coords = (id: string) => {
    const city = byId.get(id);
    if (!city) throw new Error(`city ${id} does not exist`);
    return { lat: Number(city.lat), lng: Number(city.lng) };
  };

  const statuses = await db.query<{
    origin_city_id: string;
    dest_city_id: string;
    status: string;
    distance_m: number | null;
  }>(
    `SELECT origin_city_id, dest_city_id, status, distance_m FROM route_edges
     WHERE origin_city_id = ANY($1::uuid[])`,
    [cityIds],
  );
  const edgeByPair = new Map(
    statuses.rows.map((r) => [`${r.origin_city_id}:${r.dest_city_id}`, r]),
  );

  const wanted = pairs.filter((p) => {
    const edge = edgeByPair.get(`${p.originCityId}:${p.destCityId}`);
    if (!edge) return true;
    if (edge.status === 'approved' || edge.status === 'operational') {
      summary.skippedApproved += 1;
      return false;
    }
    return !(opts.onlyMissing !== false && edge.distance_m !== null && edge.status === 'calculated');
  });

  const byOrigin = new Map<string, string[]>();
  for (const pair of wanted) {
    const list = byOrigin.get(pair.originCityId) ?? [];
    list.push(pair.destCityId);
    byOrigin.set(pair.originCityId, list);
  }

  const maxElements = config.ROUTING_MAX_ELEMENTS_PER_CALL;
  const cacheTtlDays = config.ROUTES_CACHE_TTL_DAYS;

  for (const [originCityId, destIds] of byOrigin) {
    const uniqueDest = [...new Set(destIds)];
    // One origin at a time keeps each call inside the element cap without splitting an origin's
    // destination list across calls in a way that duplicates cache writes.
    const chunkSize = Math.max(1, Math.min(uniqueDest.length, maxElements));
    for (let i = 0; i < uniqueDest.length; i += chunkSize) {
      const chunk = uniqueDest.slice(i, i + chunkSize);
      let elements: MatrixElement[];
      try {
        elements = await computeRouteMatrix(
          [{ key: originCityId, ...coords(originCityId) }],
          chunk.map((id) => ({ key: id, ...coords(id) })),
          { apiKey, timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push(message);
        for (const destId of chunk) {
          await recordFailure(db, originCityId, destId, message, cacheTtlDays);
          summary.failed += 1;
        }
        continue;
      }

      for (const element of elements) {
        if (element.error) {
          await recordFailure(db, element.originKey, element.destinationKey, element.error, cacheTtlDays);
          summary.failed += 1;
          continue;
        }
        await recordSuccess(db, element, cacheTtlDays);
        summary.resolved += 1;
      }
    }
  }

  return summary;
}

async function recordSuccess(db: Db, element: MatrixElement, ttlDays: number): Promise<void> {
  if (element.distanceM === null) return;
  const distanceM = element.distanceM;
  const durationS = element.durationS;
  await db.query(
    `INSERT INTO distance_cache
       (from_kind, from_id, to_kind, to_id, provider, status, distance_m, duration_s, fetched_at, expires_at)
     VALUES ('city',$1,'city',$2,$3,'ok',$4,$5, now(), now() + ($6 * interval '1 day'))
     ON CONFLICT (from_kind, from_id, to_kind, to_id, provider)
     DO UPDATE SET status='ok', distance_m=EXCLUDED.distance_m, duration_s=EXCLUDED.duration_s,
       error=NULL, fetched_at=now(), expires_at=EXCLUDED.expires_at`,
    [element.originKey, element.destinationKey, GOOGLE_PROVIDER_TAG, distanceM, durationS, ttlDays],
  );
  // Distance and duration are refreshed on a calculated/candidate row; an operator-approved row
  // keeps the numbers that were signed off.
  await db.query(
    `UPDATE route_edges
     SET distance_m = CASE WHEN status IN ('approved','operational') THEN distance_m ELSE $3 END,
         duration_s = CASE WHEN status IN ('approved','operational') THEN duration_s ELSE $4 END,
         provider = CASE WHEN status IN ('approved','operational') THEN provider ELSE $5 END,
         status = CASE WHEN status IN ('approved','operational') THEN status ELSE 'calculated' END,
         calculated_at = now(), updated_at = now()
     WHERE origin_city_id = $1 AND dest_city_id = $2`,
    [element.originKey, element.destinationKey, distanceM, durationS, GOOGLE_PROVIDER_TAG],
  );
}

async function recordFailure(
  db: Db,
  originCityId: string,
  destCityId: string,
  error: string,
  ttlDays: number,
): Promise<void> {
  await db.query(
    `INSERT INTO distance_cache
       (from_kind, from_id, to_kind, to_id, provider, status, error, fetched_at, expires_at)
     VALUES ('city',$1,'city',$2,$3,'failed',$4, now(), now() + ($5 * interval '1 day'))
     ON CONFLICT (from_kind, from_id, to_kind, to_id, provider)
     DO UPDATE SET status='failed', distance_m=NULL, duration_s=NULL, error=EXCLUDED.error,
       fetched_at=now(), expires_at=EXCLUDED.expires_at`,
    [originCityId, destCityId, GOOGLE_PROVIDER_TAG, error.slice(0, 500), ttlDays],
  );
  await db.query(
    `UPDATE route_edges SET status = 'failed', updated_at = now()
     WHERE origin_city_id = $1 AND dest_city_id = $2 AND status IN ('candidate','calculated')`,
    [originCityId, destCityId],
  );
}
