# Load Test Plan

**Status:** Draft v0.1 · **Date:** 2026-10-24
**Reality check:** this is a two-city pilot. Any plan that targets 100,000 users is theatre. The
purpose of load testing here is to find the **breaking point of the booking transaction** and to prove
that the system degrades predictably — not to chase a vanity number.

---

## 1. Why the pilot does not need heroics

| Fact | Consequence |
|---|---|
| Two corridors, one city pair cluster | Total addressable volume is small |
| Peak is 06:00–10:00 and 17:00–21:00 IST | Load is bursty, not sustained |
| Booking is a short, write-heavy transaction | Contention, not throughput, is the risk |
| Payments are mocked | Provider latency is simulated, not measured |
| Single region, 2 app instances | The plan is sized to what exists |

**The real risk is not volume. It is a thundering herd on a single trip's capacity** — ten senders
racing for two slots on a popular 07:00 departure. That is tested as a concurrency scenario, not a
throughput scenario.

## 2. Targets (hypothesis, to be revised after the first pilot week)

These are **planning assumptions**, not measured facts. They are labelled HYPOTHESIS.

| Metric | Pilot target | Basis |
|---|---|---|
| Concurrent users (peak) | 150 | HYPOTHESIS: < 2% of pilot corridor population active simultaneously |
| Bookings per day (peak) | 300 | HYPOTHESIS: pilot ambition ceiling |
| API requests per second (peak) | 40 | Derived from 150 users × ~0.25 rps |
| p95 read latency | < 250 ms | User-perceptible |
| p95 write latency (booking create) | < 600 ms | Includes capacity reservation |
| p99 write latency | < 1200 ms | Tail tolerance |
| Error rate under target load | < 0.1% 5xx | Availability |
| Capacity race correctness under load | 100% correct | Non-negotiable |
| Connection pool saturation | < 70% at peak | Headroom |

If the pilot exceeds these, re-plan rather than claim the old numbers were right.

## 3. Scenarios

### S1 — Browse and match (read-heavy)

```
ramp 0 → 150 VUs over 3 min
hold 10 min at 150 VUs
ramp down over 2 min
```

Journey per VU: `GET /health` → `GET /parcels/{id}/matches` → `GET /bookings?limit=20` →
`GET /trips` → think 3–8 s.

**Assertions:** p95 < 250 ms; 5xx < 0.1%; match query never triggers a sequential scan
(`EXPLAIN` checked separately).

### S2 — Booking creation under contention (the important one)

```
20 VUs, all targeting the SAME trip with capacity_kg = 2
Each VU: create quote → POST /bookings → accept → measure outcome
Repeat 50 rounds
```

**Assertions:**
- Exactly `floor(capacity / parcel_weight)` bookings are created per round.
- Capacity never goes negative (asserted with a direct SQL check after the run).
- No `500`s; only `201` or `409 CAPACITY_UNAVAILABLE`.
- p99 of the failure path < 300 ms (a losing request must fail fast, not queue).

This scenario is the one that would embarrass the product in public. It runs on every release.

### S3 — Handover burst

```
50 VUs over 60 s
Each: pickup confirmation with a valid OTP, then delivery confirmation on a second booking
```

**Assertions:** each OTP consumed exactly once; no duplicate `booking_events`; p95 < 500 ms.

### S4 — Webhook storm

```
600 requests in 60 s, 20% duplicates, 5% invalid signatures
```

**Assertions:** zero duplicate ledger rows; invalid signatures `401`; DB write amplification bounded
(no more than 2 rows per valid event); no connection-pool exhaustion.

### S5 — Sustained soak (60 min)

150 VUs mixed 80/20 read/write for one hour, with a rolling deploy at minute 30.

**Assertions:** no memory growth > 10%; no connection leak (pool count stable); p95 does not degrade
more than 20% from minute 5 to minute 55; zero 5xx during the rolling restart.

### S6 — Degradation drill (not a load test, but run alongside)

Kill one app instance mid-soak; kill the DB's primary read replica (if any); inject 2 s latency into
the mock payment provider.

**Assertions:** health endpoint reports `degraded`; in-flight bookings either complete or fail
cleanly; no partial writes; alerts fire.

## 4. Data

- Synthetic only: 5,000 users, 1,200 trips across the two corridors, 3,000 parcels.
- Deliberately skewed: 60% of parcels target the same 20 trips (contention is the point).
- Seeded before each run; database dropped after.
- **Never** run against staging data that contains a real phone number.

## 5. Tooling

| Concern | Tool |
|---|---|
| HTTP load | k6 (scripted, version-controlled) |
| Assertions | k6 thresholds + a SQL verification step after the run |
| DB observation | `pg_stat_statements`, `pg_stat_activity`, connection pool metrics |
| App observation | Prometheus metrics, structured logs |
| Profiling (if a latency target fails) | Node `--cpu-prof` on a single instance |
| Reporting | k6 JSON summary committed to the release folder |

## 6. Environment

- Dedicated staging namespace with the **same instance sizes** as the intended pilot production.
- Test against a database with production-like row counts, not an empty schema — an empty table hides
  every index problem.
- Payments mocked, notifications suppressed (otherwise SMS cost is real money).
- Load generator runs from a separate host so it does not compete for CPU.

## 7. Pass/fail thresholds (k6)

```js
export const options = {
  thresholds: {
    'http_req_duration{scenario:browse}': ['p(95)<250'],
    'http_req_duration{scenario:booking}': ['p(95)<600', 'p(99)<1200'],
    'http_req_failed': ['rate<0.001'],
    'http_req_duration{scenario:webhook}': ['p(95)<300'],
  },
};
```

Plus post-run SQL assertions:

```sql
-- must be zero
SELECT count(*) FROM trips WHERE capacity_kg_remaining < 0;
-- must be zero
SELECT count(*) FROM bookings b
  JOIN parcels p ON p.id = b.parcel_id
 WHERE b.status NOT IN ('cancelled_by_sender','cancelled_by_traveller','expired')
 GROUP BY p.id HAVING count(*) > 1;
-- ledger must balance
SELECT sum(amount_paise) FROM payment_ledger WHERE entry_type = 'capture'
  - (SELECT sum(amount_paise) FROM payment_ledger WHERE entry_type = 'refund');
```

## 8. Interpreting results honestly

| Observation | Correct conclusion | Wrong conclusion |
|---|---|---|
| p95 passes at 150 VUs | The system handles the pilot assumption | "We scale to 150 concurrent users" |
| p95 fails at 150 VUs | Find the bottleneck before launch | "Increase the timeout" |
| Errors only under contention | The transaction design needs work | "Add more instances" |
| DB CPU at 90% | Query or index problem | "Buy a bigger database" (sometimes right, but diagnose first) |
| All green on an empty DB | Nothing proven | "Performance is fine" |

**Rule:** a load test report must state the data volume, the instance size, the scenario, the
percentiles and the failure mode observed. A single "passed" line is not a report.

## 9. What this plan deliberately excludes

| Excluded | Reason |
|---|---|
| 10,000 VU tests | Not the pilot's problem; would produce a scary graph with no decision value |
| Multi-region latency | Single region at pilot |
| DDoS simulation | Out of scope; handled by the CDN/host provider |
| Mobile radio-state simulation (2G/3G) | Covered by Lighthouse throttling and manual device testing instead |
| Payment provider load | Not our system; contractually their problem |
| Long-duration endurance beyond 1 h | Diminishing returns at pilot scale |

## 10. Schedule

| When | What |
|---|---|
| Every PR touching booking/payment/ledger code | S2 (concurrency) in CI, scaled down (5 VUs, 5 rounds) |
| Weekly on staging | S1 + S2 at full target |
| Before release | S1, S2, S3, S4 + a 15-minute soak |
| Post-launch, monthly | S5 soak, revised targets based on real traffic |
| Before any scale-up | Full re-plan with new hypotheses, not a re-run of these numbers |

## 11. Cost discipline

The full suite runs for about 90 minutes on two mid-size instances. Run it on a weekday morning, tear
the environment down immediately, and do not leave load generators running. A forgotten k6 process is
a real bill and a fake data point.

## 12. Reporting template

```
Date / commit / environment:
Data volume:            users / trips / parcels
Scenario:               S1 / S2 / ...
VUs & duration:
Instance sizes:

p50 / p95 / p99 (read):
p50 / p95 / p99 (write):
Error rate:
5xx count:
Correctness assertions: pass/fail (quote the SQL result)
Bottleneck observed:
Decision taken:
Not tested:
```
