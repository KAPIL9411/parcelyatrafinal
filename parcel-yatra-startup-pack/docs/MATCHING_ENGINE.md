# Matching Engine

**Status:** Draft v0.1 · **Last updated:** 2026-10-24
**Implementation:** `packages/domain/matching.ts` · SQL in `database/INDEXING_AND_QUERY_PLAN.md` §4

---

## 1. Purpose

Given a posted parcel, return a ranked list of traveller trips that can plausibly carry it, with an
explanation, without leaking private itinerary data.

The engine is deliberately **rules-first**. No machine-learned ranking at pilot: a small team must be
able to explain every result to a user and to a regulator.

## 2. Inputs

**Parcel side:** origin city + area (geohash precision 6), destination city, weight, dimensions,
category, delivery window (start/end), declared value, handling flags.

**Trip side:** origin city + area, destination city, departure window, arrival window, mode, capacity
remaining, traveller verification, reliability score, preference flags, price expectations.

## 3. Filtering (hard constraints, boolean)

Applied in SQL before scoring, in this order (cheapest first):

1. `mode_enabled(mode)` — feature flag.
2. `trip.status IN ('PUBLISHED','PARTIALLY_BOOKED')`.
3. `trip.origin_city_id = parcel.origin_city_id`.
4. `trip.destination_city_id = parcel.destination_city_id`.
5. `trip.capacity_kg_remaining >= parcel.weight_kg * 1.1`.
6. `trip.departure_at <= parcel.window_end`.
7. `trip.arrival_at <= parcel.window_end + interval '2 hours'`.
8. `traveller.verification_status = 'VERIFIED'`.
9. `NOT blocked(sender, traveller)`.
10. `trip.traveller_id <> parcel.sender_id`.

Any candidate failing 1–10 is excluded. **No scoring can rescue an excluded trip.**

## 4. Scoring (0–100)

| Factor | Weight | Definition |
|---|---|---|
| Time fit | 30 | 100 if arrival ≤ window end − 2 h; linear decay to 0 at window end + grace |
| Departure fit | 20 | 100 if departure ≥ window start; decays if departure is much earlier |
| Detour | 20 | 100 at 0 km; −4 points per km of estimated detour (max 5 km at pilot) |
| Reliability | 15 | traveller reliability × 100 (see `docs/BUSINESS_LOGIC.md` §9) |
| Capacity fit | 10 | 100 if remaining ≥ 2× parcel weight, decaying to 0 at 1.1× |
| Preference | 5 | category preference match, receiver-side flexibility |

```
score = 0.30·time + 0.20·departure + 0.20·detour + 0.15·reliability + 0.10·capacity + 0.05·preference
```

Bands for UI: **Excellent ≥ 80**, **Good 65–79**, **Fair 50–64**, **Poor < 50 (not shown)**.

## 5. Explanation generation

Every returned trip carries machine-generated reasons drawn from a closed set:

| Code | User-facing text (English) |
|---|---|
| `ON_ROUTE` | "Travels from {origin} to {destination}" |
| `ARRIVES_IN_WINDOW` | "Arrives within your delivery window" |
| `SMALL_DETOUR` | "Small detour near your pickup area" |
| `HIGH_RELIABILITY` | "Completed {n} deliveries with a good record" |
| `CAPACITY_OK` | "Has room for your parcel" |
| `VERIFIED_ID` | "ID verified by Parcel Yatra" |
| `DELAYED_ARRIVAL` | "Arrives later than you asked; check before booking" |

Reasons must be true. Never generate "fast delivery" copy for a trip that is not fast.

## 6. Privacy constraints

- Results show **area**, not address. Distance shown as a band ("within 3 km"), not exact metres.
- Traveller name shown as first name + initial until booking is confirmed.
- Phone numbers are never returned by the matching endpoint.
- No endpoint returns a traveller's live location before `PICKED_UP`.
- Exact itinerary is visible to the matched counterparty only after `CONFIRMED`.

## 7. Geospatial approach

- Pilot: **city-to-city matching only**, plus optional area radius using PostGIS `ST_DWithin` on
  geohash-centroid points. No full route-polyline matching.
- Route overlap (`ST_LineLocatePoint` on a simplified polyline) is **P2**, and only if pilot data shows
  senders need intermediate-city pickups.
- Reason: polyline matching adds correctness and privacy risk for marginal pilot benefit.

## 8. Failure and fallback

| Condition | Response |
|---|---|
| No candidates | `200` with `matches: []` and `no_match_reasons: ["NO_TRIP_ON_DATE"]` |
| Candidates exist but all < 50 score | Return top 3 with `low_confidence: true` and honest copy |
| Sender widens window | Re-run query; new quote generated |
| Partial route (intermediate city) | Not supported at pilot → `NO_MATCH` with explanation |

## 9. Anti-gaming rules

- A traveller cannot create trips they do not intend to make; repeated `CANCELLED_BY_TRAVELLER` trips
  reduce ranking score to zero.
- A sender cannot post the same parcel repeatedly to probe traveller locations; identical
  origin/destination posts within 1 h are rate-limited and deduplicated.
- Both parties cannot repeatedly match and cancel each other (collusion signal); after 2 mutual
  cancellations, the pair is blocked.
- Ranking does not consider declared value (avoiding incentive to attract high-value parcels to
  uninsured travellers).

## 10. Evaluation metrics

| Metric | Definition | Pilot target |
|---|---|---|
| Match rate | bookings created / parcels posted | ≥ 60% |
| Top-1 acceptance | requests accepted where chosen trip was rank 1 | ≥ 70% |
| Time-to-match | median minutes from post to accept | < 90 min |
| False match rate | matches cancelled for "not actually on route" | < 5% |
| No-match rate by corridor | tracked daily | investigated if > 35% |

## 11. Future work (not now)

- Multi-leg journeys with custody transfer at a hub (**high complexity, high liability** — requires
  insurance and legal clarity first).
- Learned ranking once ≥ 1,000 labelled bookings exist.
- Route-aware pricing rather than city-pair pricing.
