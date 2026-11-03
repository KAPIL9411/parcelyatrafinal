# Route-corridor matching (formula `match-p2.0`)

## 1. Root cause

The old matcher asked the wrong question. Its Stage A query required

```sql
t.dest_city_id = parcel.dest_city_id
AND t.origin_city_id = ANY(cities within 10 km of the parcel origin)
```

so a trip was only visible when the two city pairs were (almost) identical. A Bareilly → Delhi
traveller drives through Moradabad and Ghaziabad, but a Moradabad → Ghaziabad parcel was invisible:
neither of its cities is an endpoint. The remaining signals were equally coarse:

- "detour" was the crow-flies distance between city centroids, not the cost of leaving the road;
- there was no travel-direction check, so a Delhi → Ghaziabad parcel could be scored against a
  Bareilly → Delhi trip;
- the deadline was checked against the trip's final arrival, so a mid-route delivery inherited the
  final city's ETA;
- no route geometry was stored, so there was nothing to validate a corridor against.

## 2. What changed

Matching is now a two-stage corridor search. Stage A is cheap SQL; Stage B is pure geometry and
ranking. No routing provider is called per candidate.

**Stage A (sender: `GET /parcels/:id/matches`)** keeps a trip when either

1. the city pair is exact, or
2. the trip's stored route bounding box, padded by `MATCH_MAX_CORRIDOR_KM`, contains both parcel
   cities.

It also applies status, departure, deadline and remaining-capacity filters, orders by departure and
caps the scan at `MATCH_CANDIDATE_SCAN_LIMIT` (default 200).

**Stage A (traveller: `GET /trips/:id/opportunities`)** is the mirror image: parcel window overlap,
weight fit, not the traveller's own parcel, and either the exact pair or both cities inside the padded
route box.

**Stage B** decodes each candidate trip's polyline once, builds a route index, projects both parcel
cities onto it, and applies the gates below. The exact city pair always passes the geometry gate
(`route_source: 'exact'`); a non-exact pair with no geometry is refused as `ROUTE_NOT_EVALUABLE`
instead of being guessed from a straight line.

Trip geometry is measured once and stored on `trips` (encoded polyline, bbox, distance, duration,
source, status, expiry). Measurement runs in the background on trip creation and through a
`JOBS_ENABLED`-gated backfill; it is never on the request path.

## 3. Formula

For a candidate trip and parcel:

```
pickup = project(parcel.origin, route)
drop   = project(parcel.dest,   route)

offsetM  = perpendicular distance from the city to the road
alongM   = distance along the road from the trip origin
fraction = alongM / route.distanceM

detourM  = 2 * pickup.offsetM + 2 * drop.offsetM
legM     = drop.alongM - pickup.alongM
```

Hard gates, in order:

| Gate | Reject code |
| --- | --- |
| trip status not `published` / `partially_booked` | `TRIP_NOT_ACTIVE` |
| traveller not verified | `TRAVELLER_NOT_VERIFIED` |
| no route geometry and not an exact pair | `ROUTE_NOT_EVALUABLE` |
| estimated route when `MATCH_REQUIRE_ROUTED_GEOMETRY=true` | `ROUTE_NOT_EVALUABLE` |
| `pickup.offsetM > maxCorridorKm` | `PICKUP_OFF_CORRIDOR` |
| `drop.offsetM > maxCorridorKm` | `DROP_OFF_CORRIDOR` |
| `drop.alongM < pickup.alongM` | `WRONG_DIRECTION` |
| `legM < minLegKm` | `LEG_TOO_SHORT` |
| `detourM > maxDetourKm` | `DETOUR_TOO_LARGE` |
| parcel not inside the trip's time window | `ARRIVES_TOO_LATE` / `DEPARTS_AFTER_WINDOW` |
| remaining capacity below `weight × 1.1` | `NO_CAPACITY` |
| prohibited content / mode / serviceability | existing eligibility codes |

ETAs are computed at the parcel's own points, not at the trip destination:

```
durationS   = route.durationS (or declared trip duration if no route)
pickupMs    = departure + pickup.fraction * durationS * 1000
dropMs      = departure + drop.fraction   * durationS * 1000
              (exact pair: dropMs = trip.arrival_estimate_at)
```

The delivery deadline gates on `dropMs`; the pickup must also be inside the window. An overnight trip
therefore keeps the correct calendar day at each point.

Score (each fit is 0–1, weights sum to 100 by default):

```
score = Σ(weight_i × fit_i) / Σ weight_i × 100
```

| Component | Weight | Fit |
| --- | --- | --- |
| `time` | 25 | `(windowEnd + grace − dropMs) / ((grace + timeTargetLeadHours) × 1h)` |
| `departure` | 15 | 1 if pickup is after the window opens, linear decay over 48 h before it |
| `detour` | 15 | `1 − detourM / maxDetourM` |
| `alignment` | 15 | `1 − max(pickup.offsetM, drop.offsetM) / maxCorridorM` |
| `reliability` | 15 | completed / (completed + traveller cancellations), last 20 finished trips; new = 0.25 |
| `capacity` | 10 | remaining kg vs required kg, 1 at 2× and 0 at the hard floor |
| `preference` | 5 | half area agreement, half category intent |

Tie-breakers are deterministic: score desc, earliest `dropMs`, earliest departure, trip id.
The score breakdown is returned as `score_breakdown.fit` and `.points`, with
`formula_version: "match-p2.0"`.

## 4. Data model

Migration `apps/api/migrations/0013_route_matching.sql` is additive and nullable:

| Column | Purpose |
| --- | --- |
| `route_geometry` | encoded polyline (Google/OSRM format) |
| `route_distance_m`, `route_duration_s` | numbers used for ETA and detour |
| `route_provider`, `route_source` | `osrm` / `routed` or `estimated` |
| `route_status` | `pending`, `ready`, `estimated`, `unavailable` |
| `route_computed_at`, `route_expires_at` | measurement time and refresh deadline |
| `route_min_lat/max_lat/min_lng/max_lng` | Stage A bounding box |

Indexes:

- `trips_active_departure_idx` — live trips in departure order (the candidate scan);
- `trips_route_pending_idx` — the backfill queue;
- `trips_route_expiry_idx` — the re-measurement sweep.

Old rows default to `route_status = 'pending'`: exact city pairs keep matching, corridor matches
appear once the backfill measures them. The DOWN block is kept as a comment in the migration because
the runner applies files forward only.

## 5. API changes (additive)

`GET /v1/parcels/:id/matches` — each match now includes:

```json
{
  "route_source": "routed | estimated | exact",
  "detour_km": 0,
  "leg_km": 12.4,
  "pickup_eta_at": "2026-10-25T01:30:00.000Z",
  "drop_eta_at": "2026-10-25T05:45:00.000Z"
}
```

`GET /v1/trips/:id/opportunities` — adds `route_status` at the top level.

`GET /v1/trips/:id` — adds `route_status`, `route_source`, `route_distance_km`.

No existing field was removed or renamed. Older clients ignore the new keys.

## 6. Configuration

```dotenv
MATCH_MAX_CORRIDOR_KM=8
MATCH_MAX_DETOUR_KM=16
MATCH_MIN_LEG_KM=1
MATCH_REQUIRE_ROUTED_GEOMETRY=false
MATCH_ROUTE_TTL_DAYS=14
MATCH_ROUTE_BACKFILL_BATCH=5
MATCH_WEIGHTS=time=25,departure=15,detour=15,alignment=15,reliability=15,capacity=10,preference=5
```

`MATCH_REQUIRE_ROUTED_GEOMETRY=true` is the strict mode: only measured roads (or an exact city pair)
can match. It is the correct setting when a straight line is unacceptable as evidence, at the cost of
losing corridor matches during a routing outage.

## 7. UI

Web (`Send.tsx`, `ParcelDetail.tsx`) and mobile (`match-card.tsx`) now show:

- **Drop by** using `drop_eta_at`, not the trip's final arrival;
- **On the route** or **+N km detour** using `detour_km`;
- the old crow-flies band only as a fallback for older API responses.

## 8. Verification

Executed on the current tree:

| Command | Result |
| --- | --- |
| `npm run typecheck` | 4/4 workspaces clean |
| `npm run test:domain` | 108 passed, 0 failed |
| `npm run test:api` | 87 passed, 0 failed |
| `npm run test:mobile` | 10 passed, 0 failed |
| `cd apps/mobile && npx expo lint` | clean |

New coverage:

- `packages/domain/test/route-match.test.ts` — 18 tests: projection, direction, corridor offsets,
  detour and leg limits, missing geometry, estimated vs routed, deadline at the drop point, overnight,
  capacity and cancelled trips.
- `apps/api/test/route-matching.test.ts` — 9 tests: polyline round-trip, sender discovery, traveller
  discovery, reversed parcel, pending geometry, duplicate interest, concurrent overbooking, cancelled
  trip.

The API tests write route geometry directly, so they are deterministic and offline. **Live OSRM
behaviour is not exercised by CI**; that remains a deployment smoke test.

## 9. Performance and free-tier limits

- Stage A is a bounded scan (`LIMIT 200`). The bbox comparison uses four numeric columns; there is no
  PostGIS dependency.
- Stage B is O(candidates × polyline points). At 200 candidates × ~500 points this is ~100k point
  projections per request — acceptable in Node, but it is the first thing to cache if traffic grows.
- `LIMIT` is a hard cap, not pagination. A very busy corridor can crowd out later departures; raise
  `MATCH_CANDIDATE_SCAN_LIMIT` or add a keyset page if that happens.
- The backfill measures `MATCH_ROUTE_BACKFILL_BATCH` trips every 10 minutes, one at a time. At the
  default 5 that is ~720 trips/day; a 1,000-trip backlog takes roughly a day and a half. Raise the
  batch or run a one-off measurement for a launch corridor.
- Public OSRM demo has no SLA and is rate-limited. The code serialises requests and labels fallbacks;
  it never retries in a loop.
- Storage: ~4 KB of polyline per trip. Even 10,000 trips is ~40 MB, inside Neon's free tier. The
  migration adds no rewrite and no backfill of user data.
- Render free instances sleep; the backfill timer resumes on the next boot and runs a tick
  immediately, so pending routes are picked up after a cold start.

## 10. Deploy

1. Take a database backup or Neon branch.
2. Apply the migration **before** the new API code:
   `npm run db:migrate` (or `MIGRATE_ON_BOOT=true`). Old code ignores the new columns.
3. Deploy the API with `JOBS_ENABLED=true` and the matching variables above.
4. Deploy web and mobile. They tolerate a missing `drop_eta_at` / `detour_km`.
5. Smoke test:
   - publish Bareilly → Delhi; wait for `route_status` to become `ready`;
   - request matches for a Moradabad → Ghaziabad parcel; it should appear with `route_source: routed`;
   - request matches for a Delhi → Ghaziabad parcel; it must not appear;
   - check logs for `trip route measurement failed` and `backfill tick failed`.

## 11. Rollback

- Fastest: redeploy the previous API release. The new columns are additive, so old code runs
  unchanged.
- Stop background measurement with `JOBS_ENABLED=false`.
- If the schema itself must go, run the DOWN block at the bottom of `0013_route_matching.sql` by hand
  after the old code is live. It drops only derived route columns; parcels, trips, bookings and
  payments are untouched.
- Restore the backup only if the migration failed midway (the runner wraps each file, but a manual
  rollback is still the safe path).

## 12. Risks and open items

1. **Straight-line fallback can over-match.** A city within 8 km of the straight line, but far from
   the real road, may match while the provider is down. Set `MATCH_REQUIRE_ROUTED_GEOMETRY=true` if
   that is unacceptable.
2. **Routing outage reduces corridor matches.** Exact city pairs keep working; everything else waits
   for the backfill.
3. **Existing trips are `pending` until measured.** Corridor discovery is delayed by up to one
   backfill cycle. This is deliberate: no fabricated matches.
4. **Public OSRM is not a production SLA.** If it becomes unreliable, point `OSRM_ROUTER_URL` at a
   self-hosted instance or set `ROUTING_PROVIDER`/fallback policy accordingly.
5. **No live-provider E2E test.** The geometry tests use fixtures; the deployment smoke test is the
   first real measurement.
6. **Score reordering.** `match-p2.0` changes weights and adds `alignment`; existing matches may move.
   The formula version is exposed for support.
7. **Local dev database is corrupt.** `apps/api/data/pgdata` aborts on open. Delete it and let
   `AUTO_SEED=true` recreate it; this does not affect production.
8. **Unrelated working-tree work.** Live-tracking files (`0012`, `socket/`, `tracking*`) and deleted
   deployment notes are present but not part of this change. Commit the matching files separately.
