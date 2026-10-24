# Error Catalog

**Status:** Draft v0.1 · **Date:** 2026-10-24
Every error the API can return. `code` is stable; clients branch on it. Adding a code is a
non-breaking change; renaming one is breaking.

Envelope shape is defined once in `api/API_CONVENTIONS.md` §4.

---

## 1. Authentication & session (4xx)

| Code | HTTP | Meaning | Client action | User-facing message (en) |
|---|---|---|---|---|
| `AUTH_REQUIRED` | 401 | No bearer token | Redirect to sign-in | "Please sign in to continue." |
| `AUTH_TOKEN_INVALID` | 401 | Malformed/unknown token | Refresh, then sign in | "Your session is invalid. Please sign in again." |
| `AUTH_TOKEN_EXPIRED` | 401 | Access token past `exp` | Refresh silently | — (silent) |
| `AUTH_REFRESH_INVALID` | 401 | Refresh token unknown | Sign in again | "Please sign in again." |
| `AUTH_REFRESH_REUSE` | 401 | Rotated refresh token replayed; family revoked | Sign in again; warn user | "For your security we signed you out of all devices." |
| `AUTH_SESSION_REVOKED` | 401 | Session killed (logout, admin, password-less reset) | Sign in | "Please sign in again." |
| `AUTH_GOOGLE_AUD_MISMATCH` | 401 | ID token issued for another client | Do not retry; report | "Google sign-in failed." |
| `AUTH_GOOGLE_EMAIL_UNVERIFIED` | 401 | `email_verified` false | Use phone sign-in | "Please use your phone number to sign in." |
| `OTP_INVALID` | 400 | Wrong code | Re-enter | "That code isn't right." |
| `OTP_EXPIRED` | 400 | Past 5/10-minute TTL | Request new code | "That code has expired. Send a new one." |
| `OTP_ALREADY_USED` | 400 | Code consumed | Request new code | "That code has already been used." |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | 5 failed attempts | Wait, then request new | "Too many attempts. Try again later." |
| `OTP_RATE_LIMITED` | 429 | Issuance throttled | Wait (`Retry-After`) | "Please wait before requesting another code." |
| `OTP_CHALLENGE_NOT_FOUND` | 400 | Unknown/expired challenge id | Restart flow | "Start again." |

## 2. Authorisation

| Code | HTTP | Meaning |
|---|---|---|
| `FORBIDDEN` | 403 | Authenticated but role not permitted |
| `NOT_RESOURCE_OWNER` | 404 | Deliberately masked as not-found to avoid disclosure |
| `ACCOUNT_SUSPENDED` | 403 | Suspended account attempted an action |
| `ACCOUNT_DELETED` | 403 | Deletion in progress |
| `TRANSITION_NOT_PERMITTED` | 403 | Command exists but this actor may not issue it |
| `ADMIN_MFA_REQUIRED` | 403 | Sensitive admin action without fresh MFA |
| `ROLE_REQUIRED` | 403 | Specific role missing (e.g. `verification_reviewer`) |

## 3. Validation

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Schema violation; see `details.fields[]` |
| `UNKNOWN_FIELD` | 400 | Client sent a property the server does not accept |
| `INVALID_UUID` | 400 | Malformed path/body identifier |
| `INVALID_PHONE` | 400 | Not a valid Indian mobile number |
| `INVALID_WINDOW` | 400 | `window_end <= window_start` or start in past |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Missing on a mutating endpoint |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different body |
| `REQUEST_IN_PROGRESS` | 409 | Same key, original still executing |
| `PAYLOAD_TOO_LARGE` | 413 | Body above limit |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Not `application/json` |

## 4. Eligibility & parcel rules

| Code | HTTP | Meaning | Notes |
|---|---|---|---|
| `PHONE_NOT_VERIFIED` | 403 | Sender phone unverified | E2 |
| `ITEM_PROHIBITED` | 422 | Category on the hard-block list | E3; never overridable by support |
| `PARCEL_TOO_LARGE` | 422 | Weight > 5 kg or longest side > 45 cm | E4 |
| `VALUE_ABOVE_PILOT_LIMIT` | 422 | Declared value > ₹5,000 | E5; no workaround offered |
| `CITY_NOT_SERVICED` | 422 | Origin/destination outside pilot | E6 |
| `WINDOW_INVALID` | 422 | Window in past or > 7 days out | E7 |
| `MANUAL_REVIEW_REQUIRED` | 202 | Restricted category queued | E8; success-with-review, not an error page |
| `RISK_REVIEW_REQUIRED` | 403 | Unresolved fraud flag | E9 |
| `CANCELLATION_LIMIT` | 403 | ≥ 3 cancellations in 30 days | E10 |
| `DESCRIPTION_TOO_VAGUE` | 422 | e.g. "gift", "stuff", "documents" alone | Screened, reason not revealed in detail |

## 5. Trips & matching

| Code | HTTP | Meaning |
|---|---|---|
| `MODE_DISABLED` | 422 | Mode is off by feature flag |
| `VERIFICATION_REQUIRED` | 403 | Traveller not `verified` |
| `TRIP_WINDOW_INVALID` | 422 | Departure/arrival inconsistent or in the past |
| `TRIP_CAPACITY_INVALID` | 422 | Capacity ≤ 0 or > 20 kg |
| `NO_MATCH` | 409 | No eligible trip; **no price is returned** |
| `TRIP_NOT_AVAILABLE` | 409 | Trip full, cancelled or expired |
| `SELF_BOOKING_FORBIDDEN` | 403 | Sender is the trip's traveller |
| `USER_BLOCKED` | 403 | Either party blocked the other |

## 6. Bookings

| Code | HTTP | Meaning | Why it matters |
|---|---|---|---|
| `CAPACITY_UNAVAILABLE` | 409 | Lost the capacity race | Normal, expected; UI must offer alternatives |
| `BOOKING_ALREADY_ACTIVE` | 409 | Parcel already has an active booking | Prevented by partial unique index |
| `QUOTE_EXPIRED` | 409 | 15-minute window passed | Return a fresh quote, never silently re-price |
| `QUOTE_MISMATCH` | 409 | Quote does not belong to this parcel | Tampering or stale client state |
| `INVALID_TRANSITION` | 409 | (from, command) not in the transition table | Client bug or stale UI |
| `TRANSITION_CONFLICT` | 409 | Concurrent update changed state | Retry after refetch |
| `HANDOVER_NOT_ALLOWED_IN_STATE` | 409 | Handover attempted too early/late | |
| `ACCEPT_WINDOW_CLOSED` | 409 | Traveller accepted after `accept_by` | |
| `PARCEL_HAS_ACTIVE_BOOKING` | 409 | Tried to withdraw a booked parcel | |
| `TRIP_HAS_ACCEPTED_BOOKING` | 409 | Tried to cancel a trip with bookings | |

## 7. Handover & OTP

| Code | HTTP | Meaning |
|---|---|---|
| `BOOKING_LOCKED` | 423 | 5 failed OTP attempts; support only |
| `OTP_NOT_APPLICABLE` | 409 | Phase not valid for current state |
| `PHOTO_REQUIRED` | 400 | Evidence photo missing |
| `HANDOVER_REFUSED_OVERWEIGHT` | 409 | Traveller refused: actual weight exceeds declaration |
| `HANDOVER_REFUSED_SEAL` | 409 | Traveller refused: seal compromised |

## 8. Payments

| Code | HTTP | Meaning | Notes |
|---|---|---|---|
| `PAYMENTS_NOT_ENABLED` | 501 | Live payments disabled | Expected production state until GATE-3 |
| `PAYOUTS_NOT_ENABLED` | 501 | Payouts disabled | Expected until gates cleared |
| `PAYMENT_ALREADY_EXISTS` | 409 | Intent already created for booking | Return the existing intent |
| `PAYMENT_NOT_PAYABLE` | 409 | Booking not in a payable state | |
| `PAYMENT_PROVIDER_UNAVAILABLE` | 503 | Provider timeout/5xx | Booking stays `payment_pending`; do not treat as failure |
| `PAYMENT_STATE_UNKNOWN` | 409 | Provider status unknown | Poll; never assume success or failure |
| `REFUND_EXCEEDS_CAPTURED_AMOUNT` | 409 | Refund > captured − prior refunds | |
| `APPROVAL_REQUIRED` | 409 | Maker-checker needed (> ₹1,000) | |
| `SELF_APPROVAL_FORBIDDEN` | 403 | Same user proposed and approved | |
| `PAYOUT_NOT_ELIGIBLE` | 409 | Dispute open, window not elapsed, or suspended | |

## 9. Disputes & reviews

| Code | HTTP | Meaning |
|---|---|---|
| `DISPUTE_WINDOW_CLOSED` | 409 | Past 72 h / 7 days |
| `DISPUTE_ALREADY_OPEN` | 409 | One open dispute per booking |
| `DISPUTE_CLOSED` | 409 | Evidence added to a closed dispute |
| `REVIEW_ALREADY_SUBMITTED` | 409 | Unique per (booking, author) |
| `REVIEW_WINDOW_CLOSED` | 409 | More than 7 days after delivery |

## 10. Files

| Code | HTTP | Meaning |
|---|---|---|
| `UPLOAD_INVALID_TYPE` | 400 | Content type or magic bytes rejected |
| `UPLOAD_TOO_LARGE` | 400 | > 10 MB |
| `UPLOAD_URL_EXPIRED` | 400 | Presigned URL past 5 minutes |
| `UPLOAD_NOT_CONFIRMED` | 400 | Object referenced before upload completed |

## 11. Webhooks

| Code | HTTP | Meaning | Response |
|---|---|---|---|
| `WEBHOOK_SIGNATURE_INVALID` | 401 | HMAC mismatch | Alert; do not process |
| `WEBHOOK_TIMESTAMP_INVALID` | 401 | Outside ±5 min tolerance | Alert; do not process |
| `WEBHOOK_UNKNOWN_TYPE` | 400 | Event type not handled | Log, return 400 |

## 12. Platform

| Code | HTTP | Meaning |
|---|---|---|
| `RATE_LIMITED` | 429 | Generic limiter trip |
| `NOT_FOUND` | 404 | Route or resource absent |
| `METHOD_NOT_ALLOWED` | 405 | Wrong verb |
| `CONFLICT` | 409 | Generic optimistic-concurrency failure |
| `INTERNAL_ERROR` | 500 | Unhandled; `request_id` is the support key |
| `SERVICE_UNAVAILABLE` | 503 | Dependency down |
| `DEPENDENCY_TIMEOUT` | 504 | Upstream timeout |

## 13. Rules for implementers

1. Never return a database constraint name as `code`. Map it (`bookings_one_active_per_parcel` →
   `BOOKING_ALREADY_ACTIVE`).
2. Never include provider error text verbatim — it can contain account identifiers.
3. Never include the submitted value in `message` (it may be PII). Use `details.field` pointers.
4. Every new code needs: row in this table, test assertion, and client copy in English + Hindi.
5. If a code is returned but undocumented, that is a **contract test failure**.

## 14. Coverage note

This catalogue covers the errors referenced by `api/openapi.yaml`. The validator does not check
that every referenced code exists here — that is a documentation review task, tracked in
`validation/VALIDATION_REPORT.md` §5.
