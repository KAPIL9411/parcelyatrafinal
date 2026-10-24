# Product Vision — Parcel Yatra

**Status:** Draft v0.1 · **Owner:** Founding team · **Last updated:** 2026-10-24

---

## 1. One-line vision

> Parcel Yatra turns journeys people are already taking into a trusted, transparent way to move
> everyday parcels between Indian cities.

## 2. The problem we believe exists

Inter-city movement of a small, time-sensitive item in India is a bad experience at both ends of the
market:

| Sender need | What exists today | Observed friction |
|---|---|---|
| Send documents urgently (Bareilly → Delhi) | Bus courier, private travel agency parcel, or a relative | No tracking, no proof of handover, informal pricing, no recourse |
| Send a shop sample / spare part same-day | On-demand truck/two-wheeler platforms | Priced and designed for **intra-city** movement, not inter-city |
| Send something with a known person | Ask a friend travelling that way | Works only if you know someone; no trust, no payment, no insurance |
| Send low-value but urgent item cheaply | National courier | 24–72h, hub routing, not same-day |

Meanwhile, a large volume of vehicle and train capacity moves between Indian cities with empty
space. **HYPOTHESIS H-01:** a meaningful share of inter-city travellers on dense corridors would
carry a small, sealed, inspected parcel for a modest fee if the risk and effort were low and the
platform handled trust and payment.

## 3. What Parcel Yatra is

A **marketplace**, not a courier. Parcel Yatra:

- lets a **sender** declare an eligible parcel with origin, destination, size, value and time window;
- lets a **traveller** publish an already-planned inter-city trip (route, date, capacity);
- **matches** the two, with the traveller naming a price or accepting an indicative quote;
- provides **identity verification, prohibited-goods screening, OTP handover, dispute handling and
  controlled payment settlement**;
- **does not** own vehicles, employ travellers as couriers, or perform carriage itself.

## 4. What Parcel Yatra is not (vision-level boundaries)

- Not a same-city on-demand logistics app (that is Porter/Borzo territory; see
  `research/COMPETITOR_LANDSCAPE.md`).
- Not a freight/FTL operator.
- Not a wallet, bank, or escrow service. Money movement happens through a **licensed payment
  provider**, subject to written approval (`legal/PAYMENTS_TAX_AND_SETTLEMENT.md`).
- Not an air-travel parcel network at launch. Air is a separate, later, legally-gated mode.
- Not a "send anything" service. The eligible-item list is deliberately narrow at launch.

## 5. Trust is the product

The scarce resource is not travellers — it is **willingness to hand a parcel to a stranger**. Every
product decision is judged against one question:

> Does this reduce the sender's perceived risk, or the traveller's perceived risk, without hiding
> information from either?

This drives: mandatory identity verification, no cash-on-delivery, sealed-parcel inspection at
handover, OTP + photo proof, no continuous GPS tracking by default, item-level insurance clarity,
and a grievance route that a human actually answers.

## 6. Why Bareilly first

Bareilly (UP) is proposed as the pilot origin because:

- It sits on the Lucknow–Delhi rail corridor and NH-30/NH-9 road corridor, giving **dense, repeated
  travel** toward Delhi NCR and Lucknow (**PUBLISHED/geography**, density unmeasured).
- It has an active small-business base (bamboo/zari work, handicrafts, trading, coaching, healthcare
  referrals) that plausibly generates urgent small-parcel demand (**HYPOTHESIS H-02**).
- It is small enough to operate with a hands-on team and manual oversight, which matters because
  the first 500 bookings should be human-reviewed rather than automated.

**This is a pilot hypothesis, not a validated market.** Route viability is decided by
`roadmap/PILOT_OPERATIONS_PLAN.md` §5, not by this paragraph.

## 7. Success definition for the pilot

The pilot succeeds if, over 8–10 weeks and ≥300 completed bookings, we can show:

1. **Match rate ≥ 60%** of posted parcels matched within the sender's window.
2. **On-time delivery ≥ 90%** against the agreed window.
3. **Incident rate < 2%** (loss, damage, tamper, prohibited item).
4. **Positive contribution margin** per booking at pilot pricing (not subsidised).
5. **Repeat rate ≥ 25%** among business senders at 6 weeks.
6. **Traveller 4-week retention ≥ 30%** (supply is the binding constraint).

Failing 1, 3 or 4 kills or reshapes the model. See `docs/ANALYTICS_AND_KPIS.md`.

## 8. Five-year shape (deliberately vague)

Dense corridor network in Tier-2/3 UP and NCR → expand to adjacent corridors where we have observed
travel density → layer business accounts and scheduled-repeat shipments → only then evaluate bus,
train and air carrier partnerships. **No part of this roadmap assumes regulatory approval that we do
not yet have.**

## 9. Principles

1. **Evidence over enthusiasm.** Every market claim is labelled OBSERVED / PUBLISHED / INFERRED /
   HYPOTHESIS / UNKNOWN.
2. **Narrow launch.** Fewer corridors, fewer item types, manual operations, real humans reviewing.
3. **No silent risk transfer.** If we do not have insurance cover confirmed in writing, the sender is
   told the parcel is uninsured.
4. **Operate inside the law as written, not as we wish it were.** Transport mode feasibility gates
   launch (`legal/TRANSPORT_MODE_FEASIBILITY.md`).
5. **Small team, boring technology.** Modular monolith, managed services, no microservices.
