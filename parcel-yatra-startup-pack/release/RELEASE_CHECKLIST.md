# Release Checklist

**Status:** Draft v0.1 · **Date:** 2026-10-24
One checklist per release. Copy it into the release ticket and tick boxes with a name and timestamp
next to each one. An unticked box is a real answer; a ticked box nobody verified is a lie.

---

## 0. Release identity

| Field | Value |
|---|---|
| Version | `v0.__.__` |
| Commit | |
| Date (IST) | |
| Release manager | |
| Environments affected | staging → production |
| Migrations included | yes / no (list) |
| Feature flags changed | (list) |

---

## 1. Legal and regulatory gates (non-negotiable)

These are not "nice to have". Each one maps to a gate in `legal/LEGAL_REGULATORY_MATRIX.md` §8.

| Gate | Requirement | Status | Blocking? |
|---|---|---|---|
| GATE-1 | Business entity registered; GST status confirmed for the chosen model | ☐ | **Yes, for any live payment** |
| GATE-2 | Terms, Privacy Notice, Refund Policy reviewed by an Indian lawyer | ☐ | **Yes, for public launch** |
| GATE-3 | Payment provider written confirmation that the fund-flow model is permitted | ☐ | **Yes, before `PAYMENTS_LIVE=true`** |
| GATE-4 | Transport legality position confirmed (private car, goods, no fare-sharing) | ☐ | **Yes, before public launch** |
| GATE-5 | Insurance position documented; no coverage claim in UI until written confirmation | ☐ | **Yes, before claiming anything about cover** |
| GATE-6 | Grievance officer appointed and published with the statutory window | ☐ | **Yes, for public launch** |
| GATE-7 | DPDP readiness: notices, consent records, deletion path, breach process | ☐ | **Yes, before collecting personal data at scale** |

- [ ] **Every gate required by this release's scope is cleared, with evidence linked.**
- [ ] If any required gate is open, the release ships **internal-only** with payments and public
      sign-up disabled.

> Money rule: `PAYMENTS_LIVE=false` and `PAYOUTS_ENABLED=false` is the default and the only permitted
> state until GATE-3 is signed. A configuration change alone must never be enough to go live — the
> provider credentials must also exist and be validated at boot.

---

## 2. Code and quality

- [ ] CI green on the release commit (all 13 stages of `testing/TEST_STRATEGY.md` §11)
- [ ] Zero open S1/S2 defects (`testing/TEST_STRATEGY.md` §9)
- [ ] The ten critical scenarios pass (`testing/TEST_CASES.md` §1) — attach the run output
- [ ] `packages/domain` coverage ≥ 85%
- [ ] No skipped tests without a written reason
- [ ] Lint, typecheck, format clean
- [ ] Dependency audit: no unpatched critical/high
- [ ] Secret scan clean
- [ ] No `TODO` in money, auth, or state-transition code (grep, and read what you find)
- [ ] No commented-out code in the release diff

## 3. API contract

- [ ] `api/openapi.yaml` lints clean (warnings either zero or explicitly accepted below)
- [ ] Accepted warnings listed here, with reason:
      - `operation-4xx-response` on `/health` — intentional; the endpoint only documents `200`/`503`
- [ ] No breaking change since the last release, or the version was bumped
- [ ] Client types regenerated from the spec (not hand-edited)
- [ ] Contract tests pass for all 42 operations
- [ ] Every error code returned is present in `api/ERROR_CATALOG.md`
- [ ] New error codes have English + Hindi copy

## 4. Database

- [ ] Migrations are forward-only and reviewed by a second person
- [ ] Every migration has a tested rollback path **or** an explicit "not reversible, here is why"
- [ ] Migration runs on a production-sized copy in < 30 s, or is documented as a maintenance window
- [ ] No `DROP COLUMN` in the same release as code that still reads it (two-phase change)
- [ ] Backfill jobs are idempotent and restartable
- [ ] `EXPLAIN ANALYZE` on the five hottest queries after migration
- [ ] Backup taken immediately before migration; restore verified at least once this month
- [ ] Grants unchanged or explicitly re-applied (the app role must not gain `UPDATE` on the ledger)

## 5. Configuration and secrets

- [ ] All required env vars present in the target environment (checked against `examples/sample.env.example`)
- [ ] `PAYMENTS_LIVE=false`, `PAYOUTS_ENABLED=false`, `PROVIDER=mock` at pilot
- [ ] Feature flags reviewed; `mode_bike`, `mode_bus`, `mode_train`, `mode_air` all **off**
- [ ] `PAYMENTS_LIVE=true` would fail boot if provider credentials are missing
- [ ] Secrets are in the secret manager, not in env files, not in the repo
- [ ] Rotated secrets this cycle: (list) — old ones removed after the overlap window
- [ ] No secret in the client bundle (build scan)
- [ ] CORS allowlist contains only our origins
- [ ] Rate limits enabled — verify by actually tripping one in staging

## 6. Observability

- [ ] Structured logs shipping; PII scrub verified (`testing/SECURITY_TEST_CASES.md` `SEC-PRV-03`)
- [ ] Error tracking capturing with release tag and `request_id`
- [ ] Dashboards: latency p50/p95/p99, error rate, booking state distribution, job queue depth,
      DB connections, payment/webhook failures
- [ ] Alerts configured and **fired once in staging** (an untested alert is a belief)
- [ ] On-call rota published for the next 14 days with names and numbers
- [ ] Runbook links present on every alert

## 7. Security

- [ ] `testing/SECURITY_TEST_CASES.md` executed; results attached
- [ ] Zero Critical, zero High findings open
- [ ] Medium findings have an owner and a date
- [ ] TLS/headers verified in staging (`SEC-CFG-01`…`06`)
- [ ] Admin console requires MFA, on a separate origin
- [ ] Access review: every human with production access is listed and justified
- [ ] Incident response plan current, with a named first responder
- [ ] Breach notification path tested as a tabletop exercise (not a real breach)

## 8. Accessibility and content

- [ ] `testing/UAT_CHECKLIST.md` §16 executed
- [ ] axe/Lighthouse scan on 5 key screens: no new violations
- [ ] TalkBack journey completed end-to-end
- [ ] 200% zoom and 320 px width pass
- [ ] Every string has a Hindi translation
- [ ] Copy lint: no "insured", "guaranteed", "100% safe", "escrow" outside the allowed contexts
- [ ] No invented number, testimonial or claim anywhere in the UI

## 9. Performance

- [ ] `testing/LOAD_TEST_PLAN.md` S1 + S2 run on this build, results attached
- [ ] p95 targets met at the pilot hypothesis load
- [ ] Capacity never negative after the concurrency run (SQL assertion quoted)
- [ ] Bundle size within budget on the initial route
- [ ] Lighthouse mobile performance ≥ 80 on landing and send flow

## 10. Deploy mechanics

- [ ] Image built, tagged with the commit SHA, scanned
- [ ] Deploy to staging and run the smoke suite there
- [ ] Migration executed on staging first
- [ ] Rollback plan written and **rehearsed in staging** (`release/ROLLBACK_AND_RECOVERY.md`)
- [ ] Deploy window agreed (avoid 06:00–10:00 and 17:00–21:00 IST — peak booking hours)
- [ ] Someone is watching dashboards for 60 minutes after deploy, by name
- [ ] Previous image digest recorded for instant rollback
- [ ] Feature flags allow disabling payment, matching, or the whole app without a deploy

## 11. Post-deploy (first 60 minutes)

- [ ] `/health` returns `200` in production
- [ ] Synthetic journey: sign in → create parcel → quote → book → mock pay → confirm (in a test account)
- [ ] Error rate at baseline
- [ ] p95 latency at baseline
- [ ] No new alert
- [ ] Job queue draining (not growing)
- [ ] Ledger reconciliation job ran and reported zero mismatches

## 12. Communication

- [ ] Support briefed on what changed and what to say
- [ ] Known issues list sent to support (with the exact words to use)
- [ ] Changelog entry written in plain language, no jargon
- [ ] If user-visible: in-app note or SMS to affected pilot users (only if needed)
- [ ] Internal announcement with the rollback plan and who to call

## 13. Post-release (within 7 days)

- [ ] Defects found by users triaged and linked
- [ ] Release metrics reviewed against the previous release
- [ ] One honest retrospective: what broke, what we got lucky on
- [ ] Checklist itself updated (a checklist that never changes is not being read)

---

## 14. Explicit statements to include in the release note

Copy these, fill the blanks, do not soften them:

> This release runs with **payments disabled / sandbox only**. No real money moves.
> This release has **not** been independently security-tested or accessibility-audited.
> This release has **not** been reviewed by a lawyer for regulatory compliance.
> Parcels are **not insured**.
> Travellers' live location is **not tracked**.
> Known limitations: ______________________

If any of these statements becomes untrue, it must be justified by a specific cleared gate, not by a
feeling that it is probably fine.
