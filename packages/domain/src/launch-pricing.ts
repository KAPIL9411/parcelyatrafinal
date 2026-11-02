/**
 * Launch pricing (v2). Every default below is an EXPERIMENT from the 2026-10 launch brief, not a
 * validated market rate. The policy is versioned and expected to be overridden by a database row
 * (`pricing_policies`); this constant is only the compiled fallback used when no policy is active.
 *
 * Reconciliation invariant, enforced by construction and re-checked before returning:
 *
 *   billableWeight = max(actualWeight, volumetricWeight)          volumetric = L·W·H / divisor
 *   gross          = base + distance + weight + handling + pickup + dropoff
 *   adjusted       = gross × surge
 *   discount       = adjusted × discountRate                       (platform-funded subsidy)
 *   tax            = (adjusted − discount) × taxRate
 *   total          = adjusted − discount + tax
 *   commission     = (adjusted − pickup − dropoff) × commissionRate
 *   traveller      = adjusted − commission + travellerSubsidy
 *   platformNet    = commission − travellerSubsidy − discount      (may be negative — surfaced)
 *
 * The sender's fare never silently absorbs the traveller's minimum payout: a subsidy is applied
 * explicitly, itemised, and flagged, per the brief's "never conceal losses".
 */

import type { Category } from './enums.ts';
import { clampInt } from './money.ts';

export const LAUNCH_FORMULA_VERSION = 'v2.0-launch';

export interface LaunchPricingPolicy {
  version: string;
  baseFarePaise: number;
  routeRatePaisePerKm: number;
  weightRatePaisePerKg: number;
  handlingFeePaise: number;
  commissionRate: number;
  minCommissionPaise: number;
  taxRate: number;
  minTotalPaise: number;
  maxTotalPaise: number;
  maxSurgeMultiplier: number;
  maxDiscountRate: number;
  /** Below this payout a launch subsidy is applied (up to maxSubsidyPaise) and flagged. */
  minTravellerPayoutPaise: number;
  maxSubsidyPaise: number;
  maxWeightKg: number;
  maxDimensionCm: number;
  volumetricDivisor: number;
}

export const DEFAULT_LAUNCH_POLICY: LaunchPricingPolicy = {
  version: 'launch-2026-10-experiment',
  baseFarePaise: 1_200, // ₹12
  routeRatePaisePerKm: 18, // ₹0.18 per actual road km
  weightRatePaisePerKg: 400, // ₹4 per billable kg
  handlingFeePaise: 0,
  commissionRate: 0.06, // 6% launch commission
  minCommissionPaise: 0,
  taxRate: 0.18, // GST on the service amount; treatment subject to professional advice
  minTotalPaise: 3_900, // ₹39
  maxTotalPaise: 250_000, // ₹2,500
  maxSurgeMultiplier: 1.5,
  maxDiscountRate: 0.5,
  minTravellerPayoutPaise: 5_000, // ₹50
  maxSubsidyPaise: 3_000, // ₹30
  maxWeightKg: 5,
  maxDimensionCm: 45,
  volumetricDivisor: 5_000, // cm³ per kg, the courier-industry convention
};

export type ServiceMode = 'hub_to_hub' | 'doorstep';

export interface LaunchPriceInput {
  /** Actual road kilometres from a routing provider, or a clearly-labelled estimate. */
  roadDistanceKm: number;
  distanceSource: 'routed' | 'estimated';
  actualWeightKg: number;
  /** [length, width, height] in centimetres. Omit when dimensions are unknown. */
  dimsCm?: readonly number[];
  category: Category;
  serviceMode?: ServiceMode;
  /** Caller supplies these only when a doorstep runner is genuinely available. */
  pickupFeePaise?: number;
  dropoffFeePaise?: number;
  surgeMultiplier?: number;
  discountRate?: number;
  policy?: LaunchPricingPolicy;
}

export interface LaunchQuoteLine {
  label: string;
  amount_paise: number;
  note?: string;
}

export type LaunchWarning =
  | 'DISTANCE_ESTIMATED'
  | 'TRAVELLER_SUBSIDY_APPLIED'
  | 'PLATFORM_LOSS_AT_QUOTE'
  | 'MAX_FARE_CAPPED'
  | 'PARCEL_ABOVE_LIMIT';

export interface LaunchQuote {
  formula_version: string;
  policy_version: string;
  actual_weight_kg: number;
  volumetric_weight_kg: number;
  billable_weight_kg: number;
  road_distance_km: number;
  distance_source: 'routed' | 'estimated';
  route_cost_paise: number;
  weight_cost_paise: number;
  handling_paise: number;
  pickup_paise: number;
  dropoff_paise: number;
  surge_paise: number;
  adjusted_paise: number;
  discount_paise: number;
  traveller_subsidy_paise: number;
  tax_paise: number;
  total_paise: number;
  traveller_paise: number;
  commission_paise: number;
  processing_fee_paise: number;
  platform_net_paise: number;
  loss_making: boolean;
  capped: boolean;
  within_limits: boolean;
  warnings: LaunchWarning[];
  breakdown: LaunchQuoteLine[];
}

export function volumetricWeightKg(dimsCm: readonly number[] | undefined, divisor: number): number {
  if (!dimsCm || dimsCm.length < 3) return 0;
  const [l, w, h] = dimsCm;
  if (![l, w, h].every((d) => typeof d === 'number' && Number.isFinite(d) && d > 0)) return 0;
  return (l! * w! * h!) / divisor;
}

/** Rounded to 10 g so a volumetric figure does not introduce float noise into the quote. */
export function billableWeightKg(
  actualKg: number,
  dimsCm: readonly number[] | undefined,
  divisor: number,
): { billable: number; volumetric: number } {
  const volumetric = Math.round(volumetricWeightKg(dimsCm, divisor) * 100) / 100;
  const actual = Math.round(Math.max(0, actualKg) * 100) / 100;
  return { billable: Math.max(actual, volumetric), volumetric };
}

function assertPolicy(p: LaunchPricingPolicy): void {
  const bad = (msg: string): never => {
    throw new Error(`Invalid launch pricing policy: ${msg}`);
  };
  if (!p.version) bad('version is required');
  for (const key of ['baseFarePaise', 'routeRatePaisePerKm', 'weightRatePaisePerKg', 'handlingFeePaise', 'minTotalPaise', 'maxTotalPaise', 'minTravellerPayoutPaise', 'maxSubsidyPaise'] as const) {
    if (!Number.isFinite(p[key]) || p[key] < 0) bad(`${key} must be a finite non-negative number`);
  }
  if (p.maxTotalPaise < p.minTotalPaise) bad('maxTotalPaise must not be below minTotalPaise');
  for (const key of ['commissionRate', 'taxRate', 'maxDiscountRate'] as const) {
    if (!Number.isFinite(p[key]) || p[key] < 0 || p[key] > 1) bad(`${key} must be within 0–1`);
  }
  if (p.maxSurgeMultiplier < 1) bad('maxSurgeMultiplier must be at least 1');
  if (p.volumetricDivisor <= 0) bad('volumetricDivisor must be positive');
  if (p.maxWeightKg <= 0 || p.maxDimensionCm <= 0) bad('parcel limits must be positive');
}

export function quoteLaunchPrice(input: LaunchPriceInput): LaunchQuote {
  const p = input.policy ?? DEFAULT_LAUNCH_POLICY;
  assertPolicy(p);

  const km = Math.max(0, input.roadDistanceKm);
  const { billable, volumetric } = billableWeightKg(input.actualWeightKg, input.dimsCm, p.volumetricDivisor);

  const surges = clampMultiplier(opts(input.surgeMultiplier), p.maxSurgeMultiplier);
  const discountRate = clampRate(Number.isFinite(input.discountRate) ? (input.discountRate as number) : 0, p.maxDiscountRate);
  const serviceMode = input.serviceMode ?? 'hub_to_hub';
  const pickup = serviceMode === 'doorstep' ? Math.max(0, Math.round(input.pickupFeePaise ?? 0)) : 0;
  const dropoff = serviceMode === 'doorstep' ? Math.max(0, Math.round(input.dropoffFeePaise ?? 0)) : 0;

  const weightCost = Math.round(billable * p.weightRatePaisePerKg);
  const handling = p.handlingFeePaise;

  interface Ctx {
    routeCost: number;
    surgeAmount: number;
    uplift: number;
    discount: number;
    tax: number;
    total: number;
  }

  const compute = (distanceCost: number, uplift = 0): Ctx => {
    const gross = p.baseFarePaise + distanceCost + weightCost + handling + pickup + dropoff + uplift;
    const adjusted = Math.round(gross * surges);
    const surgeAmount = adjusted - gross;
    const discount = Math.round(adjusted * discountRate);
    const tax = Math.round((adjusted - discount) * p.taxRate);
    return { routeCost: distanceCost, surgeAmount, uplift, discount, tax, total: adjusted - discount + tax };
  };

  let distanceCost = Math.max(0, Math.round(km * p.routeRatePaisePerKm));
  let ctx = compute(distanceCost);
  let capped = false;

  // Floor: lift the service amount until the sender's total reaches the minimum fare.
  if (ctx.total < p.minTotalPaise) {
    const shortfall = p.minTotalPaise - ctx.total;
    ctx = compute(distanceCost, shortfall);
  }

  // Ceiling: shrink the distance charge until the total fits. Converges in a pass or two because
  // tax and discount are proportional.
  for (let i = 0; i < 6 && ctx.total > p.maxTotalPaise; i++) {
    const excess = ctx.total - p.maxTotalPaise;
    const next = Math.max(0, distanceCost - excess);
    if (next === distanceCost) break;
    distanceCost = next;
    ctx = compute(distanceCost, ctx.uplift);
    capped = true;
  }

  const adjusted = ctx.total + ctx.discount - ctx.tax; // back out: total = adjusted − discount + tax
  const commission = clampInt(
    Math.round(Math.max(0, adjusted - pickup - dropoff) * p.commissionRate),
    p.minCommissionPaise,
    adjusted,
  );

  let traveller = adjusted - commission;
  const subsidy = traveller < p.minTravellerPayoutPaise
    ? Math.min(p.minTravellerPayoutPaise - traveller, p.maxSubsidyPaise)
    : 0;
  traveller += subsidy;

  const platformNet = commission - subsidy - ctx.discount;
  const withinLimits =
    input.actualWeightKg <= p.maxWeightKg &&
    (!input.dimsCm || input.dimsCm.length === 0 || Math.max(...input.dimsCm) <= p.maxDimensionCm);

  const warnings: LaunchWarning[] = [];
  if (input.distanceSource === 'estimated') warnings.push('DISTANCE_ESTIMATED');
  if (subsidy > 0) warnings.push('TRAVELLER_SUBSIDY_APPLIED');
  if (platformNet < 0) warnings.push('PLATFORM_LOSS_AT_QUOTE');
  if (capped) warnings.push('MAX_FARE_CAPPED');
  if (!withinLimits) warnings.push('PARCEL_ABOVE_LIMIT');

  const distanceNote =
    input.distanceSource === 'routed'
      ? 'Actual road distance from the routing provider'
      : 'Estimated road distance — the routing provider has not confirmed this pair';

  const lines: LaunchQuoteLine[] = [
    { label: 'Base fare', amount_paise: p.baseFarePaise },
    {
      label: `Road distance (${formatKm(km)} km × ₹${(p.routeRatePaisePerKm / 100).toFixed(2)}/km)`,
      amount_paise: ctx.routeCost,
      note: distanceNote,
    },
    { label: `Billable weight (${formatKg(billable)} kg)`, amount_paise: weightCost },
  ];
  if (handling > 0) lines.push({ label: 'Handling', amount_paise: handling });
  if (pickup > 0) lines.push({ label: 'Doorstep pickup', amount_paise: pickup, note: 'Paid at the doorstep' });
  if (dropoff > 0) lines.push({ label: 'Doorstep drop-off', amount_paise: dropoff, note: 'Paid at the doorstep' });
  if (ctx.surgeAmount > 0) {
    lines.push({
      label: `Peak demand ×${surges.toFixed(1)}`,
      amount_paise: ctx.surgeAmount,
      note: 'Shown separately. Never applied silently.',
    });
  }
  if (ctx.uplift > 0) lines.push({ label: 'Minimum fare adjustment', amount_paise: ctx.uplift });
  lines.push({
    label: `GST (${Math.round(p.taxRate * 100)}%)`,
    amount_paise: ctx.tax,
    note: 'Tax treatment is subject to professional advice',
  });
  if (ctx.discount > 0) {
    lines.push({
      label: 'Launch discount',
      amount_paise: -ctx.discount,
      note: 'Funded by Parcel Yatra, not by the traveller',
    });
  }

  const lineSum = lines.reduce((acc, l) => acc + l.amount_paise, 0);
  if (lineSum !== ctx.total) {
    throw new Error(`launch quote breakdown mismatch: lines=${lineSum} total=${ctx.total}`);
  }

  return {
    formula_version: LAUNCH_FORMULA_VERSION,
    policy_version: p.version,
    actual_weight_kg: Math.round(Math.max(0, input.actualWeightKg) * 100) / 100,
    volumetric_weight_kg: volumetric,
    billable_weight_kg: billable,
    road_distance_km: km,
    distance_source: input.distanceSource,
    route_cost_paise: p.baseFarePaise + ctx.routeCost,
    weight_cost_paise: weightCost,
    handling_paise: handling,
    pickup_paise: pickup,
    dropoff_paise: dropoff,
    surge_paise: ctx.surgeAmount,
    adjusted_paise: adjusted,
    discount_paise: ctx.discount,
    traveller_subsidy_paise: subsidy,
    tax_paise: ctx.tax,
    total_paise: ctx.total,
    traveller_paise: traveller,
    commission_paise: commission,
    processing_fee_paise: 0, // no payment gateway at launch; sandbox only
    platform_net_paise: platformNet,
    loss_making: platformNet < 0,
    capped,
    within_limits: withinLimits,
    warnings,
    breakdown: lines,
  };
}

/** Indicative price on a match card. Same engine, hub-to-hub, no surge or discount. */
export function indicativeLaunchPricePaise(
  roadDistanceKm: number,
  weightKg: number,
  category: Category,
): number {
  return quoteLaunchPrice({
    roadDistanceKm,
    distanceSource: 'estimated',
    actualWeightKg: weightKg,
    category,
    serviceMode: 'hub_to_hub',
  }).total_paise;
}

function opts(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 1;
}

function clampMultiplier(value: number, max: number): number {
  return Math.min(max, Math.max(1, value));
}

function clampRate(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function formatKm(km: number): string {
  return km >= 10 ? String(Math.round(km)) : km.toFixed(1);
}

function formatKg(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
