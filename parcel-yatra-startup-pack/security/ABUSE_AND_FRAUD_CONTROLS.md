# Abuse & Fraud Controls

**Status:** Draft v0.1 · **Date:** 2026-10-24
Principle: **controls must be explainable to a user and to an investigator.** No black-box scoring at pilot.

---

## 1. Fraud taxonomy and controls

| ID | Abuse | Signal | Control | Response |
|---|---|---|---|---|
| F-01 | Fake traveller identity | ID mismatch, stolen photos, low liveness score | Liveness + ID–selfie match + payout name match + manual review | Reject; ban on repeat |
| F-02 | Account takeover | New device + immediate payout change | Step-up verification, 24 h payout lock after account change, alert | Freeze payouts, contact user |
| F-03 | OTP brute force | Many failed attempts across bookings | Attempt limits, lock booking, IP/device throttle | Lock + investigate |
| F-04 | OTP interception / SIM swap | OTP requested then number ported | Short TTL, anomaly detection, optional authenticator for high-trust users | Require re-verification |
| F-05 | Sender/traveller collusion | Same device, same IP, repeated pair, no real movement | Pair-repeat block after 2 mutual cancels; device graph; volume caps | Manual review, payout hold |
| F-06 | Fake delivery | Delivery OTP entered immediately after pickup; impossible travel time | Minimum plausible transit time; anomaly flag | Hold payout, investigate |
| F-07 | False loss/damage claim | Claim shortly after delivery; no photos; repeat claimant | Evidence requirements, claim history, photos mandatory | Investigate; limit goodwill |
| F-08 | Prohibited goods | Category/description mismatch; weight anomaly; X-ray-free screening gaps | Declaration, review, traveller refusal right, random checks | Cancel, ban, police if illegal |
| F-09 | Payment manipulation | Amount mismatch; replayed webhook; altered client payload | Server-side amount, signature verification, idempotency | Reject, alert |
| F-10 | Refund abuse | Refund to different instrument; repeated refunds | Refund to original instrument only; velocity limits | Block refunds, review |
| F-11 | Duplicate booking | Rapid repeated submits | Idempotency keys, dedupe window | Return original |
| F-12 | Data harvesting | Many searches, many booking requests without completing | Quotas, verified-sender requirement, anomaly detection | Throttle, suspend |
| F-13 | Harassment / stalking | Messages after cancellation; repeated calls | Chat disabled after terminal state; report button; number masking | Suspend, preserve evidence |
| F-14 | Fake reviews | Review rings, same-device clusters | Only completed bookings can rate; one rating per booking | Remove, flag |
| F-15 | Referral/promo abuse (future) | Same device/payment instrument | Device + instrument binding, caps | Claw back |
| F-16 | Insider abuse | Admin viewing IDs without reason; unusual refunds | Access logging, reason codes, maker-checker, monthly audit sample | Discipline, revoke access |

## 2. Risk tiers

| Tier | Criteria | Friction applied |
|---|---|---|
| T0 Trusted | ≥ 5 completed, no incidents, verified | Normal flow |
| T1 Standard | New verified user | Normal flow, extra monitoring |
| T2 Elevated | 1 incident or 2 cancellations in 30 d | Manual review of next booking |
| T3 High risk | Fraud flag, chargeback, prohibited item | Blocked from new bookings; payout held |

Tier changes are **auditable** and reversible by `trust_safety`.

## 3. Velocity limits (pilot)

| Action | Limit |
|---|---|
| Parcels posted | 5/day, 20/week per sender |
| Bookings accepted | 4/day per traveller |
| Parcels per traveller per month | 4 |
| Cancellations | 3/30 d before review |
| OTP requests | see `security/SECURITY_REQUIREMENTS.md` SR-A3 |
| Messages | 60/hour per booking |
| Payout account changes | 1 per 30 days, with step-up |

## 4. Device & identity signals

Collected (minimally, with notice): device ID (app-scoped), IP, user agent, install ID.
**Not collected:** contacts, SMS, photos library, precise background location, advertising ID.

Signals used for review (not automatic bans):
- multiple accounts per device;
- same device on both sides of a booking;
- payout account shared across unrelated users;
- rapid account creation from one IP;
- phone number recently recycled (provider signal if available).

## 5. Investigation workflow

```
Flag created → T2 triage (24 h) → evidence collection → decision
  → clear | warn | limit | suspend | ban | report to police
```
Every decision records: flag ID, evidence, reviewer, reason code, duration, appeal path.

## 6. User-facing fairness

- A user is told *that* they are under review, and *what* they can do (usually: contact support).
- We do not reveal detection thresholds.
- A user can appeal within 7 days.
- Suspension never silently deletes history.

## 7. Metrics

| Metric | Target |
|---|---|
| Fraud loss as % of GMV | < 1% |
| False-positive suspension rate | < 2% of suspensions |
| Median flag triage time | < 24 h |
| Repeat-offender rate | < 10% |
| Chargeback rate | < 0.5% |

## 8. What we deliberately do not build at pilot

- ML risk scoring (no data, unexplainable).
- Behavioural biometrics.
- Contact-graph analysis (privacy-invasive).
- Automated permanent bans without human review.
