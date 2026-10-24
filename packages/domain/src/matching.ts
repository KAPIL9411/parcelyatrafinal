/**
 * Matching. Candidate conditions: docs/BUSINESS_LOGIC.md §3. Ranking reasons are a closed set
 * (MATCH_REASON_CODES) — never invent copy for a match card.
 *
 * The pilot has no area geocoding, so detour is not computed and `pickup_distance_band_km` is
 * omitted rather than guessed.
 */

import type { Category, MatchBand, MatchReasonCode, ReliabilityBand, TransportMode, VerificationState } from './enums.ts';
import { indicativePricePaise } from './pricing.ts';

export const MATCHING = {
  packagingAllowance: 1.1,
  arrivalGraceHours: 2,
  maxResults: 10,
} as const;

export interface TripCandidate {
  id: string;
  travellerId: string;
  mode: TransportMode;
  originCityId: string;
  destCityId: string;
  departureAt: Date;
  arrivalEstimateAt: Date;
  capacityKg: number;
  capacityKgRemaining: number;
  status: string;
  acceptsDocumentsOnly: boolean;
  travellerFirstName: string | null;
  travellerInitial: string | null;
  verificationState: VerificationState;
  reliabilityBand: ReliabilityBand;
  completedTrips: number;
}

export interface MatchInput {
  senderId: string;
  originCityId: string;
  destCityId: string;
  originServiceable: boolean;
  destServiceable: boolean;
  category: Category;
  weightKg: number;
  windowStart: Date;
  windowEnd: Date;
  corridorKm: number;
  enabledModes: readonly TransportMode[];
  now: Date;
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
  mode: TransportMode;
  departure_at: string;
  arrival_estimate_at: string;
  capacity_kg_remaining: number;
  indicative_price_paise: number;
  accepts_documents_only: boolean;
}

export type NoMatchReason =
  | 'NO_TRIP_ON_DATE'
  | 'NO_CAPACITY'
  | 'WINDOW_TOO_TIGHT'
  | 'ORIGIN_NOT_SERVED'
  | 'DESTINATION_NOT_SERVED'
  | 'MODE_DISABLED';

export interface MatchResult {
  matches: Match[];
  low_confidence: boolean;
  no_match_reasons: NoMatchReason[];
}

export function rankMatches(input: MatchInput, trips: readonly TripCandidate[]): MatchResult {
  if (!input.originServiceable || !input.destServiceable) {
    return {
      matches: [],
      low_confidence: false,
      no_match_reasons: [
        ...(!input.originServiceable ? (['ORIGIN_NOT_SERVED'] as const) : []),
        ...(!input.destServiceable ? (['DESTINATION_NOT_SERVED'] as const) : []),
      ],
    };
  }

  const reasons = new Set<NoMatchReason>();
  const matches: Match[] = [];
  const requiredKg = input.weightKg * MATCHING.packagingAllowance;
  const graceMs = MATCHING.arrivalGraceHours * 3_600_000;
  const windowEndWithGrace = input.windowEnd.getTime() + graceMs;

  for (const trip of trips) {
    if (!input.enabledModes.includes(trip.mode)) {
      reasons.add('MODE_DISABLED');
      continue;
    }
    if (trip.originCityId !== input.originCityId) {
      reasons.add('ORIGIN_NOT_SERVED');
      continue;
    }
    if (trip.destCityId !== input.destCityId) {
      reasons.add('DESTINATION_NOT_SERVED');
      continue;
    }
    if (trip.travellerId === input.senderId) continue; // no self-booking
    if (!['published', 'partially_booked'].includes(trip.status)) continue;
    if (trip.verificationState !== 'verified') continue;
    if (trip.acceptsDocumentsOnly && input.category !== 'documents' && input.category !== 'educational_certificates') {
      continue;
    }
    if (trip.departureAt.getTime() > input.windowEnd.getTime()) {
      reasons.add('NO_TRIP_ON_DATE');
      continue;
    }
    if (trip.capacityKgRemaining < requiredKg) {
      reasons.add('NO_CAPACITY');
      continue;
    }
    if (trip.arrivalEstimateAt.getTime() > windowEndWithGrace) {
      reasons.add('WINDOW_TOO_TIGHT');
      continue;
    }

    const reasonsForMatch: MatchReasonCode[] = ['ON_ROUTE', 'CAPACITY_OK'];
    let score = 40;

    const arrivesInWindow = trip.arrivalEstimateAt.getTime() <= input.windowEnd.getTime();
    if (arrivesInWindow) {
      score += 25;
      reasonsForMatch.push('ARRIVES_IN_WINDOW');
    } else {
      score += 10;
      reasonsForMatch.push('DELAYED_ARRIVAL');
    }

    const headroom = trip.capacityKgRemaining / Math.max(0.1, requiredKg);
    score += headroom >= 2 ? 15 : headroom >= 1.5 ? 10 : 5;

    if (trip.reliabilityBand === 'reliable' || trip.reliabilityBand === 'highly_reliable') {
      score += 10;
      reasonsForMatch.push('HIGH_RELIABILITY');
    } else if (trip.completedTrips === 0) {
      score += 2;
    } else {
      score += 5;
    }

    reasonsForMatch.push('VERIFIED_ID');

    const hoursToDeparture = (trip.departureAt.getTime() - input.now.getTime()) / 3_600_000;
    score += hoursToDeparture <= 24 ? 10 : hoursToDeparture <= 72 ? 6 : 2;

    const finalScore = Math.max(0, Math.min(100, score));
    matches.push({
      trip_id: trip.id,
      score: finalScore,
      band: finalScore >= 80 ? 'excellent' : finalScore >= 60 ? 'good' : 'fair',
      reasons: [...new Set(reasonsForMatch)],
      ...(trip.travellerFirstName ? { traveller_first_name: trip.travellerFirstName } : {}),
      ...(trip.travellerInitial ? { traveller_initial: trip.travellerInitial } : {}),
      verification_state: trip.verificationState,
      reliability_band: trip.reliabilityBand,
      mode: trip.mode,
      departure_at: trip.departureAt.toISOString(),
      arrival_estimate_at: trip.arrivalEstimateAt.toISOString(),
      capacity_kg_remaining: trip.capacityKgRemaining,
      indicative_price_paise: indicativePricePaise(input.corridorKm, input.weightKg, input.category),
      accepts_documents_only: trip.acceptsDocumentsOnly,
    });
  }

  matches.sort((a, b) => b.score - a.score || a.departure_at.localeCompare(b.departure_at));
  const top = matches.slice(0, MATCHING.maxResults);

  return {
    matches: top,
    low_confidence: top.length > 0 && top.every((m) => m.band === 'fair'),
    no_match_reasons: top.length === 0 ? [...reasons] : [],
  };
}
