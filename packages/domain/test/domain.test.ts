import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatPaise, groupIndian, parseRupeesToPaise, rupeesToPaise } from '../src/money.ts';
import { quotePrice, corridorKm, PRICING_V1, indicativePricePaise } from '../src/pricing.ts';
import { evaluateEligibility, detectProhibitedContent } from '../src/eligibility.ts';
import { applyTransition, allowedCommands, CLIENT_COMMANDS, HANDOVER_ONLY_COMMANDS } from '../src/booking-machine.ts';
import { computeRefund } from '../src/refunds.ts';
import {
  rankMatches,
  matchingPolicy,
  reliabilityBandOf,
  reliabilityRatioOf,
  type MatchInput,
  type RouteGeometry,
  type TripCandidate,
} from '../src/matching.ts';

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
  emailVerified: false,
  phoneVerificationRequired: true,
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
  // With phone verification switched off, a provider-vouched email carries rule E2 on its own.
  assert.equal(
    evaluateEligibility({ ...baseInput, phoneVerified: false, phoneVerificationRequired: false, emailVerified: true }).ok,
    true,
  );
  // Neither channel verified is still a hard failure — the flag relaxes SMS, not accountability.
  assert.equal(
    evaluateEligibility({ ...baseInput, phoneVerified: false, phoneVerificationRequired: false, emailVerified: false }).code,
    'CONTACT_NOT_VERIFIED',
  );
  // A required phone is not satisfied by a verified email.
  assert.equal(
    evaluateEligibility({ ...baseInput, phoneVerified: false, emailVerified: true }).code,
    'PHONE_NOT_VERIFIED',
  );
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

  // A handover is proved on the handover endpoints with a code and a photo, so it is never advertised
  // as a plain command the transitions route would accept.
  const travellerCmds = allowedCommands('pickup_ready', { now, actor: 'traveller' });
  assert.deepEqual(travellerCmds, []);
  for (const command of HANDOVER_ONLY_COMMANDS) {
    assert.ok(!CLIENT_COMMANDS.includes(command), `${command} must not be sendable as a plain command`);
    assert.ok(!allowedCommands('arrived', { now, actor: 'traveller' }).includes(command));
  }
});

test('booking machine: a second delivery attempt still needs proof', () => {
  const now = new Date();
  const bare = applyTransition('delivery_attempt_failed', 'confirm_delivery', { now, actor: 'traveller' });
  assert.equal(!bare.ok && bare.code, 'OTP_INVALID');

  const noPhoto = applyTransition('delivery_attempt_failed', 'confirm_delivery', { now, actor: 'traveller', otpValid: true });
  assert.equal(!noPhoto.ok && noPhoto.code, 'HANDOVER_NOT_ALLOWED_IN_STATE');

  // The walk that used to fake a delivery: declare the receiver absent, then confirm without anything.
  const failed = applyTransition('arrived', 'receiver_unavailable', { now, actor: 'traveller' });
  assert.deepEqual(failed, { ok: true, to: 'delivery_attempt_failed' });
  const stillNeedsProof = applyTransition('delivery_attempt_failed', 'confirm_delivery', { now, actor: 'traveller' });
  assert.equal(!stillNeedsProof.ok, true);

  assert.deepEqual(
    applyTransition('delivery_attempt_failed', 'confirm_delivery', { now, actor: 'traveller', otpValid: true, photoPresent: true }),
    { ok: true, to: 'delivered' },
  );
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

const MATCH_NOW = new Date('2026-10-24T10:00:00Z');

function matchInput(over: Partial<MatchInput> = {}): MatchInput {
  return {
    senderId: 'u1',
    originCityId: 'bareilly',
    destCityId: 'delhi',
    parcelOriginArea: 'Civil Lines',
    parcelDestArea: 'Karol Bagh',
    originServiceable: true,
    destServiceable: true,
    category: 'documents',
    description: 'A4 envelope with a signed property agreement',
    weightKg: 3,
    dimsCm: [30, 20, 2],
    windowStart: new Date('2026-10-25T00:00:00Z'),
    windowEnd: new Date('2026-10-25T12:00:00Z'),
    corridorKm: 250,
    enabledModes: ['car'],
    parcelStatus: 'posted',
    parcelAlreadyAssigned: false,
    now: MATCH_NOW,
    ...over,
  };
}

function trip(over: Partial<TripCandidate> = {}): TripCandidate {
  return {
    id: 't1',
    travellerId: 'u2',
    mode: 'car',
    originCityId: 'bareilly',
    destCityId: 'delhi',
    originArea: null,
    destArea: null,
    originDetourKm: 0,
    departureAt: new Date('2026-10-25T01:30:00Z'),
    arrivalEstimateAt: new Date('2026-10-25T07:00:00Z'),
    capacityKg: 10,
    capacityKgRemaining: 8,
    status: 'published',
    acceptsDocumentsOnly: true,
    travellerFirstName: 'Imran',
    travellerInitial: 'S',
    verificationState: 'verified',
    completedTrips: 12,
    travellerCancellations: 0,
    ...over,
  };
}

const rejectionOf = (res: ReturnType<typeof rankMatches>, tripId = 't1') =>
  res.rejections.find((r) => r.trip_id === tripId)?.code;

/**
 * Bareilly → Moradabad → Ghaziabad → Delhi, in travel order. Real road geometry from OSRM has hundreds
 * of points; these four are enough to prove the projection and ordering logic.
 */
function bareillyDelhiRoute(): RouteGeometry {
  return {
    points: [
      [28.367, 79.43],
      [28.838, 78.773],
      [28.669, 77.453],
      [28.613, 77.209],
    ],
    distanceM: 270_000,
    durationS: 5 * 3_600,
    source: 'routed',
  };
}

test('matching: an eligible trip is ranked, explained, and its points add up to its score', () => {
  const res = rankMatches(matchInput(), [trip()]);
  assert.equal(res.matches.length, 1);
  const m = res.matches[0]!;
  // time 30 + departure 20 + detour 20 + reliability 15 + capacity 10 + preference 5×0.8 = 99.
  assert.equal(m.score, 99);
  assert.equal(m.band, 'excellent');
  assert.equal(m.reliability_band, 'highly_reliable');
  assert.equal(m.reliability_ratio, 1);
  assert.equal(m.pickup_distance_band_km, '<1');
  assert.ok(m.reasons.includes('ON_ROUTE'));
  assert.ok(m.reasons.includes('ARRIVES_IN_WINDOW'));
  assert.ok(m.reasons.includes('HIGH_RELIABILITY'));
  assert.ok(m.reasons.includes('VERIFIED_ID'));
  assert.ok(!m.reasons.includes('SMALL_DETOUR'), 'the traveller never named a pickup area');
  const b = m.score_breakdown;
  assert.equal(b.formula_version, 'match-p2.0');
  assert.equal(Math.round(Object.values(b.points).reduce((a, x) => a + x, 0)), m.score);
  assert.ok(Object.values(b.fit).every((f) => f >= 0 && f <= 1));
});

test('matching: a failed hard constraint is never outscored', () => {
  // Perfect on every weighted factor, 0.1 kg short of the packaging allowance.
  const res = rankMatches(matchInput({ weightKg: 3 }), [trip({ capacityKgRemaining: 3.2 })]);
  assert.equal(res.matches.length, 0);
  assert.equal(rejectionOf(res), 'NO_CAPACITY');
  assert.ok(res.no_match_reasons.includes('NO_CAPACITY'));
  assert.equal(res.low_confidence, false);
});

test('matching: route, timing, trust and handling constraints each reject on their own', () => {
  const cases: Array<[{ category?: MatchInput['category'] } & Partial<TripCandidate>, string]> = [
    [{ destCityId: 'lucknow' }, 'ROUTE_NOT_EVALUABLE'],
    [{ originCityId: 'meerut', originDetourKm: 40 }, 'ROUTE_NOT_EVALUABLE'],
    [{ originCityId: 'meerut', originDetourKm: Number.NaN }, 'ROUTE_NOT_EVALUABLE'],
    [{ mode: 'bike' }, 'MODE_DISABLED'],
    [{ status: 'full' }, 'TRIP_NOT_ACTIVE'],
    [{ departureAt: new Date('2026-10-24T09:00:00Z') }, 'TRIP_DEPARTED'],
    [{ travellerId: 'u1' }, 'SELF_TRIP'],
    [{ verificationState: 'pending' }, 'TRAVELLER_NOT_VERIFIED'],
    [{ completedTrips: 6, travellerCancellations: 8 }, 'TRAVELLER_RELIABILITY_REVIEW'],
    [{ category: 'spare_parts_dry' }, 'CATEGORY_NOT_ACCEPTED'],
    [{ departureAt: new Date('2026-10-25T13:00:00Z') }, 'DEPARTS_AFTER_WINDOW'],
    [{ arrivalEstimateAt: new Date('2026-10-25T14:30:00Z') }, 'ARRIVES_TOO_LATE'],
  ];
  for (const [over, expected] of cases) {
    const { category, ...tripOver } = over as { category?: MatchInput['category'] } & Partial<TripCandidate>;
    const res = rankMatches(matchInput(category ? { category } : {}), [trip(tripOver)]);
    assert.equal(res.matches.length, 0, `${expected} must exclude the candidate`);
    assert.equal(rejectionOf(res), expected);
  }
});

test('matching: a parcel whose delivery is mid-route is allowed, and geometry is required to say so', () => {
  // The parcel ends in Ghaziabad; the trip ends in Delhi. Under the old rule this was invisible.
  const exactOnly = trip({ id: 'no-route', travellerId: 'u2' });
  const corridorTrip = trip({ id: 'mid-route', travellerId: 'u3', route: bareillyDelhiRoute() });
  const res = rankMatches(
    matchInput({
      destCityId: 'ghaziabad',
      parcelDestArea: 'Raj Nagar',
      parcelOrigin: { lat: 28.367, lng: 79.43 },
      parcelDest: { lat: 28.669, lng: 77.453 },
      corridorKm: 210,
    }),
    [exactOnly, corridorTrip],
  );
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0]!.trip_id, 'mid-route');
  assert.equal(res.matches[0]!.route_source, 'routed');
  assert.equal(res.matches[0]!.detour_km, 0);
  assert.ok(res.matches[0]!.leg_km > 0);
  // Without geometry the same city pair is refused explicitly rather than guessed from a straight line.
  assert.equal(rejectionOf(res, 'no-route'), 'ROUTE_NOT_EVALUABLE');
});

test('matching: an unknown contact or closed parcel stops the search before any trip is read', () => {
  assert.deepEqual(rankMatches(matchInput({ parcelStatus: 'cancelled' }), [trip()]).no_match_reasons, ['PARCEL_NOT_OPEN']);
  assert.deepEqual(rankMatches(matchInput({ parcelAlreadyAssigned: true }), [trip()]).no_match_reasons, [
    'PARCEL_ALREADY_ASSIGNED',
  ]);
  assert.deepEqual(rankMatches(matchInput({ originServiceable: false }), [trip()]).no_match_reasons, ['ORIGIN_NOT_SERVED']);
  assert.equal(rankMatches(matchInput({ parcelStatus: 'cancelled' }), [trip()]).rejections.length, 0);
});

test('matching: the parcel itself can be the reason nothing matches', () => {
  const tooBig = rankMatches(matchInput({ dimsCm: [60, 10, 10] }), [trip()]);
  assert.equal(rejectionOf(tooBig), 'PARCEL_TOO_LARGE');
  assert.ok(tooBig.no_match_reasons.includes('PARCEL_TOO_LARGE'));

  const prohibited = rankMatches(matchInput({ description: 'envelope with 50000 cash inside' }), [trip()]);
  assert.equal(rejectionOf(prohibited), 'ITEM_PROHIBITED');
  // Reporting a route shortage here would describe the wrong problem to the sender.
  assert.deepEqual(prohibited.no_match_reasons, []);
});

test('matching: a thin record is not punished twice, a bad one is', () => {
  // 3 finished trips is below the §9 sample of 10, so the ratio gate does not fire yet.
  const thin = rankMatches(matchInput(), [trip({ completedTrips: 2, travellerCancellations: 1 })]);
  assert.equal(thin.matches.length, 1);
  assert.equal(thin.matches[0]!.reliability_band, 'building');
  assert.ok(!thin.matches[0]!.reasons.includes('HIGH_RELIABILITY'));
});

test('matching: low-confidence fallback shows at most three weak trips, honestly labelled', () => {
  const weak = (id: string, travellerId: string): TripCandidate =>
    trip({
      id,
      travellerId,
      capacityKgRemaining: 5.6,
      departureAt: new Date('2026-10-24T10:01:00Z'),
      arrivalEstimateAt: new Date('2026-11-01T13:54:00Z'),
      originDetourKm: 9.9,
      completedTrips: 0,
    });
  const res = rankMatches(
    matchInput({
      weightKg: 5,
      windowStart: new Date('2026-11-01T00:00:00Z'),
      windowEnd: new Date('2026-11-01T12:00:00Z'),
    }),
    [weak('a', 'u2'), weak('b', 'u3'), weak('c', 'u4'), weak('d', 'u5'), weak('e', 'u6')],
  );
  assert.equal(res.matches.length, 3);
  assert.equal(res.low_confidence, true);
  assert.deepEqual(
    res.matches.map((m) => m.trip_id),
    ['a', 'b', 'c'],
  );
  assert.ok(res.matches.every((m) => m.score < 50));
});

test('matching: ordering is deterministic, ties broken by arrival then departure then id', () => {
  const a = trip({ id: 'bbb', travellerId: 'u2', arrivalEstimateAt: new Date('2026-10-25T08:00:00Z') });
  const b = trip({ id: 'aaa', travellerId: 'u3', arrivalEstimateAt: new Date('2026-10-25T08:00:00Z') });
  const c = trip({ id: 'ccc', travellerId: 'u4', arrivalEstimateAt: new Date('2026-10-25T06:00:00Z') });
  const first = rankMatches(matchInput(), [a, b, c]);
  const second = rankMatches(matchInput(), [c, b, a]);
  assert.deepEqual(
    first.matches.map((m) => m.trip_id),
    ['ccc', 'aaa', 'bbb'],
  );
  assert.deepEqual(
    second.matches.map((m) => m.trip_id),
    first.matches.map((m) => m.trip_id),
  );
});

test('matching: weights are configurable and validated', () => {
  // Reliability-only weighting puts the experienced traveller first despite a later arrival.
  // The floor is lowered so the weaker trip is visible as an ordering proof rather than hidden.
  const policy = matchingPolicy({
    minScoreToShow: 0,
    weights: { time: 0, departure: 0, detour: 0, alignment: 0, reliability: 100, capacity: 0, preference: 0 },
  });
  const green = trip({ id: 'green', travellerId: 'u2', completedTrips: 0, arrivalEstimateAt: new Date('2026-10-25T05:00:00Z') });
  const seasoned = trip({ id: 'seasoned', travellerId: 'u3', completedTrips: 30, travellerCancellations: 1 });
  const res = rankMatches(matchInput({ policy }), [green, seasoned]);
  assert.equal(res.matches[0]!.trip_id, 'seasoned');
  assert.equal(res.matches[0]!.score, 97);
  assert.equal(res.matches[1]!.score, 25);

  assert.throws(() => matchingPolicy({ weights: { time: -1 } }), /non-negative/);
  assert.throws(
    () => matchingPolicy({ weights: { time: 0, departure: 0, detour: 0, alignment: 0, reliability: 0, capacity: 0, preference: 0 } }),
    /at least one weight/,
  );
  assert.throws(() => matchingPolicy({ minScoreToShow: 140 }), /must be within/);
});

test('matching: grace hours and the detour limit are policy, not constants', () => {
  const tight = rankMatches(matchInput({ policy: matchingPolicy({ arrivalGraceHours: 0 }) }), [
    trip({ arrivalEstimateAt: new Date('2026-10-25T12:30:00Z') }),
  ]);
  assert.equal(rejectionOf(tight), 'ARRIVES_TOO_LATE');

  const route = bareillyDelhiRoute();
  // The pickup is ~4.4 km off the road; out and back costs ~8.8 km of detour.
  const offset = { lat: 28.367, lng: 79.475 };
  const parcel = {
    originCityId: 'bareilly',
    destCityId: 'ghaziabad',
    parcelOrigin: offset,
    parcelDest: { lat: 28.669, lng: 77.453 },
  };
  const strict = rankMatches(
    matchInput({ ...parcel, policy: matchingPolicy({ maxDetourKm: 6, maxCorridorKm: 10 }) }),
    [trip({ route })],
  );
  assert.equal(rejectionOf(strict), 'DETOUR_TOO_LARGE');

  const generous = rankMatches(
    matchInput({ ...parcel, policy: matchingPolicy({ maxDetourKm: 16, maxCorridorKm: 10 }) }),
    [trip({ route })],
  );
  assert.equal(generous.matches.length, 1);
  assert.ok(generous.matches[0]!.detour_km > 0);
});

test('matching: SMALL_DETOUR is only claimed when the pickup areas actually agree', () => {
  const sameArea = rankMatches(matchInput(), [trip({ originArea: 'civil lines', destArea: 'Karol Bagh' })]);
  assert.ok(sameArea.matches[0]!.reasons.includes('SMALL_DETOUR'));
  assert.equal(sameArea.matches[0]!.score_breakdown.fit.preference, 1);

  const otherArea = rankMatches(matchInput(), [trip({ originArea: 'Sadar Bazaar' })]);
  assert.ok(!otherArea.matches[0]!.reasons.includes('SMALL_DETOUR'));
  assert.equal(otherArea.matches[0]!.score_breakdown.fit.preference, 0.65);
});

test('matching: reliability band and ratio follow the §9 definition', () => {
  assert.equal(reliabilityRatioOf(0, 0), null);
  assert.equal(reliabilityRatioOf(9, 1), 0.9);
  assert.equal(reliabilityBandOf(0, null), 'new');
  assert.equal(reliabilityBandOf(3, 1), 'building');
  assert.equal(reliabilityBandOf(6, 0.85), 'reliable');
  assert.equal(reliabilityBandOf(12, 0.95), 'highly_reliable');
});

test('matching: a rejected candidate never appears in the shown set and scores stay in range', () => {
  const res = rankMatches(matchInput({ weightKg: 5 }), [
    trip({ id: 'ok', travellerId: 'u2', capacityKgRemaining: 20 }),
    trip({ id: 'bad', travellerId: 'u3', capacityKgRemaining: 1 }),
  ]);
  assert.deepEqual(
    res.matches.map((m) => m.trip_id),
    ['ok'],
  );
  for (const m of res.matches) {
    assert.ok(Number.isInteger(m.score) && m.score >= 0 && m.score <= 100);
    assert.equal(m.indicative_price_paise > 0, true);
  }
});
