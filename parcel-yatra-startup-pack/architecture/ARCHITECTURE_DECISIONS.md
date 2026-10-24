# Architecture Decision Records

**Status:** Draft v0.1 · **Date:** 2026-10-24
Format: Context → Decision → Consequences → Reversal condition.

---

## ADR-001 — Modular monolith over microservices

**Context:** 2–4 engineers, transactional correctness dominates, unknown scale.
**Decision:** One API deployable, strictly separated modules.
**Consequences:** Simple transactions and debugging; single blast radius; must police module boundaries.
**Reversal:** A module needs independent scaling/runtime or team > 6 backend engineers.

## ADR-002 — Fastify over NestJS

**Context:** Need schema validation, low overhead, small team, OpenAPI.
**Decision:** Fastify with JSON Schema → OpenAPI generation.
**Consequences:** Less opinionated structure (we enforce our own); excellent performance; fewer abstractions
to learn.
**Reversal:** Team needs enforced DI/module conventions at scale.

## ADR-003 — PostgreSQL as the only durable store (plus object storage)

**Context:** Bookings, money, custody need real constraints.
**Decision:** Postgres for everything relational; object storage only for images.
**Consequences:** Strong integrity; vertical scaling limits later; must manage indexes carefully.
**Reversal:** Analytics volume requires a warehouse (read replica / export, not replacement).

## ADR-004 — Defer PostGIS

**Context:** Pilot matches city-pair, not route geometry.
**Decision:** Store `lat`,`lng` and city IDs; compute distance in SQL; enable PostGIS in staging only.
**Consequences:** Simpler ops; area-radius queries less elegant; route overlap unsupported.
**Reversal:** Sender research shows real need for intermediate-city pickup.

## ADR-005 — Server-authoritative state machine

**Context:** Clients (web, mobile, admin) must not corrupt lifecycle.
**Decision:** Single `applyTransition()` domain function; no direct status writes anywhere.
**Consequences:** Slight ceremony for admin overrides; enormous safety gain.
**Reversal:** None foreseeable.

## ADR-006 — Money never held by us

**Context:** Holding funds may be regulated.
**Decision:** Provider-held delayed payout only; sandbox until written approval.
**Consequences:** Product constrained by provider capability; slower launch; legally safer.
**Reversal:** Only with written legal + provider confirmation.

## ADR-007 — Idempotency at the boundary

**Context:** Mobile retries, flaky networks, duplicate webhooks.
**Decision:** `Idempotency-Key` required on all POSTs that create/mutate money or bookings; provider events
deduped by ID.
**Consequences:** Extra table and key management; eliminates a whole class of double-charge bugs.
**Reversal:** None.

## ADR-008 — OTP hashed, never logged

**Context:** Handover integrity is the core trust primitive.
**Decision:** Store only keyed hash; compare in constant time; consume atomically; never log.
**Consequences:** Cannot "look up" an OTP for support — support must regenerate instead.
**Reversal:** None.

## ADR-009 — No continuous location tracking

**Context:** Privacy, battery, legal sensitivity, low pilot value.
**Decision:** Event-based status; optional coarse city check-in.
**Consequences:** Sender has less visibility; must manage expectations in copy.
**Reversal:** Documented need + consent design + retention policy.

## ADR-010 — Human-in-the-loop for KYC and restricted items

**Context:** Automated verification and item classification are error-prone; pilot volume is small.
**Decision:** Manual review with reason codes and audit.
**Consequences:** Ops cost and turnaround time; far better error handling.
**Reversal:** Vendor provides auditable automation + appeal path.

## ADR-011 — Postgres-backed job queue first

**Context:** Adding Redis early increases operational surface.
**Decision:** `jobs` table with `FOR UPDATE SKIP LOCKED`; worker process polls.
**Consequences:** Adequate for pilot volumes; must monitor job lag; no fan-out pub/sub.
**Reversal:** Sustained > 50 jobs/s or complex scheduling needs.

## ADR-012 — Adapter pattern for every external provider

**Context:** Providers change; sandbox must work without real credentials.
**Decision:** Interfaces in `packages/providers`; mock implementation is default in dev.
**Consequences:** Slightly more code; enables tests and provider swaps.
**Reversal:** None.

## ADR-013 — Separate admin origin and auth realm

**Context:** Admin compromise is catastrophic.
**Decision:** Distinct hostname, separate session, MFA, IP allowlist option.
**Consequences:** More setup; a public-app XSS cannot reach admin.
**Reversal:** None.

## ADR-014 — OpenAPI as contract, generated types

**Context:** Web + mobile + API drift is a common failure.
**Decision:** `api/openapi.yaml` is authoritative; types generated; contract tests in CI.
**Consequences:** Spec changes require regeneration; catches drift early.
**Reversal:** None.

## ADR-015 — Documentation-first change control

**Context:** Multiple contributors (human + AI agents).
**Decision:** PRD/OpenAPI/ADR outrank code; contradictions must be resolved in docs.
**Consequences:** Slight process overhead; prevents silent divergence.
**Reversal:** None.
