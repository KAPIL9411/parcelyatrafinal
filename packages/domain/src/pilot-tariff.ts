/**
 * Pilot slab tariff (v3) — the finalized business plan for the Bareilly–Nainital launch corridor.
 *
 *   sender fare    = max(₹39, ₹19 + ₹0.35/km) + weight surcharge slab (+ hill segment surcharge)
 *   traveller paid = max(₹25, ₹18 + ₹0.20/km) + weight bonus slab    (+ hill segment bonus)
 *   commission     = sender fare − traveller payout, floored at zero — never negative.
 *
 * Distances are the fixed corridor segment distances from the plan, not provider-routed figures:
 * Bareilly→Baheri 50, Baheri→Kichha 18, Kichha→Rudrapur 19, Rudrapur→Haldwani 40,
 * Haldwani→Nainital 45 (total 172 km). Every intermediate pickup→drop pair in both directions is
 * the sum of the segments between them.
 *
 * Output is deliberately shaped as a `LaunchQuote` so the existing quote snapshot columns,
 * `legacyQuoteColumns` and the frontend breakdown renderer work untouched.
 *
 * GST is NOT applied here: the pilot tariff as finalized is the all-in figure the sender pays, and
 * tax treatment is pending professional advice — see parcel-yatra-startup-pack/legal.
 */

import type { Category } from './enums.ts';
import type { LaunchQuote, LaunchQuoteLine, LaunchWarning } from './launch-pricing.ts';

export const PILOT_FORMULA_VERSION = 'v3.0-pilot-slab';
export const PILOT_MODEL_TAG = 'pilot_slab' as const;

export interface PilotCorridorStop {
  name: string;
  /** Database row in `cities`; carried so the server can resolve a parcel's city to its stop. */
  cityId?: string;
  /** Road km to the next stop on the corridor; null for the final stop. */
  segmentKmToNext: number | null;
  /** True when the segment to the next stop is the hill section carrying the surcharge. */
  hillSegmentToNext?: boolean;
}

export interface PilotWeightSlab {
  /** Upper bound (inclusive), in grams. Slabs are checked in ascending order. */
  maxGrams: number;
  senderSurchargePaise: number;
  travellerBonusPaise: number;
}

export interface PilotTariffPolicy {
  model: typeof PILOT_MODEL_TAG;
  version: string;
  corridorStops: PilotCorridorStop[];
  senderBasePaise: number;
  senderRatePaisePerKm: number;
  senderMinFarePaise: number;
  travellerBasePaise: number;
  travellerRatePaisePerKm: number;
  travellerMinPayoutPaise: number;
  /** Ascending by maxGrams. A parcel heavier than the top slab is out of scope. */
  weightSlabs: PilotWeightSlab[];
  maxWeightKg: number;
  /** Provisional maximum: length × width × height in cm, matched against the parcel's sides sorted descending. */
  maxDimsCm: readonly number[];
  hillSenderSurchargePaise: number;
  hillTravellerSurchargePaise: number;
  /** Payment gateway charge as a fraction of the captured amount. 0 until a gateway is approved. */
  gatewayFeeRate: number;
  /** Hard floor on platform commission. The payout is trimmed before this if needed, never the reverse. */
  minCommissionPaise: number;
}

const DEFAULT_CORRIDOR: PilotCorridorStop[] = [
  { name: 'Bareilly', segmentKmToNext: 50 },
  { name: 'Baheri', segmentKmToNext: 18 },
  { name: 'Kichha', segmentKmToNext: 19 },
  { name: 'Rudrapur', segmentKmToNext: 40 },
  { name: 'Haldwani', segmentKmToNext: 45, hillSegmentToNext: true },
  { name: 'Nainital', segmentKmToNext: null },
];

export const DEFAULT_PILOT_POLICY: PilotTariffPolicy = {
  model: PILOT_MODEL_TAG,
  version: 'pilot-2026-11',
  corridorStops: DEFAULT_CORRIDOR,
  senderBasePaise: 1_900, // ₹19
  senderRatePaisePerKm: 35, // ₹0.35 per km
  senderMinFarePaise: 3_900, // ₹39
  travellerBasePaise: 1_800, // ₹18
  travellerRatePaisePerKm: 20, // ₹0.20 per km
  travellerMinPayoutPaise: 2_500, // ₹25
  weightSlabs: [
    { maxGrams: 500, senderSurchargePaise: 0, travellerBonusPaise: 0 },
    { maxGrams: 1_000, senderSurchargePaise: 1_000, travellerBonusPaise: 800 },
    { maxGrams: 2_000, senderSurchargePaise: 2_000, travellerBonusPaise: 1_500 },
    { maxGrams: 3_000, senderSurchargePaise: 3_500, travellerBonusPaise: 2_200 },
  ],
  maxWeightKg: 3,
  maxDimsCm: [30, 25, 20],
  hillSenderSurchargePaise: 1_500, // ₹15 on fares that include the Haldwani–Nainital segment
  hillTravellerSurchargePaise: 1_000, // ₹10 traveller bonus on the same segment
  gatewayFeeRate: 0,
  minCommissionPaise: 0,
};

export function isPilotTariffParams(params: unknown): boolean {
  return (
    typeof params === 'object' &&
    params !== null &&
    (params as { model?: unknown }).model === PILOT_MODEL_TAG
  );
}

export function isPilotTariffPolicy(policy: unknown): policy is PilotTariffPolicy {
  return isPilotTariffParams(policy);
}

/** Merges stored params over the defaults and validates the result. Throws on a malformed policy. */
export function parsePilotTariffPolicy(version: string, params: unknown): PilotTariffPolicy {
  const raw = (params ?? {}) as Partial<PilotTariffPolicy> & Record<string, unknown>;
  const merged: PilotTariffPolicy = {
    ...DEFAULT_PILOT_POLICY,
    ...raw,
    model: PILOT_MODEL_TAG,
    version,
    corridorStops: Array.isArray(raw.corridorStops) && raw.corridorStops.length >= 2
      ? (raw.corridorStops as PilotCorridorStop[])
      : DEFAULT_PILOT_POLICY.corridorStops.map((s) => ({ ...s })),
    weightSlabs: Array.isArray(raw.weightSlabs) && raw.weightSlabs.length > 0
      ? (raw.weightSlabs as PilotWeightSlab[])
      : DEFAULT_PILOT_POLICY.weightSlabs.map((s) => ({ ...s })),
    maxDimsCm: Array.isArray(raw.maxDimsCm) && raw.maxDimsCm.length === 3
      ? (raw.maxDimsCm as number[])
      : [...DEFAULT_PILOT_POLICY.maxDimsCm],
  };
  assertPilotPolicy(merged);
  return merged;
}

function bad(msg: string): never {
  throw new Error(`Invalid pilot tariff policy: ${msg}`);
}

function nonNeg(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    bad(`${key} must be a finite non-negative number`);
  }
  return value;
}

export function assertPilotPolicy(p: PilotTariffPolicy): void {
  if (!p.version) bad('version is required');
  for (const key of [
    'senderBasePaise', 'senderRatePaisePerKm', 'senderMinFarePaise',
    'travellerBasePaise', 'travellerRatePaisePerKm', 'travellerMinPayoutPaise',
    'hillSenderSurchargePaise', 'hillTravellerSurchargePaise', 'minCommissionPaise',
  ] as const) {
    nonNeg(p[key], key);
  }
  if (!Number.isFinite(p.maxWeightKg) || p.maxWeightKg <= 0) bad('maxWeightKg must be positive');
  if (p.gatewayFeeRate < 0 || p.gatewayFeeRate > 1) bad('gatewayFeeRate must be within 0–1');
  if (p.corridorStops.length < 2) bad('corridorStops must have at least two stops');
  p.corridorStops.forEach((stop, i) => {
    if (!stop.name) bad(`corridorStops[${i}].name is required`);
    if (i === p.corridorStops.length - 1) return;
    if (!Number.isFinite(stop.segmentKmToNext as number) || (stop.segmentKmToNext as number) <= 0) {
      bad(`corridorStops[${i}].segmentKmToNext must be a positive km figure`);
    }
  });
  const names = new Set(p.corridorStops.map((s) => s.name.toLowerCase()));
  if (names.size !== p.corridorStops.length) bad('corridor stop names must be unique');
  if (p.weightSlabs.length === 0) bad('weightSlabs must not be empty');
  let prev = 0;
  for (const [i, slab] of p.weightSlabs.entries()) {
    nonNeg(slab.maxGrams, `weightSlabs[${i}].maxGrams`);
    nonNeg(slab.senderSurchargePaise, `weightSlabs[${i}].senderSurchargePaise`);
    nonNeg(slab.travellerBonusPaise, `weightSlabs[${i}].travellerBonusPaise`);
    if (slab.maxGrams <= prev) bad(`weightSlabs[${i}].maxGrams must ascend`);
    prev = slab.maxGrams;
  }
  if (p.maxDimsCm.length !== 3 || p.maxDimsCm.some((d) => !Number.isFinite(d) || d <= 0)) {
    bad('maxDimsCm must be three positive dimensions');
  }
}

export interface CorridorLeg {
  originStop: string;
  destStop: string;
  originIndex: number;
  destIndex: number;
  /** Sum of the corridor segments between the two stops, in km. */
  distanceKm: number;
  /** True when the travelled interval contains a hill segment. */
  hillIncluded: boolean;
  /** Stop names strictly between origin and destination, in travel order. */
  intermediateStops: string[];
}

/** Resolves a stop pair to the corridor leg. Both stops must be on the corridor; direction-agnostic. */
export function corridorLegOf(policy: PilotTariffPolicy, origin: string, dest: string): CorridorLeg | null {
  if (!origin || !dest || origin === dest) return null;
  const norm = (s: string) => s.trim().toLowerCase();
  const lower = policy.corridorStops.map((s) => norm(s.name));
  const a = lower.indexOf(norm(origin));
  const b = lower.indexOf(norm(dest));
  if (a === -1 || b === -1) return null;
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  let distanceKm = 0;
  let hillIncluded = false;
  for (let i = from; i < to; i++) {
    const stop = policy.corridorStops[i]!;
    distanceKm += stop.segmentKmToNext as number;
    hillIncluded = hillIncluded || Boolean(stop.hillSegmentToNext);
  }
  const ordered = a <= b;
  const intermediateStops = ordered
    ? policy.corridorStops.slice(from + 1, to).map((s) => s.name)
    : policy.corridorStops.slice(from + 1, to).map((s) => s.name).reverse();
  return {
    originStop: policy.corridorStops[a]!.name,
    destStop: policy.corridorStops[b]!.name,
    originIndex: a,
    destIndex: b,
    distanceKm: Math.round(distanceKm * 100) / 100,
    hillIncluded,
    intermediateStops,
  };
}

export function pilotSlabForGrams(policy: PilotTariffPolicy, grams: number): PilotWeightSlab | null {
  if (grams <= 0) return null;
  for (const slab of policy.weightSlabs) {
    if (grams <= slab.maxGrams) return slab;
  }
  return null;
}

/** Sides sorted descending compared pairwise against maxDimsCm sorted descending. */
export function pilotDimsWithinLimits(dimsCm: readonly number[] | undefined, policy: PilotTariffPolicy): boolean {
  if (!dimsCm || dimsCm.length === 0) return true;
  if (dimsCm.length !== 3) return false;
  if (dimsCm.some((d) => !Number.isFinite(d) || d <= 0)) return false;
  const sides = [...dimsCm].sort((x, y) => y - x);
  const max = [...policy.maxDimsCm].sort((x, y) => y - x);
  return sides.every((d, i) => d <= (max[i] as number));
}

export interface PilotPriceInput {
  /** Corridor stop names as they appear in the policy (case-insensitive). */
  originStop: string;
  destStop: string;
  actualWeightKg: number;
  dimsCm?: readonly number[];
  category: Category;
  policy?: PilotTariffPolicy;
}

export type PilotWarning = 'COMMISSION_FLOOR_APPLIED' | 'PARCEL_ABOVE_LIMIT' | 'PARCEL_TOO_LARGE_FOR_SLAB';

/**
 * Server-side quote for the pilot corridor. Returns the same shape as `quoteLaunchPrice` so the
 * snapshot columns, breakdown renderer and match cards need no changes.
 */
export function quotePilotParcel(input: PilotPriceInput): LaunchQuote {
  const p = input.policy ?? DEFAULT_PILOT_POLICY;
  assertPilotPolicy(p);

  const leg = corridorLegOf(p, input.originStop, input.destStop);
  if (!leg) {
    throw new Error(
      `Pilot tariff quotes only launch-corridor stop pairs: "${input.originStop}" → "${input.destStop}" is outside the corridor.`,
    );
  }

  const km = leg.distanceKm;
  const warnings: (LaunchWarning | PilotWarning)[] = [];

  const rawSenderDistance = Math.max(0, Math.round(km * p.senderRatePaisePerKm));
  const rawSender = p.senderBasePaise + rawSenderDistance;
  const minAdjusted = Math.max(0, p.senderMinFarePaise - rawSender);
  const senderDistanceCharge = rawSenderDistance + minAdjusted;

  const grams = Math.round(Math.max(0, input.actualWeightKg) * 1000);
  const slab = pilotSlabForGrams(p, grams);
  const weightSurcharge = slab?.senderSurchargePaise ?? 0;
  const weightBonus = slab?.travellerBonusPaise ?? 0;
  const hillSender = leg.hillIncluded ? p.hillSenderSurchargePaise : 0;
  const hillTraveller = leg.hillIncluded ? p.hillTravellerSurchargePaise : 0;

  const total = rawSender + minAdjusted + weightSurcharge + hillSender;

  const rawTravellerDistance = Math.max(0, Math.round(km * p.travellerRatePaisePerKm));
  const travellerBase = Math.max(p.travellerMinPayoutPaise, p.travellerBasePaise + rawTravellerDistance);
  const commissionFloor = Math.min(Math.max(0, p.minCommissionPaise), total);
  let traveller = travellerBase + weightBonus + hillTraveller;
  let commission = total - traveller;
  if (commission < commissionFloor) {
    traveller = total - commissionFloor;
    commission = commissionFloor;
    warnings.push('COMMISSION_FLOOR_APPLIED');
  }

  const weightOverCap = grams > Math.round(p.maxWeightKg * 1000);
  if (!slab && grams > 0) warnings.push('PARCEL_TOO_LARGE_FOR_SLAB');
  if (weightOverCap || !pilotDimsWithinLimits(input.dimsCm, p)) warnings.push('PARCEL_ABOVE_LIMIT');
  const withinLimits = !weightOverCap && Boolean(slab) && pilotDimsWithinLimits(input.dimsCm, p);

  const gatewayFee = Math.round(total * p.gatewayFeeRate);

  const slabLabel = slab ? slabRangeLabel(slab, p) : `${roundGrams(grams)} g`;
  const lines: LaunchQuoteLine[] = [
    { label: 'Base fare', amount_paise: p.senderBasePaise },
    {
      label: `Corridor distance (${formatKm(km)} km × ₹${(p.senderRatePaisePerKm / 100).toFixed(2)}/km)`,
      amount_paise: rawSenderDistance,
      note: corridorNote(leg, p),
    },
  ];
  if (minAdjusted > 0) {
    lines.push({
      label: 'Minimum fare adjustment',
      amount_paise: minAdjusted,
      note: `Fares start at ₹${(p.senderMinFarePaise / 100).toFixed(2)} on this corridor`,
    });
  }
  lines.push({
    label: `Weight surcharge (${slabLabel})`,
    amount_paise: weightSurcharge,
    note: `Traveller earns ₹${(weightBonus / 100).toFixed(2)} extra for this slab`,
  });
  if (leg.hillIncluded) {
    lines.push({
      label: 'Hill segment (Haldwani–Nainital)',
      amount_paise: hillSender,
      note: `Includes ₹${(hillTraveller / 100).toFixed(2)} extra for the traveller on the hill road`,
    });
  }

  const lineSum = lines.reduce((acc, l) => acc + l.amount_paise, 0);
  if (lineSum !== total) {
    throw new Error(`pilot quote breakdown mismatch: lines=${lineSum} total=${total}`);
  }

  const billable = Math.round(Math.max(0, input.actualWeightKg) * 100) / 100;

  return {
    formula_version: PILOT_FORMULA_VERSION,
    policy_version: p.version,
    actual_weight_kg: billable,
    volumetric_weight_kg: 0,
    billable_weight_kg: billable,
    road_distance_km: km,
    distance_source: 'routed',
    route_cost_paise: p.senderBasePaise + senderDistanceCharge,
    weight_cost_paise: weightSurcharge,
    handling_paise: 0,
    pickup_paise: 0,
    dropoff_paise: 0,
    surge_paise: 0,
    adjusted_paise: total,
    discount_paise: 0,
    traveller_subsidy_paise: 0,
    tax_paise: 0,
    total_paise: total,
    traveller_paise: traveller,
    commission_paise: commission,
    processing_fee_paise: gatewayFee,
    platform_net_paise: commission,
    loss_making: false,
    capped: false,
    within_limits: withinLimits,
    warnings: warnings as LaunchWarning[],
    breakdown: lines,
  };
}

/** Same engine, used for the indicative figure on traveller match cards. */
export function indicativePilotPricePaise(
  policy: PilotTariffPolicy,
  originStop: string,
  destStop: string,
  weightKg: number,
  category: Category,
): number | null {
  if (!corridorLegOf(policy, originStop, destStop)) return null;
  try {
    return quotePilotParcel({ originStop, destStop, actualWeightKg: weightKg, category, policy }).total_paise;
  } catch {
    return null;
  }
}

function slabRangeLabel(slab: PilotWeightSlab, policy: PilotTariffPolicy): string {
  const idx = policy.weightSlabs.indexOf(slab);
  const lower = idx === 0 ? 0 : (policy.weightSlabs[idx - 1]?.maxGrams ?? 0) + 1;
  const fmt = (g: number) => (g >= 1000 ? `${trimNumber(g / 1000)} kg` : `${g} g`);
  if (lower === 0) return `up to ${fmt(slab.maxGrams)}`;
  return `${fmt(lower)} – ${fmt(slab.maxGrams)}`;
}

function corridorNote(leg: CorridorLeg, policy: PilotTariffPolicy): string {
  const totalKm = policy.corridorStops
    .slice(0, -1)
    .reduce((acc, s) => acc + (s.segmentKmToNext ?? 0), 0);
  const via = leg.intermediateStops.length > 0
    ? ` via ${leg.intermediateStops.join(', ')}`
    : '';
  return `Fixed corridor distance: ${leg.originStop} → ${leg.destStop}${via} (${trimNumber(totalKm)} km end to end)`;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function roundGrams(g: number): string {
  return String(Math.trunc(g));
}

function formatKm(km: number): string {
  return km >= 10 ? String(Math.round(km)) : trimNumber(km);
}
