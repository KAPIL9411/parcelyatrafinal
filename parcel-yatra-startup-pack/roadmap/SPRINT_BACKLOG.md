# Sprint Backlog

**Status:** Draft v0.1 · **Date:** 2026-10-24
Format: one sprint = 1 week for a 2–4 person team. Story points are **relative effort**, not hours.
Every item links to a requirement, a test, or a gate — if it links to nothing, it does not belong here.

---

## 1. Conventions

| Field | Meaning |
|---|---|
| **P** | Priority: P0 blocks the pilot, P1 before open pilot, P2 later |
| **Est** | Story points (1 = half a day, 2 = a day, 3 = two days, 5 = most of a week, 8 = needs splitting) |
| **Deps** | What must exist first |
| **Done** | The exit condition, not the activity |

**Definition of Done (applies to every item, not repeated below):**
code + tests + contract assertion + audit/telemetry + Hindi string + error-state handling + review by
someone else + feature flag + runbook update where relevant.

---

## 2. Sprint 0 — Foundations

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S0-1 | Repo, monorepo layout, lint/format/typecheck | P0 | 3 | — | `main` protected; CI runs on PR |
| S0-2 | Local dev compose: Postgres, MinIO, mail capture | P0 | 2 | S0-1 | One command brings up the stack |
| S0-3 | Migration tooling + first empty migration | P0 | 2 | S0-2 | `migrate up` from scratch works |
| S0-4 | Fastify skeleton + `/health` + error envelope | P0 | 3 | S0-1 | `API-HLT-01`, `API-HLT-02` pass |
| S0-5 | OpenAPI lint + generated types in CI | P0 | 2 | S0-4 | A spec change breaks the build if types drift |
| S0-6 | Secret scan, dependency audit, SAST in CI | P0 | 2 | S0-1 | CI fails on a planted secret |
| S0-7 | Structured logging with PII redaction | P0 | 3 | S0-4 | `SEC-PRV-03` passes |
| S0-8 | Env/secret loading with fail-fast on missing config | P0 | 2 | S0-4 | Boot fails if `PAYMENTS_LIVE=true` and no provider key |
| S0-9 | Admin origin separated from public origin | P0 | 2 | S0-4 | Two hostnames, separate cookie scopes |
| S0-10 | Legal gate tracker opened with owners | P0 | 1 | — | GATE-1…7 have a name and a date |

**Sprint 0 exit:** a `/health` endpoint deployed to staging, with CI that actually blocks bad code.

---

## 3. Sprint 1 — Identity

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S1-1 | Phone OTP request (hashed code, rate limited) | P0 | 5 | S0 | `API-AUTH-01`…`04` pass |
| S1-2 | OTP verify + session issuance | P0 | 3 | S1-1 | `API-AUTH-05`…`08` pass |
| S1-3 | Refresh rotation with reuse detection | P0 | 3 | S1-2 | `API-AUTH-09`, `10` pass |
| S1-4 | Logout / session revocation | P0 | 2 | S1-2 | `API-AUTH-11` passes |
| S1-5 | Google sign-in with full claim validation | P1 | 3 | S1-2 | `API-AUTH-12`…`14` pass |
| S1-6 | `GET/PATCH /me` with field allowlist | P0 | 2 | S1-2 | `API-ME-01`…`04` pass |
| S1-7 | Enumeration resistance (constant-time path) | P0 | 2 | S1-1 | `SEC-AUTH-02` statistical test passes |
| S1-8 | Sign-in UI: phone, OTP, resend, errors | P0 | 5 | S1-2 | All states from `ux/SCREEN_SPECIFICATIONS.md` §2.2 |
| S1-9 | Auth tests incl. token confusion cases | P0 | 3 | S1-2 | `SEC-AUTH-05`…`08` pass |

**Sprint 1 exit:** a real person can sign up on a phone and the OTP is never logged.

---

## 4. Sprint 2 — Verification and files

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S2-1 | Presigned upload URL with type/size enforcement | P0 | 3 | S0 | `API-FIL-01`, `02` pass |
| S2-2 | Post-upload processing: re-encode, strip EXIF | P0 | 3 | S2-1 | `SEC-UPL-03`, `04` pass |
| S2-3 | Verification submission + state machine | P0 | 3 | S2-2 | `API-VER-01`, `02` pass |
| S2-4 | Admin verification queue (list + detail) | P0 | 5 | S2-3 | Reviewer can decide; `API-VER-06`, `07` pass |
| S2-5 | Audit logging on every document view | P0 | 2 | S2-4 | `SEC-LOG-01` passes for this resource |
| S2-6 | ID number masking (last 4 only) | P1 | 1 | S2-4 | No full number anywhere in the UI |
| S2-7 | Traveller verification UI (camera, retry, rejection) | P0 | 5 | S2-3 | All nine states |
| S2-8 | Block trip publishing for unverified | P0 | 1 | S2-3 | `TC-VER-09` passes |

**Sprint 2 exit:** a human reviews a real ID and the system records who looked at it.

---

## 5. Sprint 3 — Parcels and eligibility

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S3-1 | Category taxonomy + prohibited/restricted sets | P0 | 2 | — | Seeded; server enforces, not just UI |
| S3-2 | `POST /parcels` with E1–E10 evaluation | P0 | 5 | S1, S3-1 | `API-PAR-01`…`08` pass |
| S3-3 | Restricted-category review queue (`202` path) | P0 | 2 | S3-2 | `API-PAR-06` passes |
| S3-4 | Description vagueness screening | P1 | 2 | S3-2 | `TC-PAR-07` passes |
| S3-5 | Sender wizard steps 1–2 (item, route) | P0 | 5 | S3-2 | Drafts persist across app kill |
| S3-6 | Pricing formula implementation (integer paise) | P0 | 5 | S3-2 | Property test: components sum to total, always |
| S3-7 | Quote creation + 15-minute expiry | P0 | 3 | S3-6 | `API-PAR-11`, `12` pass |
| S3-8 | Price breakdown UI with live countdown | P0 | 3 | S3-7 | Expiry changes CTA, never silently reprices |

**Sprint 3 exit:** the server refuses what we cannot carry, and never invents a price.

---

## 6. Sprint 4 — Trips and matching

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S4-1 | Trip create/cancel with capacity | P0 | 3 | S2 | `API-TRP-01`…`06` pass |
| S4-2 | Mode feature flags (car on; bike/bus/train/air off) | P0 | 1 | S4-1 | `API-TRP-03`, `04` pass; no disabled mode in UI |
| S4-3 | Matching query: route, time window, capacity | P0 | 5 | S4-1, S3-2 | `TC-MAT-01`…`04` pass |
| S4-4 | Ranking + reason codes (closed set) | P0 | 3 | S4-3 | Reasons come only from `docs/MATCHING_ENGINE.md` §5 |
| S4-5 | PII-minimal match projection | P0 | 2 | S4-3 | `TC-MAT-07` passes |
| S4-6 | Match list UI with no-match states | P0 | 5 | S4-4 | `TC-MAT-02`, `08`; no price when no match |
| S4-7 | Trip creation UI for travellers | P0 | 3 | S4-1 | All nine states |
| S4-8 | Matching index tuning + `EXPLAIN` review | P1 | 2 | S4-3 | p95 < 150 ms on pilot-sized data |

**Sprint 4 exit:** a sender sees real candidates, or an honest empty state.

---

## 7. Sprint 5 — Booking state machine

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S5-1 | Booking schema, events table, invariants | P0 | 3 | S4 | Constraints from `database/SCHEMA.md` applied |
| S5-2 | Capacity reservation in one transaction | P0 | 5 | S5-1 | `TC-CRIT-01` passes |
| S5-3 | Transition engine with guard table | P0 | 5 | S5-1 | `API-BK-07`…`11` pass |
| S5-4 | Idempotency middleware + storage | P0 | 3 | S5-2 | `API-BK-02`…`04` pass |
| S5-5 | `allowed_commands` server computation | P0 | 2 | S5-3 | `API-BK-14`, `15` pass |
| S5-6 | Expiry jobs (30-min accept, quote, trip) | P0 | 3 | S5-3 | `TC-BK-06` passes; jobs idempotent |
| S5-7 | Booking detail UI with timeline | P0 | 5 | S5-3 | Timeline matches `booking_events` |
| S5-8 | Cancellation + refund calculation | P0 | 3 | S5-3 | `TC-BK-12`…`15`; amount shown before confirm |
| S5-9 | Booking concurrency test suite | P0 | 2 | S5-2 | `TC-CRIT-10` passes |

**Sprint 5 exit:** two people cannot book the same slot, and no state can be reached without a
recorded transition. **This is the highest-risk sprint; do not compress it.**

---

## 8. Sprint 6 — Handover

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S6-1 | OTP issue (hashed), delivery, expiry | P0 | 3 | S5 | `SEC-OTP-02` passes |
| S6-2 | OTP verify + consume atomically | P0 | 3 | S6-1 | `API-HO-02`, `05` pass |
| S6-3 | Attempt limiting + booking lock | P0 | 2 | S6-2 | `TC-CRIT-04` passes |
| S6-4 | Handover photo capture + storage | P0 | 3 | S2-1 | Visible to the entitled party only |
| S6-5 | Pickup UI (one screen, one action) | P0 | 3 | S6-2 | Works offline with honest queueing |
| S6-6 | Delivery UI + receiver web page | P0 | 5 | S6-2 | `TC-OFF-01`; no app required |
| S6-7 | Receiver token links (scoped, expiring) | P0 | 2 | S6-6 | Token grants no other access |
| S6-8 | Offline queue with idempotent replay | P0 | 5 | S6-2 | `TC-OFF-02` passes |

**Sprint 6 exit:** a real pickup happens in a car with bad signal and nothing is double-consumed.

---

## 9. Sprint 7 — Mock payments and admin

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S7-1 | Payment intent (server-computed amount) | P0 | 3 | S5 | `API-PAY-01`, `02` pass |
| S7-2 | Mock adapter: authorise/capture/fail/timeout | P0 | 3 | S7-1 | All six payment states reproducible on demand |
| S7-3 | Webhook receiver with signature + replay guard | P0 | 5 | S7-2 | `API-WH-01`…`05` pass |
| S7-4 | Ledger with append-only grants | P0 | 3 | S7-2 | `SEC-WH-10`, `11` pass |
| S7-5 | Payment UI incl. unknown-state handling | P0 | 3 | S7-1 | No retry button in unknown state |
| S7-6 | Admin booking search + dashboard | P0 | 5 | S5 | Stuck booking findable in < 60 s |
| S7-7 | Refund with maker-checker | P0 | 3 | S7-4 | `API-PAY-07`, `08` pass |
| S7-8 | Audit log read + export | P0 | 3 | S2-5 | Tamper attempt fails |
| S7-9 | Kill switches (payments, payouts, matching, bookings) | P0 | 2 | S0 | Each verified by actually flipping it |

**Sprint 7 exit:** the full loop runs with sandbox money and every money action is auditable.

---

## 10. Sprint 8 — Pilot readiness

| ID | Story | P | Est | Deps | Done when |
|---|---|---|---|---|---|
| S8-1 | Dispute creation + payout freeze | P0 | 3 | S7 | `TC-CRIT-08` passes |
| S8-2 | Dispute resolution with outcome codes | P0 | 3 | S8-1 | Justification ≥ 20 chars enforced |
| S8-3 | Notification pipeline (SMS, push, in-app) | P0 | 5 | S5 | No PII in payloads; dedupe works |
| S8-4 | Support tooling: queue, macros, SLA timer | P0 | 5 | S7-6 | Support handles a case without engineering |
| S8-5 | Hindi parity pass | P0 | 5 | all UI | Every string translated, reviewed by a native speaker |
| S8-6 | Accessibility pass | P0 | 3 | all UI | TalkBack journey; 200% zoom; contrast |
| S8-7 | Load test S1 + S2 | P0 | 3 | S5 | Targets met; capacity assertion quoted |
| S8-8 | Runbooks + alert wiring | P0 | 3 | S7 | Every alert fires once in staging |
| S8-9 | UAT execution | P0 | 3 | all | `testing/UAT_CHECKLIST.md` P0 all ticked |
| S8-10 | Rollback rehearsal | P0 | 2 | S0 | Rollback done in staging in < 5 min |

**Sprint 8 exit:** the founder can run the product for a week without writing code.

---

## 11. Backlog hygiene

| Rule | Why |
|---|---|
| No item without a requirement, test or gate link | Prevents scope drift |
| Items > 8 points are split | They are hiding uncertainty |
| Bugs found during a sprint go to the top, P0 bugs stop the sprint | Otherwise they rot |
| Every P1 has a target sprint | A P1 with no sprint is a P2 pretending |
| Once per sprint, delete the oldest untouched item | If it has not been touched in 6 sprints, it is not real |

---

## 12. What is not in this backlog, by design

- Real payment integration (gated by GATE-3 — `roadmap/PHASES.md` §7)
- Payouts (same gate)
- iOS
- Live location tracking
- Wallet
- Bus/train/air modes
- Ratings and reviews beyond a stub
- Referral programme
- Analytics dashboards beyond the operator dashboard

Listed so that nobody assumes they are "coming next sprint". They are not in the next sprint, and some
are never.

---

## 13. Capacity reality

With 2 engineers, the eight sprints above are **~4 months of full-time work** before a closed pilot,
assuming no legal blockage and no scope growth. With 4, it is ~3 months. These are estimates, not
commitments, and they exclude the legal critical path in `roadmap/DEPENDENCIES_AND_BLOCKERS.md`.

Any plan that claims this in 6 weeks is either cutting the state machine, cutting the tests, or
planning to skip the pilot.
