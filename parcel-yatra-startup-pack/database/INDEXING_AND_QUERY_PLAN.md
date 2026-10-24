# Indexing & Query Plan

**Status:** Draft v0.1 · **Date:** 2026-10-24

---

## 1. Principles

1. Index for the **actual** queries in `api/openapi.yaml`, not hypothetical ones.
2. Every index has a named query it serves (documented below).
3. Composite index column order = equality columns first, then range, then sort.
4. Partial indexes for status filters (most queries exclude terminal states).
5. Measure with `EXPLAIN (ANALYZE, BUFFERS)` before optimising further.
6. Do not add an index without a query; do not keep an index without evidence of use.

## 2. Critical queries

### Q1 — Matching candidates (hot path)
```sql
SELECT t.id, t.traveller_id, t.departure_at, t.arrival_estimate_at, t.capacity_kg_remaining
FROM trips t
JOIN users u ON u.id = t.traveller_id
WHERE t.origin_city_id = $1
  AND t.dest_city_id   = $2
  AND t.status IN ('published','partially_booked')
  AND t.departure_at <= $3              -- parcel.window_end
  AND t.arrival_estimate_at <= $4       -- window_end + 2h
  AND t.capacity_kg_remaining >= $5     -- weight * 1.1
  AND u.status = 'active'
  AND u.risk_tier <= 2
  AND NOT EXISTS (SELECT 1 FROM blocks b
                  WHERE (b.blocker_id = $6 AND b.blocked_id = t.traveller_id)
                     OR (b.blocker_id = t.traveller_id AND b.blocked_id = $6))
ORDER BY t.departure_at
LIMIT 50;
```
**Index:** `trips_match_idx (origin_city_id, dest_city_id, departure_at) WHERE status IN (...)`
**Note:** `capacity` and `arrival` are checked after the index scan; 50-row limit keeps it small.

### Q2 — Booking by id with ownership
```sql
SELECT * FROM bookings
WHERE id = $1 AND (sender_id = $2 OR traveller_id = $2);
```
**Index:** PK on `id` (sufficient; second predicate filters).

### Q3 — My bookings list
```sql
SELECT id, status, created_at FROM bookings
WHERE sender_id = $1 ORDER BY created_at DESC LIMIT 20;
```
**Index:** `bookings_sender_idx (sender_id, created_at DESC)`.

### Q4 — Verification queue
```sql
SELECT id, user_id, created_at FROM verifications
WHERE state = 'pending' ORDER BY created_at LIMIT 50;
```
**Index:** `verifications_queue_idx` (partial).

### Q5 — Payout candidates (cron)
```sql
SELECT b.id FROM bookings b
LEFT JOIN disputes d ON d.booking_id = b.id AND d.state IN ('open','evidence_requested','under_review')
WHERE b.status = 'delivered'
  AND b.dispute_deadline < now()
  AND d.id IS NULL
  AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.booking_id = b.id);
```
**Index:** `bookings_status_idx (status, updated_at)` + `disputes_one_open` partial unique.
**Better:** add `bookings(status, dispute_deadline)` partial on `status='delivered'` if this runs slowly.

### Q6 — Admin search by phone (hashed)
```sql
SELECT id FROM users WHERE phone_hash = $1;
```
**Index:** unique on `phone_hash`.

### Q7 — Booking timeline
```sql
SELECT * FROM booking_events WHERE booking_id = $1 ORDER BY occurred_at;
```
**Index:** `booking_events_booking_idx (booking_id, occurred_at)`.

### Q8 — Unprocessed webhooks / jobs
```sql
SELECT * FROM jobs WHERE run_at <= now() AND completed_at IS NULL
ORDER BY run_at LIMIT 10 FOR UPDATE SKIP LOCKED;
```
**Index:** `jobs_due_idx` (partial).

### Q9 — Idempotency lookup
```sql
SELECT * FROM idempotency_keys WHERE user_id=$1 AND scope=$2 AND key=$3;
```
**Index:** unique `(user_id, scope, key)`.

### Q10 — Route scorecard (analytics, non-critical)
Aggregate by city pair per week. Use a **read replica**; do not run on primary.

## 3. Index inventory

| Index | Table | Serves | Notes |
|---|---|---|---|
| `users_phone_hash_key` | users | Q6 | unique |
| `users_status_idx` | users | Q1 (partial filter) | partial |
| `sessions_user_idx` | sessions | session revocation | partial |
| `otp_phone_idx` | otp_challenges | OTP rate limiting | — |
| `verifications_queue_idx` | verifications | Q4 | partial |
| `vdocs_purge_idx` | verification_documents | retention job | — |
| `parcels_route_idx` | parcels | admin + matching inputs | — |
| `trips_match_idx` | trips | **Q1** | critical |
| `bookings_one_active_per_parcel` | bookings | invariant | unique partial |
| `bookings_sender_idx` / `bookings_traveller_idx` | bookings | Q3 | — |
| `bookings_status_idx` | bookings | Q5 | — |
| `booking_events_booking_idx` | booking_events | Q7 | — |
| `payments_booking_idx` | payments | payment list | — |
| `payments_provider_event_id_key` | payments | webhook dedupe | unique |
| `ledger_booking_idx` | payment_ledger | reconciliation | — |
| `disputes_one_open` | disputes | Q5 | unique partial |
| `jobs_due_idx` | jobs | Q8 | partial |
| `outbox_pending_idx` | outbox | dispatch | partial |
| `idempotency_keys_user_id_scope_key_key` | idempotency_keys | Q9 | unique |

## 4. Query rules

1. **No `SELECT *`** in application queries on wide tables.
2. **Pagination mandatory** on all list endpoints (`limit` default 20, max 100).
3. **No offset pagination** beyond 1,000 rows — use keyset (`created_at, id`).
4. **No unbounded `IN`lists** from client input.
5. **No OR across unindexed columns** in hot paths.
6. **Timeout** every admin query (`statement_timeout = 5s` for admin role).

## 5. Monitoring

| Check | Frequency | Action |
|---|---|---|
| Slow query log (> 200 ms) | Daily | Review top 10 |
| Index usage (`pg_stat_user_indexes`) | Monthly | Drop unused indexes |
| Table bloat | Monthly | Consider maintenance |
| Lock waits | Weekly | Investigate contention |

## 6. Known future risks

| Risk | Trigger | Mitigation |
|---|---|---|
| Matching query grows | > 5,000 active trips | Add capacity/arrival to index or prefilter table |
| `booking_events` huge | > 10M rows | Partition by month |
| `audit_log` huge | > 10M rows | Archive to cold storage |
| Analytics contention | Admin slow | Read replica (already planned) |
