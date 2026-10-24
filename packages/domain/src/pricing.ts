/**
 * Pricing. Every figure here is a HYPOTHESIS from docs/PRICING_AND_UNIT_ECONOMICS.md §2 — not
 * measured, not validated, not to be presented as a market rate.
 *
 * Invariants enforced by construction:
 *   subtotal  = base + distance + weight + handling   (service is carved out of it)
 *   total     = subtotal + platform_fee + tax
 *   share     = subtotal - service
 *   every amount is an integer number of paise
 */

import type { Category } from './enums.ts';
import { clampInt } from './money.ts';

export const FORMULA_VERSION = 'v1.0';

export const PRICING_V1 = {
  baseFarePaise: 6_000,
  perKmPaise: 220,
  perKgAboveOnePaise: 1_800,
  serviceComponentPaise: 2_500,
  commissionRate: 0.18,
  minPlatformFeePaise: 3_900,
  maxPlatformFeePaise: 19_900,
  gstRate: 0.18,
  minTotalPaise: 9_900,
  maxTotalPaise: 250_000,
  minTravellerSharePaise: 8_000,
  /**
   * The pack states "max traveller share = 80% of subtotal". That cannot hold together with
   * `share = subtotal - service_component` (which yields ~96% of subtotal) and the worked
   * example (621/899 = 69%). We apply the cap against `total`, which is the reading that
   * reconciles both. Recorded as DEFECT-001 in docs/BUILD_NOTES.md.
   */
  maxTravellerShareOfTotal: 0.8,
  maxSurgeMultiplier: 1.5,
} as const;

export const HANDLING_MULTIPLIER: Record<Category, number> = {
  documents: 1.0,
  educational_certificates: 1.0,
  business_samples: 1.1,
  spare_parts_dry: 1.2,
  cosmetics_sealed: 1.1,
  printed_material: 1.05,
  religious_items: 1.1,
  keys: 1.0,
  electronics_accessories_low_value: 1.3,
};

export interface PriceInput {
  corridorKm: number;
  weightKg: number;
  category: Category;
  /** Named, documented multiplier ≤ 1.5. Never applied silently. */
  surgeMultiplier?: number;
}

export interface QuoteLine {
  label: string;
  amount_paise: number;
  note?: string;
}

export interface QuoteBreakdown {
  formula_version: string;
  subtotal_paise: number;
  platform_fee_paise: number;
  tax_paise: number;
  total_paise: number;
  traveller_paise: number;
  breakdown: QuoteLine[];
  inputs: {
    corridor_km: number;
    weight_kg: number;
    category: Category;
    surge_multiplier: number;
    base_fare_paise: number;
    distance_paise: number;
    weight_paise: number;
    handling_paise: number;
    service_paise: number;
  };
  capped: boolean;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Road distance is longer than great-circle distance. 1.25 is a HYPOTHESIS, not a measured
 * detour factor, and should be replaced with a routing provider before any real launch.
 */
export const ROAD_FACTOR = 1.25;

export function corridorKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.round(haversineKm(a, b) * ROAD_FACTOR);
}

interface Components {
  base: number;
  distance: number;
  weight: number;
  handling: number;
  service: number;
  surge: number;
}

function build(c: Components, category: Category, surgeMultiplier: number) {
  // `service` is carved out of the subtotal, not added to it: the traveller receives
  // subtotal - service. This reproduces the worked example in the pricing doc exactly.
  const subtotal = c.base + c.distance + c.weight + c.handling + c.surge;
  const platformFee = clampInt(
    Math.round(subtotal * PRICING_V1.commissionRate),
    PRICING_V1.minPlatformFeePaise,
    PRICING_V1.maxPlatformFeePaise,
  );
  const tax = Math.round((subtotal + platformFee) * PRICING_V1.gstRate);
  const total = subtotal + platformFee + tax;
  const traveller = Math.max(0, subtotal - c.service);
  return { subtotal, platformFee, tax, total, traveller, components: c, category, surgeMultiplier };
}

export function quotePrice(input: PriceInput): QuoteBreakdown {
  const km = Math.max(0, input.corridorKm);
  const kg = Math.max(0.1, input.weightKg);
  const surgeMultiplier = Math.min(
    PRICING_V1.maxSurgeMultiplier,
    Math.max(1, input.surgeMultiplier ?? 1),
  );
  const multiplier = HANDLING_MULTIPLIER[input.category] ?? 1;

  const base = PRICING_V1.baseFarePaise;
  let distance = Math.round(PRICING_V1.perKmPaise * km);
  const weight = Math.round(PRICING_V1.perKgAboveOnePaise * Math.max(0, kg - 1));
  const handling = Math.round((base + distance + weight) * (multiplier - 1));
  const service = PRICING_V1.serviceComponentPaise;
  const surge = Math.round((base + distance + weight) * (surgeMultiplier - 1));

  let c: Components = { base, distance, weight, handling, service, surge };
  let q = build(c, input.category, surgeMultiplier);

  // Raise the floor: the traveller's minimum share is ₹80, which is a floor on subtotal.
  const minSubtotal = PRICING_V1.minTravellerSharePaise + PRICING_V1.serviceComponentPaise;
  if (q.subtotal < minSubtotal) {
    c = { ...c, distance: c.distance + (minSubtotal - q.subtotal) };
    q = build(c, input.category, surgeMultiplier);
  }

  // Cap the ceiling by shrinking the distance component. Converges in one or two passes.
  let capped = false;
  for (let i = 0; i < 6 && q.total > PRICING_V1.maxTotalPaise; i++) {
    const excess = q.total - PRICING_V1.maxTotalPaise;
    const nextDistance = Math.max(0, c.distance - excess);
    if (nextDistance === c.distance) break;
    c = { ...c, distance: nextDistance };
    q = build(c, input.category, surgeMultiplier);
    capped = true;
  }

  // Cap the traveller's share against total (see PRICING_V1.maxTravellerShareOfTotal).
  const maxShare = Math.floor(q.total * PRICING_V1.maxTravellerShareOfTotal);
  if (q.traveller > maxShare) {
    const reduction = q.traveller - maxShare;
    c = { ...c, distance: Math.max(0, c.distance - reduction) };
    q = build(c, input.category, surgeMultiplier);
    capped = true;
  }

  const baseShare = q.traveller - c.surge;
  const lines: QuoteLine[] = [
    {
      label: "Traveller's share",
      amount_paise: baseShare,
      note: 'Paid to the traveller after delivery',
    },
    ...(surgeMultiplier > 1
      ? [
          {
            label: `Peak demand \u00D7${surgeMultiplier.toFixed(1)}`,
            amount_paise: c.surge,
            note: 'Shown separately. Never applied silently.',
          },
        ]
      : []),
    { label: 'Service fee', amount_paise: c.service, note: 'Pickup coordination and support' },
    {
      label: `Platform fee (${Math.round(PRICING_V1.commissionRate * 100)}%)`,
      amount_paise: q.platformFee,
    },
    {
      label: `GST (${Math.round(PRICING_V1.gstRate * 100)}%)`,
      amount_paise: q.tax,
      note: 'Tax treatment is subject to professional advice',
    },
  ];

  const sum = lines.reduce((acc, l) => acc + l.amount_paise, 0);
  if (sum !== q.total) {
    // Defensive: never return a breakdown that does not add up.
    throw new Error(`quote breakdown mismatch: lines=${sum} total=${q.total}`);
  }

  return {
    formula_version: FORMULA_VERSION,
    subtotal_paise: q.subtotal,
    platform_fee_paise: q.platformFee,
    tax_paise: q.tax,
    total_paise: q.total,
    traveller_paise: q.traveller,
    breakdown: lines,
    inputs: {
      corridor_km: km,
      weight_kg: kg,
      category: input.category,
      surge_multiplier: surgeMultiplier,
      base_fare_paise: c.base,
      distance_paise: c.distance,
      weight_paise: c.weight,
      handling_paise: c.handling,
      service_paise: c.service,
    },
    capped,
  };
}

/** Indicative price shown on a match card. Same formula, no surge. */
export function indicativePricePaise(corridorKmValue: number, weightKg: number, category: Category): number {
  return quotePrice({ corridorKm: corridorKmValue, weightKg, category }).total_paise;
}
