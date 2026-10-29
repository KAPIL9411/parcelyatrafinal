/**
 * Route-corridor matching, tested as geometry first and as marketplace rules second.
 *
 * The fixtures are the real corridor this feature was built for: Bareilly → Moradabad → Ghaziabad →
 * Delhi. A parcel may start or end at any of those points and still be on the way; the tests below
 * are the examples from the specification, plus the cases that must *not* match.
 *
 * No network, no clock, no database: a failure here means the geometry or the gate is wrong, not that
 * a routing provider was unavailable.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRouteIndex,
  evaluateCorridor,
  projectPoint,
  straightLineRoute,
  type RouteGeometry,
} from '../src/route-match.ts';
import {
  matchingPolicy,
  rankMatches,
  type MatchInput,
  type TripCandidate,
} from '../src/matching.ts';

const BAREILLY = { lat: 28.367, lng: 79.43 };
const MORADABAD = { lat: 28.838, lng: 78.773 };
const GHAZIABAD = { lat: 28.669, lng: 77.453 };
const DELHI = { lat: 28.613, lng: 77.209 };
const LUCKNOW = { lat: 26.847, lng: 80.946 };

/** The corridor in travel order. Four points are enough to test projection and direction. */
const CORRIDOR: RouteGeometry = {
  points: [
    [BAREILLY.lat, BAREILLY.lng],
    [MORADABAD.lat, MORADABAD.lng],
    [GHAZIABAD.lat, GHAZIABAD.lng],
    [DELHI.lat, DELHI.lng],
  ],
  distanceM: 270_000,
  durationS: 5 * 3_600,
  source: 'routed',
};

const LIMITS = { maxCorridorM: 8_000, maxDetourM: 16_000, minLegM: 1_000 };
const route = buildRouteIndex(CORRIDOR);

const MATCH_NOW = new Date('2026-10-24T10:00:00Z');

function matchInput(over: Partial<MatchInput> = {}): MatchInput {
  return {
    senderId: 'sender',
    originCityId: 'bareilly',
    destCityId: 'ghaziabad',
    parcelOriginArea: 'Civil Lines',
    parcelDestArea: 'Raj Nagar',
    parcelOrigin: BAREILLY,
    parcelDest: GHAZIABAD,
    originServiceable: true,
    destServiceable: true,
    category: 'documents',
    description: 'A4 envelope with a signed property agreement',
    weightKg: 2,
    dimsCm: [30, 20, 2],
    windowStart: new Date('2026-10-25T00:00:00Z'),
    windowEnd: new Date('2026-10-25T12:00:00Z'),
    corridorKm: 210,
    enabledModes: ['car'],
    parcelStatus: 'posted',
    parcelAlreadyAssigned: false,
    now: MATCH_NOW,
    ...over,
  };
}

function trip(over: Partial<TripCandidate> = {}): TripCandidate {
  return {
    id: 'trip-1',
    travellerId: 'traveller',
    mode: 'car',
    originCityId: 'bareilly',
    destCityId: 'delhi',
    originArea: null,
    destArea: null,
    originDetourKm: 0,
    route: CORRIDOR,
    departureAt: new Date('2026-10-25T01:30:00Z'),
    arrivalEstimateAt: new Date('2026-10-25T06:30:00Z'),
    capacityKg: 10,
    capacityKgRemaining: 8,
    status: 'published',
    acceptsDocumentsOnly: true,
    travellerFirstName: 'Imran',
    travellerInitial: 'S',
    verificationState: 'verified',
    completedTrips: 12,
    travellerCancellations: 0,
    ...over,
  };
}

const rejection = (res: ReturnType<typeof rankMatches>, id = 'trip-1') =>
  res.rejections.find((r) => r.trip_id === id)?.code;

// ---------------------------------------------------------------- geometry

test('route geometry: a missing or one-point route is not a route', () => {
  assert.equal(buildRouteIndex(null), null);
  assert.equal(buildRouteIndex(undefined), null);
  assert.equal(buildRouteIndex({ ...CORRIDOR, points: [] }), null);
  assert.equal(buildRouteIndex({ ...CORRIDOR, points: [[28.3, 79.4]] }), null);
  assert.ok(buildRouteIndex(CORRIDOR));
});

test('route geometry: projection reports distance along the road and offset from it', () => {
  const pickup = projectPoint(route!, BAREILLY);
  const drop = projectPoint(route!, GHAZIABAD);
  assert.ok(pickup && drop);
  assert.equal(pickup.offsetM < 1, true);
  assert.equal(drop.offsetM < 1, true);
  assert.ok(pickup.alongM < drop.alongM, 'Bareilly comes before Ghaziabad');
  assert.ok(pickup.fraction < drop.fraction);
  assert.equal(pickup.fraction, 0);
});

test('route geometry: an estimated route is labelled, never passed off as a road', () => {
  const estimate = straightLineRoute(BAREILLY, DELHI);
  assert.equal(estimate.source, 'estimated');
  assert.ok(estimate.distanceM > 0);
  assert.ok(estimate.durationS > 0);
});

// ---------------------------------------------------------------- the specified corridor cases

test('corridor: Bareilly → Delhi matches a Bareilly → Ghaziabad parcel', () => {
  const result = evaluateCorridor({
    route,
    pickup: BAREILLY,
    drop: GHAZIABAD,
    limits: LIMITS,
    exactEndpoints: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
  assert.equal(result.source, 'routed');
  assert.ok(result.legM > 0);
});

test('corridor: Bareilly → Delhi matches a Moradabad → Ghaziabad parcel', () => {
  const result = evaluateCorridor({
    route,
    pickup: MORADABAD,
    drop: GHAZIABAD,
    limits: LIMITS,
    exactEndpoints: false,
  });
  assert.equal(result.ok, true);
  assert.ok(result.pickup!.alongM < result.drop!.alongM);
});

test('corridor: Bareilly → Delhi matches a Moradabad → Delhi parcel', () => {
  const result = evaluateCorridor({
    route,
    pickup: MORADABAD,
    drop: DELHI,
    limits: LIMITS,
    exactEndpoints: false,
  });
  assert.equal(result.ok, true);
  assert.ok(result.legM > 0);
});

test('corridor: a reversed parcel (Delhi → Ghaziabad) is refused', () => {
  const result = evaluateCorridor({
    route,
    pickup: DELHI,
    drop: GHAZIABAD,
    limits: LIMITS,
    exactEndpoints: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WRONG_DIRECTION');
});

test('corridor: an off-route destination (Lucknow) is refused, not snapped on', () => {
  const result = evaluateCorridor({
    route,
    pickup: BAREILLY,
    drop: LUCKNOW,
    limits: LIMITS,
    exactEndpoints: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'DROP_OFF_CORRIDOR');
});

test('corridor: a nearby but expensive detour is refused', () => {
  // ~4.4 km east of Bareilly: inside the 8 km corridor, but 8.8 km of out-and-back driving.
  const result = evaluateCorridor({
    route,
    pickup: { lat: 28.367, lng: 79.475 },
    drop: GHAZIABAD,
    limits: { ...LIMITS, maxDetourM: 6_000 },
    exactEndpoints: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'DETOUR_TOO_LARGE');
});

test('corridor: a leg shorter than the configured minimum is refused', () => {
  const result = evaluateCorridor({
    route,
    pickup: GHAZIABAD,
    drop: DELHI,
    limits: { ...LIMITS, minLegM: 300_000 },
    exactEndpoints: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'LEG_TOO_SHORT');
});

test('corridor: missing geometry is safe — exact endpoints still match, everything else is refused', () => {
  const exact = evaluateCorridor({
    route: null,
    pickup: BAREILLY,
    drop: GHAZIABAD,
    limits: LIMITS,
    exactEndpoints: true,
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.source, 'exact');

  const unknown = evaluateCorridor({
    route: null,
    pickup: BAREILLY,
    drop: GHAZIABAD,
    limits: LIMITS,
    exactEndpoints: false,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'ROUTE_NOT_EVALUABLE');
});

// ---------------------------------------------------------------- engine integration

test('matching: a mid-route parcel is offered and its ETA is at the parcel delivery point', () => {
  const res = rankMatches(matchInput(), [trip()]);
  assert.equal(res.matches.length, 1);
  const m = res.matches[0]!;
  assert.equal(m.route_source, 'routed');
  assert.ok(m.drop_eta_at < m.arrival_estimate_at, 'Ghaziabad is reached before Delhi');
  assert.ok(m.pickup_eta_at < m.drop_eta_at);
  assert.equal(m.leg_km > 0, true);
});

test('matching: the trip may be reversed relative to the parcel only in the wrong direction', () => {
  const res = rankMatches(matchInput({ parcelOrigin: DELHI, parcelDest: GHAZIABAD }), [trip()]);
  assert.equal(res.matches.length, 0);
  assert.equal(rejection(res), 'WRONG_DIRECTION');
  assert.ok(res.no_match_reasons.includes('NO_TRIP_ON_ROUTE'));
});

test('matching: a delivery deadline that the parcel point cannot meet is refused', () => {
  const res = rankMatches(
    matchInput({
      windowStart: new Date('2026-10-25T00:00:00Z'),
      windowEnd: new Date('2026-10-25T02:00:00Z'),
    }),
    [trip()],
  );
  assert.equal(res.matches.length, 0);
  // Pickup at 01:30 is inside the window, but Ghaziabad is reached around 05:45, after it closes.
  assert.equal(rejection(res), 'ARRIVES_TOO_LATE');
});

test('matching: insufficient capacity prevents a corridor match', () => {
  const res = rankMatches(matchInput({ weightKg: 5 }), [trip({ capacityKgRemaining: 5 })]);
  assert.equal(res.matches.length, 0);
  assert.equal(rejection(res), 'NO_CAPACITY');
});

test('matching: cancelled and completed trips are never candidates', () => {
  for (const status of ['cancelled', 'completed', 'expired']) {
    const res = rankMatches(matchInput(), [trip({ status })]);
    assert.equal(res.matches.length, 0, status);
    assert.equal(rejection(res), 'TRIP_NOT_ACTIVE', status);
  }
});

test('matching: an estimated route is usable by default and refused when routed geometry is required', () => {
  const estimate: RouteGeometry = {
    ...straightLineRoute(BAREILLY, DELHI),
    // A straight line puts Ghaziabad ~9 km off, so widen the corridor for this fixture.
    source: 'estimated',
  };
  const defaultPolicy = matchingPolicy({ maxCorridorKm: 12, maxDetourKm: 24 });
  const allowed = rankMatches(matchInput({ policy: defaultPolicy }), [trip({ route: estimate })]);
  assert.equal(allowed.matches.length, 1);
  assert.equal(allowed.matches[0]!.route_source, 'estimated');

  const strict = matchingPolicy({ maxCorridorKm: 12, maxDetourKm: 24, requireRoutedGeometry: true });
  const refused = rankMatches(matchInput({ policy: strict }), [trip({ route: estimate })]);
  assert.equal(refused.matches.length, 0);
  assert.equal(rejection(refused), 'ROUTE_NOT_EVALUABLE');
});

test('matching: an overnight trip keeps pickup and drop on the correct calendar days', () => {
  const overnight = trip({
    departureAt: new Date('2026-10-25T22:00:00Z'),
    arrivalEstimateAt: new Date('2026-10-26T03:00:00Z'),
  });
  const res = rankMatches(
    matchInput({
      windowStart: new Date('2026-10-25T20:00:00Z'),
      windowEnd: new Date('2026-10-26T06:00:00Z'),
    }),
    [overnight],
  );
  assert.equal(res.matches.length, 1);
  const m = res.matches[0]!;
  assert.equal(new Date(m.pickup_eta_at).getUTCDate(), 25);
  assert.equal(new Date(m.drop_eta_at).getUTCDate(), 26);
  assert.ok(m.reasons.includes('ARRIVES_IN_WINDOW'));
});
