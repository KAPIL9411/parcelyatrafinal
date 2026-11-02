import { z } from 'zod';

import { DEFAULT_LAUNCH_POLICY, type LaunchPricingPolicy, type LaunchQuote } from '@py/domain';

import type { Db } from '../db/client.ts';

/**
 * The active pricing policy, read from `pricing_policies`.
 *
 * The compiled `DEFAULT_LAUNCH_POLICY` is only a fallback for a database that has no active row
 * (a fresh install, or a deliberate rollback). Values are validated on read: a malformed active
 * policy refuses the quote instead of quietly producing a wrong price.
 */

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

export async function loadActivePolicy(db: Db): Promise<LaunchPricingPolicy> {
  const res = await db.query<{ version: string; params: Record<string, unknown> }>(
    `SELECT version, params FROM pricing_policies WHERE status = 'active' LIMIT 2`,
  );
  if (res.rows.length > 1) {
    throw new Error('More than one active pricing policy exists; the unique index should prevent this.');
  }
  const row = res.rows[0];
  if (!row) return DEFAULT_LAUNCH_POLICY;
  return parsePolicy(row.version, row.params);
}

/** The tunable columns, without the identity field, for persistence and admin display. */
export function policyTunables(policy: LaunchPricingPolicy): Record<string, number> {
  const { version: _version, ...rest } = policy;
  return rest;
}

/**
 * Maps the launch formula onto the legacy quote columns, which require
 * `total = subtotal + platform_fee + tax`.
 *
 * The commission is carved out of the service amount rather than added on top, so the two pre-tax
 * columns are just a split of `adjusted − discount`. The authoritative decomposition is the
 * quote's `breakdown` (and the v2 fields on the response/inputs).
 */
export function legacyQuoteColumns(quote: LaunchQuote): {
  subtotal_paise: number;
  platform_fee_paise: number;
} {
  const preTax = quote.adjusted_paise - quote.discount_paise;
  const subtotal = Math.max(0, preTax - quote.commission_paise);
  return { subtotal_paise: subtotal, platform_fee_paise: preTax - subtotal };
}
