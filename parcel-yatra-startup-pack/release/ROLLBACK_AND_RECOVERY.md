# Rollback and Recovery

**Status:** Draft v0.1 · **Date:** 2026-10-24
**Principle:** the fastest safe action is usually to stop doing the bad thing, not to fix it live.

---

## 1. Order of operations during an incident

```
1. Stop the bleeding      → flip a feature flag, disable payments, drain traffic
2. Preserve evidence      → do not restart-and-pray before snapshotting logs
3. Decide rollback vs fix → §2
4. Execute                → §3–§6
5. Verify                  → §7
6. Reconcile money         → §8
7. Write it down          → §9
```

**Do not** debug in production while the system is actively corrupting booking state. Disable the
affected capability first.

## 2. Decision table

| Symptom | First action | Then |
|---|---|---|
| Booking state corruption (double accept, wrong transitions) | Disable `matching` and `booking_transitions` flags | Investigate, rollback if deploy-correlated |
| Duplicate charges or payouts | `PAYMENTS_LIVE=false`, `PAYOUTS_ENABLED=false` | Reconcile before re-enabling |
| Auth broken / users locked out | Roll back the last deploy | Check token signing keys first |
| Data leak suspected | Disable the leaking endpoint via flag, revoke sessions | Incident response (`security/INCIDENT_RESPONSE_PLAN.md`) |
| Elevated 5xx after deploy | Roll back immediately, ask questions later | Compare with previous image |
| DB migration error | **Do not** roll back the image first — assess schema state | §5 |
| Slow, not broken | Scale out, then investigate | Rollback if degradation is deploy-correlated |
| Third-party outage (SMS, storage) | Degrade gracefully; do not roll back our code | §6 |

## 3. Application rollback

### 3.1 Standard rollback (no migration in the release)

```
1. Identify previous image digest:  recorded in the release ticket
2. Deploy previous digest to all instances
3. Wait for health checks:  /health returns 200 on every instance
4. Verify: synthetic journey + error rate baseline
5. Announce in the incident channel
```

Target: **< 5 minutes** from decision to previous version serving traffic.

Requirements that must exist before this can work:

- [ ] Previous image digest recorded at deploy time
- [ ] Image retention ≥ 10 releases
- [ ] Rollback deploy is the same pipeline as forward deploy (no special path that is never exercised)
- [ ] Rollback rehearsed in staging within the last 30 days

### 3.2 Rollback with feature flags only (preferred when possible)

If the defect is confined to a capability, prefer a flag flip over a deploy:

| Flag | Disables | User-visible effect |
|---|---|---|
| `payments_enabled` | Payment intents | Booking cannot be paid; existing bookings unaffected |
| `payouts_enabled` | Payout release | Travellers wait; no money moves |
| `matching_enabled` | New quotes/matches | Existing bookings continue |
| `new_bookings_enabled` | Booking creation | Existing bookings continue; senders see a maintenance message |
| `verification_submissions_enabled` | New KYC | Verification queue stops growing |
| `app_readonly` | All mutations | Reads continue; a clear maintenance banner |

A flag flip is reversible in seconds and does not risk a bad deploy. **Design for it:** every
mutating capability must be behind a flag from day one.

## 4. Database rollback

The hardest case. Rules:

1. **Forward-only migrations.** Do not write `down` migrations that drop data unless you have proven
   there is no data you need.
2. **Two-phase changes** for anything destructive:
   - Release N: add the new column, write to both, read from old.
   - Release N+1: read from new.
   - Release N+2: stop writing to old, drop it later.
3. A release containing a destructive migration is **not** rollback-able by image alone. Its rollback
   plan must be written in the release ticket before merge.
4. Restore-from-backup is the last resort and has a data-loss cost measured in minutes. Say the number
   out loud before choosing it.

### Migration failure procedure

```
1. Stop the deploy (do not let remaining instances start)
2. Determine: did the migration partially apply?
   - Postgres DDL is transactional for most operations: prefer single-transaction migrations
   - If partial: apply the documented compensating script, never ad-hoc SQL
3. If the schema is forward-compatible and the old code still works → roll back the image only
4. If the schema is incompatible → restore from the pre-migration snapshot, then redeploy the old image
5. Record actual data loss window (timestamps of writes at risk)
6. Reconcile anything that happened between snapshot and restore
```

**Non-transactional operations to avoid entirely:** `CREATE INDEX CONCURRENTLY` mixed with other DDL
in the same migration; `ALTER TYPE ... ADD VALUE` followed by use of the value in the same
transaction; long backfills inside a DDL transaction.

## 5. Money-state recovery (the part that matters most)

If a deploy or incident touched payments, the sequence is fixed: **freeze, reconcile, then restore.**

```
1. Set PAYMENTS_LIVE=false and PAYOUTS_ENABLED=false
   → no new money moves, regardless of what else is wrong
2. Snapshot: payment_ledger, payments, refunds, payouts, booking_events
3. Pull the provider's settlement report for the affected window
4. Reconcile line by line:
   - captured by provider, missing in our ledger  → orphan
   - in our ledger, not captured by provider      → phantom (dangerous)
   - amount mismatch                              → investigate as fraud
   - duplicate entries                            → refund or reverse per policy
5. Resolve each class with a written decision. Never "adjust the sum to match".
6. Only after zero unexplained breaks: re-enable payouts. Re-enable payments separately, later.
```

**Never** re-enable payments on the same day as a money incident. Sleep on it.

### Ledger repair rules

- The ledger is append-only. Corrections are new entries, never edits.
- Every correction entry references the original entry ID and a reason code.
- Two-person approval for any correction above ₹1,000.
- Every correction is audited and appears in the daily reconciliation report.

## 6. External dependency failure

| Dependency down | Behaviour | Recovery |
|---|---|---|
| SMS provider | Notifications queue and retry; OTP login is **blocked** with a clear message | Failover provider if configured; otherwise wait and be honest |
| Storage (S3/MinIO) | Upload disabled; existing views work if cached | Retry; no data loss |
| Payment provider | Intents fail with `503`; **never** mark as failed or paid | Poll status; reconcile later |
| Push provider | Silent degradation; in-app + SMS fallback | Retry queue |
| Database primary | Full outage; `503` from health | Failover or restore (§4) |

The rule for every one: **degrade visibly and honestly.** A user who is told "we can't confirm right
now, we'll text you" is fine. A user who sees a fake success is not.

## 7. Verification after recovery

Do not declare recovery from a green health check. Run this:

- [ ] `/health` `200` on every instance
- [ ] Synthetic journey: sign in → create parcel → quote → book → mock pay → pickup → deliver
- [ ] Error rate at or below the pre-incident baseline
- [ ] p95 latency at or below baseline
- [ ] Job queue depth decreasing
- [ ] No new alerts for 15 minutes
- [ ] Ledger reconciliation: zero unexplained mismatches
- [ ] Booking state invariants hold (SQL assertions from `testing/LOAD_TEST_PLAN.md` §7)
- [ ] A sample of 10 affected users actually has the state they should

## 8. Communication during an incident

| Audience | When | What |
|---|---|---|
| Incident channel | Immediately | Symptom, impact, who is leading |
| Support | Within 15 min | What to tell users, exact words |
| Affected users | Within 1 h if money or data affected | Plain language, what happened, what we are doing, what they should do |
| Regulator | Per legal advice | **Not** a unilateral decision — `security/INCIDENT_RESPONSE_PLAN.md` |

Never speculate publicly about cause. Never blame a provider before confirming. Never say "no data was
affected" until it is verified.

## 9. Post-incident

Within 72 hours, a written review containing:

1. Timeline with timestamps in IST, from first signal to resolution.
2. Customer impact: how many users, how much money, what data.
3. Root cause — the actual one, not "human error".
4. What made it worse (usually: detection time, or a rollback that had never been rehearsed).
5. Actions with owners and dates.
6. Which check in this pack should have caught it, and why it did not.

**Blameless but not vague.** "The deploy process lacked a canary" is a finding. "We'll be more careful"
is not.

## 10. Recovery objectives (pilot, hypothesis)

| Metric | Target | Basis |
|---|---|---|
| RTO (time to restore service) | 2 hours | HYPOTHESIS; single region, small team |
| RPO (acceptable data loss) | 15 minutes | HYPOTHESIS; requires WAL archiving or 15-min snapshots |
| Backup retention | 30 days | Financial record needs |
| Restore drill frequency | Monthly | An untested backup is a rumour |
| Max tolerated downtime during business hours | 30 minutes | Pilot users are few; honesty buys patience |

These are **targets to be validated**, not achieved facts. The first restore drill will tell you what
the real RPO is.

## 11. Pre-launch requirements for this plan to be usable

- [ ] Backups actually run (verify, do not assume)
- [ ] A restore has been performed successfully at least once
- [ ] Previous image digest is recorded automatically at deploy
- [ ] Every mutating capability is behind a flag
- [ ] Flags can be flipped by someone who is not the deployer
- [ ] The provider settlement report is accessible to at least two people
- [ ] This document is reachable from the alert, not buried in a repo
- [ ] Someone has read it before the incident, not during
