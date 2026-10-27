# Connected city network, road distances and launch pricing

This document describes what is actually implemented for the launch network: the geography model,
the distance engine, the route status ladder, serviceability, the v2 fare engine and the staff
controls behind them. It also lists what is **not** verified in the current environment, so no
reader has to infer coverage from a city appearing in a list.

The short version: the schema, seeder, APIs, fare engine and staff controls are implemented and
exercised by tests against PostgreSQL semantics (PGlite). **No city pair has a measured road
distance yet** unless a Google Routes key has been supplied and the matrix has been run; until
then every quote is computed on a labelled straight-line estimate, and the app says so. No hotspot
has verified coordinates, so doorstep serviceability is refused. Speed Post benchmarks are empty.

---

## 1. Geography model

Migration `apps/api/migrations/0010_geo_network.sql` adds:

| Table | Purpose |
| --- | --- |
| `countries` | Country names and ISO codes |
| `states` | State/province per country |
| `cities` | Existing table, extended with `state_id`, `status`, `coordinate_source`, `coordinate_verified_at` |
| `zones` | Named catchments inside a city |
| `hotspots` | Candidate pickup / drop-off points, with coordinates, verification and service modes |
| `route_edges` | One row per **directed** city pair, carrying distance and the route status ladder |
| `distance_cache` | Provider responses with `status`, `distance_m`, `duration_s`, `fetched_at`, `expires_at` |
| `pricing_policies` | Versioned fare parameters; at most one `active` |
| `postal_benchmarks` | Optional Speed Post reference rates, stored separately from fares |

The migration seeds:

- **8 cities, once each**, with state links and `coordinate_source = 'manual_reference'`:
  Baheri, Bareilly, Delhi, Ghaziabad, Rudrapur, Haldwani, Pilibhit, Lucknow.
  The three cities that predate this migration (Bareilly, Delhi, Lucknow) are inserted with the
  same IDs the demo seeder uses, and `ON CONFLICT (name, state) DO NOTHING` keeps a second run
  idempotent.
- **4–5 zones per city** (`Central`, `Transport hubs`, `Residential catchments`, `Corridors`,
  plus `Industrial` for Rudrapur and Ghaziabad).
- **41 hotspot candidates** named from the launch brief. All are `candidate`, `unverified`, with
  `lat`/`lng` NULL and pickup/drop-off disabled. A hotspot cannot be activated until an operator
  enters coordinates and verifies it (database check constraints enforce this).
- **56 directed route edges** — every ordered pair of the 8 cities — all `candidate`, with no
  distance. City pairs are directed on purpose: a return trip is a separate edge.
- **One active pricing policy** (`launch-2026-10-experiment`) whose values mirror the compiled
  defaults in `packages/domain/src/launch-pricing.ts`.

Cities keep their existing `is_serviceable` flag; `status` is the newer gate and the quote handler
refuses to price an origin or destination whose status is not `active`.

## 2. Route status ladder

Route status and booking ability are separate questions, and the API never collapses them:

```
candidate ──measure──▶ calculated ──approve──▶ approved ──operate──▶ operational
     └──────────── measure fails ──────────▶ failed
                                             
any non-operational ──retire──▶ retired
```

- `candidate`: the pair exists in the network; nothing has been measured.
- `calculated`: a provider returned a distance. Not yet an operator decision.
- `approved`: a `trust_safety` operator approved the measured pair. Still not bookable.
- `operational`: the pair is live. `GET /v1/geo/routes` reports `bookable: true` only for
  `operational` edges **with** a distance.
- `failed`: the last measurement failed. The edge can be retried.
- `retired`: removed from the public route list.

`POST /v1/admin/geo/routes/:routeId/decision` enforces the ladder: `approve` only from
`calculated` with a distance, `operate` only from `approved` and only when both cities are
`active`, `retire` from anything. Every decision writes an audit row.

A quote is produced only when a distance can be resolved. With the safe default
(`REQUIRE_OPERATIONAL_ROUTE=false`) a pair without a measured edge may be priced on a labelled
estimate; set `REQUIRE_OPERATIONAL_ROUTE=true` to refuse anything not `operational`.

## 3. Distance engine

`apps/api/src/lib/routing.ts` implements the only path by which a road distance enters the system.
Resolution order for a directed city pair:

1. `route_edges.distance_m` — a measured, operator-visible distance.
2. `distance_cache` — a successful provider response that has not expired.
3. A straight-line estimate (`corridorKm`, a great-circle-derived lower bound) **only** when
   `ALLOW_ESTIMATED_DISTANCE=true`. This is always labelled `estimated` in the quote and in the
   breakdown note.
4. Otherwise the pair is `unavailable` and the quote request fails with `CITY_NOT_SERVICED`
   (HTTP 503 when the cause is that routing is not configured is surfaced separately as
   `ROUTING_UNAVAILABLE` on the admin refresh path).

Distance resolution **never runs on a read path**. It is called from the quote handler and the
serviceability endpoint, and measurement happens offline through a script or an admin refresh.

### Google Routes

The provider is Google Routes `computeRouteMatrix`:

- Endpoint: `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`
- Method: POST, `X-Goog-Api-Key`, `X-Goog-FieldMask`, `TRAFFIC_UNAWARE`
- Per-element status and condition are honoured; a `ROUTE_NOT_FOUND` element is recorded as a
  failure rather than a zero distance.

Required environment variables (placeholders live in `.env.example` and
`.env.production.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ROUTING_PROVIDER` | `none` | `none` or `google` |
| `GOOGLE_MAPS_API_KEY` | unset | Server-side key; required when provider is `google`; the literal `CHANGE_ME` is refused at boot |
| `ROUTES_CACHE_TTL_DAYS` | `30` | How long a cached measurement is trusted |
| `ROUTING_TIMEOUT_MS` | `8000` | Per-call timeout |
| `ROUTING_MAX_ELEMENTS_PER_CALL` | `100` | Matrix chunk size (Google allows up to 625 elements) |
| `REQUIRE_OPERATIONAL_ROUTE` | `false` | Refuse to price non-operational pairs |
| `ALLOW_ESTIMATED_DISTANCE` | `true` | Permit a labelled estimate when nothing is measured |

### Filling the 56 directed pairs

```bash
# Measure pairs that have no measured distance (provider + key required):
npm run geo:matrix -w @py/api

# Re-measure every pair that is not approved/operational:
npm run geo:matrix -w @py/api -- --all
```

The script refuses to run while migrations are pending. Without a provider it prints the required
environment variables and every unresolved pair, then exits non-zero. It prints resolved/failed
counts and route-status counts, and exits non-zero if any element failed. Approved and operational
edges are never overwritten by a refresh — those are operator decisions.

The same refresh is available to staff at `POST /v1/admin/geo/routes/refresh` for at most 10
pairs per call; it answers `ROUTING_UNAVAILABLE` when no provider is configured, and writes an
audit row.

## 4. Serviceability

`GET /v1/geo/serviceability` answers two separate questions, each with its own reason:

- `hub_to_hub.bookable` — both cities `active` and serviceable, and a distance resolvable.
- `doorstep.bookable` — the hub answer must hold **and** both ends need an `active`, `verified`
  hotspot with the matching pickup/drop-off capability and `doorstep` in `service_modes`.

Reasons are explicit (`city_not_active`, `city_not_serviceable`, `no_verified_pickup_hotspot`,
`origin_hotspot_not_verified`, `distance_unresolved`, …), never a bare boolean. Because every
seeded hotspot is unverified, doorstep is currently refused for every pair — by design, not by
accident.

`GET /v1/geo/journeys` runs a bounded Dijkstra over operational edges (`include_calculated=true`
widens it to calculated edges), with 1–3 legs. It reports `bookable: true` only for a single
operational leg. Multi-leg journeys are informational: parcel custody across a handover is not
implemented, and the response says so.

## 5. Launch fare engine (v2)

`packages/domain/src/launch-pricing.ts` computes every sender price. Formula
(`v2.0-launch`):

```
billableWeight = max(actualWeightKg, L·W·H / volumetricDivisor)
gross          = base + distance + weight + handling + pickup + dropoff
adjusted       = gross × surge
discount       = adjusted × discountRate        (platform-funded)
tax            = (adjusted − discount) × taxRate
total          = adjusted − discount + tax
commission     = (adjusted − pickup − dropoff) × commissionRate
traveller      = adjusted − commission + travellerSubsidy
platformNet    = commission − travellerSubsidy − discount
```

Defaults are explicitly experiments, not market data: ₹12 base, ₹0.18/actual road km,
₹4/billable kg, 6% commission, 18% tax, ₹39 minimum, ₹2,500 maximum, volumetric divisor 5000,
₹50 minimum traveller payout with up to ₹30 subsidy.

The quote response keeps these separate: `traveller_paise`, `commission_paise`,
`platform_net_paise`, `tax_paise`, `discount_paise`, `traveller_subsidy_paise`,
`loss_making`, plus the legacy `subtotal_paise` / `platform_fee_paise` split that the existing
quote table enforces. It also returns `road_distance_km`, `distance_source`, `route_status`,
`route_provider`, `route_measured_at`, `billable_weight_kg`, `volumetric_weight_kg`,
`service_mode`, `policy_version`, `within_limits` and `warnings`.

A quote whose route could not be resolved is refused — nothing is priced.

The web price card renders the distance, whether it is **Measured** or an **Estimate**, the
billable weight and the route status, so an estimated fare is never presented as measured.

`pricing_policies` is the live control surface. Finance can create a draft, then activate it; the
tables' partial unique index guarantees at most one active policy, and a malformed policy fails to
activate rather than silently falling back.

## 6. HTTP surface

Public (`/v1` prefix):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/geo/cities` | Countries, states, cities with zone lists and coordinate provenance |
| GET | `/geo/cities/:cityId/hotspots` | Only `active` + `verified` hotspots; candidate count withheld |
| GET | `/geo/routes` | Directed edges with status, distance, provider, `bookable` |
| GET | `/geo/serviceability` | Hub-to-hub and doorstep, with reasons |
| GET | `/geo/journeys` | 1–3 leg journeys over operational (or calculated) edges |
| POST | `/parcels/:id/quote` | Now v2, authoritative on the server, with price lock/expiry |

Staff (`/v1` prefix, bearer JWT, roles from `user_roles`):

| Method | Path | Role |
| --- | --- | --- |
| GET | `/admin/geo/hotspots`, `/routes`, `/coverage`, `/policies`, `/benchmarks` | any staff role |
| PATCH | `/admin/geo/hotspots/:hotspotId` | `trust_safety` |
| POST | `/admin/geo/hotspots/:hotspotId/verify` | `trust_safety` |
| POST | `/admin/geo/routes/:routeId/decision` | `trust_safety` |
| POST | `/admin/geo/routes/refresh` | `trust_safety` |
| POST | `/admin/geo/policies`, `/policies/:id/activate` | `finance` |
| POST / DELETE | `/admin/geo/benchmarks[/:id]` | `finance` |

Hotspot coordinate edits on an active hotspot require re-verification in the same request;
verification is refused without coordinates. All state changes write audit rows
(`hotspot.verified|rejected|suspended`, `route.*`, `pricing_policy.*`, `postal_benchmark.*`).

**These paths are additive:** `parcel-yatra-startup-pack/api/openapi.yaml` does not list `/geo/*`
or `/admin/geo/*`, and its `Quote` schema is `additionalProperties: false` with the legacy money
columns only, so the v2 fields are outside the frozen contract until the pack gains them. See
`docs/BUILD_NOTES.md`, DEFECT-029 → CONTRACT.

**Staff console:** the web operations screen has a **Network and pricing** tab
(`apps/web/src/components/NetworkAdmin.tsx`) over these endpoints: coverage counters, the route
ladder with per-pair measure/approve/operational/retire, the hotspot editor (coordinates, verify /
reject / suspend, activate, pickup and drop-off toggles), pricing policy drafts with activation, and
recorded postal benchmarks. Controls are disabled or hidden per role from the caller's own `/me`
roles, and a server refusal is shown verbatim instead of being smoothed over. Its rendered state on
this build is recorded in `docs/BUILD_NOTES.md` (DEFECT-029, Verification).

## 7. Tests

New coverage added with this work:

| File | What it proves |
| --- | --- |
| `apps/api/test/geo-network.test.ts` | 8 unique cities with state links; zones per city; 41 candidates with no coordinates; 56 directed candidate edges; exactly one active policy matching compiled defaults; idempotent re-run; constraint tests for the route ladder and hotspot activation |
| `apps/api/test/routing.test.ts` | Google request shape; success and per-element failure mapping; HTTP error handling; estimate→routed transition; approved edges are never overwritten; `REQUIRE_OPERATIONAL_ROUTE` refusal; failure recording |
| `apps/api/test/launch-quote.test.ts` | Active policy matches defaults; activating a new policy changes quotes; malformed policy fails; second active policy blocked by the index; v2 quote reconciles through the legacy columns |
| `apps/api/test/geo-api.test.ts` | Real app via `buildApp()` + `app.inject`: public geo endpoints, auth gates, hotspot verification ladder, route calculated→approved→operational, serviceability and journey changes, finance-only policy and benchmark CRUD, audit rows |
| `packages/domain/test/launch-pricing.test.ts` | Pricing invariants, labels, subsidy and cap behaviour |

Run them with `npm test` (domain + API + mobile) or individually as described in
`docs/TEST_COVERAGE.md`.

## 8. Rollback

- **Routing provider:** set `ROUTING_PROVIDER=none` and restart. Quotes fall back to labelled
  estimates; measured rows stay in `route_edges` and are still used. No schema change.
- **Operational gate:** set `REQUIRE_OPERATIONAL_ROUTE=false` (the default) to allow estimates
  again, or `true` to refuse anything not operational. No deploy required beyond restart.
- **Pricing:** activate a previous policy row (versioned, audited); the compiled default is the
  fallback only when no policy is active.
- **Schema:** migration 0010 is additive. It can only be undone by removing the new tables and
  columns; that would discard any distances and policies recorded since. Do not roll it back
  after the matrix has been measured — restore a backup instead.
- **Hotspots / routes:** nothing is deleted. Pause a hotspot or retire an edge.

## 9. Known gaps and unverified items

State these as limits, not as pending polish:

1. **Road distances are unverified until a key is configured.** In this workspace no
   `GOOGLE_MAPS_API_KEY` exists, so all 56 pairs remain `candidate` with no distance. Quotes use a
   labelled estimate (allowed by default). Nothing in the repo fabricates measured values.
2. **No hotspot is verified or active.** Coordinates are NULL. Doorstep serviceability is
   therefore refused for every pair until an operator geocodes and verifies hotspots.
3. **No Speed Post benchmarks are stored.** The table exists and is finance-editable; the UI does
   not show savings because none have been computed. Do not add marketing claims from an empty
   table.
4. **Multi-leg journeys are informational.** There is no custody handover, no re-pricing per leg
   and no booking across legs; `bookable` is false for them.
5. **Staff console is verified read-mostly.** The Network and pricing tab renders the live coverage,
   routes, hotspots, policies and benchmarks, and the unconfigured-provider refusal surfaces verbatim,
   but no state-changing press (verify a hotspot, approve a route, activate a policy) has been driven
   through this browser yet. Those transitions are covered by `geo-api.test.ts` against the API. The
   panel also has no test of its own: it is a Vite bundle build plus a DOM walkthrough, not a suite.
6. **Journey search is not yet used by the sender flow.** The quote and booking path resolves the
   direct city pair only.
7. **Distances are city-centroid to city-centroid.** Hotspot-level distances are not computed; if
   doorstep pricing needs them, it needs a separate measured leg.
8. **Estimates are great-circle-derived (`corridorKm`).** They are lower bounds on road distance
   and are labelled as estimates everywhere.

## 10. Definition of done — current status

| Requirement | Status |
| --- | --- |
| DB-driven country/state/city/zone/hotspot hierarchy | Implemented (migration 0010 + geo routes) |
| 8 cities without duplicates | Implemented and tested |
| 56 directed city pairs | Implemented as candidate edges |
| Real road distances for all pairs | **Unverified** — requires provider key + matrix run |
| Distance cache, provider, timestamp, status | Implemented and tested |
| Route statuses kept separate | Implemented, enforced by DB checks and API ladder |
| Hotspot-level serviceability | Implemented; doorstep blocked until hotspots are verified |
| Low-launch fare engine | Implemented (`v2.0-launch`) and tested |
| Cost control (cache, bulk matrix, no per-render calls) | Implemented |
| Quote/booking authoritative server-side | Implemented (quote v2, stored inputs) |
| Admin controls | API implemented and tested; staff console ships (`NetworkAdmin.tsx`), state-changing presses not driven in a browser |
| Speed Post benchmarking stored separately | Table + finance API; no data yet |
| Tests | Added; see §7 |
| Honest coverage report | This document |

If a routing key is supplied later, re-run the matrix and update §9 items 1–2 rather than
assuming this table still holds.
