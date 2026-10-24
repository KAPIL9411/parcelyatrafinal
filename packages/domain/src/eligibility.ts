/**
 * Eligibility rules E1–E10. Authoritative description: docs/BUSINESS_LOGIC.md §2.
 * This module is the single implementation; the server is the only decider.
 */

import type { Category } from './enums.ts';
import { RESTRICTED_CATEGORIES } from './enums.ts';

export const PILOT_LIMITS = {
  maxWeightKg: 5,
  maxDimensionCm: 45,
  maxDeclaredValuePaise: 500_000, // ₹5,000
  maxWindowDays: 7,
  maxCancellations30d: 3,
} as const;

export type EligibilityFailureCode =
  | 'ACCOUNT_SUSPENDED'
  | 'PHONE_NOT_VERIFIED'
  | 'ITEM_PROHIBITED'
  | 'PARCEL_TOO_LARGE'
  | 'VALUE_ABOVE_PILOT_LIMIT'
  | 'CITY_NOT_SERVICED'
  | 'WINDOW_INVALID'
  | 'RISK_REVIEW_REQUIRED'
  | 'CANCELLATION_LIMIT'
  | 'SAME_CITY';

export interface EligibilityInput {
  accountStatus: 'active' | 'suspended' | 'deleted';
  phoneVerified: boolean;
  category: Category;
  description: string;
  weightKg: number;
  dimsCm: readonly number[];
  declaredValuePaise: number;
  originCityId: string;
  destCityId: string;
  originServiceable: boolean;
  destServiceable: boolean;
  windowStart: Date;
  windowEnd: Date;
  hasUnresolvedFraudFlag: boolean;
  cancellationsLast30d: number;
  now?: Date;
}

export interface EligibilityDecision {
  ok: boolean;
  /** Hard failure. When present, the parcel cannot be posted. */
  code?: EligibilityFailureCode;
  message?: string;
  /** Soft block: post it, but queue a human check (E8). */
  reviewRequired: boolean;
  reviewReason: string | null;
  /** Rules that passed, for the audit trail. */
  passed: string[];
}

const PROHIBITED_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\b(cash|currency|bank ?notes?|notes of|rupee notes?)\b/i, reason: 'cash or currency' },
  { re: /\b(gold|silver|jewell?ery|diamond|ornament|bullion)\b/i, reason: 'jewellery or precious metal' },
  { re: /\b(passport|visa stamp|aadhaar|aadhar)\b/i, reason: 'identity documents that are not permitted to travel this way' },
  { re: /\b(medicine|medicines|tablets?|syrup|injection|pharmaceutical|insulin)\b/i, reason: 'medicines' },
  { re: /\b(laptop|iphone|smartphone|mobile phone|tablet device|camera body)\b/i, reason: 'high-value electronics' },
  { re: /\b(battery|lithium|power ?bank|inverter|acid)\b/i, reason: 'batteries or hazardous material' },
  { re: /\b(perfume|aerosol|spray|thinner|paint|petrol|diesel|kerosene|lighter fluid)\b/i, reason: 'flammable material' },
  { re: /\b(alcohol|liquor|beer|whisky|wine)\b/i, reason: 'alcohol' },
  { re: /\b(tobacco|cigarette|gutkha|vape)\b/i, reason: 'tobacco' },
  { re: /\b(gun|firearm|pistol|rifle|ammunition|knife set|sword)\b/i, reason: 'weapons' },
  { re: /\b(live animal|puppy|kitten|bird|fish)\b/i, reason: 'live animals' },
  { re: /\b(food|sweets|milk|curd|meat|fruit|vegetable|prasad liquid)\b/i, reason: 'perishable food' },
  { re: /\b(acid|chemical|explosive|firework|cracker)\b/i, reason: 'hazardous chemicals' },
];

export function detectProhibitedContent(description: string): string | null {
  for (const { re, reason } of PROHIBITED_PATTERNS) {
    if (re.test(description)) return reason;
  }
  return null;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityDecision {
  const passed: string[] = [];
  const now = input.now ?? new Date();
  const fail = (code: EligibilityFailureCode, message: string): EligibilityDecision => ({
    ok: false,
    code,
    message,
    reviewRequired: false,
    reviewReason: null,
    passed,
  });

  // E1 — account active
  if (input.accountStatus !== 'active') {
    return fail('ACCOUNT_SUSPENDED', 'This account cannot send parcels right now.');
  }
  passed.push('E1');

  // E2 — phone verified
  if (!input.phoneVerified) {
    return fail('PHONE_NOT_VERIFIED', 'Verify your phone number before sending a parcel.');
  }
  passed.push('E2');

  // E3 — prohibited content (hard block)
  const prohibited = detectProhibitedContent(`${input.category} ${input.description}`);
  if (prohibited) {
    return fail('ITEM_PROHIBITED', `We do not carry ${prohibited}.`);
  }
  passed.push('E3');

  // E4 — size and weight
  const longestSide = input.dimsCm.length ? Math.max(...input.dimsCm) : 0;
  if (input.weightKg <= 0 || input.weightKg > PILOT_LIMITS.maxWeightKg) {
    return fail('PARCEL_TOO_LARGE', `Parcels are capped at ${PILOT_LIMITS.maxWeightKg} kg at launch.`);
  }
  if (longestSide > PILOT_LIMITS.maxDimensionCm) {
    return fail('PARCEL_TOO_LARGE', `The longest side must be ${PILOT_LIMITS.maxDimensionCm} cm or less.`);
  }
  passed.push('E4');

  // E5 — declared value
  if (input.declaredValuePaise <= 0 || input.declaredValuePaise > PILOT_LIMITS.maxDeclaredValuePaise) {
    return fail(
      'VALUE_ABOVE_PILOT_LIMIT',
      'Declared value is capped at ₹5,000 because parcels are not insured at launch.',
    );
  }
  passed.push('E5');

  // E6 — serviceable cities
  if (!input.originServiceable || !input.destServiceable) {
    return fail('CITY_NOT_SERVICED', 'We do not serve this route yet.');
  }
  if (input.originCityId === input.destCityId) {
    return fail('SAME_CITY', 'Origin and destination must be different cities.');
  }
  passed.push('E6');

  // E7 — window
  const start = input.windowStart.getTime();
  const end = input.windowEnd.getTime();
  const horizon = now.getTime() + PILOT_LIMITS.maxWindowDays * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return fail('WINDOW_INVALID', 'Choose a delivery window with an end after its start.');
  }
  if (start < now.getTime() - 60_000) {
    return fail('WINDOW_INVALID', 'The delivery window must be in the future.');
  }
  if (end > horizon) {
    return fail('WINDOW_INVALID', `The window must be within the next ${PILOT_LIMITS.maxWindowDays} days.`);
  }
  passed.push('E7');

  // E8 — restricted category. Soft block, so it is recorded here and only returned at the end;
  // a later hard failure (E9, E10) must still win.
  const restricted = RESTRICTED_CATEGORIES.includes(input.category);

  // E9 — fraud flag
  if (input.hasUnresolvedFraudFlag) {
    return fail('RISK_REVIEW_REQUIRED', 'This account is under review. Contact support.');
  }
  passed.push('E9');

  // E10 — cancellation limit
  if (input.cancellationsLast30d >= PILOT_LIMITS.maxCancellations30d) {
    return fail(
      'CANCELLATION_LIMIT',
      `You have cancelled ${PILOT_LIMITS.maxCancellations30d} bookings in the last 30 days.`,
    );
  }
  passed.push('E10');

  if (restricted) {
    return {
      ok: true,
      reviewRequired: true,
      reviewReason: 'Restricted category — a person will check this before it is matched.',
      passed: [...passed, 'E8'],
    };
  }

  return { ok: true, reviewRequired: false, reviewReason: null, passed: [...passed, 'E8'] };
}
