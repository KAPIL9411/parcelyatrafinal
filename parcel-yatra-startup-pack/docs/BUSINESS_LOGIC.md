# Business Logic — Parcel Yatra

**Status:** Draft v0.1 · **Last updated:** 2026-10-24
This document is the **authoritative description of platform rules**. Code must not contain a business
rule that contradicts this file; if it must, update this file first (see `AGENTS.md`).

---

## 1. Core entities and ownership

| Entity | Owner | Can be mutated by |
|---|---|---|
| `user` | Self | Self (profile), Support (suspension) |
| `verification` | Traveller | Traveller (submit), Reviewer (decide) |
| `parcel` | Sender | Sender (before booking only) |
| `trip` | Traveller | Traveller (before any booking acceptance) |
| `booking` | Sender + Traveller jointly | **Server only**, via transition engine |
| `handover` | Booking | Server, via OTP verification |
| `payment` | Sender | Payment provider webhook (server) |
| `payout` | Traveller | Server, Finance admin (release/withhold) |
| `dispute` | Either party | Support (resolve) |

**Rule:** no client of any kind may `PATCH` a `booking.status` field. Status is derived only from
executing a transition command (`POST /bookings/{id}/transitions`).

## 2. Eligibility rules (evaluated in this order)

A parcel may be posted only if **all** pass:

| # | Rule | Failure outcome |
|---|---|---|
| E1 | Sender account is ACTIVE and not suspended | `ACCOUNT_SUSPENDED` |
| E2 | Sender phone verified | `PHONE_NOT_VERIFIED` |
| E3 | Category not in prohibited list | `ITEM_PROHIBITED` (hard block) |
| E4 | Declared weight ≤ 5 kg, longest side ≤ 45 cm | `PARCEL_TOO_LARGE` |
| E5 | Declared value ≤ ₹5,000 | `VALUE_ABOVE_PILOT_LIMIT` |
| E6 | Both cities are in enabled service areas | `CITY_NOT_SERVICED` |
| E7 | Delivery window is in the future and ≤ 7 days out | `WINDOW_INVALID` |
| E8 | Category not in restricted list | `MANUAL_REVIEW_REQUIRED` (soft block → queue) |
| E9 | Sender has no unresolved fraud flag | `RISK_REVIEW_REQUIRED` |
| E10 | Sender has < 3 cancellations in last 30 days | `CANCELLATION_LIMIT` |

Rules are server-side and mirrored in `packages/domain/eligibility.ts`. The mobile client may
pre-validate for UX, but the server decision is final.

## 3. Matching rules

A trip is a **candidate** if:

1. `trip.mode` is enabled by feature flag.
2. `trip.origin_city` = parcel origin city **or** within `max_origin_detour_km` (pilot: 10 km).
3. `trip.destination_city` = parcel destination city (pilot: exact city match only).
4. `trip.departure_window` starts before the parcel window closes, **and** `trip.arrival_window` ends
   before the parcel window closes + grace (pilot grace: 2 h).
5. `trip.capacity_kg_remaining` ≥ parcel weight × 1.1 (10% packaging allowance).
6. Traveller `verification_status = VERIFIED`.
7. Traveller is not the sender (no self-booking) and not blocked by either party.
8. Trip is not already `FULL`, `CANCELLED`, `EXPIRED` or `IN_PROGRESS` past pickup.

Ranking is defined in `docs/MATCHING_ENGINE.md`. **Matching never exposes exact addresses**; it works
on city + area + optional radius.

## 4. Pricing rules

Server-computed only. Formula and caps: `docs/PRICING_AND_UNIT_ECONOMICS.md`.
Key invariants:

- `total = subtotal + platform_fee + taxes` and `subtotal = travel_compensation + service_component`.
- Price is locked at quote time for 15 minutes, stored as an immutable `quote` row.
- If no eligible trip exists, the API returns `NO_MATCH` and **no price**. We never invent a price for
  an impossible booking.
- Price must be re-validated at booking creation; if the quote expired, return `QUOTE_EXPIRED` with a
  fresh quote, never silently charge a different amount.

## 5. Booking creation rules

1. Client sends `Idempotency-Key`; server stores it for 24 h.
2. Server re-checks eligibility, quote validity, capacity and traveller status **inside one DB
   transaction**.
3. Capacity is reserved with an atomic conditional update:
   `UPDATE trip SET capacity_kg_remaining = capacity_kg_remaining - $1 WHERE id = $2 AND capacity_kg_remaining >= $1`
   — if 0 rows affected → `CAPACITY_UNAVAILABLE`.
4. A booking is created in `PENDING_TRAVELLER_ACCEPTANCE` with `accept_by = now() + 30 min`.
5. An outbox event `booking.requested` is written in the same transaction.

**Never** create a booking without a capacity reservation, and never reserve capacity without a
booking row — use a single transaction and verify in a test.

## 6. Cancellation rules

| Who / when | Outcome | Refund | Fee |
|---|---|---|---|
| Sender, before traveller accepts | `CANCELLED_BY_SENDER` | 100% (no capture yet) | none |
| Sender, after accept, > 2 h before window | `CANCELLED_BY_SENDER` | 100% minus payment fee | none |
| Sender, after accept, ≤ 2 h before window | `CANCELLED_BY_SENDER` | 50% | 50% to traveller |
| Sender, after pickup | **Not allowed in-app** → dispute path | — | — |
| Traveller, before pickup | `CANCELLED_BY_TRAVELLER` | 100% | traveller reliability penalty |
| Traveller, after pickup | **Not allowed** → incident path | — | — |
| System (no match / expiry) | `EXPIRED` | 100% | none |
| Safety block (either party) | `CANCELLED_SAFETY` | 100% | none |

All refunds are computed by the same `computeRefund()` domain function and unit-tested. Refund policy
text must match `legal/REFUND_CANCELLATION_POLICY_DRAFT.md`.

## 7. Exception handling (mandatory behaviours)

| Situation | Required behaviour |
|---|---|
| Parcel ineligible after booking | Transition to `CANCELLED_INELIGIBLE`, full refund, traveller notified, sender warned; second occurrence within 90 days → manual review |
| Traveller cancels after pickup | `INCIDENT_OPEN`; parcel custody recorded; support contacts both within 30 min; payout frozen |
| Receiver no-show | `DELIVERY_ATTEMPT_FAILED`; traveller may hold for 24 h, hand to support point, or return; compensation per policy |
| Concurrent capacity acceptance | DB transaction + row lock; loser gets `CAPACITY_UNAVAILABLE` |
| Payment provider timeout | Booking stays `PAYMENT_PENDING`; provider status polled; **never** assume failure or success; no duplicate capture |
| OTP to recycled number | Receiver identity confirmed by callback before any override; override requires `support_lead` role |
| Collusion to fake delivery | Delivery requires receiver OTP + photo + GPS-less timestamp consistency; anomaly scoring flags same-device pairs and rapid repeat pairs |
| Weight exceeds declaration at handover | Traveller may refuse (`HANDOVER_REFUSED_OVERWEIGHT`) with no penalty; rebooking at correct weight; repeat offenders flagged |
| Vehicle breakdown | Traveller declares `TRIP_DISRUPTED`; parcel custody reassigned only through support; sender chooses rebook/return |
| Duplicate webhook | Deduplicate by `provider_event_id`; second delivery is a no-op returning 200 |

## 8. Money rules (hard constraints)

- Parcel Yatra **does not hold customer funds**. All capture, hold and payout are provider operations.
- Until written provider + legal approval exists, `payments_live = false` and only the mock adapter runs.
- A payout may be released only when: booking `DELIVERED` **and** no open dispute **and** dispute
  window elapsed **and** traveller not suspended.
- Payout release above ₹1,000 requires maker-checker.
- Every money movement writes to `payment_ledger` (append-only). No UPDATE or DELETE on that table.

## 9. Trust & reputation rules

- Rating: 1–5 stars + optional tags; visible only after both sides rate or 7 days pass.
- Traveller reliability = completed / (completed + traveller-cancellations) over last 20 trips.
- Reliability < 0.7 after ≥ 10 trips → new bookings require manual review.
- A verified badge is never removed automatically without review; it is *suspended* on a credible
  safety report.
- Ratings never delete or hide an incident record.

## 10. Notification rules

- No PII in push notification bodies. "Your parcel is on the way" — not "Rohit is bringing your
  gold chain to House 42".
- OTPs are sent only to the phone number on file, never to a number supplied at handover time.
- Marketing consent is separate from transactional messages (DPDP notice requirement).

## 11. Idempotency and concurrency invariants

| Operation | Invariant |
|---|---|
| Create booking | One booking per (parcel, trip) pair; enforced by unique index |
| Accept booking | One successful accept per booking; `UPDATE ... WHERE status = 'PENDING...'` |
| Verify OTP | One successful consume per OTP row (`used_at IS NULL` guard) |
| Payment webhook | One effect per `provider_event_id` |
| Payout release | One release per booking per provider reference |
| Dispute freeze | Payout state machine rejects release while any open dispute exists |

## 12. What this document intentionally does not decide

Insurance coverage, whether travellers are "workers", GST treatment, and whether bus/train modes are
permitted. Those are legal questions tracked in `legal/LEGAL_REGULATORY_MATRIX.md` and must not be
assumed by engineering.
