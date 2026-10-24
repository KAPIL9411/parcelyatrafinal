# Refund & Cancellation Policy — DRAFT

> ⚠️ **DRAFT — NOT LEGAL ADVICE. NOT FOR PUBLICATION.**
> Must align with the implemented rules in `docs/BUSINESS_LOGIC.md` §6 and be reviewed by counsel.

**Version:** 0.1-draft · **Date:** 2026-10-24

---

## 1. Principles

1. A sender should never lose money because **we** failed to find a match.
2. A traveller should be compensated when a sender cancels at the last minute.
3. No one should be able to profit from cancelling.
4. Every refund has a reason code and an audit record.

## 2. Cancellation by the sender

| When | Refund | Traveller compensation | Notes |
|---|---|---|---|
| Before a traveller accepts | **100%** | None | No payment captured |
| After acceptance, more than 2 hours before the pickup window | **100%** minus payment-provider fee (if charged) | None | Provider fee is pass-through |
| After acceptance, 2 hours or less before the pickup window | **50%** | 50% (or the traveller share, whichever is lower) | Discourages last-minute cancellation |
| After the traveller has picked up | **No in-app cancellation** | n/a | Must go through dispute/incident process |
| Sender no-show at pickup | **0%** | Up to 100% of traveller share | Treated as cancellation at the window close + 6 h |

## 3. Cancellation by the traveller

| When | Refund to sender | Consequence for traveller |
|---|---|---|
| Before pickup | **100%** | Reliability score impact; repeated cancellations trigger review |
| After pickup | Not permitted in-app | **Incident opened**, payout frozen, possible suspension |
| Verified emergency (with evidence) | 100% | No reliability penalty |

## 4. System-driven cancellations

| Cause | Refund |
|---|---|
| No match found / request expired | 100% |
| Parcel found ineligible after booking | 100% |
| Safety block by Parcel Yatra | 100% |
| Route/city disabled | 100% |
| Force majeure (strike, disaster, road closure) | 100% |

## 5. Refund timelines

| Payment method | Expected credit |
|---|---|
| UPI | 1–3 business days after provider confirms |
| Card | 3–7 business days |
| Netbanking | 3–5 business days |

**We do not control bank posting times.** We state the provider-confirmed date, not a promise of when the
money appears.

## 6. Non-refundable items

| Item | Reason |
|---|---|
| Payment-provider fee on a completed booking | Third-party cost already incurred |
| Add-on services once performed | Consumed |
| Bookings cancelled after pickup (goes to dispute) | Custody has transferred |

## 7. Disputes instead of cancellation

After pickup, the correct path is a **dispute**, not a cancellation. Disputes are governed by the
Grievance & Incident Process and can result in:
- full refund,
- partial refund,
- no refund but traveller payout released,
- goodwill credit (platform-funded, capped, logged).

## 8. Compensation cap

Platform-funded goodwill compensation is capped at **₹2,000 per booking** at pilot, requires
maker-checker above ₹1,000, and is never described as insurance.

## 9. How to cancel

In-app: Booking → Cancel → select reason → confirm. Phone support is available for accessibility and for
users who cannot use the app.

## 10. Abuse

Repeated cancellations, refund abuse, or collusive cancellation may result in suspension. We track:
cancellation rate, refund frequency, and matched-pair cancellation patterns.

## 11. Grievances

If you disagree with a refund decision: contact the Grievance Officer within 30 days. Details in
`legal/GRIEVANCE_AND_INCIDENT_PROCESS.md`.

## 12. Legal review points

- [ ] Are the 50% and 0% tiers enforceable as "unfair terms" under consumer law?
- [ ] Must we disclose the payment-provider fee deduction explicitly at checkout?
- [ ] Does a "no cancellation after pickup" clause conflict with any consumer right to reject a
      deficient service?
- [ ] Is the ₹2,000 goodwill cap consistent with the liability clause in the Terms?
