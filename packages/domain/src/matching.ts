/**
 * Matching — the rules-first engine described in docs/BUSINESS_LOGIC.md §3 and
 * docs/MATCHING_ENGINE.md §3–§5.
 *
 * Two stages, and the order is the contract:
 *   1. hard constraints (H1–H14 below). A candidate that fails one is dropped. No score can rescue
 *      an excluded trip, so an infeasible route can never reach the sender's screen at a high score.
 *   2. a weighted, normalised score over the survivors, with deterministic tie-breakers.
 *
 * Scoring formula (each component is a 0–1 fit, then weighted; the weights sum to 100 by default and
 * the score is the weighted mean, so retuning weights cannot change the 0–100 range):
 *
 *   score = Σ (w_i · fit_i) / Σ w_i
 *
 *   time        w=25  1 when the trip runs on a day the parcel's window covers. Timing is a date
 *                     rule only: a traveller leaving at 8am and one leaving at 8pm on the same day
 *                     are equally compatible, because the handover can happen whenever both are
 *                     ready that day.
 *   departure   w=15  the same date fact, kept as its own component so the published breakdown
 *                     shape does not change.
 *   detour      w=15  1 − corridor detour / maxDetourKm, where detour is the out-and-back cost of
 *                     reaching both parcel endpoints: 2 × pickup offset + 2 × drop offset.
 *   alignment   w=15  1 − worst endpoint offset / maxCorridorKm. How close the parcel's cities sit to
 *                     the road the traveller is actually driving, independent of the detour budget.
 *   reliability w=15  completed / (completed + traveller cancellations) over the last 20 finished trips
 *                     (docs/BUSINESS_LOGIC.md §9). No history is `newTravellerFit`, not a free pass.
 *   capacity    w=10  1 at `capacityFullFitRatio`× the required kg, 0 at the hard capacity floor.
 *   preference  w=5   half area agreement, half category intent.
 *
 * Bands for the UI: Excellent ≥ 80, Good ≥ 65, Fair ≥ 50. Below `minScoreToShow` a trip is only
 * surfaced through the honest low-confidence fallback (top `lowConfidenceFallbackCount`), per
 * docs/MATCHING_ENGINE.md §8.
 *
 * Route compatibility (v2): the endpoints no longer have to be the same two cities. A parcel is
 * compatible when both of its cities project onto the traveller's road route, in travel order, close
 * enough to the road and cheap enough to detour to. `route-match.ts` owns that arithmetic; this file
 * only decides what to do with the answer. Two consequences worth stating plainly:
 *
 *  - the ETA that matters is the ETA *at the parcel's delivery point*, not the trip's final arrival.
 *    A Ghaziabad delivery on a Delhi-bound trip lands hours before the traveller reaches Delhi;
 *  - a trip with no measured geometry still matches an exact city pair. Anything else is refused with
 *    `ROUTE_NOT_EVALUABLE` rather than guessed from a straight line.
 *
 * Distance honesty: offsets and detours come from the route polyline, which is road geometry when the
 * provider answered and a labelled straight line when it did not. The match exposes `route_source`,
 * `detour_km`, `leg_km`, both ETAs, and `pickup_distance_band_km` — the band of the *worse* endpoint's
 * offset from the route, not a crow-flies distance between city centres.
 */

import type { Category, MatchBand, MatchReasonCode, ReliabilityBand, TransportMode, VerificationState } from './enums.ts';
import { detectProhibitedContent, dimsFitLimits, PILOT_LIMITS, type ParcelLimits } from './eligibility.ts';
import { indicativeLaunchPricePaise } from './launch-pricing.ts';
import {
  buildRouteIndex,
  evaluateCorridor,
  projectPoint,
  type GeoPoint,
  type RouteGeometry,
  type RouteSource,
} from './route-match.ts';

export type { GeoPoint, RouteGeometry, RouteSource } from './route-match.ts';

export const MATCHING_FORMULA_VERSION = 'match-p2.0';

export interface MatchingPolicy {
  version: string;
  /** Packaging allowance on the parcel weight when reserving capacity (docs/BUSINESS_LOGIC.md §3.5). */
  packagingAllowance: number;
  /** How far past the window end an arrival is still acceptable (§3.4 grace). */
  arrivalGraceHours: number;
  /** §3.2: a trip may start in the origin city or within this straight-line distance of it. */
  maxOriginDetourKm: number;
  /** Below this score a trip is not offered, except through the low-confidence fallback. */
  minScoreToShow: number;
  lowConfidenceFallbackCount: number;
  maxResults: number;
  bandThresholds: { excellent: number; good: number };
  weights: {
    time: number;
    departure: number;
    detour: number;
    alignment: number;
    reliability: number;
    capacity: number;
    preference: number;
  };
  /** Arrival this many hours before the window closes scores a full time fit. */
  timeTargetLeadHours: number;
  /** A trip leaving more than this many hours before the window opens scores 0 on departure fit. */
  departureEarlyDecayHours: number;
  /** Capacity fit is 1 at this multiple of the required kg and decays to 0 at the hard floor. */
  capacityFullFitRatio: number;
  /** Fit given to a traveller with no finished trips yet. Deliberately not 0 and not 1. */
  newTravellerFit: number;
  /** §9: below this ratio once `reliabilitySample` trips exist, automated matching stops. */
  minReliabilityRatio: number;
  reliabilitySample: number;
  /** How far a parcel's city may sit from the traveller's road before it is not "on the way". */
  maxCorridorKm: number;
  /** Extra road distance, out-and-back included, a trip may absorb to serve a parcel. */
  maxDetourKm: number;
  /** Minimum distance along the route between pickup and delivery. */
  minLegKm: number;
  /** When true, only provider-measured geometry may produce a non-exact match. */
  requireRoutedGeometry: boolean;
}

export const DEFAULT_MATCHING_POLICY: MatchingPolicy = {
  version: MATCHING_FORMULA_VERSION,
  packagingAllowance: 1.1,
  arrivalGraceHours: 2,
  maxOriginDetourKm: 10,
  minScoreToShow: 50,
  lowConfidenceFallbackCount: 3,
  maxResults: 10,
  bandThresholds: { excellent: 80, good: 65 },
  weights: { time: 25, departure: 15, detour: 15, alignment: 15, reliability: 15, capacity: 10, preference: 5 },
  timeTargetLeadHours: 2,
  departureEarlyDecayHours: 48,
  capacityFullFitRatio: 2,
  newTravellerFit: 0.25,
  minReliabilityRatio: 0.7,
  reliabilitySample: 10,
  maxCorridorKm: 8,
  maxDetourKm: 16,
  minLegKm: 1,
  requireRoutedGeometry: false,
};

/** Merge partial overrides onto the defaults. Weights are accepted as ratios; the score normalises. */
export function matchingPolicy(overrides: DeepPartial<MatchingPolicy> = {}): MatchingPolicy {
  const merged: MatchingPolicy = {
    ...DEFAULT_MATCHING_POLICY,
    ...overrides,
    bandThresholds: { ...DEFAULT_MATCHING_POLICY.bandThresholds, ...(overrides.bandThresholds ?? {}) },
    weights: { ...DEFAULT_MATCHING_POLICY.weights, ...(overrides.weights ?? {}) },
  };
  const bad = (msg: string): never => {
    throw new Error(`Invalid matching policy: ${msg}`);
  };
  for (const [key, weight] of Object.entries(merged.weights)) {
    if (!Number.isFinite(weight) || weight < 0) bad(`weight ${key} must be a finite non-negative number`);
  }
  if (weightSum(merged) <= 0) bad('at least one weight must be positive');
  if (merged.packagingAllowance < 1) bad('packagingAllowance must be at least 1');
  if (merged.arrivalGraceHours < 0) bad('arrivalGraceHours must not be negative');
  if (merged.maxOriginDetourKm < 0) bad('maxOriginDetourKm must not be negative');
  if (merged.capacityFullFitRatio <= 1) bad('capacityFullFitRatio must exceed the packaging allowance');
  if (merged.minScoreToShow < 0 || merged.minScoreToShow > 100) bad('minScoreToShow must be within 0–100');
  if (merged.maxResults < 1) bad('maxResults must be at least 1');
  if (merged.maxCorridorKm < 0) bad('maxCorridorKm must not be negative');
  if (merged.maxDetourKm < 0) bad('maxDetourKm must not be negative');
  if (merged.minLegKm < 0) bad('minLegKm must not be negative');
  return merged;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

function weightSum(p: MatchingPolicy): number {
  return Object.values(p.weights).reduce((a, b) => a + b, 0);
}

export interface TripCandidate {
  id: string;
  travellerId: string;
  mode: TransportMode;
  originCityId: string;
  destCityId: string;
  /** Free text, as posted. Null when the traveller did not name a locality. */
  originArea: string | null;
  destArea: string | null;
  /**
   * Straight-line km between the trip's origin city centroid and the parcel's origin city centroid.
   * 0 for a same-city trip. Not a road distance — see the header.
   *
   * Kept for the same-city proximity band and for callers that have no geometry; route compatibility
   * itself is decided by `route`.
   */
  originDetourKm: number;
  /**
   * The traveller's road route, when it has been measured. `null` means the route is unknown, and
   * only an exact city pair can match.
   */
  route?: RouteGeometry | null;
  departureAt: Date;
  arrivalEstimateAt: Date;
  capacityKg: number;
  capacityKgRemaining: number;
  status: string;
  acceptsDocumentsOnly: boolean;
  travellerFirstName: string | null;
  travellerInitial: string | null;
  verificationState: VerificationState;
  /** Finished deliveries inside the lookback window. */
  completedTrips: number;
  /** Trips the traveller cancelled in the same window; the denominator of the reliability ratio. */
  travellerCancellations: number;
}

export interface MatchInput {
  senderId: string;
  originCityId: string;
  destCityId: string;
  /** The locality the sender typed. Compared by name with the traveller's — never turned into km. */
  parcelOriginArea: string | null;
  parcelDestArea: string | null;
  originServiceable: boolean;
  destServiceable: boolean;
  category: Category;
  description: string;
  weightKg: number;
  dimsCm: readonly number[];
  windowStart: Date;
  windowEnd: Date;
  corridorKm: number;
  /**
   * City centroids for the parcel's two ends. When either is missing, only an exact city pair can be
   * matched — the engine will not invent a position.
   */
  parcelOrigin?: GeoPoint | null;
  parcelDest?: GeoPoint | null;
  enabledModes: readonly TransportMode[];
  /** Parcel lifecycle gate: only an open parcel is matchable. */
  parcelStatus: string;
  /** True when an active booking already holds this parcel. */
  parcelAlreadyAssigned: boolean;
  now: Date;
  policy?: MatchingPolicy;
  /** Caps from the active pricing policy (pilot tariff: 3 kg, 30×25×20). Defaults to PILOT_LIMITS. */
  limits?: ParcelLimits;
  /** Operator-maintained prohibited keywords layered on the compiled list. */
  prohibitedKeywords?: readonly string[];
  /**
   * Corridor intermediates between the parcel's pickup and drop stops, in travel order. A trip only
   * matches when its measured route passes every one of them between the two ends — never a match
   * by city name alone.
   */
  corridorIntermediates?: readonly GeoPoint[];
  /** Server-computed fare figure from the active tariff; replaces the indicative estimate wholesale. */
  indicativePricePaise?: number;
}

export interface MatchScorePoints {
  time: number;
  departure: number;
  detour: number;
  alignment: number;
  reliability: number;
  capacity: number;
  preference: number;
}

export interface Match {
  trip_id: string;
  score: number;
  band: MatchBand;
  reasons: MatchReasonCode[];
  traveller_first_name?: string;
  traveller_initial?: string;
  verification_state: VerificationState;
  reliability_band: ReliabilityBand;
  /** completed / (completed + traveller cancellations); omitted when there is no history. */
  reliability_ratio?: number;
  completed_trips: number;
  mode: TransportMode;
  departure_at: string;
  arrival_estimate_at: string;
  capacity_kg_remaining: number;
  /** Band, never a precise figure: docs/MATCHING_ENGINE.md §6. */
  pickup_distance_band_km: '<1' | '1-3' | '3-5' | '5-10';
  indicative_price_paise: number;
  accepts_documents_only: boolean;
  /** Where the route came from. `exact` means the two city pairs were identical. */
  route_source: RouteSource | 'exact';
  /** Extra road distance this parcel costs the traveller, in km. */
  detour_km: number;
  /** Distance along the traveller's route from pickup to delivery, in km. */
  leg_km: number;
  /** When the traveller is expected at the parcel's pickup point. */
  pickup_eta_at: string;
  /** When the traveller is expected at the parcel's delivery point — the ETA that gates the window. */
  drop_eta_at: string;
  /** Weighted points per component; they sum to `score`. The explanation the audit trail needs. */
  score_breakdown: { formula_version: string; fit: MatchScorePoints; points: MatchScorePoints };
}

/** Aggregate reasons safe to show a sender. Never names, never another user's records. */
export type NoMatchReason =
  | 'NO_TRIP_ON_DATE'
  | 'NO_TRIP_ON_ROUTE'
  | 'NO_CAPACITY'
  | 'WINDOW_TOO_TIGHT'
  | 'ORIGIN_NOT_SERVED'
  | 'DESTINATION_NOT_SERVED'
  | 'MODE_DISABLED'
  | 'TRAVELLER_NOT_VERIFIED'
  | 'CATEGORY_NOT_ACCEPTED'
  | 'PARCEL_TOO_LARGE'
  | 'PARCEL_NOT_OPEN'
  | 'PARCEL_ALREADY_ASSIGNED';

/** Why one candidate was dropped. Kept out of the client payload; used by tests and by support. */
export type MatchRejectionCode =
  | 'MODE_DISABLED'
  | 'DESTINATION_NOT_SERVED'
  | 'ORIGIN_NOT_SERVED'
  | 'TRIP_NOT_ACTIVE'
  | 'TRIP_DEPARTED'
  | 'SELF_TRIP'
  | 'TRAVELLER_NOT_VERIFIED'
  | 'TRAVELLER_RELIABILITY_REVIEW'
  | 'ITEM_PROHIBITED'
  | 'CATEGORY_NOT_ACCEPTED'
  | 'PARCEL_TOO_LARGE'
  | 'NO_CAPACITY'
  | 'DEPARTS_AFTER_WINDOW'
  | 'ARRIVES_TOO_LATE'
  /** The trip runs on a different calendar day than the parcel's pickup window. */
  | 'TRIP_OUTSIDE_DATE'
  | 'ROUTE_NOT_EVALUABLE'
  | 'PICKUP_OFF_CORRIDOR'
  | 'DROP_OFF_CORRIDOR'
  | 'WRONG_DIRECTION'
  | 'LEG_TOO_SHORT'
  | 'DETOUR_TOO_LARGE';

export interface MatchRejection {
  trip_id: string;
  code: MatchRejectionCode;
}

export interface MatchResult {
  matches: Match[];
  low_confidence: boolean;
  no_match_reasons: NoMatchReason[];
  rejections: MatchRejection[];
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** India has no DST: IST is UTC+05:30 all year, so a fixed offset is exact. */
const IST_OFFSET_MS = 5.5 * HOUR;

/**
 * The calendar day a moment belongs to, in India. Matching is date-only, so "today" must mean the
 * same day to a sender in Bareilly and a server running in UTC: 1 Nov 01:00 IST is still 31 Oct in
 * UTC, and a trip that leaves at 01:00 IST must not be filed under the previous day.
 */
function serviceDay(moment: Date): number {
  return Math.floor((moment.getTime() + IST_OFFSET_MS) / DAY);
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Area names are free text on both sides, so agreement is compared case- and whitespace-insensitively. */
function normArea(area: string | null): string | null {
  const trimmed = area?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

const DOCUMENT_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['documents', 'educational_certificates']);

export function reliabilityRatioOf(
  completed: number,
  cancellations: number,
): number | null {
  const sample = completed + cancellations;
  if (sample <= 0) return null;
  return completed / sample;
}

export function reliabilityBandOf(completed: number, ratio: number | null): ReliabilityBand {
  if (completed <= 0) return 'new';
  if (ratio !== null && ratio >= 0.9 && completed >= 10) return 'highly_reliable';
  if (ratio !== null && ratio >= 0.8 && completed >= 5) return 'reliable';
  return 'building';
}

function distanceBandKm(km: number): Match['pickup_distance_band_km'] {
  if (km < 1) return '<1';
  if (km <= 3) return '1-3';
  if (km <= 5) return '3-5';
  return '5-10';
}

/**
 * The parcel-side gates. A parcel that cannot be matched at all produces no candidate loop, which
 * keeps the aggregate reasons honest: they describe the route, not a hundred trips that were never
 * eligible for a cancelled parcel.
 */
function parcelGate(input: MatchInput): NoMatchReason[] | null {
  const blocked: NoMatchReason[] = [];
  if (!input.originServiceable) blocked.push('ORIGIN_NOT_SERVED');
  if (!input.destServiceable) blocked.push('DESTINATION_NOT_SERVED');
  if (blocked.length > 0) return blocked;
  if (input.parcelStatus !== 'posted' && input.parcelStatus !== 'matched') return ['PARCEL_NOT_OPEN'];
  if (input.parcelAlreadyAssigned) return ['PARCEL_ALREADY_ASSIGNED'];
  return null;
}

export function rankMatches(input: MatchInput, trips: readonly TripCandidate[]): MatchResult {
  const policy = input.policy ?? DEFAULT_MATCHING_POLICY;
  const gate = parcelGate(input);
  if (gate) {
    return { matches: [], low_confidence: false, no_match_reasons: gate, rejections: [] };
  }

  const rejections: MatchRejection[] = [];
  const rejected = (trip: TripCandidate, code: MatchRejectionCode): null => {
    rejections.push({ trip_id: trip.id, code });
    return null;
  };
  const requiredKg = input.weightKg * policy.packagingAllowance;
  // Matching is date-only. These three day numbers are the whole timing rule: a trip is compatible
  // when its departure day is one of the days the pickup window covers. Clock times are ignored on
  // purpose — a traveller who leaves early can still take the parcel, because the pickup code is
  // available as soon as the booking is confirmed.
  const todayDay = serviceDay(input.now);
  const windowFirstDay = serviceDay(input.windowStart);
  const windowLastDay = serviceDay(input.windowEnd);
  const prohibited = detectProhibitedContent(
    `${input.category} ${input.description}`,
    input.prohibitedKeywords,
  );
  const limitsP = input.limits;
  const maxWeightKg = limitsP?.maxWeightKg ?? PILOT_LIMITS.maxWeightKg;
  const maxDimsCm = limitsP?.maxDimsCm;
  const maxSideCm = limitsP?.maxDimensionCm ?? PILOT_LIMITS.maxDimensionCm;
  const parcelOriginArea = normArea(input.parcelOriginArea);
  const parcelDestArea = normArea(input.parcelDestArea);
  const limits = {
    maxCorridorM: policy.maxCorridorKm * 1000,
    maxDetourM: policy.maxDetourKm * 1000,
    minLegM: policy.minLegKm * 1000,
  };

  const scored: Array<{ match: Match; dropMs: number; departureMs: number }> = [];

  for (const trip of trips) {
    // ---- hard constraints: cheapest first. Failing any of these is terminal. ----
    if (!input.enabledModes.includes(trip.mode)) {
      rejected(trip, 'MODE_DISABLED');
      continue;
    }
    if (!['published', 'partially_booked'].includes(trip.status)) {
      rejected(trip, 'TRIP_NOT_ACTIVE');
      continue;
    }
    if (serviceDay(trip.departureAt) < todayDay) {
      // Only a trip from an earlier day is gone. One that left this morning may still be reachable,
      // and the sender can see it; refusing it would make a same-day search return nothing after 9am.
      rejected(trip, 'TRIP_DEPARTED');
      continue;
    }
    if (trip.travellerId === input.senderId) {
      rejected(trip, 'SELF_TRIP');
      continue;
    }
    if (trip.verificationState !== 'verified') {
      rejected(trip, 'TRAVELLER_NOT_VERIFIED');
      continue;
    }
    const reliability = reliabilityRatioOf(trip.completedTrips, trip.travellerCancellations);
    const sample = trip.completedTrips + trip.travellerCancellations;
    if (reliability !== null && sample >= policy.reliabilitySample && reliability < policy.minReliabilityRatio) {
      // §9 sends these to manual review; this build has no review queue for matching, so they are
      // excluded rather than offered. They are never silently ranked down into visibility.
      rejected(trip, 'TRAVELLER_RELIABILITY_REVIEW');
      continue;
    }
    if (prohibited) {
      // Re-checked here as defence in depth: a parcel row can predate the pattern list.
      rejected(trip, 'ITEM_PROHIBITED');
      continue;
    }
    if (trip.acceptsDocumentsOnly && !DOCUMENT_CATEGORIES.has(input.category)) {
      rejected(trip, 'CATEGORY_NOT_ACCEPTED');
      continue;
    }
    if (input.weightKg <= 0 || input.weightKg > maxWeightKg) {
      rejected(trip, 'PARCEL_TOO_LARGE');
      continue;
    }
    if (maxDimsCm && maxDimsCm.length > 0) {
      if (!dimsFitLimits(input.dimsCm, maxDimsCm)) {
        rejected(trip, 'PARCEL_TOO_LARGE');
        continue;
      }
    } else {
      const longestSide = input.dimsCm.length > 0 ? Math.max(...input.dimsCm) : 0;
      if (longestSide > maxSideCm) {
        rejected(trip, 'PARCEL_TOO_LARGE');
        continue;
      }
    }
    if (trip.capacityKgRemaining < requiredKg) {
      rejected(trip, 'NO_CAPACITY');
      continue;
    }

    // ---- route compatibility: is the parcel actually on the way? ----
    //
    // This replaces the old "same destination city" rule. The endpoints may differ from the trip's
    // endpoints; what has to hold is that both project onto the road, in order, within the offset and
    // detour limits. An exact city pair is compatible even with no geometry, because there is nothing
    // for geometry to add.
    const routeIndex = buildRouteIndex(trip.route ?? null);
    const exactEndpoints =
      trip.originCityId === input.originCityId && trip.destCityId === input.destCityId;
    const corridor = evaluateCorridor({
      route: routeIndex,
      pickup: input.parcelOrigin ?? null,
      drop: input.parcelDest ?? null,
      limits,
      exactEndpoints,
    });
    if (!corridor.ok) {
      rejected(trip, corridor.reason ?? 'ROUTE_NOT_EVALUABLE');
      continue;
    }
    if (
      policy.requireRoutedGeometry &&
      corridor.source !== 'routed' &&
      corridor.source !== 'exact'
    ) {
      // The deployment has decided a straight line is not evidence of a road.
      rejected(trip, 'ROUTE_NOT_EVALUABLE');
      continue;
    }
    if (input.corridorIntermediates && input.corridorIntermediates.length > 0) {
      // Corridor rule: the trip must cover the complete pickup→drop sequence, not just the two
      // end cities. That needs real route geometry; an exact-city pair with no geometry proves
      // nothing about the stops in between.
      if (!routeIndex) {
        rejected(trip, 'ROUTE_NOT_EVALUABLE');
        continue;
      }
      const lo = Math.min(corridor.pickup?.fraction ?? 0, corridor.drop?.fraction ?? 1);
      const hi = Math.max(corridor.pickup?.fraction ?? 0, corridor.drop?.fraction ?? 1);
      let offSequence = false;
      for (const stop of input.corridorIntermediates) {
        const proj = projectPoint(routeIndex, stop);
        if (!proj || proj.offsetM > limits.maxCorridorM || proj.fraction <= lo || proj.fraction >= hi) {
          offSequence = true;
          break;
        }
      }
      if (offSequence) {
        rejected(trip, 'ROUTE_NOT_EVALUABLE');
        continue;
      }
    }

    // The ETA that matters is the one at the parcel's delivery point, not the trip's final arrival:
    // a Ghaziabad drop on a Delhi-bound trip lands well before the traveller reaches Delhi.
    const departureMs = trip.departureAt.getTime();
    const declaredDurationS = Math.max(0, (trip.arrivalEstimateAt.getTime() - departureMs) / 1000);
    const durationS =
      routeIndex && routeIndex.durationS > 0 ? routeIndex.durationS : declaredDurationS;
    const pickupFraction = corridor.pickup?.fraction ?? 0;
    const dropFraction = corridor.drop?.fraction ?? 1;
    const pickupMs = departureMs + pickupFraction * durationS * 1000;
    const dropMs =
      corridor.source === 'exact'
        ? trip.arrivalEstimateAt.getTime()
        : departureMs + dropFraction * durationS * 1000;

    // The only timing gate: the trip must run on a day the pickup window covers. No clock comparison
    // follows, so a trip at 08:00 and one at 20:00 on the right date are both offered.
    const tripDay = serviceDay(trip.departureAt);
    if (tripDay < windowFirstDay || tripDay > windowLastDay) {
      rejected(trip, 'TRIP_OUTSIDE_DATE');
      continue;
    }

    // ---- scoring: every component is a normalised 0–1 fit. ----
    //
    // Time and departure are 1 for every survivor: the date gate above already answered the timing
    // question, and scoring must not quietly re-impose the clock rule the product removed.
    const timeFit = 1;
    const departureFit = 1;

    const detourFit = clamp01(1 - corridor.detourM / Math.max(1, limits.maxDetourM));

    const worstOffsetM = Math.max(corridor.pickup?.offsetM ?? 0, corridor.drop?.offsetM ?? 0);
    const alignmentFit = clamp01(1 - worstOffsetM / Math.max(1, limits.maxCorridorM));

    const reliabilityFit = reliability ?? policy.newTravellerFit;

    const capacityRatio = trip.capacityKgRemaining / Math.max(0.1, requiredKg);
    const capacityFit = clamp01(
      (capacityRatio - policy.packagingAllowance) / (policy.capacityFullFitRatio - policy.packagingAllowance),
    );

    const tripOriginArea = normArea(trip.originArea);
    const tripDestArea = normArea(trip.destArea);
    const originAreaMatches = tripOriginArea !== null && tripOriginArea === parcelOriginArea;
    const destAreaMatches = tripDestArea !== null && tripDestArea === parcelDestArea;
    const areaFit = originAreaMatches ? (destAreaMatches ? 1 : 0.8) : tripOriginArea === null ? 0.6 : 0.3;
    // A documents-only trip that is being offered a document parcel is an exact intent match; an
    // open trip is compatible with anything the pilot allows, which is good but not a stated intent.
    const categoryFit = trip.acceptsDocumentsOnly ? 1 : 0.85;
    const preferenceFit = 0.5 * areaFit + 0.5 * categoryFit;

    const fit: MatchScorePoints = {
      time: round3(timeFit),
      departure: round3(departureFit),
      detour: round3(detourFit),
      alignment: round3(alignmentFit),
      reliability: round3(reliabilityFit),
      capacity: round3(capacityFit),
      preference: round3(preferenceFit),
    };
    const points: MatchScorePoints = {
      time: round1(timeFit * policy.weights.time),
      departure: round1(departureFit * policy.weights.departure),
      detour: round1(detourFit * policy.weights.detour),
      alignment: round1(alignmentFit * policy.weights.alignment),
      reliability: round1(reliabilityFit * policy.weights.reliability),
      capacity: round1(capacityFit * policy.weights.capacity),
      preference: round1(preferenceFit * policy.weights.preference),
    };
    const rawScore =
      ((timeFit * policy.weights.time +
        departureFit * policy.weights.departure +
        detourFit * policy.weights.detour +
        alignmentFit * policy.weights.alignment +
        reliabilityFit * policy.weights.reliability +
        capacityFit * policy.weights.capacity +
        preferenceFit * policy.weights.preference) *
        100) /
      weightSum(policy);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    // Date compatibility is already proven by the gate above; there is no arrival-clock claim to make.
    const reasons: MatchReasonCode[] = ['ON_ROUTE', 'CAPACITY_OK', 'VERIFIED_ID', 'ARRIVES_IN_WINDOW'];
    if (corridor.detourM <= 3_000 && alignmentFit >= 0.6 && areaFit >= 0.8) reasons.push('SMALL_DETOUR');
    if (reliability !== null && reliability >= 0.8 && trip.completedTrips >= 5) reasons.push('HIGH_RELIABILITY');

    const band: MatchBand =
      score >= policy.bandThresholds.excellent ? 'excellent' : score >= policy.bandThresholds.good ? 'good' : 'fair';

    scored.push({
      dropMs,
      departureMs,
      match: {
        trip_id: trip.id,
        score,
        band,
        reasons,
        ...(trip.travellerFirstName ? { traveller_first_name: trip.travellerFirstName } : {}),
        ...(trip.travellerInitial ? { traveller_initial: trip.travellerInitial } : {}),
        verification_state: trip.verificationState,
        reliability_band: reliabilityBandOf(trip.completedTrips, reliability),
        ...(reliability !== null ? { reliability_ratio: round3(reliability) } : {}),
        completed_trips: trip.completedTrips,
        mode: trip.mode,
        departure_at: trip.departureAt.toISOString(),
        arrival_estimate_at: trip.arrivalEstimateAt.toISOString(),
        capacity_kg_remaining: trip.capacityKgRemaining,
        pickup_distance_band_km: distanceBandKm(worstOffsetM / 1000),
        indicative_price_paise:
          input.indicativePricePaise ?? indicativeLaunchPricePaise(input.corridorKm, input.weightKg, input.category),
        accepts_documents_only: trip.acceptsDocumentsOnly,
        route_source: corridor.source,
        detour_km: round1(corridor.detourM / 1000),
        leg_km: round1(corridor.legM / 1000),
        pickup_eta_at: new Date(pickupMs).toISOString(),
        drop_eta_at: new Date(dropMs).toISOString(),
        score_breakdown: { formula_version: policy.version, fit, points },
      },
    });
  }

  // Deterministic: score, then the earliest delivery, then the earliest departure, then the id.
  // Two identical trips therefore always come back in the same order.
  scored.sort(
    (a, b) =>
      b.match.score - a.match.score ||
      a.dropMs - b.dropMs ||
      a.departureMs - b.departureMs ||
      a.match.trip_id.localeCompare(b.match.trip_id),
  );

  const confident = scored.filter((s) => s.match.score >= policy.minScoreToShow).slice(0, policy.maxResults);
  const shown =
    confident.length > 0
      ? confident
      : scored.slice(0, Math.min(policy.lowConfidenceFallbackCount, policy.maxResults));

  const usedFallback = confident.length === 0 && shown.length > 0;
  const lowConfidence = usedFallback || (shown.length > 0 && shown.every((s) => s.match.band === 'fair'));

  return {
    matches: shown.map((s) => s.match),
    low_confidence: lowConfidence,
    no_match_reasons: shown.length === 0 ? aggregateReasons(rejections) : [],
    rejections,
  };
}

/**
 * Collapse per-candidate rejections into the handful of sender-facing reasons. A reason is only
 * reported when it actually stopped a candidate, so "no trips on this date" is never claimed when
 * the real blocker was capacity.
 */
function aggregateReasons(rejections: readonly MatchRejection[]): NoMatchReason[] {
  const out = new Set<NoMatchReason>();
  for (const { code } of rejections) {
    switch (code) {
      case 'MODE_DISABLED':
        out.add('MODE_DISABLED');
        break;
      case 'ORIGIN_NOT_SERVED':
        out.add('ORIGIN_NOT_SERVED');
        break;
      case 'DESTINATION_NOT_SERVED':
        out.add('DESTINATION_NOT_SERVED');
        break;
      case 'TRAVELLER_NOT_VERIFIED':
      case 'TRAVELLER_RELIABILITY_REVIEW':
        out.add('TRAVELLER_NOT_VERIFIED');
        break;
      case 'CATEGORY_NOT_ACCEPTED':
        out.add('CATEGORY_NOT_ACCEPTED');
        break;
      case 'NO_CAPACITY':
        out.add('NO_CAPACITY');
        break;
      case 'PARCEL_TOO_LARGE':
        out.add('PARCEL_TOO_LARGE');
        break;
      case 'DEPARTS_AFTER_WINDOW':
      case 'ARRIVES_TOO_LATE':
      case 'TRIP_OUTSIDE_DATE':
      case 'TRIP_DEPARTED':
      case 'TRIP_NOT_ACTIVE':
        out.add('NO_TRIP_ON_DATE');
        break;
      case 'ROUTE_NOT_EVALUABLE':
      case 'PICKUP_OFF_CORRIDOR':
      case 'DROP_OFF_CORRIDOR':
      case 'WRONG_DIRECTION':
      case 'LEG_TOO_SHORT':
      case 'DETOUR_TOO_LARGE':
        // The trip exists and may be fine for someone else; it just does not pass this parcel.
        out.add('NO_TRIP_ON_ROUTE');
        break;
      case 'SELF_TRIP':
      case 'ITEM_PROHIBITED':
        // Not a route shortage: saying so would misdescribe why the list is empty.
        break;
    }
  }
  // `WINDOW_TOO_TIGHT` is no longer produced: the only timing rule left is the date gate, and a
  // window is never "too tight" when the clock does not decide compatibility. It stays in the
  // published reason list so older clients keep a label for it.
  return [...out];
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
