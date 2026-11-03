import { z } from 'zod';

import {
  DEFAULT_LAUNCH_POLICY,
  isPilotTariffParams,
  parsePilotTariffPolicy,
  PILOT_MODEL_TAG,
  type LaunchPricingPolicy,
  type LaunchQuote,
  type ParcelLimits,
  type PilotTariffPolicy,
} from '@py/domain';

import type { Db } from '../db/client.ts';

/**
 * The active pricing policy, read from `pricing_policies`.
 *
 * Two models coexist: the v2 launch formula (`LaunchPricingPolicy`, provider-routed km) and the
 * finalized v3 pilot slab tariff (`PilotTariffPolicy`, fixed corridor segment distances). A stored
 * row is pilot-shaped when its params carry `model: "pilot_slab"`.
 *
 * The compiled defaults are only fallbacks for a database with no active row (fresh install, or a
 * deliberate rollback). Values are validated on read: a malformed active policy refuses the quote
 * instead of quietly producing a wrong price.
 */

export type ActivePricingPolicy = LaunchPricingPolicy | PilotTariffPolicy;

const tunables = z.object({
  baseFarePaise: z.number().int().min(0),
  routeRatePaisePerKm: z.number().min(0),
  weightRatePaisePerKg: z.number().min(0),
  handlingFeePaise: z.number().int().min(0),
  commissionRate: z.number().min(0).max(1),
  minCommissionPaise: z.number().int().min(0),
  taxRate: z.number().min(0).max(1),
  minTotalPaise: z.number().int().min(0),
  maxTotalPaise: z.number().int().min(0),
  maxSurgeMultiplier: z.number().min(1),
  maxDiscountRate: z.number().min(0).max(1),
  minTravellerPayoutPaise: z.number().int().min(0),
  maxSubsidyPaise: z.number().int().min(0),
  maxWeightKg: z.number().positive(),
  maxDimensionCm: z.number().positive(),
  volumetricDivisor: z.number().positive(),
});

export function parsePolicy(version: string, params: unknown): LaunchPricingPolicy {
  const parsed = tunables.safeParse({ ...DEFAULT_LAUNCH_POLICY, ...(params as object) });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Active pricing policy "${version}" is invalid: ${issues}`);
  }
  if (parsed.data.maxTotalPaise < parsed.data.minTotalPaise) {
    throw new Error(`Active pricing policy "${version}" is invalid: maxTotalPaise < minTotalPaise`);
  }
  return { version, ...parsed.data };
}

/** Parse in whichever model the params declare. Throws on a malformed policy. */
export function parseAnyPolicy(version: string, params: unknown): ActivePricingPolicy {
  if (isPilotTariffParams(params)) return parsePilotTariffPolicy(version, params);
  return parsePolicy(version, params);
}

/** The normalized params JSON to store for a validated policy of either model. */
export function normalizedPolicyParams(policy: ActivePricingPolicy): Record<string, unknown> {
  if (isPilotTariffPolicy(policy)) {
    const { version: _version, ...rest } = policy;
    return rest as unknown as Record<string, unknown>;
  }
  return policyTunables(policy);
}

export function isPilotTariffPolicy(policy: ActivePricingPolicy): policy is PilotTariffPolicy {
  return 'model' in policy && policy.model === PILOT_MODEL_TAG;
}

export async function loadActivePolicy(db: Db): Promise<ActivePricingPolicy> {
  const res = await db.query<{ version: string; params: Record<string, unknown> }>(
    `SELECT version, params FROM pricing_policies WHERE status = 'active' LIMIT 2`,
  );
  if (res.rows.length > 1) {
    throw new Error('More than one active pricing policy exists; the unique index should prevent this.');
  }
  const row = res.rows[0];
  if (!row) return DEFAULT_LAUNCH_POLICY;
  return parseAnyPolicy(row.version, row.params);
}

/** The tunable columns, without the identity field, for persistence and admin display. */
export function policyTunables(policy: LaunchPricingPolicy): Record<string, number> {
  const { version: _version, ...rest } = policy;
  return rest;
}

/** Parcel caps carried by the active policy, in the shape the eligibility and matching engines take. */
export function policyParcelLimits(policy: ActivePricingPolicy): ParcelLimits {
  if (isPilotTariffPolicy(policy)) {
    return { maxWeightKg: policy.maxWeightKg, maxDimsCm: policy.maxDimsCm };
  }
  return { maxWeightKg: policy.maxWeightKg, maxDimensionCm: policy.maxDimensionCm };
}

/** The corridor stop a city belongs to under the pilot tariff, by its recorded cityId, else by name. */
export function pilotStopNameForCity(
  policy: PilotTariffPolicy,
  cityId: string,
  cityName: string,
): string | null {
  const byId = policy.corridorStops.find((s) => s.cityId === cityId);
  if (byId) return byId.name;
  const byName = policy.corridorStops.find(
    (s) => s.name.trim().toLowerCase() === cityName.trim().toLowerCase(),
  );
  return byName ? byName.name : null;
}

/**
 * Maps the launch formula onto the legacy quote columns, which require
 * `total = subtotal + platform_fee + tax`.
 *
 * The commission is carved out of the service amount rather than added on top, so the two pre-tax
 * columns are just a split of `adjusted − discount`. The authoritative decomposition is the
 * quote's `breakdown` (and the v2 fields on the response/inputs). For the pilot slab tariff the
 * same split applies with tax and discount at zero: subtotal = fare − commission.
 */
export function legacyQuoteColumns(quote: LaunchQuote): {
  subtotal_paise: number;
  platform_fee_paise: number;
} {
  const preTax = quote.adjusted_paise - quote.discount_paise;
  const subtotal = Math.max(0, preTax - quote.commission_paise);
  return { subtotal_paise: subtotal, platform_fee_paise: preTax - subtotal };
}
