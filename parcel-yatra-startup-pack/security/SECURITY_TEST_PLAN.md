# Security Test Plan

**Status:** Draft v0.1 · **Date:** 2026-10-24
**Scope:** Parcel Yatra systems only. No testing against third parties.

---

## 1. Approach

| Layer | Method | Frequency |
|---|---|---|
| Authorisation | Automated per-endpoint tests | Every PR |
| Business logic | Concurrency + state tests | Every PR |
| API security | Contract + fuzz | Every PR / weekly |
| Web | Manual OWASP-guided checks | Pre-release |
| Mobile | Static + runtime checks | Pre-release |
| Infrastructure | Config review, TLS scan | Monthly |
| External | Independent pen-test | Before scale-up (not pilot) |

## 2. Authorisation test matrix

For each of these resources, test **owner**, **other user**, **suspended user**, **admin**:

`booking`, `parcel`, `trip`, `handover`, `payment`, `payout`, `dispute`, `message`, `verification`, `id_document`

Expected:
- Owner → allowed per role
- Other user → `403` (or `404` if resource existence must be hidden)
- Suspended → `403`
- Admin → allowed only with the specific role, and audited

**A single IDOR pass/fail is a release blocker.**

## 3. Authentication tests

| Case | Expected |
|---|---|
| OTP reused | `OTP_ALREADY_USED` |
| OTP after expiry | `OTP_EXPIRED` |
| 6th wrong attempt | locked + audit |
| OTP for number A submitted for number B | rejected |
| Google token: wrong `aud` | rejected |
| Google token: expired | rejected |
| Google token: unsigned (`alg:none`) | rejected |
| Refresh token replay | session family revoked |
| Token after logout | rejected |
| Session fixation | new session ID on privilege change |

## 4. Input & injection

| Test | Expected |
|---|---|
| SQLi in search/filter params | no error leak, no data change |
| XSS payload in parcel description → admin view | escaped |
| Stored XSS in chat | escaped |
| Path traversal in file key | rejected |
| Oversized JSON body | `413` |
| Unknown properties in POST | `400` |
| Malformed UUID | `400`, no stack trace |
| SSRF attempt via image URL param (if any) | blocked |
| CSV injection in admin export | sanitised |

## 5. Upload tests

| Test | Expected |
|---|---|
| `.exe` renamed `.jpg` | rejected by magic-byte check |
| 20 MB file | rejected |
| Image with GPS EXIF | EXIF stripped |
| Polyglot JPEG+PHP | re-encoded, safe |
| Direct bucket URL access | denied |
| Expired signed URL | denied |
| Upload for another user's verification | denied |

## 6. Payment & webhook

| Test | Expected |
|---|---|
| Client-sent amount differs from quote | server uses quote |
| Forged webhook signature | `401`, alert |
| Replayed valid webhook | `200`, no second effect |
| Webhook with old timestamp | rejected |
| Duplicate payment intent with same key | one intent |
| Provider timeout | state stays pending, no double capture |
| Refund twice | second is no-op |
| Payout while dispute open | blocked |

## 7. Business-logic / race conditions

| Test | Expected |
|---|---|
| 2 concurrent accepts on last capacity | exactly 1 success |
| 2 concurrent bookings same parcel+trip | unique constraint holds |
| Duplicate `POST /bookings` same idempotency key | same booking |
| OTP consumed concurrently | one success |
| Payout release concurrently | one release |
| Cancel during handover | deterministic outcome per state machine, no invalid state |
| Status set directly by client | rejected |

## 8. Privacy checks

| Test | Expected |
|---|---|
| Search response contains phone/address | **fail** |
| Logs contain OTP/token/phone | **fail** |
| Analytics event contains PII | **fail** |
| Error tracker payload contains ID URL | **fail** |
| Data export contains only own data | enforced |
| Deleted account still searchable | **fail** |

## 9. Rate limiting

| Test | Expected |
|---|---|
| 100 OTP requests/min | throttled, no SMS spend explosion |
| 500 search requests/min | throttled |
| 50 uploads/min | throttled |
| Webhook flood | queued, not crash |

## 10. Resilience

| Test | Expected |
|---|---|
| DB connection drop | graceful error, retry, no data corruption |
| Redis/queue down | core booking still works or degrades explicitly |
| Notification provider 500 | booking proceeds |
| Restore from backup | data matches, app starts |
| Deploy rollback | previous version healthy |

## 11. Manual web checks (OWASP-guided)

- Security headers present and correct
- No verbose errors
- No directory listing
- No source maps in production
- No debug endpoints
- Cookie flags
- CSRF on admin forms
- Clickjacking protection
- Mixed content

## 12. Mobile checks

- Token storage location
- Certificate pinning behaviour on MITM (documented proxy test)
- Screenshot restriction on OTP/ID screens
- Deep-link hijacking
- Root detection advisory only
- No secrets in bundle (`strings` scan)

## 13. Reporting

Every finding: ID, severity (Critical/High/Medium/Low), CVSS where useful, reproduction, evidence,
affected component, remediation, retest result. Stored in `validation/VALIDATION_REPORT.md`.

## 14. Exit criteria

- Zero open Critical/High
- All authorisation matrix tests passing
- All race-condition tests passing
- Restore drill passed
- Findings documented with accepted risks signed off explicitly
