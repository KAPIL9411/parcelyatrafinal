import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  billableWeightKg,
  DEFAULT_LAUNCH_POLICY,
  indicativeLaunchPricePaise,
  quoteLaunchPrice,
} from '../src/launch-pricing.ts';

const base = {
  roadDistanceKm: 260,
  distanceSource: 'routed' as const,
  actualWeightKg: 1.5,
  dimsCm: [30, 22, 2],
  category: 'documents' as const,
};

function assertReconciles(q: ReturnType<typeof quoteLaunchPrice>): void {
  assert.equal(
    q.total_paise,
    q.traveller_paise + q.commission_paise - q.traveller_subsidy_paise + q.tax_paise - q.discount_paise,
    'sender total must equal traveller + commission - subsidy + tax - discount',
  );
  assert.equal(
    q.platform_net_paise,
    q.commission_paise - q.traveller_subsidy_paise - q.discount_paise,
    'platform net must reconcile',
  );
  const lineSum = q.breakdown.reduce((acc, line) => acc + line.amount_paise, 0);
  assert.equal(lineSum, q.total_paise, 'breakdown lines must add to the total');
}

test('launch pricing: a 260 km 1.5 kg hub-to-hub parcel is a low-cost quote to the paise', () => {
  const q = quoteLaunchPrice(base);
  // 1200 base + 260×18 distance + 1.5×400 weight = 6480 gross; GST 18% = 1166; total ₹76.46.
  assert.equal(q.billable_weight_kg, 1.5);
  assert.equal(q.route_cost_paise, 1_200 + 4_680);
  assert.equal(q.weight_cost_paise, 600);
  assert.equal(q.adjusted_paise, 6_480);
  assert.equal(q.tax_paise, 1_166);
  assert.equal(q.total_paise, 7_646);
  assert.equal(q.commission_paise, 389);
  assert.equal(q.traveller_paise, 6_091);
  assert.equal(q.traveller_subsidy_paise, 0);
  assert.equal(q.platform_net_paise, 389);
  assert.equal(q.loss_making, false);
  assert.equal(q.distance_source, 'routed');
  assert.deepEqual(q.warnings, []);
  assertReconciles(q);
});

test('launch pricing: volumetric weight wins when the box is oversized', () => {
  const { billable, volumetric } = billableWeightKg(1, [40, 40, 30], 5_000);
  assert.equal(volumetric, 9.6);
  assert.equal(billable, 9.6);
  const q = quoteLaunchPrice({ ...base, actualWeightKg: 1, dimsCm: [40, 40, 30] });
  assert.equal(q.billable_weight_kg, 9.6);
  // Physical limits are what the pilot enforces; volumetric weight is a billing convention.
  assert.equal(q.within_limits, true);
  assert.equal(q.weight_cost_paise, 3_840);
  assertReconciles(q);
});

test('launch pricing: a parcel above the pilot limits is flagged, not silently priced', () => {
  const q = quoteLaunchPrice({ ...base, actualWeightKg: 6 });
  assert.equal(q.within_limits, false);
  assert.ok(q.warnings.includes('PARCEL_ABOVE_LIMIT'));
  assertReconciles(q);
});

test('launch pricing: the minimum fare lifts a short hop above the floor', () => {
  const q = quoteLaunchPrice({ ...base, roadDistanceKm: 1 });
  assert.ok(q.total_paise >= DEFAULT_LAUNCH_POLICY.minTotalPaise);
  assert.ok(q.breakdown.some((l) => l.label === 'Minimum fare adjustment'));
  assertReconciles(q);
});

test('launch pricing: a traveller subsidy is explicit and flags a platform loss', () => {
  const q = quoteLaunchPrice({ ...base, roadDistanceKm: 1, actualWeightKg: 0.5 });
  assert.ok(q.traveller_subsidy_paise > 0);
  assert.ok(q.warnings.includes('TRAVELLER_SUBSIDY_APPLIED'));
  assert.ok(q.warnings.includes('PLATFORM_LOSS_AT_QUOTE'));
  assert.equal(q.traveller_paise, DEFAULT_LAUNCH_POLICY.minTravellerPayoutPaise);
  assert.equal(q.loss_making, true);
  assertReconciles(q);
});

test('launch pricing: a launch discount reduces the sender total but never the traveller payout', () => {
  const full = quoteLaunchPrice(base);
  const discounted = quoteLaunchPrice({ ...base, discountRate: 0.2 });
  assert.ok(discounted.discount_paise > 0);
  assert.ok(discounted.total_paise < full.total_paise);
  assert.equal(discounted.traveller_paise, full.traveller_paise);
  assertReconciles(discounted);
});

test('launch pricing: an estimated distance is labelled, never passed off as routed', () => {
  const q = quoteLaunchPrice({ ...base, distanceSource: 'estimated' });
  assert.equal(q.distance_source, 'estimated');
  assert.ok(q.warnings.includes('DISTANCE_ESTIMATED'));
  assert.ok(q.breakdown.some((l) => /Estimated road distance/.test(l.note ?? '')));
});

test('launch pricing: indicative match-card price uses the same engine', () => {
  const q = quoteLaunchPrice({ ...base, category: 'documents' });
  assert.equal(indicativeLaunchPricePaise(260, 1.5, 'documents'), q.total_paise);
});

test('launch pricing: an invalid policy is rejected instead of mispricing', () => {
  assert.throws(
    () => quoteLaunchPrice({ ...base, policy: { ...DEFAULT_LAUNCH_POLICY, maxTotalPaise: 100 } }),
    /Invalid launch pricing policy/,
  );
  assert.throws(
    () => quoteLaunchPrice({ ...base, policy: { ...DEFAULT_LAUNCH_POLICY, commissionRate: 2 } }),
    /Invalid launch pricing policy/,
  );
});
