import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatPaise, groupIndian, parseRupeesToPaise, rupeesToPaise } from '../src/money.ts';
import { quotePrice, corridorKm, PRICING_V1, indicativePricePaise } from '../src/pricing.ts';
import { evaluateEligibility, detectProhibitedContent } from '../src/eligibility.ts';
import { applyTransition, allowedCommands } from '../src/booking-machine.ts';
import { computeRefund } from '../src/refunds.ts';
import { rankMatches } from '../src/matching.ts';

test('money: Indian grouping and paise formatting', () => {
  assert.equal(groupIndian(123456), '1,23,456');
  assert.equal(groupIndian(999), '999');
  assert.equal(groupIndian(10000000), '1,00,00,000');
  assert.equal(formatPaise(89900), '\u20B9899');
  assert.equal(formatPaise(89950), '\u20B9899.50');
  assert.equal(formatPaise(-2500), '-\u20B925');
  assert.equal(rupeesToPaise(899.5), 89950);
  assert.equal(parseRupeesToPaise('1,234.50'), 123450);
  assert.equal(parseRupeesToPaise('12.345'), null);
});

test('pricing: worked example matches the documented HYPOTHESIS to the paise', () => {
  const q = quotePrice({ corridorKm: 250, weightKg: 3, category: 'documents' });
  // The doc rounds to whole rupees: subtotal 646, platform 116, tax 137, total 899, traveller 621.
  // We keep paise precision, so 18% of 64600 is 11628, not 11600.
  assert.equal(q.subtotal_paise, 64_600);
  assert.equal(q.platform_fee_paise, 11_628);
  assert.equal(q.tax_paise, 13_721);
  assert.equal(q.total_paise, 89_949);
  assert.equal(q.traveller_paise, 62_100);
  assert.equal(Math.round(q.total_paise / 100), 899);
});

test('pricing: invariants hold across a wide input range', () => {
  for (const km of [0, 5, 40, 120, 250, 400, 900]) {
    for (const kg of [0.1, 0.5, 1, 2.5, 5]) {
      for (const category of ['documents', 'electronics_accessories_low_value', 'spare_parts_dry'] as const) {
        const q = quotePrice({ corridorKm: km, weightKg: kg, category });
        const lineSum = q.breakdown.reduce((a, l) => a + l.amount_paise, 0);
        assert.equal(lineSum, q.total_paise, `lines must sum to total (${km}km ${kg}kg ${category})`);
        assert.equal(q.total_paise, q.subtotal_paise + q.platform_fee_paise + q.tax_paise);
        assert.equal(q.traveller_paise, q.subtotal_paise - q.inputs.service_paise);
        assert.ok(Number.isInteger(q.total_paise));
        assert.ok(q.total_paise >= PRICING_V1.minTotalPaise, `floor ${km}/${kg}: ${q.total_paise}`);
        assert.ok(q.total_paise <= PRICING_V1.maxTotalPaise, `cap ${km}/${kg}: ${q.total_paise}`);
      }
    }
  }
});

test('pricing: surge appears as a named line and never silently', () => {
  const q = quotePrice({ corridorKm: 250, weightKg: 3, category: 'documents', surgeMultiplier: 1.2 });
  const surge = q.breakdown.find((l) => l.label.startsWith('Peak demand'));
  assert.ok(surge, 'surge line present');
  assert.ok(surge!.amount_paise > 0);
  assert.equal(q.breakdown.reduce((a, l) => a + l.amount_paise, 0), q.total_paise);
});

test('pricing: corridor distance uses a road factor', () => {
  const bareilly = { lat: 28.367, lng: 79.4304 };
  const delhi = { lat: 28.6139, lng: 77.209 };
  const km = corridorKm(bareilly, delhi);
  assert.ok(km > 230 && km < 290, `expected ~250 km, got ${km}`);
  assert.equal(indicativePricePaise(km, 3, 'documents'), quotePrice({ corridorKm: km, weightKg: 3, category: 'documents' }).total_paise);
});

test('eligibility: prohibited content is a hard block', () => {
  assert.equal(detectProhibitedContent('A4 envelope with property papers'), null);
  assert.match(String(detectProhibitedContent('gold chain in a box')), /jewellery|precious/);
  assert.match(String(detectProhibitedContent('laptop charger')), /electronics|batteries/);
});

const baseInput = {
  accountStatus: 'active' as const,
  phoneVerified: true,
  category: 'documents' as const,
  description: 'A4 envelope with property papers',
  weightKg: 1,
  dimsCm: [30, 20, 2],
  declaredValuePaise: 100_000,
  originCityId: 'c1',
  destCityId: 'c2',
  originServiceable: true,
  destServiceable: true,
  windowStart: new Date(Date.now() + 86_400_000),
  windowEnd: new Date(Date.now() + 2 * 86_400_000),
  hasUnresolvedFraudFlag: false,
  cancellationsLast30d: 0,
};

test('eligibility: happy path passes E1-E10', () => {
  const d = evaluateEligibility(baseInput);
  assert.equal(d.ok, true);
  assert.equal(d.reviewRequired, false);
  assert.deepEqual(d.passed.sort(), ['E1', 'E10', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9']);
});

test('eligibility: each hard rule fails with its documented code', () => {
  assert.equal(evaluateEligibility({ ...baseInput, accountStatus: 'suspended' }).code, 'ACCOUNT_SUSPENDED');
  assert.equal(evaluateEligibility({ ...baseInput, phoneVerified: false }).code, 'PHONE_NOT_VERIFIED');
  assert.equal(evaluateEligibility({ ...baseInput, description: 'cash in envelope' }).code, 'ITEM_PROHIBITED');
  assert.equal(evaluateEligibility({ ...baseInput, weightKg: 6 }).code, 'PARCEL_TOO_LARGE');
  assert.equal(evaluateEligibility({ ...baseInput, dimsCm: [50, 10, 10] }).code, 'PARCEL_TOO_LARGE');
  assert.equal(evaluateEligibility({ ...baseInput, declaredValuePaise: 600_000 }).code, 'VALUE_ABOVE_PILOT_LIMIT');
  assert.equal(evaluateEligibility({ ...baseInput, destServiceable: false }).code, 'CITY_NOT_SERVICED');
  assert.equal(
    evaluateEligibility({ ...baseInput, windowStart: new Date(Date.now() + 9 * 86_400_000), windowEnd: new Date(Date.now() + 10 * 86_400_000) }).code,
    'WINDOW_INVALID',
  );
  assert.equal(evaluateEligibility({ ...baseInput, hasUnresolvedFraudFlag: true }).code, 'RISK_REVIEW_REQUIRED');
  assert.equal(evaluateEligibility({ ...baseInput, cancellationsLast30d: 3 }).code, 'CANCELLATION_LIMIT');
});

test('eligibility: restricted category is a soft block, hard failure still wins', () => {
  const soft = evaluateEligibility({ ...baseInput, category: 'spare_parts_dry' });
  assert.equal(soft.ok, true);
  assert.equal(soft.reviewRequired, true);
  const hard = evaluateEligibility({ ...baseInput, category: 'spare_parts_dry', weightKg: 9 });
  assert.equal(hard.ok, false);
  assert.equal(hard.code, 'PARCEL_TOO_LARGE');
});

test('booking machine: legal path through to delivery', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const ctx = (extra = {}) => ({ now, actor: 'sender' as const, quoteValid: true, capacityHeld: true, ...extra });

  assert.deepEqual(applyTransition('draft', 'submit', ctx()), { ok: true, to: 'pending_traveller_acceptance' });
  assert.deepEqual(
    applyTransition('pending_traveller_acceptance', 'accept', { ...ctx(), actor: 'traveller', travellerVerified: true, acceptBy: new Date(now.getTime() + 60_000) }),
    { ok: true, to: 'payment_pending' },
  );
  assert.deepEqual(applyTransition('payment_pending', 'payment_authorised', { ...ctx(), actor: 'system' }), { ok: true, to: 'confirmed' });
  assert.deepEqual(applyTransition('confirmed', 'open_pickup', { ...ctx(), actor: 'system' }), { ok: true, to: 'pickup_ready' });
  assert.deepEqual(
    applyTransition('pickup_ready', 'confirm_pickup', { ...ctx(), actor: 'traveller', otpValid: true, photoPresent: true }),
    { ok: true, to: 'picked_up' },
  );
  assert.deepEqual(applyTransition('picked_up', 'start_transit', { ...ctx(), actor: 'traveller' }), { ok: true, to: 'in_transit' });
  assert.deepEqual(applyTransition('in_transit', 'arrive', { ...ctx(), actor: 'traveller' }), { ok: true, to: 'arrived' });
  assert.deepEqual(
    applyTransition('arrived', 'confirm_delivery', { ...ctx(), actor: 'traveller', otpValid: true, photoPresent: true }),
    { ok: true, to: 'delivered' },
  );
  assert.deepEqual(applyTransition('delivered', 'settle_window', { ...ctx(), actor: 'system' }), { ok: true, to: 'payout_eligible' });
  assert.deepEqual(applyTransition('payout_eligible', 'release', { ...ctx(), actor: 'system', openDispute: false }), { ok: true, to: 'paid_out' });
});

test('booking machine: wrong actor and unknown transitions are rejected', () => {
  const now = new Date();
  const r1 = applyTransition('draft', 'submit', { now, actor: 'traveller' });
  assert.equal(r1.ok, false);
  assert.equal(!r1.ok && r1.code, 'TRANSITION_NOT_PERMITTED');

  const r2 = applyTransition('draft', 'arrive', { now, actor: 'traveller' });
  assert.equal(r2.ok, false);
  assert.equal(!r2.ok && r2.code, 'INVALID_TRANSITION');

  const r3 = applyTransition('pickup_ready', 'confirm_pickup', { now, actor: 'traveller', otpValid: false, photoPresent: true });
  assert.equal(!r3.ok && r3.code, 'OTP_INVALID');
});

test('booking machine: allowed_commands is actor- and guard-aware', () => {
  const now = new Date();
  const senderCmds = allowedCommands('confirmed', { now, actor: 'sender', hoursUntilWindowStart: 0.5 });
  assert.ok(!senderCmds.includes('cancel'), 'inside 2h the sender cannot use the plain cancel command');
  const travellerCmds = allowedCommands('pickup_ready', { now, actor: 'traveller' });
  assert.deepEqual(travellerCmds, ['confirm_pickup']);
});

test('refunds: documented outcomes', () => {
  assert.equal(computeRefund({ actor: 'sender', accepted: false, pickedUp: false, hoursUntilWindowStart: 48, capturedPaise: 89_900 }).refundPaise, 89_900);
  assert.equal(
    computeRefund({ actor: 'sender', accepted: true, pickedUp: false, hoursUntilWindowStart: 48, capturedPaise: 89_900, paymentFeePaise: 1_800 }).refundPaise,
    88_100,
  );
  const late = computeRefund({ actor: 'sender', accepted: true, pickedUp: false, hoursUntilWindowStart: 1, capturedPaise: 89_900 });
  assert.equal(late.refundPaise, 44_950);
  assert.equal(late.travellerCompensationPaise, 44_950);
  assert.equal(computeRefund({ actor: 'sender', accepted: true, pickedUp: true, hoursUntilWindowStart: 1, capturedPaise: 89_900 }).allowed, false);
  assert.equal(computeRefund({ actor: 'traveller', accepted: true, pickedUp: false, hoursUntilWindowStart: 1, capturedPaise: 89_900 }).refundPaise, 89_900);
});

test('matching: ranks a good trip and explains why', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const trip = {
    id: 't1',
    travellerId: 'u2',
    mode: 'car' as const,
    originCityId: 'bareilly',
    destCityId: 'delhi',
    departureAt: new Date('2026-10-25T01:30:00Z'),
    arrivalEstimateAt: new Date('2026-10-25T07:00:00Z'),
    capacityKg: 10,
    capacityKgRemaining: 8,
    status: 'published',
    acceptsDocumentsOnly: true,
    travellerFirstName: 'Imran',
    travellerInitial: 'S',
    verificationState: 'verified' as const,
    reliabilityBand: 'reliable' as const,
    completedTrips: 12,
  };
  const res = rankMatches(
    {
      senderId: 'u1',
      originCityId: 'bareilly',
      destCityId: 'delhi',
      originServiceable: true,
      destServiceable: true,
      category: 'documents',
      weightKg: 3,
      windowStart: new Date('2026-10-25T00:00:00Z'),
      windowEnd: new Date('2026-10-25T12:00:00Z'),
      corridorKm: 250,
      enabledModes: ['car'],
      now,
    },
    [trip],
  );
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0]!.band, 'excellent');
  assert.ok(res.matches[0]!.reasons.includes('ON_ROUTE'));
  assert.ok(res.matches[0]!.reasons.includes('ARRIVES_IN_WINDOW'));
});

test('matching: capacity shortfall produces a reason, never a price', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const res = rankMatches(
    {
      senderId: 'u1',
      originCityId: 'bareilly',
      destCityId: 'delhi',
      originServiceable: true,
      destServiceable: true,
      category: 'documents',
      weightKg: 5,
      windowStart: new Date('2026-10-25T00:00:00Z'),
      windowEnd: new Date('2026-10-25T12:00:00Z'),
      corridorKm: 250,
      enabledModes: ['car'],
      now,
    },
    [
      {
        id: 't1', travellerId: 'u2', mode: 'car', originCityId: 'bareilly', destCityId: 'delhi',
        departureAt: new Date('2026-10-25T01:30:00Z'), arrivalEstimateAt: new Date('2026-10-25T07:00:00Z'),
        capacityKg: 3, capacityKgRemaining: 3, status: 'published', acceptsDocumentsOnly: true,
        travellerFirstName: 'A', travellerInitial: 'B', verificationState: 'verified',
        reliabilityBand: 'new', completedTrips: 0,
      },
    ],
  );
  assert.equal(res.matches.length, 0);
  assert.ok(res.no_match_reasons.includes('NO_CAPACITY'));
});
