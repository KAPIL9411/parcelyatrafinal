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
 *   time        w=30  1 when the trip lands at least `timeTargetLeadHours` before the window closes,
 *                     linear to 0 at `windowEnd + arrivalGraceHours` (the hard cut-off).
 *   departure   w=20  1 when the trip leaves after the window opens; linear to 0 `departureEarlyDecayHours`
 *                     before it, because an early handover is the sender's problem, not the traveller's.
 *   detour      w=20  1 − originDetourKm / maxOriginDetourKm. See "distance honesty" below.
 *   reliability w=15  completed / (completed + traveller cancellations) over the last 20 finished trips
 *                     (docs/BUSINESS_LOGIC.md §9). No history is `newTravellerFit`, not a free pass.
 *   capacity    w=10  1 at `capacityFullFitRatio`× the required kg, 0 at the hard capacity floor.
 *   preference  w=5   half area agreement, half category intent.
 *
 * Bands for the UI: Excellent ≥ 80, Good ≥ 65, Fair ≥ 50. Below `minScoreToShow` a trip is only
 * surfaced through the honest low-confidence fallback (top `lowConfidenceFallbackCount`), per
 * docs/MATCHING_ENGINE.md §8.
 *
 * Distance honesty: this schema has no area geocoding — `areas` carries a name only, and no routing
 * provider is configured. Distances here are therefore great-circle distances between *city
 * centroids* (`haversineKm`), which are a lower bound on road distance, never road kilometres. They
 * are only ever exposed through the `pickup_distance_band_km` band the API contract already defines,
 * and a same-city trip has detour 0 by construction. Within a city, pickup proximity is reported by
 * area *name agreement* and never converted into a distance.
 */

import type { Category, MatchBand, MatchReasonCode, ReliabilityBand, TransportMode, VerificationState } from './enums.ts';
import { detectProhibitedContent, PILOT_LIMITS } from './eligibility.ts';
import { indicativeLaunchPricePaise } from './launch-pricing.ts';

export const MATCHING_FORMULA_VERSION = 'match-p1.0';

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
  weights: { time: 30, departure: 20, detour: 20, reliability: 15, capacity: 10, preference: 5 },
  timeTargetLeadHours: 2,
  departureEarlyDecayHours: 48,
  capacityFullFitRatio: 2,
  newTravellerFit: 0.25,
  minReliabilityRatio: 0.7,
  reliabilitySample: 10,
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
   */
  originDetourKm: number;
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
  enabledModes: readonly TransportMode[];
  /** Parcel lifecycle gate: only an open parcel is matchable. */
  parcelStatus: string;
  /** True when an active booking already holds this parcel. */
  parcelAlreadyAssigned: boolean;
  now: Date;
  policy?: MatchingPolicy;
}

export interface MatchScorePoints {
  time: number;
  departure: number;
  detour: number;
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
  /** Weighted points per component; they sum to `score`. The explanation the audit trail needs. */
  score_breakdown: { formula_version: string; fit: MatchScorePoints; points: MatchScorePoints };
}

/** Aggregate reasons safe to show a sender. Never names, never another user's records. */
export type NoMatchReason =
  | 'NO_TRIP_ON_DATE'
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
  | 'ARRIVES_TOO_LATE';

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
  const windowStartMs = input.windowStart.getTime();
  const windowEndMs = input.windowEnd.getTime();
  const nowMs = input.now.getTime();
  const graceMs = policy.arrivalGraceHours * HOUR;
  const prohibited = detectProhibitedContent(`${input.category} ${input.description}`);
  const parcelOriginArea = normArea(input.parcelOriginArea);
  const parcelDestArea = normArea(input.parcelDestArea);

  const scored: Array<{ match: Match; arrivalMs: number; departureMs: number }> = [];

  for (const trip of trips) {
    // ---- hard constraints: cheapest first. Failing any of these is terminal. ----
    if (!input.enabledModes.includes(trip.mode)) {
      rejected(trip, 'MODE_DISABLED');
      continue;
    }
    if (trip.destCityId !== input.destCityId) {
      rejected(trip, 'DESTINATION_NOT_SERVED');
      continue;
    }
    if (trip.originCityId !== input.originCityId) {
      // §3.2 allows a trip that starts in a *different* city, but only inside the pilot detour limit.
      // The limit is a straight-line distance between city centroids; the caller must have measured
      // it. An unmeasured distance is never a pass.
      if (!Number.isFinite(trip.originDetourKm) || trip.originDetourKm > policy.maxOriginDetourKm) {
        rejected(trip, 'ORIGIN_NOT_SERVED');
        continue;
      }
    }
    if (!['published', 'partially_booked'].includes(trip.status)) {
      rejected(trip, 'TRIP_NOT_ACTIVE');
      continue;
    }
    if (trip.departureAt.getTime() <= nowMs) {
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
    if (input.weightKg <= 0 || input.weightKg > PILOT_LIMITS.maxWeightKg) {
      rejected(trip, 'PARCEL_TOO_LARGE');
      continue;
    }
    const longestSide = input.dimsCm.length > 0 ? Math.max(...input.dimsCm) : 0;
    if (longestSide > PILOT_LIMITS.maxDimensionCm) {
      rejected(trip, 'PARCEL_TOO_LARGE');
      continue;
    }
    if (trip.capacityKgRemaining < requiredKg) {
      rejected(trip, 'NO_CAPACITY');
      continue;
    }
    if (trip.departureAt.getTime() > windowEndMs) {
      rejected(trip, 'DEPARTS_AFTER_WINDOW');
      continue;
    }
    if (trip.arrivalEstimateAt.getTime() > windowEndMs + graceMs) {
      rejected(trip, 'ARRIVES_TOO_LATE');
      continue;
    }

    // ---- scoring: every component is a normalised 0–1 fit. ----
    const arrivalMs = trip.arrivalEstimateAt.getTime();
    const departureMs = trip.departureAt.getTime();

    const timeFit = clamp01((windowEndMs + graceMs - arrivalMs) / ((policy.arrivalGraceHours + policy.timeTargetLeadHours) * HOUR));

    const hoursEarly = (windowStartMs - departureMs) / HOUR;
    const departureFit = hoursEarly <= 0 ? 1 : clamp01(1 - hoursEarly / policy.departureEarlyDecayHours);

    const detourFit = clamp01(1 - trip.originDetourKm / Math.max(1, policy.maxOriginDetourKm));

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
      reliability: round3(reliabilityFit),
      capacity: round3(capacityFit),
      preference: round3(preferenceFit),
    };
    const points: MatchScorePoints = {
      time: round1(timeFit * policy.weights.time),
      departure: round1(departureFit * policy.weights.departure),
      detour: round1(detourFit * policy.weights.detour),
      reliability: round1(reliabilityFit * policy.weights.reliability),
      capacity: round1(capacityFit * policy.weights.capacity),
      preference: round1(preferenceFit * policy.weights.preference),
    };
    const rawScore =
      ((timeFit * policy.weights.time +
        departureFit * policy.weights.departure +
        detourFit * policy.weights.detour +
        reliabilityFit * policy.weights.reliability +
        capacityFit * policy.weights.capacity +
        preferenceFit * policy.weights.preference) *
        100) /
      weightSum(policy);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const reasons: MatchReasonCode[] = ['ON_ROUTE', 'CAPACITY_OK', 'VERIFIED_ID'];
    if (arrivalMs <= windowEndMs) reasons.push('ARRIVES_IN_WINDOW');
    else reasons.push('DELAYED_ARRIVAL');
    if (trip.originDetourKm <= 5 && areaFit >= 0.8) reasons.push('SMALL_DETOUR');
    if (reliability !== null && reliability >= 0.8 && trip.completedTrips >= 5) reasons.push('HIGH_RELIABILITY');

    const band: MatchBand =
      score >= policy.bandThresholds.excellent ? 'excellent' : score >= policy.bandThresholds.good ? 'good' : 'fair';

    scored.push({
      arrivalMs,
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
        pickup_distance_band_km: distanceBandKm(trip.originDetourKm),
        indicative_price_paise: indicativeLaunchPricePaise(input.corridorKm, input.weightKg, input.category),
        accepts_documents_only: trip.acceptsDocumentsOnly,
        score_breakdown: { formula_version: policy.version, fit, points },
      },
    });
  }

  // Deterministic: score, then the earliest arrival, then the earliest departure, then the id.
  // Two identical trips therefore always come back in the same order.
  scored.sort(
    (a, b) =>
      b.match.score - a.match.score ||
      a.arrivalMs - b.arrivalMs ||
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
      case 'TRIP_DEPARTED':
      case 'TRIP_NOT_ACTIVE':
        out.add('NO_TRIP_ON_DATE');
        break;
      case 'SELF_TRIP':
      case 'ITEM_PROHIBITED':
        // Not a route shortage: saying so would misdescribe why the list is empty.
        break;
    }
  }
  // A window that was only ever missed by the grace margin is worth telling the sender about,
  // because widening the window is the fix they can act on.
  if (out.has('NO_TRIP_ON_DATE') && rejections.some((r) => r.code === 'ARRIVES_TOO_LATE')) out.add('WINDOW_TOO_TIGHT');
  return [...out];
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
