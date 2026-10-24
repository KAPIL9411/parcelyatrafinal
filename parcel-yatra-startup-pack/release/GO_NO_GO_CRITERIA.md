# Go / No-Go Criteria

**Status:** Draft v0.1 · **Date:** 2026-10-24
A decision document, not a wish list. Every criterion has an objective test and a named decider.

---

## 1. The decision being made

There are **four different launches**, and conflating them is how startups end up taking real money
before they are allowed to.

| Launch | Audience | Money | Criteria section |
|---|---|---|---|
| **L0 — Internal** | Founders, engineers | None (mock) | §3 |
| **L1 — Closed pilot** | 20–50 invited users, 2 corridors | Sandbox only | §4 |
| **L2 — Open pilot** | Public in Bareilly, 2 corridors | Sandbox only | §5 |
| **L3 — Commercial** | Public, real payments, real payouts | **Real** | §6 |

**Default position: L1.** Everything above L1 requires a gate that is not in engineering's control.

Current status of this pack: **not launched at any level.** No criterion below has been verified
against a running system, because no system has been built yet. That is the honest starting state.

---

## 2. Deciders

| Role | Decides | Cannot decide alone |
|---|---|---|
| Founder / CEO | L2, L3, business risk acceptance | L3 payments without legal sign-off |
| Engineering lead | L0, L1 technical readiness | Any legal gate |
| Legal counsel (external) | Terms, privacy, payment model, transport position | Product scope |
| Finance / ops lead | Payout process, reconciliation | Payment legality |
| Security reviewer | Security sign-off | Business risk |

A single person may hold several roles at a 3-person startup. The **signature** still has to be
distinct for L3: the person who built the payment flow cannot be the only person who approves it.

---

## 3. L0 — Internal launch criteria

All must pass. None is negotiable.

| # | Criterion | Test | Status |
|---|---|---|---|
| I-1 | The app builds and deploys reproducibly | CI builds from a clean checkout | ☐ |
| I-2 | The ten critical scenarios pass | `testing/TEST_CASES.md` §1 output attached | ☐ |
| I-3 | `api/openapi.yaml` validates | `npx @redocly/cli lint` — see `validation/VALIDATION_REPORT.md` | ☐ |
| I-4 | Migrations run cleanly from empty and from the previous version | Two test runs | ☐ |
| I-5 | Mock payment flow completes end-to-end | Synthetic journey | ☐ |
| I-6 | No secret in the repo or bundle | gitleaks + bundle scan | ☐ |
| I-7 | Someone can be reached if it breaks | Named on-call | ☐ |
| I-8 | Data is obviously synthetic | Fixtures only, no real phone numbers | ☐ |

**L0 is engineering's call.** It exists so that demos are not done on a laptop.

---

## 4. L1 — Closed pilot criteria

The realistic near-term target. Real users, real parcels, **no real money**.

### 4.1 Product

| # | Criterion | Test | Owner |
|---|---|---|---|
| C-1 | A new sender can complete a booking without help | 5 observed sessions, ≥ 4 succeed unaided | Founder |
| C-2 | A new traveller can complete verification and publish in one sitting | 3 observed sessions | Founder |
| C-3 | Handover works with no signal, and never fakes success | Airplane-mode test | Eng |
| C-4 | Receiver can complete delivery with no app installed | Feature-phone test | Eng |
| C-5 | Every screen has all nine states implemented | `testing/UAT_CHECKLIST.md` | Eng |
| C-6 | Hindi parity on every screen | Copy lint + manual read | Design |
| C-7 | No invented number or claim anywhere | Trust audit §18 of UAT | Founder |

### 4.2 Safety

| # | Criterion | Test | Owner |
|---|---|---|---|
| C-8 | Traveller verification is manual and reviewed by a human | Queue operated, not simulated | Ops |
| C-9 | OTP is hashed at rest, single-use, attempt-limited | `SEC-OTP-02`, `SEC-OTP-05` | Eng |
| C-10 | No continuous location tracking exists in the codebase | Code review + no location permission requested | Eng |
| C-11 | Prohibited categories are blocked server-side, not just hidden in UI | `API-PAR-05` | Eng |
| C-12 | A lost-parcel drill has been walked through with a real script | Tabletop, 60 min, written outcome | Ops |
| C-13 | Every parcel in the pilot is worth ≤ ₹5,000 and the sender is told it is uninsured | Copy + declaration | Founder |

### 4.3 Legal

| # | Criterion | Test | Owner |
|---|---|---|---|
| C-14 | Terms and Privacy reviewed by an Indian lawyer | Signed opinion on file | Legal |
| C-15 | Grievance officer named and reachable | Published contact answers | Legal |
| C-16 | Transport position for private-car goods carriage documented | Written note from counsel | Legal |
| C-17 | No payment is collected from users in any form | `PAYMENTS_LIVE=false`, no UPI ID, no cash | Eng + Founder |
| C-18 | DPDP notice and consent capture in place | Consent records inspectable | Eng |

### 4.4 Operations

| # | Criterion | Test | Owner |
|---|---|---|---|
| C-19 | Support phone answered during published hours | 3 test calls | Ops |
| C-20 | A stuck booking is findable in admin in < 60 s | Timed drill | Ops |
| C-21 | Dispute SLA is written and staffed for 14 days | Rota exists | Ops |
| C-22 | Reconciliation job runs daily and reports zero unexplained mismatches | Run log | Eng |
| C-23 | Kill switch: payments, matching and the whole app can be disabled without a deploy | Flag flip in staging | Eng |

### 4.5 Security

| # | Criterion | Test | Owner |
|---|---|---|---|
| C-24 | Zero Critical / High findings open | `testing/SECURITY_TEST_CASES.md` report | Eng |
| C-25 | IDOR sweep returns `404` on every resource | `SEC-AUTHZ-01` | Eng |
| C-26 | No PII in logs, errors or push payloads | `SEC-PRV-01`…`05` | Eng |
| C-27 | Admin console on a separate origin with MFA | Manual | Eng |

**L1 decision:** founder + engineering lead. If C-14, C-16, C-17 or C-24 fails, L1 does not happen —
these are not "accept as risk" items at this stage.

---

## 5. L2 — Open pilot criteria

Everything in L1, plus:

| # | Criterion | Test | Why it blocks |
|---|---|---|---|
| O-1 | 50 closed-pilot bookings completed with ≤ 5% failure rate | Actual data | Proves the flow works beyond demos |
| O-2 | Zero unresolved safety incidents | Incident log | A single unresolved incident makes growth irresponsible |
| O-3 | Support response within the published window for 14 consecutive days | Ticket timestamps | Promising a window you miss is worse than a longer window |
| O-4 | Public legal pages live and reviewed (not drafts) | URL check + sign-off | Cannot invite the public under draft terms |
| O-5 | Independent penetration test completed, High findings fixed | External report | Self-testing has a ceiling |
| O-6 | Load test at 3× current peak passed | `testing/LOAD_TEST_PLAN.md` | Growth should not be the thing that breaks it |
| O-7 | Grievance officer response process exercised at least once | Case record | The statutory clock starts on day one |
| O-8 | Unit economics show a defensible contribution margin **or** a funded plan to reach it | Model with real pilot costs | Scaling a loss with no plan is not a strategy |
| O-9 | Insurance position resolved: either cover exists or the copy is unambiguous everywhere | Legal + copy audit | This is the single largest trust risk |

**L2 decision:** founder, with legal sign-off on O-4 and O-9.

---

## 6. L3 — Commercial launch (real money)

The hardest gate. **Every item below must be closed in writing.**

| # | Criterion | Evidence required |
|---|---|---|
| M-1 | Payment provider confirms the fund-flow model is permitted | Written confirmation naming our model (A/B/C in `legal/PAYMENTS_TAX_AND_SETTLEMENT.md`) |
| M-2 | Legal counsel confirms no payment-aggregator licence is required, or the licence is obtained | Written opinion |
| M-3 | GST treatment confirmed and invoicing implemented | CA opinion + invoice sample |
| M-4 | Payout/KYC process compliant for travellers receiving money | Written process + provider confirmation |
| M-5 | Refund mechanics tested with real money in a controlled amount | Reconciliation evidence |
| M-6 | Reconciliation proven over 30 days of sandbox with zero unexplained breaks | Reports |
| M-7 | Chargeback/dispute process agreed with the provider | Contract clause |
| M-8 | Insurance either in force or permanently excluded from all copy | Policy document or signed copy audit |
| M-9 | Breach notification runbook signed off; DPDP obligations mapped to dates | Legal memo |
| M-10 | Two-person approval enforced for refunds and payouts in production | Access review + test |
| M-11 | Finance has a named owner for daily reconciliation | Appointment |
| M-12 | A rollback that stops money movement exists and was rehearsed | Drill record |

**M-1 and M-2 are the two that most often kill this business model.** They are not paperwork to be
done after launch; taking customer money before they are settled is the risk this entire document
exists to prevent.

**L3 decision:** founder **and** external counsel **and** finance owner. Three signatures, one of whom
did not write the code.

---

## 7. Automatic no-go conditions

Regardless of how many other criteria pass, these stop the launch:

1. Any open S1 defect.
2. Any known auth bypass or cross-user data access.
3. `PAYMENTS_LIVE=true` without M-1 and M-2 in writing.
4. A UI claim of insurance, guarantee or escrow without the corresponding document.
5. A bus/train/air mode visible anywhere without written clearance.
6. Storing Aadhaar numbers.
7. Continuous location tracking enabled.
8. Draft legal pages published as final.
9. No named on-call person.
10. An untested rollback.

## 8. Acceptable-risk register (things we may choose to accept at L1)

These are permitted to be imperfect at closed pilot, with a named owner and a revisit date. They are
**not** permitted at L3.

| Risk | Why acceptable at L1 | Revisit |
|---|---|---|
| No external pentest | Small invited user base, no real money | Before L2 |
| No WCAG audit | Best-effort AA implemented, not certified | Before L2 |
| No iOS app | Receiver uses web | Post-pilot |
| Single region, no DR | Hours of downtime acceptable at 50 users | Before L2 |
| Manual verification queue | Actually desirable at this scale (human judgement) | Volume > 100/day |
| No fraud ML | Rules + human review | Volume > 500 bookings/day |
| No insurance | Copy is explicit and limits are low | Before L3, hard blocker |
| Dark mode absent | Cosmetic | Post-pilot |

Anything not on this list that fails is a **no-go**, not a "we'll see".

## 9. Decision record template

```
Launch level being decided:   L0 / L1 / L2 / L3
Date:
Build / commit:
Environment:

Criteria passed:              ___ / ___
Criteria failed:              ___  (list with reason)
Automatic no-go triggered:    yes / no  (if yes: no-go, stop)

Accepted risks (L1 only):
  1. _______________________  Owner: ______  Revisit: ______

DECISION:  GO / NO-GO / GO WITH CONDITIONS

Conditions (if any):
  1. _______________________  Due: ______

Signatures:
  Founder:            ____________________
  Engineering lead:   ____________________
  Legal counsel:      ____________________  (required for L2+)
  Finance:            ____________________  (required for L3)
```

## 10. The sentence to keep in mind

> A launch is not a reward for effort. It is a claim that we can carry someone's document across a
> state and be trusted with it. If we cannot make that claim honestly today, the correct decision is
> a smaller launch, not a louder one.
