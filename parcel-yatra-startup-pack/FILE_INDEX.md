# File Index

**Status:** Draft v0.1 · **Date:** 2026-10-24
Every file in the pack, one line each. If a file is not listed here, it is not part of the pack.

Total: **91 files** — 85 Markdown, 1 YAML, 4 JSON, 1 env example. Count verified in
`validation/VALIDATION_REPORT.md` §4.

---

## Root (3)

| File | Purpose |
|---|---|
| `README.md` | Entry point: what this is, the three governing statements, who reads what, scope, decisions, gates, next actions |
| `FILE_INDEX.md` | This file |
| `AGENTS.md` | Non-negotiable rules and conventions for AI agents and new contributors |

## docs/ — Product definition (14)

| File | Purpose |
|---|---|
| `PRODUCT_VISION.md` | What Parcel Yatra is, the problem, the one-sentence promise, what it refuses to be |
| `PRD.md` | Functional requirements FR-101…FR-806 with priorities and acceptance pointers |
| `PERSONAS_AND_JTBD.md` | Sender, traveller, receiver, support personas and their jobs-to-be-done |
| `USER_STORIES_AND_ACCEPTANCE_CRITERIA.md` | Stories per persona with Given/When/Then acceptance criteria |
| `BUSINESS_LOGIC.md` | Eligibility rules E1–E10, pricing inputs, cancellation/refund table, money rules |
| `BOOKING_STATE_MACHINE.md` | Authoritative states, transitions, guards, actors and timers |
| `PRICING_AND_UNIT_ECONOMICS.md` | Pricing formula, worked example, unit economics — all labelled HYPOTHESIS |
| `MATCHING_ENGINE.md` | Candidate selection, scoring, match bands, closed-set reason codes |
| `NOTIFICATIONS.md` | Channel strategy, templates, dedupe, quiet hours, PII rules |
| `OPERATIONS_AND_SUPPORT.md` | Support model, SLAs, escalation paths, prohibited-item handling |
| `ANALYTICS_AND_KPIS.md` | Event schema, funnel definitions, the metrics that matter at pilot |
| `MVP_SCOPE_AND_NON_GOALS.md` | What is in the pilot and, explicitly, what is not and never will be |
| `OPEN_QUESTIONS.md` | Q-L / Q-P / Q-M / Q-T / Q-O registers of unresolved questions |
| `DECISIONS_AND_ASSUMPTIONS.md` | D-001…D-011 decisions and A-01…A-13 assumptions with consequences |

## research/ — Evidence (7)

| File | Purpose |
|---|---|
| `COMPETITOR_LANDSCAPE.md` | What Porter and Kootr actually do, from observed public pages |
| `COMPETITOR_FEATURE_MATRIX.md` | Side-by-side feature comparison, with unknowns marked as unknown |
| `REA_METHOD_AND_EVIDENCE.md` | Tool, target, timestamp and evidence ID for every capture; reproduction commands |
| `COMPETITOR_WORKFLOW_OBSERVATIONS.md` | Observed user journeys and what they imply |
| `OPPORTUNITY_AND_GAP_ANALYSIS.md` | Where the gap is, and where we are guessing that a gap exists |
| `MARKET_VALIDATION.md` | What would count as evidence; explicit statement that none exists yet |
| `SOURCE_REGISTER.md` | S-01…S-06 accessed, P-01…P-10 not opened, tool limitations |

## legal/ — Regulatory analysis and drafts (10)

| File | Purpose |
|---|---|
| `LEGAL_REGULATORY_MATRIX.md` | L1–L5 evidence levels, obligation map, GATE-1…GATE-7 launch gates |
| `TRANSPORT_MODE_FEASIBILITY.md` | Per-mode feasibility; the transport-licence question in full |
| `PROHIBITED_RESTRICTED_GOODS.md` | Hard-block list, restricted list, reasoning, and why it is not a competitor's list |
| `PRIVACY_DATA_PROTECTION.md` | DPDP mapping, data categories, consent, retention, breach duties |
| `PAYMENTS_TAX_AND_SETTLEMENT.md` | Fund-flow models A/B/C, GST questions, why we are not an escrow |
| `TERMS_OF_SERVICE_DRAFT.md` | **Draft — requires Indian lawyer review** |
| `PRIVACY_NOTICE_DRAFT.md` | **Draft — requires Indian lawyer review** |
| `REFUND_CANCELLATION_POLICY_DRAFT.md` | **Draft — requires Indian lawyer review** |
| `GRIEVANCE_AND_INCIDENT_PROCESS.md` | Grievance officer duties, response windows, incident escalation |
| `LEGAL_REVIEW_CHECKLIST.md` | What counsel must actually answer, question by question |

## security/ — Controls (7)

| File | Purpose |
|---|---|
| `THREAT_MODEL.md` | STRIDE pass with IDs, severity, and SLAs |
| `SECURITY_REQUIREMENTS.md` | SR-A/B/C/H/I/L/P/R/U/W/Z requirement set |
| `ABUSE_AND_FRAUD_CONTROLS.md` | Fake accounts, collusion, prohibited items, cancellation abuse |
| `INCIDENT_RESPONSE_PLAN.md` | Severity ladder, roles, breach notification path |
| `SECURE_DEPLOYMENT_CHECKLIST.md` | Every release: secrets, headers, access, scanning |
| `SECURITY_TEST_PLAN.md` | When each security test runs and who owns it |
| `DATA_RETENTION_MATRIX.md` | Per-table retention period and legal basis |

## architecture/ — System design (7)

| File | Purpose |
|---|---|
| `SYSTEM_ARCHITECTURE.md` | Modular monolith, modules, boundaries, request lifecycle |
| `ARCHITECTURE_DECISIONS.md` | ADR log: PostGIS deferral, job queue, adapter pattern, and more |
| `THREAT_BOUNDARIES.md` | Trust zones and what crosses each boundary |
| `DEPLOYMENT_ARCHITECTURE.md` | Single region, instances, storage, networking |
| `ENVIRONMENT_STRATEGY.md` | Local / CI / staging / production parity rules |
| `DATA_FLOW_DIAGRAMS.md` | Booking, payment, handover and webhook flows as diagrams |
| `SCALABILITY_AND_COST.md` | Scaling path and cost model — labelled as estimates |

## database/ — Data (5)

| File | Purpose |
|---|---|
| `ERD.md` | Entity relationships |
| `SCHEMA.md` | Full DDL: enums, tables, constraints, ledger grants |
| `MIGRATION_STRATEGY.md` | Forward-only rules, two-phase changes, failure procedure |
| `INDEXING_AND_QUERY_PLAN.md` | Indexes, hot queries, `EXPLAIN` expectations |
| `RETENTION_AND_DELETION.md` | Deletion sequence, anonymisation, legal holds |

## api/ — Contract (4)

| File | Purpose |
|---|---|
| `api/openapi.yaml` | OpenAPI 3.1.0 contract, 42 operations. **Validated** — see `validation/VALIDATION_REPORT.md` |
| `api/API_CONVENTIONS.md` | Naming, money, errors, idempotency, concurrency, pagination, rate limits, auth |
| `api/ERROR_CATALOG.md` | Every error code, its HTTP status and its user-facing message |
| `api/WEBHOOK_CONTRACTS.md` | Signature scheme, replay protection, event catalogue, reconciliation backstop |

## ux/ — Interface (7)

| File | Purpose |
|---|---|
| `INFORMATION_ARCHITECTURE.md` | Sitemap, navigation models, the nine global states |
| `USER_FLOWS.md` | Flows per persona including failure and offline branches |
| `SCREEN_SPECIFICATIONS.md` | 22 screens, each with all nine states, plus requirement traceability |
| `DESIGN_SYSTEM.md` | Tokens, type, components, motion, contrast table, explicit refusals |
| `CONTENT_AND_MICROCOPY.md` | Voice, high-stakes strings in EN + HI, forbidden phrases |
| `ACCESSIBILITY.md` | WCAG 2.2 AA mapping, Devanagari specifics, testing plan |
| `RESPONSIVE_BEHAVIOUR.md` | Breakpoints, per-component adaptation, performance budgets |

## testing/ — Verification (6)

| File | Purpose |
|---|---|
| `TEST_STRATEGY.md` | Layers, data policy, the ten never-regress scenarios, CI pipeline |
| `TEST_CASES.md` | ~140 cases: TC-CRIT, AUTH, VER, PAR, TRIP, MAT, BK, HO, PAY, DIS, FIL, NOT, RES, COPY, OFF |
| `API_TESTS.md` | ~175 HTTP-level tests, all contract-asserted |
| `SECURITY_TEST_CASES.md` | ~110 security cases mapped to threat IDs, plus stated limitations |
| `LOAD_TEST_PLAN.md` | Six scenarios; concurrency correctness is the point, not throughput |
| `UAT_CHECKLIST.md` | Human-executed release gate, with a trust-and-honesty audit section |

## release/ — Shipping (3)

| File | Purpose |
|---|---|
| `RELEASE_CHECKLIST.md` | 13 sections from legal gates to post-release, per release |
| `GO_NO_GO_CRITERIA.md` | Four launch levels (L0–L3), objective criteria, deciders, automatic no-go list |
| `ROLLBACK_AND_RECOVERY.md` | Order of operations, flag-first rollback, money-state recovery, RTO/RPO hypotheses |

## roadmap/ — Plan (5)

| File | Purpose |
|---|---|
| `PHASES.md` | Phase 0–5 with exit tests, kill criteria and the honest critical path |
| `SPRINT_BACKLOG.md` | Sprints 0–8, ~70 stories with points, dependencies and done conditions |
| `DEPENDENCIES_AND_BLOCKERS.md` | B-LEGAL / B-PROV / B-TECH / B-OPS / B-MARKET / B-UNKNOWN registers |
| `PILOT_OPERATIONS_PLAN.md` | Recruitment (supply first), support model, incident handling, exit criteria |
| `GO_TO_MARKET.md` | Positioning, channels, the trust objection, honest traction claims |

## templates/ — Reusable (5)

| File | Purpose |
|---|---|
| `ADR_TEMPLATE.md` | Architecture decision record with reversal cost and revisit trigger |
| `REQUIREMENT_TEMPLATE.md` | Requirement with nine states, privacy, money and test mapping |
| `INCIDENT_POSTMORTEM_TEMPLATE.md` | Blameless-but-not-vague postmortem with money reconciliation section |
| `USER_RESEARCH_NOTES_TEMPLATE.md` | Session notes that record hesitation, not opinions |
| `PILOT_PARTICIPANT_TRACKER_TEMPLATE.md` | Minimum-necessary-data participant tracker (do not commit a filled copy) |

## examples/ — Config and fixtures (5)

| File | Purpose |
|---|---|
| `examples/sample.env.example` | Every env var with safe defaults; payments off, mock provider, safety rails |
| `examples/sample_data/cities_and_areas.json` | 5 cities, 12 localities, 6 corridors, car only |
| `examples/sample_data/trips.json` | 7 trips: happy path, documents-only, reverse, unverified, full, late, expired |
| `examples/sample_data/parcels.json` | 4 parcels at boundary conditions, 1 quote with integer-paise breakdown |
| `examples/sample_data/bookings.json` | 7 bookings covering the full lifecycle, with state invariants |

## validation/ — What was checked (3)

| File | Purpose |
|---|---|
| `VALIDATION_REPORT.md` | Every check actually run, its real output, and every accepted warning |
| `TRACEABILITY_MATRIX.md` | FR → test → screen → gate, plus 8 recorded coverage gaps |
| `CLAIMS_AND_LIMITATIONS.md` | Every substantive claim with its evidence label, and what is explicitly not claimed |

---

## Files that deliberately do not exist

| Absent | Why |
|---|---|
| `CHANGELOG.md` | Nothing has been released; a changelog of zero releases is noise |
| `LICENSE` | Proprietary; the licence is a commercial decision, not a documentation one |
| `CONTRIBUTING.md` | 2–4 people; `AGENTS.md` covers the conventions |
| `package.json` / `src/` | No application code exists yet. The pack is a brief, not a repository |
| `financial-model.xlsx` | Any spreadsheet would be HYPOTHESIS dressed as precision |
| `pitch-deck.pdf` | Not requested, and a deck built on no market data would be misleading |
| Logo or brand assets | `ux/DESIGN_SYSTEM.md` §2 defines a concept only; a designer must produce and trademark-check it |

Stated here so that their absence is a decision, not an oversight.
