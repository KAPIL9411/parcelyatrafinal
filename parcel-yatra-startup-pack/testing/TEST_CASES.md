# Test Cases

**Status:** Draft v0.1 · **Date:** 2026-10-24
IDs are stable and referenced by `roadmap/SPRINT_BACKLOG.md`. `P0` cases are release-blocking.

Legend: **AC** = acceptance criteria source, **FR** = requirement, **SR** = security requirement.

---

## 1. The ten critical scenarios (must never regress)

| ID | Scenario | Expected | P |
|---|---|---|---|
| `TC-CRIT-01` | Two travellers POST `accept` for the last 1 kg of capacity, concurrently | Exactly one `200`, one `409 CAPACITY_UNAVAILABLE`; capacity never negative | P0 |
| `TC-CRIT-02` | Same `payment.captured` webhook delivered twice, 3 s apart | One ledger `capture` row; second returns `200`; booking state unchanged on second | P0 |
| `TC-CRIT-03` | Same `POST /bookings` retried 5× with one `Idempotency-Key` | One booking row; all 5 responses identical (same id, same 201) | P0 |
| `TC-CRIT-04` | Five wrong pickup OTPs | Booking → `locked_for_review`; support task created; further attempts `423` | P0 |
| `TC-CRIT-05` | User A `GET /bookings/{id-of-B}` | `404` (not `403`); no data in body; audit records the attempt | P0 |
| `TC-CRIT-06` | Unverified traveller accepts a booking | `403 VERIFICATION_REQUIRED`; booking stays `pending_traveller_acceptance` | P0 |
| `TC-CRIT-07` | Sender cancels after `picked_up` | `409 INVALID_TRANSITION`; dispute path offered instead | P0 |
| `TC-CRIT-08` | Dispute raised while payout is `eligible` | Payout → `frozen`; release attempt returns `409 PAYOUT_NOT_ELIGIBLE` | P0 |
| `TC-CRIT-09` | Provider times out on payment intent | Booking stays `payment_pending`; no capture; no retry CTA; poll scheduled | P0 |
| `TC-CRIT-10` | Database restarted between capacity reservation and commit | No booking row, no capacity decrement (single transaction) | P0 |

## 2. Authentication

| ID | Case | Expected | AC | P |
|---|---|---|---|---|
| `TC-AUTH-01` | Request OTP for a new number | `202`, challenge created, code hashed only | US-A1 | P0 |
| `TC-AUTH-02` | Request OTP twice within 30 s | `429 OTP_RATE_LIMITED` with `Retry-After` | US-A1 | P0 |
| `TC-AUTH-03` | Request OTP for an existing vs non-existing number | Identical response body and timing (±50 ms) | US-A1 | P0 |
| `TC-AUTH-04` | Verify with correct code | Session issued, `expires_in ≤ 1800` | US-A1 | P0 |
| `TC-AUTH-05` | Replay a consumed code | `400 OTP_ALREADY_USED` | US-A1 | P0 |
| `TC-AUTH-06` | Verify after 5 min 1 s | `400 OTP_EXPIRED` | US-A1 | P0 |
| `TC-AUTH-07` | 6 wrong attempts | 5th → attempts exceeded; challenge invalidated | US-A1 | P0 |
| `TC-AUTH-08` | Google token with wrong `aud` | `401 AUTH_GOOGLE_AUD_MISMATCH` | US-A2 | P0 |
| `TC-AUTH-09` | Google token `alg: none` | `401 AUTH_TOKEN_INVALID` | US-A2 | P0 |
| `TC-AUTH-10` | Expired Google token | `401` | US-A2 | P0 |
| `TC-AUTH-11` | Refresh token reused after rotation | Whole family revoked, `401 AUTH_REFRESH_REUSE` | SR-A6 | P0 |
| `TC-AUTH-12` | Access token used after logout | `401 AUTH_SESSION_REVOKED` | SR-A6 | P0 |
| `TC-AUTH-13` | OTP value searched in logs | Zero occurrences (log scan assertion) | SR-L1 | P0 |

## 3. Verification

| ID | Case | Expected | AC | P |
|---|---|---|---|---|
| `TC-VER-01` | Submit with valid images | `201`, state `pending`, docs stored privately | US-A3 | P0 |
| `TC-VER-02` | Upload a `.exe` renamed `.jpg` | `400 UPLOAD_INVALID_TYPE`; no object stored | US-A3 | P0 |
| `TC-VER-03` | Upload 11 MB file | `400 UPLOAD_TOO_LARGE` | SR-U2 | P0 |
| `TC-VER-04` | Image contains GPS EXIF | Stored object has no GPS tags | SR-U2 | P0 |
| `TC-VER-05` | Support agent (not reviewer) requests an ID image | `403 ROLE_REQUIRED` | FR-803 | P0 |
| `TC-VER-06` | Reviewer views an ID image | Audit entry written with actor + reason | FR-803, SR-AD3 | P0 |
| `TC-VER-07` | Aadhaar submitted as `id_type` | `400 VALIDATION_FAILED` (enum excludes it) | FR-105 | P0 |
| `TC-VER-08` | Fourth submission after 3 rejections | `409 VERIFICATION_ATTEMPTS_EXCEEDED` | US-A3 | P1 |
| `TC-VER-09` | Pending traveller tries to publish a trip | `403 VERIFICATION_REQUIRED` | FR-103 | P0 |

## 4. Parcel & eligibility

| ID | Case | Expected | AC | P |
|---|---|---|---|---|
| `TC-PAR-01` | Valid document parcel | `201`, status `posted` | US-B1 | P0 |
| `TC-PAR-02` | Weight 5.01 kg | `422 PARCEL_TOO_LARGE` | FR-204 | P0 |
| `TC-PAR-03` | Longest side 46 cm | `422 PARCEL_TOO_LARGE` | FR-204 | P0 |
| `TC-PAR-04` | Declared value ₹5,001 | `422 VALUE_ABOVE_PILOT_LIMIT` | FR-204 | P0 |
| `TC-PAR-05` | Category `cash_or_jewellery` (prohibited) | `422 ITEM_PROHIBITED`; no quote possible | FR-203 | P0 |
| `TC-PAR-06` | Restricted category (legal documents) | `202` + `review_required`, queued | FR-203 | P0 |
| `TC-PAR-07` | Description "gift" | `422 DESCRIPTION_TOO_VAGUE` | FR-202 | P1 |
| `TC-PAR-08` | Window start in the past | `422 WINDOW_INVALID` | E7 | P0 |
| `TC-PAR-09` | Destination city not serviced | `422 CITY_NOT_SERVICED` | E6 | P0 |
| `TC-PAR-10` | Suspended sender posts | `403 ACCOUNT_SUSPENDED` | E1 | P0 |
| `TC-PAR-11` | 4th cancellation in 30 days → post | `403 CANCELLATION_LIMIT` | E10 | P1 |

## 5. Trips & matching

| ID | Case | Expected | AC | P |
|---|---|---|---|---|
| `TC-TRIP-01` | Verified traveller publishes car trip | `201`, publicly shows "car, N kg available" | US-C1 | P0 |
| `TC-TRIP-02` | Publish with `mode_bus` when flag off | `422 MODE_DISABLED` | FR-303 | P0 |
| `TC-TRIP-03` | Capacity 25 kg | `422 TRIP_CAPACITY_INVALID` | FR-301 | P0 |
| `TC-TRIP-04` | Trip detail response | Contains no phone number, no exact address | FR-302 | P0 |
| `TC-MAT-01` | Parcel + exactly matching trip | Match returned, score ≥ 65, reasons present | US-C2 | P0 |
| `TC-MAT-02` | No trips on the date | `200` with `matches: []` and `NO_TRIP_ON_DATE` | US-C2 | P0 |
| `TC-MAT-03` | Trip with insufficient capacity | Excluded from results | FR-401 | P0 |
| `TC-MAT-04` | Trip arriving after window + 2 h | Excluded | §3 rule 4 | P0 |
| `TC-MAT-05` | Self-booking attempt (own trip) | Excluded from results; direct booking `403 SELF_BOOKING_FORBIDDEN` | rule 7 | P0 |
| `TC-MAT-06` | Blocked pair | Excluded | rule 7 | P1 |
| `TC-MAT-07` | Response PII scan | No phone, no full name, no coordinates, no address | §6 privacy | P0 |
| `TC-MAT-08` | Match response when no match exists | **No price field present anywhere** | US-C2 | P0 |

## 6. Booking lifecycle

| ID | Case | Expected | AC | P |
|---|---|---|---|---|
| `TC-BK-01` | Create booking with valid quote | `201 pending_traveller_acceptance`, `accept_by = now+30m` | US-C3 | P0 |
| `TC-BK-02` | Create booking with expired quote | `409 QUOTE_EXPIRED`; new quote required | FR-405 | P0 |
| `TC-BK-03` | Create second active booking for same parcel | `409 BOOKING_ALREADY_ACTIVE` | §11 | P0 |
| `TC-BK-04` | Traveller accepts before `accept_by` | `200`, booking `payment_pending`, capacity decremented | US-C3 | P0 |
| `TC-BK-05` | Traveller accepts after `accept_by` | `409 ACCEPT_WINDOW_CLOSED` | US-C3 | P0 |
| `TC-BK-06` | No acceptance for 30 min | Job sets `expired`, capacity released | §6 timers | P0 |
| `TC-BK-07` | Client PATCHes `status` directly | `400 UNKNOWN_FIELD` (no such endpoint) | FR-407 | P0 |
| `TC-BK-08` | Command not in table (e.g. `confirm_delivery` from `confirmed`) | `409 INVALID_TRANSITION` | §3 | P0 |
| `TC-BK-09` | Two concurrent transitions on same booking | One succeeds, one `409 TRANSITION_CONFLICT` | SR-Z5 | P0 |
| `TC-BK-10` | Parcel becomes ineligible after booking (flag/oversize) | `cancelled_ineligible`, full refund, traveller notified | §7 | P0 |
| `TC-BK-11` | Every transition | Row appended to `booking_events` with from/to/actor/reason | §5 inv. 6 | P0 |
| `TC-BK-12` | Cancel before acceptance | `cancelled_by_sender`, no fee | §6 | P0 |
| `TC-BK-13` | Cancel 3 h before window | 100% minus provider fee, amount shown before confirm | §6 | P0 |
| `TC-BK-14` | Cancel 1 h before window | 50% refund, 50% to traveller | §6 | P0 |
| `TC-BK-15` | Cancel exactly at the 2 h boundary | Deterministic outcome (documented rule applied), not "either" | §6 | P1 |

## 7. Handover

| ID | Case | Expected | AC | P |
|---|---|---|---|---|
| `TC-HO-01` | Correct pickup OTP + photo | `200`, `picked_up`, OTP consumed | US-D1 | P0 |
| `TC-HO-02` | Correct OTP reused | `409 HANDOVER_NOT_ALLOWED_IN_STATE` (already picked up) | US-D1 | P0 |
| `TC-HO-03` | Expired OTP | `400 OTP_EXPIRED`; regenerate offered | US-D1 | P0 |
| `TC-HO-04` | Missing photo | `400 PHOTO_REQUIRED`; state unchanged | FR-501 | P0 |
| `TC-HO-05` | Two concurrent valid OTP submissions | One success, one rejected | §11 | P0 |
| `TC-HO-06` | OTP from another booking | `400 OTP_INVALID` | SR-A1 | P0 |
| `TC-HO-07` | Delivery OTP + photo | `200`, `delivered`, dispute deadline set | US-D2 | P0 |
| `TC-HO-08` | Receiver unavailable after 2 h | `receiver_unavailable` allowed; 3 options shown | §7 | P1 |
| `TC-HO-09` | Support-assisted delivery | Override recorded with reason + audit; role `support_lead` only | FR-505 | P1 |
| `TC-HO-10` | Regenerate OTP | Old code invalid, new code sent to the on-file number only | FR-503 | P0 |

## 8. Payments (sandbox)

| ID | Case | Expected | AC | P |
|---|---|---|---|---|
| `TC-PAY-01` | Create intent with valid quote | `201`, amount equals quote total, `sandbox: true` | FR-602 | P0 |
| `TC-PAY-02` | Client sends `amount_paise` in body | Field rejected (`400 UNKNOWN_FIELD`); server amount used | FR-601 | P0 |
| `TC-PAY-03` | `PAYMENTS_LIVE=false` + no mock adapter | `501 PAYMENTS_NOT_ENABLED` | FR-602 | P0 |
| `TC-PAY-04` | Duplicate intent with same key | One intent returned twice | FR-603 | P0 |
| `TC-PAY-05` | Unknown provider status | `409 PAYMENT_STATE_UNKNOWN`; UI shows no retry | §4 rule 6 | P0 |
| `TC-PAY-06` | Refund above captured amount | `409 REFUND_EXCEEDS_CAPTURED_AMOUNT` | §5 | P0 |
| `TC-PAY-07` | Refund ₹1,500 by one staff user | `pending_approval`; self-approval `403` | FR-804 | P0 |
| `TC-PAY-08` | Ledger mutation attempt (`UPDATE payment_ledger`) | Permission denied by DB role | §8 | P0 |
| `TC-PAY-09` | Payout while dispute open | `409 PAYOUT_NOT_ELIGIBLE` | FR-702 | P0 |
| `TC-PAY-10` | Payout before dispute window closes | `409 PAYOUT_NOT_ELIGIBLE` | §5 | P0 |
| `TC-PAY-11` | Reconciliation with a seeded mismatch | Mismatch reported; payouts blocked | §9 | P1 |

## 9. Disputes & reviews

| ID | Case | Expected | AC | P |
|---|---|---|---|---|
| `TC-DIS-01` | Raise dispute 10 h after delivery | `201`, payout frozen | US-E2 | P0 |
| `TC-DIS-02` | Raise dispute 8 days after expected delivery | `409 DISPUTE_WINDOW_CLOSED` | FR-701 | P0 |
| `TC-DIS-03` | Second open dispute on same booking | `409 DISPUTE_ALREADY_OPEN` | §11 | P0 |
| `TC-DIS-04` | Non-party raises dispute | `404` | SR-Z1 | P0 |
| `TC-DIS-05` | Resolve in sender's favour | Refund executed, payout `void` | §5 | P0 |
| `TC-DIS-06` | Resolve in traveller's favour | Payout `eligible` | §5 | P0 |
| `TC-REV-01` | Rate after delivery | `201` | FR-704 | P1 |
| `TC-REV-02` | Rate twice | `409 REVIEW_ALREADY_SUBMITTED` | §11 | P1 |
| `TC-REV-03` | Rate on a cancelled booking | `409` | FR-704 | P1 |

## 10. Files

| ID | Case | Expected | P |
|---|---|---|---|
| `TC-FIL-01` | Request upload URL for `application/pdf` | `400 UPLOAD_INVALID_TYPE` | P0 |
| `TC-FIL-02` | Upload beyond 5 min expiry | Storage rejects; API returns `400 UPLOAD_URL_EXPIRED` on confirm | P0 |
| `TC-FIL-03` | Direct bucket GET without signature | `403` from storage | P0 |
| `TC-FIL-04` | Object key with `../` | `400 VALIDATION_FAILED` | P0 |
| `TC-FIL-05` | Reference another user's `object_key` in a dispute | `403` / `400` — key ownership checked | P0 |

## 11. Notifications

| ID | Case | Expected | P |
|---|---|---|---|
| `TC-NOT-01` | Provider returns 500 | Retry ×3 with backoff, then support task; booking unaffected | P1 |
| `TC-NOT-02` | Push payload inspection | No address, phone, item description or value | P0 |
| `TC-NOT-03` | Repeat `(event, channel, recipient)` | Exactly one send | P1 |
| `TC-NOT-04` | Quiet hours 22:30 | Non-critical message queued to 08:00 | P2 |

## 12. Resilience

| ID | Case | Expected | P |
|---|---|---|---|
| `TC-RES-01` | Kill DB connection mid-request | `503 SERVICE_UNAVAILABLE`, no partial write | P0 |
| `TC-RES-02` | Restore from backup | Row counts match; app starts; ledger sums reconcile | P0 |
| `TC-RES-03` | Notification service down | Booking flow completes | P1 |
| `TC-RES-04` | Job run twice (idempotency) | Same final state, no duplicate side effects | P0 |
| `TC-RES-05` | Deploy rollback | Previous image healthy, no migration mismatch | P0 |

## 13. Copy and content lint

| ID | Case | Expected | P |
|---|---|---|---|
| `TC-COPY-01` | Scan string catalogue for "insured", "guaranteed", "100% safe" | Zero matches (except in explicitly blocked-phrase list) | P0 |
| `TC-COPY-02` | Every string has `hi` translation | Zero missing | P0 |
| `TC-COPY-03` | Error codes in catalogue match those in `api/ERROR_CATALOG.md` | Zero unmatched | P1 |
| `TC-COPY-04` | Every error has a user-facing message (no raw code shown) | Zero `code` rendered directly | P1 |

## 14. Offline / poor network

| ID | Case | Expected | P |
|---|---|---|---|
| `TC-OFF-01` | Pickup confirmation with network off | Queued, UI says "will confirm when online", **no fake success** | P0 |
| `TC-OFF-02` | Queued submission retried after reconnect | Applied once (idempotency key preserved) | P0 |
| `TC-OFF-03` | Draft restored after app kill mid-wizard | All entered fields present | P1 |
| `TC-OFF-04` | Matches screen offline | Cached results with explicit "as of" timestamp | P2 |

## 15. Coverage traceability

| Requirement group | Cases |
|---|---|
| FR-101…FR-107 | TC-AUTH-*, TC-VER-* |
| FR-201…FR-208 | TC-PAR-* |
| FR-301…FR-306 | TC-TRIP-*, TC-BK-06 |
| FR-401…FR-407 | TC-MAT-*, TC-BK-* |
| FR-501…FR-506 | TC-HO-* |
| FR-601…FR-606 | TC-PAY-* |
| FR-701…FR-706 | TC-DIS-* |
| FR-801…FR-806 | TC-VER-05/06, TC-PAY-07, TC-HO-09 |

Requirements without a case: none identified at the time of writing. This table is re-checked during
release (`release/RELEASE_CHECKLIST.md`).
