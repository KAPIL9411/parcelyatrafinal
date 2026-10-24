# API Tests

**Status:** Draft v0.1 · **Date:** 2026-10-24
**Contract under test:** `api/openapi.yaml` (OpenAPI 3.1.0), 42 operations.

---

## 1. How these tests work

Every test in this file is an HTTP-level test against a running instance with a real Postgres
database. They are not unit tests with a mocked repository — the interesting failures in this product
live in transactions, constraints and authorisation, none of which a mock reproduces.

Harness: Vitest + `fetch`, one database per worker, deterministic clock injection.

### Contract assertion helper (applies to every test)

```ts
// afterEach in every API test
assertMatchesSpec(response, operationId);   // uses api/openapi.yaml
assertNoUndocumentedFields(response);        // fails on extra fields
assertErrorEnvelopeShape(response);           // if status >= 400
```

A response that does not match the spec fails the test. This is the mechanism that prevents PII from
appearing in an undocumented field.

---

## 2. Health

| ID | Request | Expected |
|---|---|---|
| `API-HLT-01` | `GET /health` with DB up | `200`, `status: ok`, all checks `ok` |
| `API-HLT-02` | `GET /health` with DB down | `503`, `status: down`, `checks[database].status = down` |
| `API-HLT-03` | `GET /health` response time with DB up | p99 < 50 ms |
| `API-HLT-04` | `GET /health` body fields | Exactly `status`, `version`, `checks`; no hostname, no commit SHA, no env name |

> The `/health` endpoint deliberately declares only `200` and `503`. The linter's
> `operation-4xx-response` warning is accepted and documented in `validation/VALIDATION_REPORT.md`.

---

## 3. Auth

| ID | Request | Expected |
|---|---|---|
| `API-AUTH-01` | `POST /auth/otp/request` valid number | `202`, `challenge_id` UUID, `expires_in_seconds > 0` |
| `API-AUTH-02` | New number vs existing number | Identical status and body shape; response time difference < 50 ms |
| `API-AUTH-03` | `POST /auth/otp/request` for 4th time in an hour | `429` + `Retry-After` |
| `API-AUTH-04` | `POST /auth/otp/request` with `phone: "12345"` | `400 VALIDATION_FAILED`, `details.fields` points at `/phone` |
| `API-AUTH-05` | `POST /auth/otp/verify` correct | `200`, `access_token`, `refresh_token`, `expires_in ≤ 1800` |
| `API-AUTH-06` | `POST /auth/otp/verify` wrong code | `400 OTP_INVALID` |
| `API-AUTH-07` | `POST /auth/otp/verify` same code twice | Second → `400 OTP_ALREADY_USED` |
| `API-AUTH-08` | `POST /auth/otp/verify` 6th wrong attempt | `429 OTP_ATTEMPTS_EXCEEDED` |
| `API-AUTH-09` | `POST /auth/refresh` with valid token | `200`, **new** `refresh_token` ≠ old |
| `API-AUTH-10` | `POST /auth/refresh` reusing the old token | `401 AUTH_REFRESH_REUSE`; the new token is also revoked |
| `API-AUTH-11` | `POST /auth/logout` then use access token | `401 AUTH_SESSION_REVOKED` |
| `API-AUTH-12` | `POST /auth/google` with `alg: none` JWT | `401 AUTH_TOKEN_INVALID` |
| `API-AUTH-13` | `POST /auth/google` with valid JWT for another `aud` | `401 AUTH_GOOGLE_AUD_MISMATCH` |
| `API-AUTH-14` | `POST /auth/google` with `email_verified: false` | `401 AUTH_GOOGLE_EMAIL_UNVERIFIED` |
| `API-AUTH-15` | Any endpoint without `Authorization` | `401 AUTH_REQUIRED`, `WWW-Authenticate: Bearer` |

**Response body scan (all auth endpoints):** must not contain `otp`, `code`, `password`, or a token
in any field other than `access_token` / `refresh_token`.

---

## 4. Me / privacy

| ID | Request | Expected |
|---|---|---|
| `API-ME-01` | `GET /me` | `200`; `phone_last4` only — no full phone, no address |
| `API-ME-02` | `PATCH /me` with `{name}` | `200`, updated |
| `API-ME-03` | `PATCH /me` with `{verification_state: "verified"}` | `400 UNKNOWN_FIELD` — clients cannot self-verify |
| `API-ME-04` | `PATCH /me` with `{locale: "fr-FR"}` | `400 VALIDATION_FAILED` |
| `API-ME-05` | `POST /me/export` | `202`, `request_id`; email link expires 24 h (asserted by inspecting the queued job, not the email) |
| `API-ME-06` | `POST /me/export` twice within a minute | Second `429` (abuse control) |
| `API-ME-07` | `POST /me/deletion-request` with open booking | `409`, `retained_categories` present, nothing deleted |
| `API-ME-08` | `POST /me/deletion-request` clean account | `202`, `hard_delete_after` set |
| `API-ME-09` | `POST /me/deletion-request` with `confirm: false` | `400 VALIDATION_FAILED` |

---

## 5. Verification

| ID | Request | Expected |
|---|---|---|
| `API-VER-01` | `POST /verifications` valid payload | `201`, `state: pending` |
| `API-VER-02` | `POST /verifications` with `id_type: "aadhaar"` | `400 VALIDATION_FAILED` |
| `API-VER-03` | `POST /verifications` twice while pending | Second `409 VERIFICATION_ALREADY_PENDING` |
| `API-VER-04` | `GET /verifications/me` when none exists | `200`, `state: not_started` (not `404`) |
| `API-VER-05` | `POST /verifications` with another user's `object_key` | `400 VALIDATION_FAILED` (ownership check) |
| `API-VER-06` | `POST /admin/verifications/{id}/decision` as `support_agent` | `403 ROLE_REQUIRED` |
| `API-VER-07` | `POST /admin/verifications/{id}/decision` without `reason_code` | `400 VALIDATION_FAILED` |
| `API-VER-08` | Approve, then `GET /verifications/me` | `state: verified`, `decided_at` set |

---

## 6. Parcels

| ID | Request | Expected |
|---|---|---|
| `API-PAR-01` | `POST /parcels` valid | `201`, `status: posted` |
| `API-PAR-02` | Weight `5.01` | `422 PARCEL_TOO_LARGE` |
| `API-PAR-03` | `dims_cm: [10, 10, 46]` | `422 PARCEL_TOO_LARGE` |
| `API-PAR-04` | `declared_value_paise: 500001` | `422 VALUE_ABOVE_PILOT_LIMIT` |
| `API-PAR-05` | Prohibited category | `422 ITEM_PROHIBITED` |
| `API-PAR-06` | Restricted category | `202`, `review_required: true` |
| `API-PAR-07` | `declaration_accepted: false` | `400 VALIDATION_FAILED` |
| `API-PAR-08` | `POST /parcels` with `{status: "matched"}` | `400 UNKNOWN_FIELD` |
| `API-PAR-09` | `GET /parcels/{id}` as a different user | `404` (not `403`), body is an error envelope only |
| `API-PAR-10` | `DELETE /parcels/{id}` with an active booking | `409 PARCEL_HAS_ACTIVE_BOOKING` |
| `API-PAR-11` | `POST /parcels/{id}/quote` with no eligible trip | `409 NO_MATCH`, **no `total_paise` key anywhere in the body** |
| `API-PAR-12` | `POST /parcels/{id}/quote` twice quickly | Second `409 QUOTE_EXISTS_VALID` |
| `API-PAR-13` | `GET /parcels/{id}/matches` with none | `200`, `matches: []`, `no_match_reasons` non-empty |
| `API-PAR-14` | `GET /parcels/{id}/matches` body scan | No phone, no full name, no coordinates, no street address |

---

## 7. Trips

| ID | Request | Expected |
|---|---|---|
| `API-TRP-01` | `POST /trips` verified traveller, `mode: car` | `201`, `status: published` |
| `API-TRP-02` | `POST /trips` unverified | `403 VERIFICATION_REQUIRED` |
| `API-TRP-03` | `POST /trips` with `mode: bike` (flag off) | `422 MODE_DISABLED` |
| `API-TRP-04` | `POST /trips` with `mode: air` (flag off) | `422 MODE_DISABLED` |
| `API-TRP-05` | `capacity_kg: 25` | `422 TRIP_CAPACITY_INVALID` |
| `API-TRP-06` | `arrival_estimate_at` before `departure_at` | `422 TRIP_WINDOW_INVALID` |
| `API-TRP-07` | `GET /trips` pagination | `next_cursor: null` on the last page; limit respected |
| `API-TRP-08` | `DELETE /trips/{id}` with accepted booking | `409 TRIP_HAS_ACCEPTED_BOOKING` |
| `API-TRP-09` | `GET /trips/{id}` as another user | `404` |

---

## 8. Bookings and transitions

| ID | Request | Expected |
|---|---|---|
| `API-BK-01` | `POST /bookings` valid | `201`, `pending_traveller_acceptance`, `accept_by ≈ now+30m` |
| `API-BK-02` | `POST /bookings` without `Idempotency-Key` | `400 IDEMPOTENCY_KEY_REQUIRED` |
| `API-BK-03` | `POST /bookings` same key, same body, 5× | All `201`, same `id` |
| `API-BK-04` | `POST /bookings` same key, different body | `409 IDEMPOTENCY_KEY_REUSED` |
| `API-BK-05` | `POST /bookings` expired quote | `409 QUOTE_EXPIRED` |
| `API-BK-06` | `POST /bookings` concurrent for last capacity | One `201`, one `409 CAPACITY_UNAVAILABLE` |
| `API-BK-07` | `POST /bookings/{id}/transitions` `{command:"accept"}` as sender | `403 TRANSITION_NOT_PERMITTED` |
| `API-BK-08` | `accept` as the trip's traveller | `200`, `payment_pending` |
| `API-BK-09` | `confirm_delivery` from `confirmed` | `409 INVALID_TRANSITION` |
| `API-BK-10` | `{command:"refund"}` (a system-only command) | `403 TRANSITION_NOT_PERMITTED` (not `400`) |
| `API-BK-11` | Two concurrent `accept` requests | One `200`, one `409 TRANSITION_CONFLICT` |
| `API-BK-12` | `GET /bookings/{id}` as a non-party | `404` |
| `API-BK-13` | `GET /bookings` `role=sender` | Only bookings where the caller is the sender |
| `API-BK-14` | `allowed_commands` for a fresh booking as traveller | Contains exactly `["accept","decline"]` |
| `API-BK-15` | `allowed_commands` as sender at the same state | Contains exactly `["cancel"]` |
| `API-BK-16` | Every successful transition | `booking_events` row appended; `timeline` returns it |

---

## 9. Handover

| ID | Request | Expected |
|---|---|---|
| `API-HO-01` | `POST .../handover/pickup` correct OTP + photo | `200`, `picked_up` |
| `API-HO-02` | Reuse the consumed OTP | `409 HANDOVER_NOT_ALLOWED_IN_STATE` |
| `API-HO-03` | 5 wrong OTPs | 5th → `423 BOOKING_LOCKED`; booking `locked_for_review` |
| `API-HO-04` | `POST .../otp/regenerate` `{phase:"pickup"}` | `202`, `expires_at`, `attempts_remaining`; **response contains no OTP digits** |
| `API-HO-05` | Regenerate after the old code is used | Old code invalid; new code works |
| `API-HO-06` | Pickup from `pending_traveller_acceptance` | `409 HANDOVER_NOT_ALLOWED_IN_STATE` |
| `API-HO-07` | Delivery confirmation | `200`, `delivered`, `dispute_deadline ≈ now+72h` |
| `API-HO-08` | OTP brute force 20× across 4 bookings | Rate limited; `429`; no lock leakage of which booking exists |

**Global assertion:** no response from any handover endpoint ever contains the correct OTP value, in
any field, including `details`.

---

## 10. Payments (sandbox)

| ID | Request | Expected |
|---|---|---|
| `API-PAY-01` | `POST /bookings/{id}/payment-intent` | `201`, `amount_paise == quote.total_paise`, `sandbox: true` |
| `API-PAY-02` | Request body includes `amount_paise` | `400 UNKNOWN_FIELD`; server never reads it |
| `API-PAY-03` | `PAYMENTS_LIVE=false` and mock disabled | `501 PAYMENTS_NOT_ENABLED` |
| `API-PAY-04` | Two intents, same key | One intent, identical response |
| `API-PAY-05` | Intent for a `delivered` booking | `409 BOOKING_NOT_PAYABLE` |
| `API-PAY-06` | `POST /admin/refunds` amount > captured | `409 REFUND_EXCEEDS_CAPTURED_AMOUNT` |
| `API-PAY-07` | `POST /admin/refunds` ₹1,500 as `finance` | `201`, `state: pending_approval` |
| `API-PAY-08` | Same user approves their own refund | `403 SELF_APPROVAL_FORBIDDEN` |
| `API-PAY-09` | `POST /admin/payouts/{id}/release` with open dispute | `409 PAYOUT_NOT_ELIGIBLE` |
| `API-PAY-10` | Release ₹1,500 without `approval_id` | `409 APPROVAL_REQUIRED` |
| `API-PAY-11` | LEDGER: direct `UPDATE payment_ledger` as app role | Postgres permission denied (integration-level assertion) |

---

## 11. Webhooks

Mapped from `api/WEBHOOK_CONTRACTS.md` §9.

| ID | Request | Expected |
|---|---|---|
| `API-WH-01` | Valid signature, `payment.captured` | `200`; ledger row created; booking updated |
| `API-WH-02` | Same event delivered twice | `200` both; exactly one ledger row |
| `API-WH-03` | Invalid signature | `401 WEBHOOK_SIGNATURE_INVALID`; no state change; alert emitted |
| `API-WH-04` | Timestamp 10 min old | `401 WEBHOOK_TIMESTAMP_INVALID` |
| `API-WH-05` | Body modified after signing | `401` |
| `API-WH-06` | Amount in body ≠ quote | No state change; alert; booking flagged |
| `API-WH-07` | Unknown `provider_ref` | `202`; no crash; alert |
| `API-WH-08` | Unknown event type | `400 WEBHOOK_UNKNOWN_TYPE` |
| `API-WH-09` | Body > 64 KB | `413` |
| `API-WH-10` | Concurrent duplicate deliveries (10 parallel) | Exactly one effect |
| `API-WH-11` | Missing signature header | `401` |
| `API-WH-12` | Valid signature but our DB is down | `503`; state unchanged; reconciliation catches it |

---

## 12. Disputes & reviews

| ID | Request | Expected |
|---|---|---|
| `API-DIS-01` | `POST /disputes` within 72 h | `201`, payout `frozen` |
| `API-DIS-02` | `POST /disputes` after the window | `409 DISPUTE_WINDOW_CLOSED` |
| `API-DIS-03` | `description` of 5 chars | `400 VALIDATION_FAILED` |
| `API-DIS-04` | `GET /disputes/{id}` as non-party | `404` |
| `API-DIS-05` | Evidence added to a closed dispute | `409 DISPUTE_CLOSED` |
| `API-REV-01` | `POST /bookings/{id}/review` after delivery | `201` |
| `API-REV-02` | `stars: 6` | `400 VALIDATION_FAILED` |
| `API-REV-03` | Review on a `cancelled` booking | `409` |

---

## 13. Files

| ID | Request | Expected |
|---|---|---|
| `API-FIL-01` | `POST /files/upload-url` `content_type: application/pdf` | `400 UPLOAD_INVALID_TYPE` |
| `API-FIL-02` | `byte_size: 10485761` | `400 UPLOAD_TOO_LARGE` |
| `API-FIL-03` | Upload URL for another purpose's key prefix | Prefix enforced by server, not client |
| `API-FIL-04` | `object_key: "../../etc/passwd"` in a body | `400 VALIDATION_FAILED` |
| `API-FIL-05` | Fetch an object without a signature | Storage returns `403` (tested against MinIO in CI) |

---

## 14. Authorisation matrix (executed as a table-driven test)

For every endpoint, three actors are tested: owner, authenticated non-owner, anonymous.

| Resource | Owner | Non-owner | Anonymous |
|---|---|---|---|
| Parcel | `200` | `404` | `401` |
| Quote | `200` | `404` | `401` |
| Trip | `200` | `404` | `401` |
| Booking | `200` | `404` | `401` |
| Dispute | `200` | `404` | `401` |
| Verification (admin) | `200` (reviewer) | `403` (support) | `401` |
| Audit log | `200` (`admin_readonly`) | `403` | `401` |

The test asserts the **exact** status. A `403` where `404` is expected is a failure, because it leaks
existence.

---

## 15. Idempotency sweep (generated)

Every mutating endpoint with `Idempotency-Key` in the spec is driven three times with
(same key, same body), (same key, different body), (different key) and the outcome compared with the
table in `api/API_CONVENTIONS.md` §5. A missing header on a spec-declared endpoint is a test failure.

---

## 16. Test count estimate

| Group | Tests |
|---|---|
| Health | 4 |
| Auth | 15 |
| Me | 9 |
| Verification | 8 |
| Parcels | 14 |
| Trips | 9 |
| Bookings | 16 |
| Handover | 8 |
| Payments | 11 |
| Webhooks | 12 |
| Disputes/reviews | 6 |
| Files | 5 |
| Authorisation matrix | ~42 (generated) |
| Idempotency sweep | ~12 (generated) |
| **Total** | **≈ 171** |

Target: ~171 integration tests, all contract-asserted, all runnable against a container in under
6 minutes on CI.

---

## 17. What these tests do not prove

- They do not prove the product is safe for real money — the adapter is mocked.
- They do not prove regulatory compliance.
- They do not replace the manual UAT in `testing/UAT_CHECKLIST.md` or the security tests in
  `testing/SECURITY_TEST_CASES.md`.
- Passing all of them means the contract is honoured, nothing more. State that honestly in release notes.
