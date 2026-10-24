# Traceability Matrix

**Status:** Draft v0.1 · **Date:** 2026-10-24

Maps requirement → test → screen → legal gate. Built to answer one question during review: *if this
fails in production, which document said it should work?*

---

## 1. How to read this

| Column | Meaning |
|---|---|
| **FR** | Requirement ID from `docs/PRD.md` |
| **Test** | Primary test ID from `testing/TEST_CASES.md` or `testing/API_TESTS.md` |
| **Screen** | Surface from `ux/SCREEN_SPECIFICATIONS.md` |
| **Gate** | Legal gate from `legal/LEGAL_REGULATORY_MATRIX.md` §8, if any |

A requirement with no test is **unverified**. A requirement with no screen is **invisible**. Both are
defects in the pack, not in the product.

---

## 2. Authentication and identity

| FR | Requirement | Test | Screen | Gate |
|---|---|---|---|---|
| FR-101 | Phone OTP sign-in | `TC-AUTH-01`…`07`, `API-AUTH-01`…`08` | 2.1, 2.2 | — |
| FR-102 | Session management with refresh rotation | `TC-AUTH-11`, `TC-AUTH-12`, `API-AUTH-09`…`11` | 2.2 | — |
| FR-103 | Traveller identity verification | `TC-VER-01`…`09` | 3 | GATE-7 |
| FR-104 | Google sign-in (optional) | `TC-AUTH-08`…`10` | 2.3 | — |
| FR-105 | Aadhaar is not accepted | `TC-VER-07`, `SEC-PRV-10` | 3 (step 1) | GATE-7 |
| FR-106 | Profile management with field allowlist | `API-ME-01`…`04` | 17 | — |
| FR-107 | Data export and account deletion | `API-ME-05`…`09` | 17 | GATE-7 |

## 3. Parcels and eligibility

| FR | Requirement | Test | Screen | Gate |
|---|---|---|---|---|
| FR-201 | Parcel creation | `TC-PAR-01`, `API-PAR-01` | 4.1 | — |
| FR-202 | Description specificity check | `TC-PAR-07` | 4.1 | — |
| FR-203 | Prohibited/restricted category enforcement | `TC-PAR-05`, `TC-PAR-06`, `API-PAR-05`, `API-PAR-06` | 4.1 | GATE-4 |
| FR-204 | Weight, dimension and value caps | `TC-PAR-02`…`04`, `API-PAR-02`…`04` | 4.1 | — |
| FR-205 | Route and delivery window | `TC-PAR-08`, `TC-PAR-09` | 4.2 | — |
| FR-206 | Sealed-parcel photo requirement | `TC-HO-04`, `API-PAR-07` | 4.1 | — |
| FR-207 | Declaration acceptance | `API-PAR-07` | 4.1 | GATE-2 |
| FR-208 | Parcel withdrawal | `API-PAR-10` | 4 | — |

## 4. Trips and capacity

| FR | Requirement | Test | Screen | Gate |
|---|---|---|---|---|
| FR-301 | Trip publication with capacity | `TC-TRIP-01`, `TC-TRIP-03` | 5 | GATE-4 |
| FR-302 | Trip detail hides personal data | `TC-TRIP-04`, `TC-MAT-07` | 7 | GATE-7 |
| FR-303 | Mode feature flags (car only at pilot) | `TC-TRIP-02`, `API-TRP-03`, `API-TRP-04` | 5 | GATE-4 |
| FR-304 | Trip cancellation rules | `API-TRP-08` | 5 | — |
| FR-305 | Capacity accounting | `TC-CRIT-01`, `API-BK-06` | 5 | — |
| FR-306 | Trip expiry | `TC-BK-06` | 5 | — |

## 5. Matching and pricing

| FR | Requirement | Test | Screen | Gate |
|---|---|---|---|---|
| FR-401 | Candidate trip selection | `TC-MAT-01`…`04`, `API-PAR-13` | 7 | — |
| FR-402 | Ranking with closed-set reason codes | `TC-MAT-01` | 7 | — |
| FR-403 | Quote creation, server-computed only | `API-PAR-11`, `API-PAY-02` | 6 | — |
| FR-404 | Quote expiry and re-consent | `TC-BK-02`, `API-BK-05` | 6 | — |
| FR-405 | No price without a match | `TC-MAT-08`, `API-PAR-11` | 6, 7 | — |
| FR-406 | Itemised breakdown with traveller share | `TC-PAY-01` | 6 | GATE-2 |
| FR-407 | No client-writable state fields | `TC-BK-07`, `API-BK-07` | all | — |

## 6. Booking lifecycle

| FR | Requirement | Test | Screen | Gate |
|---|---|---|---|---|
| FR-501 | Booking request with 30-min clock | `TC-BK-01`, `TC-BK-06` | 8 | — |
| FR-502 | Capacity reservation atomically | `TC-CRIT-01`, `TC-CRIT-10` | 8 | — |
| FR-503 | Handover OTP issue and regeneration | `TC-HO-03`, `TC-HO-10`, `API-HO-04` | 10, 11 | — |
| FR-504 | OTP verification, consumption, lockout | `TC-CRIT-04`, `TC-HO-01`…`06` | 11, 12 | — |
| FR-505 | Support-assisted handover | `TC-HO-09` | 20 | GATE-6 |
| FR-506 | Evidence photos at both handovers | `TC-HO-01`, `TC-HO-07` | 11, 12 | GATE-7 |
| FR-507 | Cancellation with exact refund shown | `TC-BK-12`…`15` | 14 | GATE-2 |
| FR-508 | Dispute window starts at delivery | `TC-DIS-01`, `TC-DIS-02` | 15 | GATE-2 |

## 7. Payments

| FR | Requirement | Test | Screen | Gate |
|---|---|---|---|---|
| FR-601 | No client-supplied amounts | `TC-PAY-02`, `API-PAY-02` | 9 | **GATE-3** |
| FR-602 | Sandbox-only payment intents | `TC-PAY-01`, `TC-PAY-03` | 9 | **GATE-3** |
| FR-603 | Idempotent payment operations | `TC-PAY-04`, `TC-CRIT-03` | 9 | **GATE-3** |
| FR-604 | Unknown payment state is surfaced honestly | `TC-PAY-05`, `TC-CRIT-09` | 9 | **GATE-3** |
| FR-605 | Refund limits and maker-checker | `TC-PAY-06`, `TC-PAY-07` | 21 | **GATE-1** |
| FR-606 | Append-only ledger | `TC-PAY-08`, `SEC-WH-10` | — | **GATE-1** |
| FR-607 | Payout eligibility gating | `TC-PAY-09`, `TC-PAY-10`, `TC-CRIT-08` | 21 | **GATE-3** |
| FR-608 | Webhook signature and replay protection | `API-WH-01`…`12`, `SEC-WH-01`…`05` | — | **GATE-3** |

## 8. Disputes, reviews, admin

| FR | Requirement | Test | Screen | Gate |
|---|---|---|---|---|
| FR-701 | Dispute raising with window enforcement | `TC-DIS-01`…`04` | 15 | GATE-2 |
| FR-702 | Payout freeze on dispute | `TC-CRIT-08` | 15, 21 | **GATE-3** |
| FR-703 | Evidence submission | `API-DIS-05` | 15 | GATE-7 |
| FR-704 | Ratings after delivery | `TC-REV-01`…`03` | 16 | — |
| FR-705 | Appeal path | `TC-DIS-05`, `TC-DIS-06` | 15 | GATE-2 |
| FR-801 | Verification queue with audit | `TC-VER-05`, `TC-VER-06`, `SEC-LOG-01` | 19 | GATE-7 |
| FR-802 | Booking search by phone hash | `API-ME-01` (no raw phone) | 20 | GATE-7 |
| FR-803 | Role separation for ID documents | `TC-VER-05`, `SEC-AUTHZ-07` | 19 | GATE-7 |
| FR-804 | Dual approval above ₹1,000 | `TC-PAY-07`, `API-PAY-08` | 21 | **GATE-1** |
| FR-805 | Immutable audit log | `SEC-LOG-02` | 21 | GATE-2 |
| FR-806 | Reconciliation with payout block | `TC-PAY-11` | 21 | **GATE-3** |

## 9. Cross-cutting requirements

| Requirement | Test | Where enforced |
|---|---|---|
| No PII in logs | `SEC-PRV-03`, `API-AUTH-13` (log scan) | `security/SECURITY_REQUIREMENTS.md` |
| No full phone number in any response | `TC-MAT-07`, `SEC-PRV-01` | API projections |
| Resource non-disclosure returns `404` | `TC-CRIT-05`, `SEC-AUTHZ-01` | Every handler |
| Money is integer paise | `docs/BUSINESS_LOGIC.md` §4 | DB types + schema validation |
| Every state change is an event | `TC-BK-11` | `booking_events` |
| All nine UI states per screen | `testing/UAT_CHECKLIST.md` | Every screen |
| Hindi parity | `TC-COPY-02` | String catalogue |
| No insurance/escrow/guarantee copy | `TC-COPY-01` | Copy lint in CI |
| Kill switch on every mutating capability | `release/ROLLBACK_AND_RECOVERY.md` §3.2 | Feature flags |

---

## 10. Coverage gaps found while building this matrix

Recorded honestly rather than papered over. Each is a real gap in the pack as written.

| # | Gap | Severity | Note |
|---|---|---|---|
| G-1 | FR-505 (support-assisted handover) has only one test and no dedicated screen spec | Medium | The screen spec covers admin booking operations generally; a specific assisted-handover screen is not designed. Support would improvise, which is exactly what this pack tries to prevent. |
| G-2 | FR-608 webhook tests exist but there is no test for *provider key rotation overlap* | Low | Rotation is described in `api/WEBHOOK_CONTRACTS.md` §10 but not tested. |
| G-3 | Notification delivery failure has one test (`TC-NOT-01`) but no test for *duplicate suppression across retries* at the provider boundary | Medium | `TC-NOT-03` covers our side, not the provider's. |
| G-4 | No test asserts that a *suspended* traveller with an existing confirmed booking is handled correctly mid-trip | High | This is a real scenario: suspension during transit. The state machine does not define it. |
| G-5 | No requirement or test for *receiver refusing delivery* once the traveller is present | High | `receiver_unavailable` exists, but an explicit refusal by a present receiver is not modelled. |
| G-6 | Data export (FR-107) has an API test but no test of *content completeness* | Medium | We test that it is queued, not that it contains everything the user is entitled to. |
| G-7 | No test for the *kill switch itself* failing (flag read error) | Medium | A kill switch that fails open is not a kill switch. |
| G-8 | Admin audit-log *hash chain verification* is specified in UX but has no test | Low | `SEC-LOG-02` covers tamper resistance at the DB level, not the verification UI. |

**G-4 and G-5 are the two that should be closed before the pilot.** Both are scenarios that will
occur in the real world within 20 parcels, and neither currently has a defined behaviour.

---

## 11. Reverse trace: tests with no requirement

The following tests exist without a corresponding FR. They are legitimate (security, resilience,
copy-lint) but should be acknowledged so the matrix is complete:

| Test group | Justification |
|---|---|
| `TC-CRIT-01`…`10` | Cross-cutting invariants, not feature requirements |
| `SEC-*` | Derive from `security/THREAT_MODEL.md`, not from the PRD |
| `TC-RES-*` | Resilience, derives from `release/ROLLBACK_AND_RECOVERY.md` |
| `TC-COPY-*` | Content safety, derives from `ux/CONTENT_AND_MICROCOPY.md` §11 |
| `TC-OFF-*` | Offline behaviour, derives from `ux/RESPONSIVE_BEHAVIOUR.md` §11 |
| `TC-FIL-*` | File handling, derives from `security/SECURITY_REQUIREMENTS.md` |

## 12. Maintenance

This matrix is regenerated when:

- a new FR is approved,
- a test is added or retired,
- a gate changes state,
- a screen is added.

It is checked during `release/RELEASE_CHECKLIST.md` §2 (the line "the ten critical scenarios pass" is
insufficient — the matrix must also have no unexplained blanks).

**Current state:** 8 gaps recorded, 2 of them High. The pack does not claim full traceability; it
claims a traceability method plus a known-gap register.
