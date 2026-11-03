# Decisions & Assumptions

**Status:** Living document · **Last updated:** 2026-10-24
Format: ADR-lite. A decision is only "decided" if it has a date, an owner and a reversal condition.

---

## Part A — Decisions made

### D-001 — Marketplace model, not courier operator
**Date:** 2026-10-24 · **Status:** Accepted · **Owner:** Founder
Parcel Yatra facilitates matching and does not perform carriage, own vehicles, or employ travellers as
couriers. **Reversal condition:** legal advice concludes marketplace framing does not reduce liability
materially, or a carrier licence becomes commercially attractive.

### D-002 — Modular monolith
**Date:** 2026-10-24 · **Status:** Accepted
Single deployable Node.js service with enforced domain modules. No microservices, no separate services
for matching or payments. **Reversal condition:** a module demonstrably needs independent scaling or a
different runtime (e.g. heavy geospatial service) and the team has capacity to operate it.

### D-003 — Fastify over NestJS
**Date:** 2026-10-24 · **Status:** Accepted
Rationale: smaller surface, first-class TypeScript, JSON-schema validation that maps directly to
OpenAPI, lower memory on small hosts. NestJS decorators/DI add ceremony the team does not need at this
size. **Reversal condition:** team grows past ~6 backend engineers and needs enforced module boundaries.

### D-004 — PostgreSQL as the single source of truth
**Date:** 2026-10-24 · **Status:** Accepted
Relational integrity is the point: bookings, money and custody need real constraints and transactions.
**Reversal condition:** none foreseeable.

### D-005 — PostGIS deferred
**Date:** 2026-10-24 · **Status:** Accepted (provisional)
Pilot matching is city-pair based, so plain lat/long columns + a distance function suffice. PostGIS is
enabled in staging for evaluation only. **Reversal condition:** area-radius matching or route overlap
becomes a real requirement.

### D-006 — Payments: sandbox only until written approval
**Date:** 2026-10-24 · **Status:** Accepted (hard gate)
**Reversal condition:** licensed provider confirms marketplace + delayed payout in writing AND counsel
confirms fund-flow legality AND tax treatment is confirmed.

### D-007 — No continuous location tracking
**Date:** 2026-10-24 · **Status:** Accepted
Status is event-based (picked up / in transit / arrived / delivered) plus optional coarse city check-in.
**Reversal condition:** documented user need, explicit consent design, and a reviewed retention policy.

### D-008 — Aadhaar not collected by default
**Date:** 2026-10-24 · **Status:** Accepted
Use alternative government ID types and vendor verification. **Reversal condition:** legal opinion
confirms a lawful, authorised channel and a genuine need that other IDs cannot satisfy.

### D-009 — Web + Android first, iOS later
**Date:** 2026-10-24 · **Status:** Accepted
**Reversal condition:** interviews show pilot senders are majority-iOS (unlikely in target segment).

### D-010 — Human review for restricted items and all traveller KYC
**Date:** 2026-10-24 · **Status:** Accepted
**Reversal condition:** vendor provides auditable automated verification with acceptable false-positive
rate, and a human appeal path exists.

### D-011 — Documentation is the source of truth
**Date:** 2026-10-24 · **Status:** Accepted
PRD, OpenAPI and this decision log outrank code comments. Contradictions must be fixed in docs first.

---

## Part B — Assumptions register

Every assumption has an ID, a confidence, and a **test**. Untested assumptions must not appear as
facts in external material.

| ID | Assumption | Confidence | Consequence if false | Test |
|---|---|---|---|---|
| A-01 | Travellers on Bareilly→Delhi will carry parcels for ₹150–₹400 | Low | Supply collapses; model dead | 20 interviews + pilot acceptance rate |
| A-02 | Senders will pay a 20–30% premium over bus parcel for tracking + accountability | Low | Race to bottom on price | 15 sender interviews + A/B price test |
| A-03 | Bus parcel Bareilly→Delhi costs ₹150–₹300 and is same-day/overnight | Low | Our price anchor is wrong | In-person survey at bus stand |
| A-04 | Documents are the highest-trust, lowest-risk starting category | Medium | If not, item policy must change | Category mix in first 100 bookings |
| A-05 | 5 kg / ₹5,000 caps cover ≥ 70% of demand | Medium | Caps too tight; demand leaks | Declared value/weight distribution |
| A-06 | ≥ 60% match rate is achievable on one corridor | Low | Marketplace never reaches liquidity | Pilot measurement |
| A-07 | Human review can scale to 50 bookings/day with 1 FTE | Medium | Ops cost breaks unit economics | Time-motion during pilot |
| A-08 | Receiver SMS + OTP is acceptable without an app | Medium | Receiver friction kills completion | Completion rate + calls |
| A-09 | Users will accept identity verification for trust | Medium | Supply/demand friction | Funnel drop-off at KYC |
| A-10 | A licensed payment provider will onboard this model | Unknown | No legal way to collect money | Provider conversations |
| A-11 | An insurer will cover peer-carried goods at viable premium | Unknown | Uninsured risk unacceptable | Broker quotes |
| A-12 | Car-based carriage does not require a commercial permit | Unknown | Car mode illegal | Counsel memo |
| A-13 | Solo founder + 2 engineers can operate the pilot safely | Medium | Under-staffed incidents | Ops load measurement |

## Part C — Things we explicitly do **not** know

- Actual travel density on the corridor (no data collected yet).
- Actual sender demand volume in Bareilly.
- Any competitor's real GMV, user count or take rate — **we did not obtain these and will not guess**.
- Whether Kootr's air-traveller model is legally cleared in India (their site makes claims; we have not
  verified their compliance).
- Whether any Indian peer-to-peer road crowdshipping service currently operates at scale.

## Part D — Reversal log

| Date | Decision | Change | Reason |
|---|---|---|---|
| 2026-10-24 | — | Initial set | — |
