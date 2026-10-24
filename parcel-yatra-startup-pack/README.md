# Parcel Yatra — Startup Documentation Pack

**Version:** 0.1 · **Date:** 2026-10-24 · **Status:** Complete first draft, not approved for any launch

---

## What this is

Parcel Yatra is an India-first, inter-city parcel marketplace. A sender who needs to move a small,
sealed parcel is matched with a verified traveller who is already making that journey by car. Every
handover is OTP-verified and photographed at both ends.

**Pilot:** Bareilly ⇄ Delhi NCR and Bareilly ⇄ Lucknow. Documents and low-value goods, ≤ 5 kg,
≤ ₹5,000 declared value, car travellers only.

This repository is the complete planning pack: product, research, legal, security, architecture,
database, API, UX, testing, release, roadmap, templates and validation. It is a set of documents, not
software. **No code exists.**

---

## Read this before anything else

Three statements govern everything in this pack. If any document contradicts them, that document is
wrong.

1. **Nothing here is legally verified.** Every legal document is a draft requiring review by a
   qualified Indian lawyer. The single biggest open question — whether matching strangers to carry
   parcels in a private car requires a transport licence — is **unresolved**
   (`roadmap/DEPENDENCIES_AND_BLOCKERS.md` B-LEGAL-01).

2. **No real money moves at pilot.** Payments are sandbox-only until a payment provider confirms in
   writing that the fund-flow model is permitted (GATE-3). Parcel Yatra does not hold, custody or
   escrow user funds, and no document in this pack claims otherwise.

3. **No market evidence exists.** Every number about demand, pricing, conversion or market size is
   labelled **HYPOTHESIS**. Nothing was measured. `validation/CLAIMS_AND_LIMITATIONS.md` §3 lists every
   such claim.

If you take one thing from this pack, take the gates and the open questions. They are the part that
determines whether this becomes a business.

---

## Who should read what

| You are | Start here | Then |
|---|---|---|
| **Founder / decision maker** | `docs/PRODUCT_VISION.md` | `validation/CLAIMS_AND_LIMITATIONS.md`, `roadmap/PHASES.md`, `release/GO_NO_GO_CRITERIA.md` |
| **Lawyer** | `legal/LEGAL_REGULATORY_MATRIX.md` | `legal/LEGAL_REVIEW_CHECKLIST.md`, `legal/TRANSPORT_MODE_FEASIBILITY.md`, `legal/PAYMENTS_TAX_AND_SETTLEMENT.md` |
| **Engineer building it** | `docs/BOOKING_STATE_MACHINE.md` | `api/openapi.yaml`, `architecture/SYSTEM_ARCHITECTURE.md`, `database/SCHEMA.md` |
| **Designer** | `ux/SCREEN_SPECIFICATIONS.md` | `ux/DESIGN_SYSTEM.md`, `ux/CONTENT_AND_MICROCOPY.md` |
| **Security reviewer** | `security/THREAT_MODEL.md` | `security/SECURITY_REQUIREMENTS.md`, `testing/SECURITY_TEST_CASES.md` |
| **Investor / advisor** | `validation/CLAIMS_AND_LIMITATIONS.md` | `research/COMPETITOR_LANDSCAPE.md`, `docs/PRICING_AND_UNIT_ECONOMICS.md` |
| **Operator / support lead** | `docs/OPERATIONS_AND_SUPPORT.md` | `roadmap/PILOT_OPERATIONS_PLAN.md`, `legal/GRIEVANCE_AND_INCIDENT_PROCESS.md` |

---

## Structure

```
parcel-yatra-startup-pack/
├── README.md                     ← you are here
├── FILE_INDEX.md                 Every file, one line each
├── AGENTS.md                     Conventions for AI agents working in this pack
├── docs/                         Product definition (14 files)
├── research/                     Competitor and market evidence (7)
├── legal/                        Regulatory analysis and drafts (10)
├── security/                     Threat model and controls (7)
├── architecture/                 System design (7)
├── database/                     Schema and data lifecycle (5)
├── api/                          OpenAPI contract and conventions (4)
├── ux/                           Flows, screens, design system (7)
├── testing/                      Strategy, cases, load, UAT (6)
├── release/                      Checklists, go/no-go, rollback (3)
├── roadmap/                      Phases, backlog, blockers, GTM (5)
├── templates/                    Reusable document templates (5)
├── examples/                     Config and synthetic seed data (5)
└── validation/                   What was checked and what is claimed (3)
```

Exact file count and verification results: `validation/VALIDATION_REPORT.md`.

---

## The pilot scope, stated plainly

| In scope | Out of scope |
|---|---|
| Car travellers only | Bike, bus, train, air |
| Bareilly ⇄ Delhi NCR, Bareilly ⇄ Lucknow | Any other corridor |
| Documents and low-value goods | Cash, jewellery, medicines, electronics, passports |
| ≤ 5 kg, ≤ 45 cm, ≤ ₹5,000 declared value | Bulk, freight, high-value |
| Android app + web (sender), single-page web (receiver) | iOS |
| Sandbox payments | Real payments, payouts, wallet |
| Manual identity verification | Automated KYC provider |
| English + Hindi | Other languages |
| No GPS tracking | Live location, route mapping |

Modes we cannot legally operate are **absent from the UI**, not shown as "coming soon". Implying a
capability we do not have is the fastest way to lose the only asset this business has: trust.

---

## The nine states every screen must handle

A screen is not specified until all nine are designed. This is enforced in
`testing/UAT_CHECKLIST.md` and `ux/SCREEN_SPECIFICATIONS.md` §0.

Loading · Empty (first use) · Empty (no results) · Recoverable error · Unrecoverable error · Offline ·
Pending verification · Rejected/blocked · Success/terminal

---

## Key design decisions

| # | Decision | Rationale |
|---|---|---|
| D-001 | Modular monolith, not microservices | 2–4 people; a distributed system would be a liability |
| D-002 | Fastify + TypeScript, PostgreSQL 16 | Boring, well-understood, fast to hire for |
| D-003 | Money is integer paise everywhere | Floats and currency are a well-known source of loss |
| D-004 | Server computes all amounts; client amounts ignored | Removes a whole class of tampering bugs |
| D-005 | Resource non-disclosure: `404`, not `403` | A `403` confirms existence |
| D-006 | No continuous location tracking | Privacy cost exceeds value at this price point |
| D-007 | No Aadhaar storage | Avoids the highest-risk identity data entirely |
| D-008 | OTP at pickup **and** delivery | The core trust mechanism; one code is not enough |
| D-009 | Machine translation rejected for Hindi | Bad Hindi is worse than English-only |
| D-010 | Bike mode hidden in UI, not "coming soon" | Do not advertise what is not permitted |
| D-011 | PostGIS deferred; matching uses city pairs | Two corridors do not need geospatial indexing |

Full register with consequences and reversal costs: `docs/DECISIONS_AND_ASSUMPTIONS.md`.

---

## The launch gates

Every gate below must be cleared **in writing** before the corresponding launch level. None can be
closed by working harder on the product.

| Gate | Requirement | Blocks |
|---|---|---|
| **GATE-1** | Entity and GST status settled for the chosen fund-flow model | Real money |
| **GATE-2** | Terms, privacy, refund policy reviewed by Indian counsel | Public launch |
| **GATE-3** | Payment provider confirms the fund-flow model is permitted | **All payments** |
| **GATE-4** | Transport legality position confirmed | Public launch |
| **GATE-5** | Insurance in force, or permanent unambiguous exclusion in all copy | Any safety claim |
| **GATE-6** | Grievance officer appointed and published | Public launch |
| **GATE-7** | DPDP readiness: notices, consent records, deletion, breach process | Data collection at scale |

Detail: `legal/LEGAL_REGULATORY_MATRIX.md` §8. Blockers: `roadmap/DEPENDENCIES_AND_BLOCKERS.md`.

---

## What was verified, and what was not

**Verified:**
- `api/openapi.yaml` is valid OpenAPI 3.1.0 (Redocly lint, 1 accepted warning).
- The validator rejects duplicate YAML keys — proven with a control file.
- All four JSON fixtures in `examples/sample_data/` parse.
- The ZIP archive matches the source directory by hash.

**Not verified — stated openly:**
- No code exists; no test has been run against a system.
- No legal position has been confirmed by counsel.
- No market or demand evidence exists.
- No security testing, accessibility audit, or load test has been performed.
- No document has been independently proofread.

Full register: `validation/VALIDATION_REPORT.md` and `validation/CLAIMS_AND_LIMITATIONS.md`.

---

## Research method

Competitor research was done with the REA (Reverse Engineer Anything) toolset using a browser target
against public marketing pages, on 2026-10-24. Only `list_browser_targets` and `inspect_web_page` were
invoked. Every capture is recorded with an evidence ID, and every reproduction command is in
`research/REA_METHOD_AND_EVIDENCE.md`.

No authentication was bypassed, no paywall circumvented, no private data accessed, and no APK was
decompiled. Only two competitors were examined, and only public pages. The limitations of the method
are documented in `research/SOURCE_REGISTER.md` §7 rather than glossed over.

---

## How to use this pack

**It is a brief, not a contract.** Specifically:

- Do not send a legal document from `legal/` to a user. They are drafts.
- Do not quote a price from `docs/PRICING_AND_UNIT_ECONOMICS.md` publicly. They are hypotheses.
- Do not implement `api/openapi.yaml` without reading `docs/BOOKING_STATE_MACHINE.md` first — the
  contract is only correct in the context of the state machine.
- Do not treat `validation/` as a quality certificate. It reports what was checked, including the
  checks that failed or were impossible.

---

## Next five actions

In priority order. The first is not engineering.

1. **Commission a legal opinion on B-LEGAL-01** — whether matching strangers to carry parcels in a
   private car is lawful without a transport licence. Everything else is secondary to this answer.
2. **Open the conversation with a payment provider's compliance team** (not sales) about the fund-flow
   model. Expect weeks. Start now because it is the long pole.
3. **Recruit 10–15 verified travellers** on the two corridors before inviting a single sender. A
   marketplace with demand and no supply creates the worst possible first impression.
4. **Build Phase 1** (`roadmap/SPRINT_BACKLOG.md` Sprints 0–5): auth, parcels, trips, matching, booking
   state machine. Sandbox money only.
5. **Run the pilot** per `roadmap/PILOT_OPERATIONS_PLAN.md`: 20 parcels, high-touch, founder answering
   the phone.

---

## A closing note on tone

This pack is deliberately blunt about what is unknown. That is not pessimism — it is the only honest
way to plan a business whose central promise is that a stranger can be trusted with your documents.

The product will only work if users believe us. The fastest way to lose that belief is to claim
something we have not verified. So every document here states its evidence level, every draft is marked
as a draft, and every gap is listed rather than hidden.

That is the standard the product itself has to meet.
