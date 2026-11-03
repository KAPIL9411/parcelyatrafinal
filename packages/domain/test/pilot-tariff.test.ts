import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  corridorLegOf,
  DEFAULT_PILOT_POLICY,
  indicativePilotPricePaise,
  parsePilotTariffPolicy,
  pilotDimsWithinLimits,
  pilotSlabForGrams,
  quotePilotParcel,
} from '../src/pilot-tariff.ts';

const STOPS = ['Bareilly', 'Baheri', 'Kichha', 'Rudrapur', 'Haldwani', 'Nainital'];
/** Segment distances from the finalized plan: 50, 18, 19, 40, 45 — 172 km end to end. */
const EXPECTED_KM: Record<string, number> = {};
const CUM = [0, 50, 68, 87, 127, 172];
for (let i = 0; i < 6; i++) {
  for (let j = 0; j < 6; j++) {
    if (i !== j) EXPECTED_KM[`${STOPS[i]}->${STOPS[j]}`] = Math.abs(CUM[j]! - CUM[i]!);
  }
}

function assertReconciles(q: ReturnType<typeof quotePilotParcel>): void {
  assert.equal(q.total_paise, q.traveller_paise + q.commission_paise, 'fare = payout + commission');
  assert.ok(q.commission_paise >= 0, 'platform commission must never be negative');
  assert.equal(q.tax_paise, 0, 'pilot tariff is the all-in figure; GST is not self-assessed');
  const lineSum = q.breakdown.reduce((acc, line) => acc + line.amount_paise, 0);
  assert.equal(lineSum, q.total_paise, 'breakdown lines must add to the total');
}

const hasWarning = (q: ReturnType<typeof quotePilotParcel>, w: string): boolean =>
  (q.warnings as readonly string[]).includes(w);

test('pilot tariff: all 30 corridor pickup/drop combinations quote, both directions, with the fixed segment km', () => {
  for (const from of STOPS) {
    for (const to of STOPS) {
      if (from === to) continue;
      const q = quotePilotParcel({
        originStop: from,
        destStop: to,
        actualWeightKg: 0.4,
        category: 'documents',
      });
      assert.equal(q.road_distance_km, EXPECTED_KM[`${from}->${to}`], `km for ${from} → ${to}`);
      assert.equal(q.total_paise, q.traveller_paise + q.commission_paise);
      assert.ok(q.within_limits, `0.4 kg must be within limits on ${from} → ${to}`);
      assert.equal(q.distance_source, 'routed');
      assertReconciles(q);

      // Direction symmetry for the fare maths (same leg either way).
      const back = quotePilotParcel({ originStop: to, destStop: from, actualWeightKg: 0.4, category: 'documents' });
      assert.equal(back.total_paise, q.total_paise, `fare symmetric for ${from} ↔ ${to}`);
    }
  }
});

test('pilot tariff: Bareilly → Nainital full corridor, 2.5 kg, matches the plan to the paise', () => {
  // sender: max(₹39, ₹19 + 0.35×172=₹60.20) = ₹79.20 + ₹35 slab + ₹15 hill = ₹129.20
  // traveller: max(₹25, ₹18 + 0.20×172=₹34.40) = ₹52.40 + ₹22 bonus + ₹10 hill = ₹84.40
  // commission: ₹44.80
  const q = quotePilotParcel({
    originStop: 'Bareilly',
    destStop: 'Nainital',
    actualWeightKg: 2.5,
    dimsCm: [28, 22, 18],
    category: 'documents',
  });
  assert.equal(q.road_distance_km, 172);
  assert.equal(q.total_paise, 12_920);
  assert.equal(q.traveller_paise, 8_440);
  assert.equal(q.commission_paise, 4_480);
  assert.equal(q.weight_cost_paise, 3_500);
  assert.deepEqual(
    q.breakdown.map((l) => l.label),
    ['Base fare', 'Corridor distance (172 km × ₹0.35/km)', 'Weight surcharge (2 kg – 3 kg)', 'Hill segment (Haldwani–Nainital)'],
  );
  assertReconciles(q);
});

test('pilot tariff: the ₹39 floor lifts short legs and is itemised', () => {
  // Kichha → Rudrapur, 19 km: raw = 1900 + 665 = ₹25.65 < ₹39 → floor +₹13.35.
  const q = quotePilotParcel({ originStop: 'Kichha', destStop: 'Rudrapur', actualWeightKg: 0.3, category: 'documents' });
  assert.equal(q.total_paise, 3_900);
  const minLine = q.breakdown.find((l) => l.label === 'Minimum fare adjustment');
  assert.ok(minLine && minLine.amount_paise === 1_335);
  // Traveller floor ₹25 applies over the raw ₹21.80.
  assert.equal(q.traveller_paise, 2_500);
  assert.equal(q.commission_paise, 1_400);
  assertReconciles(q);
});

test('pilot tariff: the hill surcharge applies only when the Haldwani–Nainital segment is travelled', () => {
  const withHill = quotePilotParcel({ originStop: 'Haldwani', destStop: 'Nainital', actualWeightKg: 0.4, category: 'documents' });
  const hillLine = withHill.breakdown.find((l) => l.label.startsWith('Hill segment'));
  assert.ok(hillLine, 'Haldwani → Nainital must carry the hill line');
  assert.equal(hillLine.amount_paise, 1_500);
  // sender ₹39.00 floor + ₹15.00 hill; traveller max(₹25, ₹27.00) + ₹10.00 hill
  assert.equal(withHill.total_paise, 3_900 + 1_500);
  assert.equal(withHill.traveller_paise, 2_700 + 1_000);

  for (const dest of ['Baheri', 'Kichha', 'Rudrapur']) {
    const q = quotePilotParcel({ originStop: 'Haldwani', destStop: dest, actualWeightKg: 0.4, category: 'documents' });
    assert.equal(q.breakdown.some((l) => l.label.startsWith('Hill')), false, `no hill line on Haldwani → ${dest}`);
  }
  const nainitalToPlain = quotePilotParcel({ originStop: 'Nainital', destStop: 'Rudrapur', actualWeightKg: 0.4, category: 'documents' });
  assert.ok(nainitalToPlain.breakdown.some((l) => l.label.startsWith('Hill segment')), 'reverse direction keeps the hill line');
  assertReconciles(withHill);
  assertReconciles(nainitalToPlain);
});

test('pilot tariff: weight slab boundaries follow 0–500 g / 501 g–1 kg / 1–2 kg / 2–3 kg', () => {
  const grams = (g: number) =>
    quotePilotParcel({ originStop: 'Bareilly', destStop: 'Baheri', actualWeightKg: g / 1000, category: 'documents' });
  assert.equal(grams(500).weight_cost_paise, 0);
  assert.equal(grams(501).weight_cost_paise, 1_000);
  assert.equal(grams(1_000).weight_cost_paise, 1_000);
  assert.equal(grams(1_001).weight_cost_paise, 2_000);
  assert.equal(grams(2_000).weight_cost_paise, 2_000);
  assert.equal(grams(2_001).weight_cost_paise, 3_500);
  assert.equal(grams(3_000).weight_cost_paise, 3_500);
  assert.equal(grams(3_000).within_limits, true);
  assert.equal(grams(3_001).within_limits, false);
  assert.ok(grams(3_001).warnings.includes('PARCEL_ABOVE_LIMIT'));

  // Traveller bonus follows its own slab column: 50 km raw ₹28.00 beats the ₹25 floor, +₹22.00 bonus.
  const q = grams(2_500);
  assert.equal(q.traveller_paise, 2_800 + 2_200);
  const slab = pilotSlabForGrams(DEFAULT_PILOT_POLICY, 2_500);
  assert.equal(slab?.travellerBonusPaise, 2_200);
});

test('pilot tariff: provisional maximum dimensions are 30 × 25 × 20 cm regardless of side order', () => {
  assert.equal(pilotDimsWithinLimits([30, 25, 20], DEFAULT_PILOT_POLICY), true);
  assert.equal(pilotDimsWithinLimits([20, 30, 25], DEFAULT_PILOT_POLICY), true);
  assert.equal(pilotDimsWithinLimits([18, 22, 28], DEFAULT_PILOT_POLICY), true);
  assert.equal(pilotDimsWithinLimits([31, 20, 20], DEFAULT_PILOT_POLICY), false);
  assert.equal(pilotDimsWithinLimits([30, 26, 10], DEFAULT_PILOT_POLICY), false);
  assert.equal(pilotDimsWithinLimits([29, 24, 21], DEFAULT_PILOT_POLICY), false);
  assert.equal(pilotDimsWithinLimits(undefined, DEFAULT_PILOT_POLICY), true);
  const q = quotePilotParcel({ originStop: 'Bareilly', destStop: 'Baheri', actualWeightKg: 0.5, dimsCm: [26, 24, 22], category: 'documents' });
  assert.equal(q.within_limits, false);
});

test('pilot tariff: commission never goes negative, even with an absurd configured floor', () => {
  const policy = parsePilotTariffPolicy('test-floor', {
    model: 'pilot_slab',
    minCommissionPaise: 30_00, // ₹30 floor above the natural ₹14.00 on the shortest leg
  });
  const q = quotePilotParcel({
    originStop: 'Kichha',
    destStop: 'Rudrapur',
    actualWeightKg: 0.4,
    category: 'documents',
    policy,
  });
  assert.equal(q.commission_paise, 3_000);
  assert.equal(q.traveller_paise, q.total_paise - 3_000);
  assert.ok(hasWarning(q, 'COMMISSION_FLOOR_APPLIED'));
  assertReconciles(q);

  // Even a floor above the whole fare cannot push commission below zero or the payout below zero:
  // the floor clamps to the fare and the payout trims to the remainder.
  const brutal = parsePilotTariffPolicy('test-brutal', { model: 'pilot_slab', minCommissionPaise: 99_900 });
  const bq = quotePilotParcel({ originStop: 'Kichha', destStop: 'Rudrapur', actualWeightKg: 0.4, category: 'documents', policy: brutal });
  assert.equal(bq.commission_paise, bq.total_paise);
  assert.equal(bq.traveller_paise, 0);
  assert.ok(hasWarning(bq, 'COMMISSION_FLOOR_APPLIED'));
});

test('pilot tariff: corridorLegOf resolves both directions, intermediates and hill membership', () => {
  const leg = corridorLegOf(DEFAULT_PILOT_POLICY, 'Baheri', 'Haldwani');
  assert.ok(leg);
  assert.equal(leg.distanceKm, 77);
  assert.deepEqual(leg.intermediateStops, ['Kichha', 'Rudrapur']);
  assert.equal(leg.hillIncluded, false);
  const rev = corridorLegOf(DEFAULT_PILOT_POLICY, 'Haldwani', 'Baheri');
  assert.ok(rev);
  assert.equal(rev.distanceKm, 77);
  assert.deepEqual(rev.intermediateStops, ['Rudrapur', 'Kichha']);
  assert.equal(corridorLegOf(DEFAULT_PILOT_POLICY, 'Baheri', 'Nainital')?.hillIncluded, true);
  assert.equal(corridorLegOf(DEFAULT_PILOT_POLICY, 'Bareilly', 'Delhi'), null);
  assert.equal(corridorLegOf(DEFAULT_PILOT_POLICY, 'Bareilly', 'Bareilly'), null);
  assert.equal(corridorLegOf(DEFAULT_PILOT_POLICY, 'bareilly', 'NAINITAL')?.distanceKm, 172);
});

test('pilot tariff: quotes outside the corridor are refused, not silently estimated', () => {
  assert.throws(
    () => quotePilotParcel({ originStop: 'Bareilly', destStop: 'Delhi', actualWeightKg: 1, category: 'documents' }),
    /outside the corridor/,
  );
  assert.equal(indicativePilotPricePaise(DEFAULT_PILOT_POLICY, 'Bareilly', 'Delhi', 1, 'documents'), null);
});

test('pilot tariff: every parameter is policy-configurable', () => {
  const policy = parsePilotTariffPolicy('pilot-v2', {
    model: 'pilot_slab',
    senderBasePaise: 2_500,
    senderRatePaisePerKm: 50,
    travellerRatePaisePerKm: 30,
    weightSlabs: [
      { maxGrams: 500, senderSurchargePaise: 0, travellerBonusPaise: 0 },
      { maxGrams: 5_000, senderSurchargePaise: 6_000, travellerBonusPaise: 4_000 },
    ],
    hillSenderSurchargePaise: 2_000,
    hillTravellerSurchargePaise: 1_200,
    gatewayFeeRate: 0.02,
    maxWeightKg: 5,
    maxDimsCm: [40, 30, 25],
  });
  const q = quotePilotParcel({ originStop: 'Bareilly', destStop: 'Nainital', actualWeightKg: 4, category: 'documents', policy });
  // sender: 2500 + 172×50 = 11100 (≥ min 3900) + 6000 + 2000 = 19100; traveller: 1800 + 5160 = 6960 → +4000 +1200 = 12160
  assert.equal(q.total_paise, 19_100);
  assert.equal(q.traveller_paise, 12_160);
  assert.equal(q.commission_paise, 19_100 - 12_160);
  assert.equal(q.processing_fee_paise, 382); // 2% gateway charge on the captured fare
  assert.equal(q.within_limits, true);
  assertReconciles(q);

  assert.throws(() => parsePilotTariffPolicy('bad', { model: 'pilot_slab', senderBasePaise: -1 }), /non-negative/);
  assert.throws(
    () => parsePilotTariffPolicy('bad', { model: 'pilot_slab', weightSlabs: [{ maxGrams: 900, senderSurchargePaise: 0, travellerBonusPaise: 0 }, { maxGrams: 800, senderSurchargePaise: 0, travellerBonusPaise: 0 }] }),
    /must ascend/,
  );
  assert.throws(() => parsePilotTariffPolicy('bad', { model: 'pilot_slab', gatewayFeeRate: 1.5 }), /0–1/);
});

test('pilot tariff: the gateway fee is tracked separately and never added to the sender fare', () => {
  const policy = parsePilotTariffPolicy('gw', { model: 'pilot_slab', gatewayFeeRate: 0.019 });
  const q = quotePilotParcel({ originStop: 'Bareilly', destStop: 'Baheri', actualWeightKg: 0.9, category: 'documents', policy });
  assert.equal(q.total_paise, 3_900 + 1_000); // floor + 501 g–1 kg slab
  assert.equal(q.processing_fee_paise, Math.round(q.total_paise * 0.019));
  assert.equal(q.commission_paise, q.total_paise - q.traveller_paise);
  const lineSum = q.breakdown.reduce((a, l) => a + l.amount_paise, 0);
  assert.equal(lineSum, q.total_paise, 'gateway fee is not a breakdown line the sender pays');
});
