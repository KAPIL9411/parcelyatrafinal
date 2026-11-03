# Test Strategy

**Status:** Draft v0.1 · **Date:** 2026-10-24
**Scope:** the Parcel Yatra application. No testing of third-party systems.

---

## 1. What testing is actually for here

Three failure classes dominate this product:

1. **Money/state corruption under concurrency** — two acceptances, double capture, double payout.
2. **Authorisation mistakes** — one user reading another's booking or ID document.
3. **Trust-destroying UX failures** — a handover that fails in a car with no signal, a receiver who
   cannot complete delivery.

Everything else (visual polish, broad coverage percentages) is secondary at pilot. The pyramid below
is weighted accordingly.

## 2. Test layers

| Layer | Tooling (proposed) | Volume target | Runs on |
|---|---|---|---|
| Unit (domain) | Vitest | ~400 tests, ≥ 85% on `packages/domain` | Every save / PR |
| Integration (API + DB) | Vitest + real Postgres (testcontainers) | ~180 tests | PR |
| Contract | OpenAPI schema assertions | 1 per endpoint (≈ 42) | PR |
| End-to-end | Playwright (web), Maestro/Detox (Android) | ~25 critical journeys | PR (smoke) + nightly (full) |
| Security | custom + OWASP ZAP baseline | see `security/SECURITY_TEST_PLAN.md` | PR + release |
| Performance | k6 | 3 scenarios | Release + weekly |
| Accessibility | axe-core + manual | every screen | PR + release |
| Manual exploratory | human | 2 h per release | Release |

Coverage is a **symptom**, not a goal. A 95% coverage number with no concurrency test is worse than
80% with the right race-condition tests, because it creates false confidence.

## 3. Test data policy

- Fixtures only. **No production data in any test environment, ever.**
- Deterministic seeds with obviously fake identities: `Test Sender A`, `+9190000000NN`,
  `@example.com`.
- Each test creates its own data and does not depend on ordering.
- Time is injectable (`Clock` port) — no `sleep()` in tests to wait for expiry.
- Money fixtures are integers in paise; no float literals anywhere in tests.

## 4. Environment matrix

| Suite | Environment | Payments | Notifications |
|---|---|---|---|
| Unit | local, no I/O | n/a | n/a |
| Integration | ephemeral Postgres container | mock | captured in memory |
| Contract | ephemeral | mock | n/a |
| E2E | staging-like compose | mock | fake provider |
| Load | staging (isolated) | mock | suppressed |
| UAT | staging | mock | sandbox numbers only |

## 5. The ten scenarios that must never regress

These are release-blocking, regardless of what else passes.

| # | Scenario | Why |
|---|---|---|
| 1 | Two travellers accept the last capacity simultaneously | Marketplace integrity |
| 2 | Same webhook delivered twice | Money integrity |
| 3 | Same payment request retried with the same idempotency key | Double-charge prevention |
| 4 | Wrong OTP ×5 → booking locked | Handover integrity |
| 5 | User A requests user B's booking by ID | Privacy |
| 6 | Unverified traveller attempts to accept | KYC enforcement |
| 7 | Cancellation attempted after pickup | Custody/liability |
| 8 | Dispute raised → payout blocked | Financial control |
| 9 | Payment provider timeout → state stays unknown, no retry button | Double-capture prevention |
| 10 | DB restart mid-booking → no partial state | Durability |

Each has an explicit test in `testing/TEST_CASES.md` and, where applicable, a security test in
`testing/SECURITY_TEST_CASES.md`.

## 6. Test-first rules for sensitive code

Write the test **before** the implementation for:

- booking state transitions
- pricing/quote arithmetic
- refund calculation
- OTP issue/verify/consume
- capacity reservation
- payout eligibility
- webhook processing
- any authorisation guard

A PR touching these without a new or updated test is rejected in review, not negotiated.

## 7. Contract testing

- Server response validated against `api/openapi.yaml` on every integration test.
- CI fails if a handler returns an undocumented field (undocumented fields are how PII leaks).
- Breaking-change detection compares the current spec with the last released tag.
- Client types are generated from the spec; a hand-written duplicate type is a review failure.

## 8. What is explicitly not tested at pilot

| Not tested | Reason | Revisit |
|---|---|---|
| Multi-region failover | Single region | Pre-scale |
| 100k concurrent users | Not the pilot problem | Post-PMF |
| iOS app | Not shipping | P1 |
| Third-party penetration test | Cost; internal plan exists | Pre-scale gate |
| Chaos engineering | Overkill for 2 instances | Post-scale |
| Full WCAG audit | Cost | Pre-scale gate |

These are stated so the absence is not mistaken for a pass.

## 9. Defect severity and exit criteria

| Severity | Definition | Blocks release? |
|---|---|---|
| S1 | Data loss, money loss, auth bypass, ID document exposure | **Yes** |
| S2 | Wrong behaviour in a core flow, no workaround | **Yes** |
| S3 | Wrong behaviour with a workaround | No, but must be ticketed with an owner |
| S4 | Copy, cosmetic, minor UX | No |

Release gate: **zero open S1/S2**. Documented, explicitly accepted S3s require a named owner and a
date (`release/GO_NO_GO_CRITERIA.md`).

## 10. Reporting

Every release produces a test report containing:
- commands actually run,
- counts (pass/fail/skip) per layer,
- the ten critical scenarios with pass/fail,
- known failures and accepted risks,
- coverage of `packages/domain`,
- any test that was skipped and why.

**Never** report "all tests pass" without stating what was executed. A suite that failed to start is
not a pass.

## 11. CI pipeline

```
1. lint + typecheck
2. unit tests (parallel)
3. build
4. integration tests (ephemeral DB)
5. contract validation (openapi lint + response assertions)
6. secret scan + dependency audit + SAST
7. accessibility scan on 5 key screens
8. e2e smoke (7 journeys)
9. image build + scan
--- gate: all of the above must pass ---
10. deploy staging
11. e2e full (25 journeys)
12. load smoke (5 min)
13. manual UAT checklist
```

Steps 1–9 are required on every PR. 10–13 run on merge to `main` and before release.

## 12. Ownership

| Area | Owner |
|---|---|
| Domain correctness tests | Backend engineer |
| API/contract | Backend engineer |
| Mobile E2E | Mobile engineer |
| Security tests | Whoever wrote the feature + reviewer |
| UAT | Founder / ops lead |
| Load | Backend engineer |

With a 2–4 person team, everyone owns tests. There is no separate QA department at pilot; the
`testing/UAT_CHECKLIST.md` is executed by the founder, which is itself a control.
