# Migration Strategy

**Status:** Draft v0.1 · **Date:** 2026-10-24

---

## 1. Principles

1. **Every migration is reviewed like code.** No ad-hoc `psql` against production.
2. **Forward-only by default.** Rollback = a new forward migration, except for trivial reversions.
3. **Expand → migrate → contract.** Never drop/rename in one step.
4. **No long locks.** Use `CONCURRENTLY` for indexes; avoid table rewrites on large tables.
5. **Data migrations are separate** from schema migrations and must be idempotent.
6. **Destructive changes require explicit approval** and a verified backup.

## 2. Naming and ordering

```
migrations/
  0001_init.sql
  0002_identity.sql
  0003_parcels_trips.sql
  0004_bookings.sql
  0005_payments.sql
  0006_disputes_reviews.sql
  0007_platform.sql
```
- Sequential, immutable once merged.
- Each file has a header: purpose, author, date, reversibility (yes/no), est. lock time.

## 3. Expand/contract example — renaming a column

| Step | Migration | Deploy |
|---|---|---|
| 1 | Add `new_col` nullable | app writes both |
| 2 | Backfill in batches | app reads `new_col` with fallback |
| 3 | Add constraint / not null | — |
| 4 | Stop writing `old_col` | after verification |
| 5 | Drop `old_col` | next release |

## 4. Safe patterns

| Operation | Safe approach |
|---|---|
| Add NOT NULL column | Add nullable → backfill → set default → add constraint |
| Add index | `CREATE INDEX CONCURRENTLY` |
| Add FK | Add `NOT VALID`, then `VALIDATE CONSTRAINT` |
| Large backfill | Batch (1k rows), sleep, resumable |
| Rename table | New table + dual write + cutover (rare; avoid) |
| Change enum | Add value (safe); never remove values in use |

## 5. Dangerous operations (require approval)

| Operation | Risk | Mitigation |
|---|---|---|
| `DROP TABLE` | Data loss | Backup + 7-day retention of dump + approval |
| `DROP COLUMN` | Data loss | Confirm no readers; contract phase only |
| `ALTER TYPE ... RENAME VALUE` | App breakage | Deploy-compatible window |
| Rewriting a large table | Lock/downtime | Use `pg_repack` or new table |
| Changing `payment_ledger` | Audit break | **Prohibited**; new table if needed |

## 6. Migration execution

```
1. CI checks: syntax, migration order, no destructive ops without flag
2. Run on staging against a production-like snapshot (scrubbed)
3. Time it; if > 30s on staging, redesign
4. Backup production
5. Run with a migration role (not app role)
6. Verify: row counts, constraints, spot queries
7. Deploy app
8. Post-deploy verification
```

## 7. Rollback

| Case | Action |
|---|---|
| App bug, schema compatible | Roll back app image only |
| Migration bug, additive | Forward-fix migration |
| Migration bug, destructive | Restore from backup (last resort; document) |
| Data corruption | PITR to timestamp before migration |

Rollback must be **rehearsed in staging** before a risky production migration.

## 8. Multi-service sequencing

Because this is a monolith, there is one app + one migration stream. The only exception is the worker,
which must tolerate both old and new schema during a rolling deploy — hence expand/contract.

## 9. Seed and fixtures

- Local/test seeds are versioned and deterministic.
- Seeds never contain real personal data.
- Production starts empty; no seed script has production access.

## 10. Audit

`migration_history` table records: id, name, checksum, applied_at, applied_by, duration_ms, success.
A checksum mismatch is an incident (implies edited history).
