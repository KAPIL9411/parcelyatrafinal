# Market Validation Plan

**Date:** 2026-10-24 · **Status:** Not yet executed
This document defines *how* we will validate. It contains **no validated market facts**.

---

## 1. What must be true for this business to work

| # | Must be true | Current evidence | Test |
|---|---|---|---|
| M1 | Enough travellers traverse Bareilly→Delhi with spare capacity | None collected | Trip logging + 20 interviews |
| M2 | They will carry a stranger's parcel for ₹150–₹400 | None | Interviews + pilot acceptance |
| M3 | Senders have urgent small-parcel needs weekly | None | 15 interviews + demand diary |
| M4 | Senders will pay more than bus-parcel price for proof | None | Price-choice experiment |
| M5 | Incidents stay below 2% with screening + OTP | None | Pilot |
| M6 | Match rate ≥ 60% on one corridor | None | Pilot |
| M7 | Contribution margin > 0 at realistic volume | Modelled only (HYPOTHESIS) | Pilot P&L |

## 2. Why no TAM/SAM/SOM number appears here

A credible TAM for "Tier-2 inter-city small parcels carried by peer travellers" would require:
corridor-level parcel volumes (unavailable), traveller frequency data (unavailable), and a defensible
conversion rate (unknown).

Multiplying India's courier market size by an invented percentage would produce a number that looks
authoritative and means nothing. **We refuse to do that.**

Instead:

| Layer | What we will measure | Source |
|---|---|---|
| TAM proxy | Daily inter-city trips Bareilly→Delhi by car (road) | Manual count at toll/bus stand + RTO data request |
| SAM proxy | Trips with spare capacity willing to carry | Interview-derived % × TAM proxy |
| SOM | Actual matched bookings in pilot | Our own data |

Until those three exist, any market-size figure in an investor deck must be labelled
**"illustrative, unsourced"** or omitted.

## 3. Research instruments

| Instrument | Target n | Duration | Output |
|---|---|---|---|
| Traveller interviews | 20 | 20 min | Rejection triggers, price floor |
| Sender interviews (business) | 15 | 25 min | WTP, current alternative, SLA needs |
| Sender interviews (individual) | 10 | 15 min | Trust objections |
| Bus-counter price survey | 5 counters | 1 day | Real price + timing baseline |
| Toll/travel count | 2 days (weekday + weekend) | 4 h each | Trips/hour by vehicle type |
| Concierge pilot | 20 bookings | 2 weeks | End-to-end feasibility without app |
| Closed app pilot | 300 bookings | 8–10 weeks | All KPIs |

Templates: `templates/USER_RESEARCH_NOTES_TEMPLATE.md` covers interview notes. Dedicated survey
instruments (sender and traveller written questionnaires) are **not yet written** — the interview
approach is preferred at pilot because a survey of 20 people produces numbers that look like evidence
and are not.

## 4. Interview design rules

1. Ask about **last time**, not hypotheticals ("When did you last send something to Delhi? Walk me
   through it.").
2. Never pitch the product before minute 15.
3. Record exact price numbers the person says, not rounded impressions.
4. Separate what they *say* from what they *did*.
5. Capture objections verbatim; they become microcopy and FAQ.
6. No incentives that bias price answers (pay for time, not for opinions).

## 5. Price research method

**Van Westendorp-lite** for senders (too-expensive / too-cheap / expensive-but-acceptable / bargain) plus
a forced choice against the *measured* bus-parcel price.

For travellers: a descending-price accept/reject ladder (₹400 → ₹300 → ₹200 → ₹150 → ₹100) on their
actual next trip, with a real parcel described.

## 6. Route validation framework

A corridor is scored weekly on:

| Factor | Data source | Minimum for `VIABLE` |
|---|---|---|
| Actual travel frequency | trip posts + manual count | ≥ 15 trips/week observed |
| Eligible traveller supply | verified travellers with matching trips | ≥ 10/week |
| Sender demand | parcels posted | ≥ 25/week |
| Parcel suitability | % within 5 kg / ₹5,000 / allowed categories | ≥ 70% |
| Expected match rate | bookings / posts | ≥ 60% |
| Delivery-time fit | on-time % | ≥ 90% |
| Contribution margin | ledger | > ₹0 |
| Incident rate | incidents / completed | < 2% |
| Cancellation rate | traveller cancels / confirmed | < 8% |

**No corridor is declared viable before 30 completed bookings.** A corridor failing two consecutive
weeks is paused, not "given more time".

## 7. Sample-size reality check

With 30 bookings, a 2% incident rate cannot be distinguished from 0% or 8% statistically. Therefore:
- Incident rate is treated as a **safety gate** (any serious incident stops the corridor), not as a
  precise metric.
- Match rate and on-time are treated as **directional** until ~100 bookings.
- We will report confidence intervals, not just point estimates, in `validation/VALIDATION_REPORT.md`.

## 8. Disconfirming evidence to actively seek

We will ask questions designed to kill the idea:

- "Why wouldn't you just use the bus parcel counter?"
- "What would make you refuse to carry a parcel?" (travellers)
- "Would you send a ₹4,000 item this way?" (probably no — and that bounds the market)
- "What if the traveller is delayed by 6 hours?"
- "Would you do this if Parcel Yatra took 30% commission?"

## 9. Ethical research constraints

- No recording without consent.
- No collection of ID documents during research.
- No fake bookings to measure supply.
- Interviews stored without unnecessary PII; consent recorded.
- Participants may withdraw and have notes deleted.

## 10. Deliverables from validation

`validation/VALIDATION_REPORT.md` (actual results), updated `docs/DECISIONS_AND_ASSUMPTIONS.md`,
updated pricing model, and a go/no-go recommendation.
