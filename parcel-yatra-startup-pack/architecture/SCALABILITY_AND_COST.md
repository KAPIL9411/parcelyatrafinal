# Scalability & Cost

**Status:** Draft v0.1 · **Date:** 2026-10-24
All figures are **estimates and hypotheses**, not measured.

---

## 1. Scale assumptions

| Stage | Bookings/month | Concurrent users | Notes |
|---|---|---|---|
| Pilot | 300 | < 20 | Manual ops |
| Early | 2,000 | ~60 | 1 corridor × 3 |
| Growth | 20,000 | ~400 | 5–8 corridors |
| Scale | 200,000 | ~3,000 | Multi-state |

Design target: **handle 20,000 bookings/month** without architectural change; beyond that, revisit.

## 2. Load profile

| Operation | Relative volume | Cost |
|---|---|---|
| Match search | 4× booking volume | DB read-heavy |
| Booking write | 1× | Transaction + lock |
| Status read | 10× | Cached-friendly |
| OTP send | 2× | External cost |
| Notification | 6× booking | External cost |
| Upload | 2× booking | Storage egress |

## 3. Bottlenecks in order of appearance

| # | Bottleneck | Symptom | Fix |
|---|---|---|---|
| 1 | External SMS/OTP cost & rate | spend spike | throttles, caching, provider caps |
| 2 | Matching query cost | slow searches | composite indexes, bounding box, city-pair prefilter |
| 3 | Trip capacity contention | lock waits | short transactions, retry, per-trip hashing |
| 4 | Job queue lag | delayed notifications | more workers; then Redis |
| 5 | DB connections | pool exhaustion | pgbouncer / connection limits |
| 6 | Analytics queries | slow admin | read replica |
| 7 | Object storage egress | cost | CDN, shorter retention |
| 8 | Single-region latency | slow for distant users | edge cache; not pilot |

## 4. Scaling levers (cheapest first)

1. **Indexes** — a booking system's biggest wins.
2. **Query optimisation** — remove N+1, select only needed columns.
3. **API replicas** — horizontal, stateless.
4. **Read replica** — for admin/analytics.
5. **Caching** — only after measuring (matching candidates, city lists).
6. **Queue upgrade** — Redis/BullMQ when job lag appears.
7. **Partitioning** — `booking_events` and `analytics` by month.
8. **Service extraction** — only if a module has genuinely different scaling.

## 5. Cost model at 20,000 bookings/month (HYPOTHESIS)

| Item | Monthly (₹) |
|---|---|
| API compute (4 medium) | 12,000 |
| Worker (2) | 3,000 |
| Postgres (HA, medium) | 18,000 |
| Read replica | 8,000 |
| Object storage + egress | 6,000 |
| CDN/WAF | 4,000 |
| SMS (40,000 msgs) | 6,000 |
| WhatsApp/push/email | 8,000 |
| KYC (2,000 verifications) | 40,000 |
| Maps | 5,000 |
| Observability | 6,000 |
| Payment provider fees | ~2% of GMV |
| **Infra total (excl. payment fees)** | **≈ 116,000** |

At 20,000 bookings × ₹114 contribution = ₹22.8L contribution vs. ~₹1.16L infra → infra is not the
constraint; **support and verification labour are**.

## 6. Cost per booking (pilot vs. growth)

| Cost | Pilot | Growth |
|---|---|---|
| Infra | ₹34 | ₹6 |
| KYC | ₹12 (amortised) | ₹2 |
| Support labour | ₹18 | ₹6 |
| Payment fees | ₹11 | ₹11 |
| **Total variable** | **₹75** | **₹25** |

Pilot contribution ₹68–158 (see pricing doc) means the pilot is viable **only** because support is
founder-labour, not salaried.

## 7. Deliberate scale limits at pilot

| Limit | Why |
|---|---|
| 1 corridor | Ops must be able to phone everyone |
| 5 kg cap | Capacity + liability |
| 300–500 bookings | Human review capacity |
| No bulk API | Avoid B2B SLA obligations |
| Single region | Simplicity, data residency |

## 8. What would force a redesign

| Event | Response |
|---|---|
| > 100 rps sustained | Caching + read replicas + queue upgrade |
| Multi-state operations | Sharding by region or separate DB per region |
| Regulated escrow requirement | New provider integration + audit |
| Real-time tracking requirement | Streaming architecture (and privacy review) |
| 100k+ travellers | Verification automation mandatory |

## 9. Honest summary

Parcel Yatra at pilot scale is **not** a scaling problem. It is an **operations, trust and legal**
problem. Spending engineering effort on scale before 1,000 bookings would be a mistake, and this
document exists partly to justify *not* doing that.
