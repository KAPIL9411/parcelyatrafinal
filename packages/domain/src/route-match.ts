/**
 * Route-corridor geometry for matching.
 *
 * The old engine could only answer "does this trip end exactly where the parcel ends?". That is the
 * wrong question for a marketplace built on people who are already driving: a traveller going
 * Bareilly → Delhi passes Ghaziabad, and a parcel for Ghaziabad is a perfectly good parcel.
 *
 * This module answers the right question, and it does so with arithmetic only — no database, no
 * network, no clock. That is deliberate:
 *
 *  - the API can run it inside a request without a routing call per candidate;
 *  - the tests can drive it with a fixed polyline, so a passing test means the geometry is right and
 *    not that a third-party service happened to be up;
 *  - "is this parcel on the way?" has exactly one implementation, shared by the sender's list and the
 *    traveller's list, so the two can never disagree.
 *
 * The route is a polyline of `[lat, lng]` pairs in travel order. Everything is measured in metres
 * along that polyline; perpendicular distance is the distance from a point to its nearest projection
 * on the line. Both are local tangent-plane approximations, which is accurate to well under a metre
 * at the scale of a city and cheap enough to run over a thousand-point route.
 *
 * What this module refuses to do:
 *  - it never treats a straight line as a road. A route whose source is `estimated` is returned with
 *    that label so callers can decide to trust it less;
 *  - it never snaps a point that is far away onto the route and calls it a match. Offset and detour
 *    are checked against explicit limits and the reason for a refusal is returned.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** How the geometry was obtained. `estimated` is a straight line, not a road. */
export type RouteSource = 'routed' | 'estimated';

export interface RouteGeometry {
  /** Ordered `[lat, lng]` points. At least two. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Road distance in metres. May exceed the polyline's chord length; the index scales to it. */
  distanceM: number;
  durationS: number;
  source: RouteSource;
}

export interface RouteIndex {
  readonly points: ReadonlyArray<readonly [number, number]>;
  /** Distance from the start to each point, metres. Same length as `points`. */
  readonly cumulative: ReadonlyArray<number>;
  readonly totalM: number;
  readonly durationS: number;
  readonly source: RouteSource;
}

export interface RouteProjection {
  /** Metres from the trip origin, along the route. */
  alongM: number;
  /** Perpendicular distance from the route, metres. */
  offsetM: number;
  /** `alongM / totalM`, in 0..1. */
  fraction: number;
  snapped: [number, number];
}

const EARTH_RADIUS_M = 6_371_000;
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

/** Great-circle distance in metres. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * TO_RAD;
  const dLng = (bLng - aLng) * TO_RAD;
  const rLat1 = aLat * TO_RAD;
  const rLat2 = bLat * TO_RAD;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/**
 * Build the measuring stick. Returns null for anything that cannot describe a route, so a caller
 * with missing geometry gets `null` rather than a zero-length route that would match everything.
 */
export function buildRouteIndex(geometry: RouteGeometry | null | undefined): RouteIndex | null {
  if (!geometry) return null;
  const points = geometry.points;
  if (!Array.isArray(points) || points.length < 2) return null;

  const cumulative: number[] = [0];
  let chord = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (!previous || !current) return null;
    if (!Number.isFinite(previous[0]) || !Number.isFinite(previous[1])) return null;
    if (!Number.isFinite(current[0]) || !Number.isFinite(current[1])) return null;
    chord += haversineMeters(previous[0], previous[1], current[0], current[1]);
    cumulative.push(chord);
  }
  if (!(chord > 0)) return null;

  // A provider's road distance is longer than the sum of straight chords between its own points, and
  // it is the distance a quote and an ETA are built on. Scaling the cumulative table keeps "along
  // this route" in the same units as the route itself.
  const distanceM = Number.isFinite(geometry.distanceM) && geometry.distanceM > 0 ? geometry.distanceM : chord;
  const scale = distanceM / chord;
  const durationS = Number.isFinite(geometry.durationS) && geometry.durationS > 0 ? geometry.durationS : 0;

  return {
    points,
    cumulative: cumulative.map((value) => value * scale),
    totalM: distanceM,
    durationS,
    source: geometry.source,
  };
}

/**
 * Project a point onto the route.
 *
 * The nearest segment wins. Ties go to the earlier segment, which makes the result deterministic for
 * a route that doubles back on itself — an out-and-back trip has two projections for the same place
 * and "where did I pass it first" is the useful answer for a pickup.
 */
export function projectPoint(route: RouteIndex, point: GeoPoint): RouteProjection | null {
  const { points, cumulative } = route;
  if (points.length < 2) return null;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;

  let best: RouteProjection | null = null;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;

    const cosLat = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
    const startAlong = cumulative[i] ?? 0;
    const endAlong = cumulative[i + 1] ?? startAlong;

    const bx = (b[1] - a[1]) * TO_RAD * EARTH_RADIUS_M * cosLat;
    const by = (b[0] - a[0]) * TO_RAD * EARTH_RADIUS_M;
    const px = (point.lng - a[1]) * TO_RAD * EARTH_RADIUS_M * cosLat;
    const py = (point.lat - a[0]) * TO_RAD * EARTH_RADIUS_M;

    const lengthSq = bx * bx + by * by;
    let t = lengthSq > 0 ? (px * bx + py * by) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));

    const projX = t * bx;
    const projY = t * by;
    const offsetM = Math.hypot(px - projX, py - projY);
    const alongM = startAlong + t * (endAlong - startAlong);

    if (!best || offsetM < best.offsetM) {
      best = {
        alongM,
        offsetM,
        fraction: route.totalM > 0 ? alongM / route.totalM : 0,
        snapped: [
          a[0] + (projY / EARTH_RADIUS_M) * TO_DEG,
          a[1] + (projX / (EARTH_RADIUS_M * Math.max(0.01, cosLat))) * TO_DEG,
        ],
      };
    }
  }

  return best;
}

export type CorridorRejectReason =
  /** No usable geometry and the endpoints are not an exact city match. */
  | 'ROUTE_NOT_EVALUABLE'
  /** The pickup city is too far from the traveller's road. */
  | 'PICKUP_OFF_CORRIDOR'
  /** The delivery city is too far from the traveller's road. */
  | 'DROP_OFF_CORRIDOR'
  /** The delivery point comes before the pickup point on this route. */
  | 'WRONG_DIRECTION'
  /** Both points are on the route but closer together than a leg worth booking. */
  | 'LEG_TOO_SHORT'
  /** Getting to both points costs more extra distance than the trip is allowed to absorb. */
  | 'DETOUR_TOO_LARGE';

export interface CorridorLimits {
  /** How far a parcel's city may sit from the road before it stops being "on the way". */
  maxCorridorM: number;
  /** Extra road distance, return trips included, the traveller may absorb. */
  maxDetourM: number;
  /** Minimum distance along the route between pickup and delivery. */
  minLegM: number;
}

export interface CorridorResult {
  ok: boolean;
  reason: CorridorRejectReason | null;
  pickup: RouteProjection | null;
  drop: RouteProjection | null;
  /** Extra road distance in metres: leaving the corridor and rejoining it, at both ends. */
  detourM: number;
  /** Distance along the route from pickup to delivery, metres. */
  legM: number;
  /** Seconds from departure to the pickup point. */
  pickupEtaS: number;
  /** Seconds from departure to the delivery point. */
  dropEtaS: number;
  source: RouteSource | 'exact';
}

function refuse(reason: CorridorRejectReason, source: RouteSource | 'exact'): CorridorResult {
  return {
    ok: false,
    reason,
    pickup: null,
    drop: null,
    detourM: 0,
    legM: 0,
    pickupEtaS: 0,
    dropEtaS: 0,
    source,
  };
}

/**
 * Can this trip carry this parcel, and where on the trip does each end fall?
 *
 * `exactEndpoints` is the escape hatch for a trip whose geometry has not been measured yet: when the
 * two city pairs are identical there is nothing for geometry to add, so the match is allowed and
 * labelled `exact`. That keeps a freshly published trip visible immediately without pretending a
 * straight line is a road.
 */
export function evaluateCorridor(params: {
  route: RouteIndex | null;
  pickup: GeoPoint | null | undefined;
  drop: GeoPoint | null | undefined;
  limits: CorridorLimits;
  exactEndpoints: boolean;
}): CorridorResult {
  const { route, pickup, drop, limits, exactEndpoints } = params;
  const source: RouteSource | 'exact' = exactEndpoints ? 'exact' : (route?.source ?? 'estimated');

  if (exactEndpoints) {
    const totalM = route?.totalM ?? 0;
    const durationS = route?.durationS ?? 0;
    return {
      ok: true,
      reason: null,
      pickup: null,
      drop: null,
      detourM: 0,
      legM: totalM,
      pickupEtaS: 0,
      dropEtaS: durationS,
      source: 'exact',
    };
  }

  if (!route || !pickup || !drop) return refuse('ROUTE_NOT_EVALUABLE', source);

  const pickupProjection = projectPoint(route, pickup);
  const dropProjection = projectPoint(route, drop);
  if (!pickupProjection || !dropProjection) return refuse('ROUTE_NOT_EVALUABLE', source);

  if (pickupProjection.offsetM > limits.maxCorridorM) return refuse('PICKUP_OFF_CORRIDOR', source);
  if (dropProjection.offsetM > limits.maxCorridorM) return refuse('DROP_OFF_CORRIDOR', source);

  if (dropProjection.alongM < pickupProjection.alongM) return refuse('WRONG_DIRECTION', source);

  const legM = dropProjection.alongM - pickupProjection.alongM;
  if (legM < limits.minLegM) return refuse('LEG_TOO_SHORT', source);

  // Leaving the corridor to reach a point and rejoining it costs the perpendicular distance twice,
  // once out and once back. Doing it at both ends is the honest worst case, and it is what the
  // traveller's fuel and time actually pay for.
  const detourM = 2 * pickupProjection.offsetM + 2 * dropProjection.offsetM;
  if (detourM > limits.maxDetourM) return refuse('DETOUR_TOO_LARGE', source);

  const perMetre = route.totalM > 0 ? route.durationS / route.totalM : 0;

  return {
    ok: true,
    reason: null,
    pickup: pickupProjection,
    drop: dropProjection,
    detourM,
    legM,
    pickupEtaS: pickupProjection.alongM * perMetre,
    dropEtaS: dropProjection.alongM * perMetre,
    source,
  };
}

/**
 * The shortest sensible route between two points, for the case where the routing provider is down.
 *
 * It is a straight line with a 1.25× road factor, and it is labelled `estimated` everywhere it is
 * used. It exists so a trip is still bookable end-to-end when OSRM is unreachable — not so that an
 * unverified detour can be sold as a match.
 */
export function straightLineRoute(origin: GeoPoint, dest: GeoPoint): RouteGeometry {
  const direct = haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng);
  const distanceM = Math.max(1, Math.round(direct * 1.25));
  return {
    points: [
      [origin.lat, origin.lng],
      [dest.lat, dest.lng],
    ],
    distanceM,
    // 30 km/h is the same conservative city/highway blend the tracking fallback uses.
    durationS: Math.round(distanceM / 8.33),
    source: 'estimated',
  };
}
