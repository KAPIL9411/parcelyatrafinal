# Build notes — where this build departs from the pack

Status: **pilot build, sandbox payments only**. Not production-ready, not legally reviewed, not
security-audited. See `parcel-yatra-startup-pack/AGENTS.md` §2 and
`parcel-yatra-startup-pack/release/GO_NO_GO_CRITERIA.md`.

The documentation pack is the specification. This file records every place where the code makes a
different choice, plus the parts of the pack that are deliberately **not** implemented. It exists so
the next person can tell a bug from a decision.

Each entry is one of:

| Type | Meaning |
| --- | --- |
| **Additive** | The pack does not describe this; the build adds it. The contract should gain it before freeze. |
| **Divergence** | The pack describes something else, or describes two things that cannot both be true. |
| **Pack inconsistency** | Two pack documents disagree; the build picked one. |
| **Gap** | The pack asks for it and the build does not have it. |

Labels for claims: **OBSERVED** (seen in this build), **PUBLISHED** (stated in the pack),
**INFERRED** (reasoning from the above), **HYPOTHESIS** (unvalidated), **UNKNOWN** (no evidence).

---

## 1. Numbered deviations

| ID | Type | Area | One line |
| --- | --- | --- | --- |
| DEFECT-001 | Divergence | Pricing | The 80% traveller-share cap is applied to the total, not the subtotal. |
| DEFECT-002 | Closed | Money | Integer paise everywhere. No divergence found; entry kept because the schema header refers to it. |
| DEFECT-003 | Additive | Schema | `trips` gains `origin_area`; `dest_area` is reserved and unused. |
| DEFECT-004 | Pack inconsistency | Errors | `PAYMENT_NOT_PAYABLE` (catalogue) is used; the OpenAPI description says `BOOKING_NOT_PAYABLE`. |
| DEFECT-005 | Additive | API | `GET /v1/cities` and `GET /v1/config` are not in the contract. |
| DEFECT-006 | Additive | Schema / privacy | A `phone_masked` column is stored so a masked number can be shown. |
| DEFECT-007 | Divergence | Uploads | Local authenticated sink instead of presigned object storage. |
| DEFECT-008 | Additive | Admin | Refund approval and dispute queue/resolve endpoints. |
| DEFECT-009 | Additive | Booking view | `pickup_window_start` / `pickup_window_end` on the booking. |
| DEFECT-010 | Additive | Booking view | `actor_role` on each timeline event. |
| DEFECT-011 | Additive | Auth | `roles` on `/me` and on the login user. |
| DEFECT-012 | Additive | Booking view | A `dispute` summary on the booking. |
| DEFECT-013 | Additive | Admin | Evidence entries on the admin dispute list. |
| DEFECT-014 | Gap | Settlement | Split outcome returns `501 SPLIT_SETTLEMENT_NOT_ENABLED`. |
| DEFECT-015 | Divergence | Matching | Engine rebuilt on `match-p1.0`: hard gates then a weighted 0–100 score; distances are straight-line, never road. |
| DEFECT-016 | Additive | Booking list | `GET /v1/bookings` items carry `parcel_id`, category, weight and the two city names. |
| DEFECT-017 | Security | Sweep | Webhook / dev / admin / auth / file-ownership hardening (see §1 DEFECT-017). |
| DEFECT-018 | Additive | Performance & honesty | `0005_phase_d_indexes.sql` adds eight hot indexes; admin list routes gain `offset` and a `page` block; `/me/export` refuses with 501 because no worker is deployed; `/me/deletion-request` says so; `queueNotification` labels in-app rows `delivered` (the write IS the delivery) and other channels `queued`. |
| DEFECT-019 | Presentation | Web UI | Sandbox badge and seeded demo numbers removed from the chrome; tokens and type scale retuned for a calmer launch look; landing limits read from `GET /v1/config`. |
| DEFECT-020 | Presentation | Web UI | Homepage rebuilt around a functional booking panel (live cities, weight, category) that hands off to `/send` via query-param prefill; Porter/Rapido investigation summarised with evidence and stated limits; tracking and driver-onboarding paths surfaced on the landing page. |
| DEFECT-021 | Presentation | Web UI | Sign-in page: the two auth cards now stretch to equal height on desktop (grid `align-items` default instead of `items-start`, `h-full` navy panel) and stack on mobile; the placeholder Google glyph was replaced with the official four-colour Google G mark (`#EA4335`/`#4285F4`/`#FBBC05`/`#34A853`). |
| DEFECT-022 | Presentation | Web UI | Landing hero: the user-supplied cityscape image (`hero-background.png`) is the hero background (`cover`/`center`/`no-repeat`, subtle 25% navy overlay), visible on both sides of the navy card; the card is flush with the hero's bottom edge so the grey strip below it is gone; `overflow-x: clip` on `html` absorbs the scrollbar-width overflow of the full-bleed breakout. **Superseded by DEFECT-023**, which removed the viewport-unit breakout entirely. |
| DEFECT-023 | Presentation | Web UI | Homepage redesigned around a reference visual language: curved full-bleed navy hero with the cityscape layered under a navy scrim, centred headline, pill booking bar, and a row of six floating category cards straddling the curve; below-the-fold re-rhythmed with a centred section heading and four feature cards. Full-bleed is now achieved by giving the `/` route its own un-boxed `<main>` instead of viewport-unit negative margins. |
| DEFECT-024 | Presentation / Auth lifecycle | Web UI | Signed-out UI was rendered while the session was still being restored, so a returning visitor saw a Sign In button, a sign-in form and `/login?next=` call-to-action links that were then pulled away. The session context now carries `loading` / `authenticated` / `unauthenticated`, every consumer waits for the answer, and the restore runs once per page load. |
| DEFECT-030 | Additive | Homepage / campaigns | `0011_homepage_cms.sql` adds immutable homepage and campaign releases plus a media allowlist; `GET /v1/homepage` serves the resolved page and the app renders it over a fixed composition; a **Homepage** console tab edits, schedules, publishes and restores releases. Writes are limited to `trust_safety`. |

### DEFECT-001 — traveller-share cap basis

- **PUBLISHED** (`docs/PRICING_AND_UNIT_ECONOMICS.md` §2): maximum traveller share is 80% of
  subtotal; `share = subtotal − service_component`; the worked example gives 621 on a 646 subtotal
  and an 899 total.
- **OBSERVED** (`packages/domain/src/pricing.ts`): the cap is applied to **total**
  (`maxTravellerShareOfTotal = 0.8`), because 621 / 899 = 69% fits an 80%-of-total cap but not an
  80%-of-subtotal cap alongside `share = subtotal − service`.
- **Consequence:** the cap is a runaway guard, not a constraint that binds in normal quotes. If the
  fee and tax are large relative to the subtotal, the share can exceed 80% of subtotal.
- **Needs:** a pricing decision, not a code fix. Whichever reading is chosen, the pack and the
  formula must be changed together.

### DEFECT-002 — money representation (closed)

- **PUBLISHED** (`AGENTS.md` §7, `api/API_CONVENTIONS.md` §3): money is an integer number of paise;
  field names end `_paise`; never a float or a rupee field.
- **OBSERVED:** every money column in `apps/api/src/db/schema.sql` is `integer` and ends `_paise`;
  `packages/domain/src/pricing.ts` uses integer arithmetic only; the API serialises these as JSON
  integers. No decimal or float money exists.
- **Status:** the pack's `database/SCHEMA.md` already uses `_paise` integers, so there is no
  divergence. The entry is retained only because `schema.sql`'s header cites it. Treat it as closed
  rather than as an outstanding defect.

### DEFECT-003 — trip areas

- **PUBLISHED** (`database/SCHEMA.md` §7): `trips` stores `origin_city_id` / `dest_city_id`; coarse
  areas live on `parcels`.
- **OBSERVED:** `trips` also stores `origin_area` (nullable) and a reserved `dest_area` that no route
  writes yet. Trip creation accepts `origin_area`; `dest_area` is always null in this build.
- **Why:** a traveller publishes a trip before any parcel exists, and the trip list should show where
  they start ("Civil Lines"), not just the city.
- **Consequence:** two sources of truth for trip geography, and one unused column. Either finish
  `dest_area` (form field, validation, view) or drop it; a later migration should also decide whether
  areas belong on the trip, on a route table, or only on the parcel.

### DEFECT-004 — payable-state error code

- **PUBLISHED** (`api/ERROR_CATALOG.md`): `PAYMENT_NOT_PAYABLE` (409, booking not in a payable
  state). The `POST /bookings/{id}/payment-intent` description in `api/openapi.yaml` instead says
  `BOOKING_NOT_PAYABLE`, which is not in the catalogue.
- **OBSERVED:** the build returns `PAYMENT_NOT_PAYABLE` and the closed error table contains no
  `BOOKING_NOT_PAYABLE`.
- **Consequence:** a client generated from the OpenAPI description will not match the server. The
  pack should correct the description.

### DEFECT-005 — public catalogue endpoints

- **PUBLISHED:** the contract has no city list and no public config read.
- **OBSERVED:** `GET /v1/cities` returns serviceable and non-serviceable cities (no personal data);
  `GET /v1/config` returns safe public flags (sandbox payments, payout state, pilot limits).
- **Why:** the send wizard cannot offer a city picker without the first; the web cannot show the
  sandbox banner honestly without the second.
- **Consequence:** additive contract surface. Add both to `openapi.yaml` before freeze.

### DEFECT-006 — masked phone storage

- **PUBLISHED** (`database/SCHEMA.md` §6, `AGENTS.md` §2.5): store `phone_hash` and `phone_last4`;
  never store the raw number; the counterparty sees a masked number.
- **OBSERVED:** `users` and `otp_challenges` gain `phone_masked`, computed as `+91******` plus the
  last four digits. No other digits are stored.
- **Why:** the counterparty view needs a display string with the country code and a mask; that string
  cannot be derived from the hash, and the build chose to store it rather than format it per request.
- **Privacy note:** the stored mask reveals exactly the same four digits as `phone_last4`; it does
  not widen what the database holds. Retention and deletion must still cover the column. An earlier
  version of `maskPhone` also stored the first two national digits; that was removed.
- **Consequence:** two columns now carry the same four digits. A future schema could derive the
  display string from `phone_last4` and drop the column.

### DEFECT-007 — upload sink

- **PUBLISHED** (`api/openapi.yaml`, `security/SECURITY_REQUIREMENTS.md`): uploads are authorised
  with a short-lived presigned URL to object storage.
- **OBSERVED:** `POST /v1/files/upload-url` returns the same response shape, but the URL points at
  `PUT /v1/files/local-upload/<object_key>` on the API origin. Bytes land in `data/uploads/`.
  The PUT is authenticated and scoped to the caller's own object key; JPEG/PNG only; 10 MB limit.
- **Why:** there is no object storage in this build, and pretending a presigned URL exists would be
  a false claim in the response.
- **Consequence:** the local PUT route is authenticated and scoped to the caller's own key, and reads
  go through `GET /v1/files/signed/:token` — an HMAC token that opens one object for one TTL — which is
  what the staff console hands an `<img>` for an identity document. What the local sink still is not:
  durable across a host rebuild, scanned, or encrypted beyond the disk. Replace the sink before any
  real document is collected, or set `STORAGE_PROVIDER=cloudinary` so the objects outlive the process.

### DEFECT-008 — admin endpoints

- **PUBLISHED:** the contract says a refund above the dual-approval threshold must be approved by a
  *different* staff user, but defines no approval endpoint. It also defines no dispute queue.
- **OBSERVED:** additive `POST /v1/admin/refunds/:refundId/approve` (finance/admin_readonly,
  self-approval refused with `SELF_APPROVAL_FORBIDDEN`), `GET /v1/admin/disputes`, and
  `POST /v1/admin/disputes/:disputeId/resolve`.
- **Why:** the requirement is unimplementable without them.
- **Consequence:** the contract should gain all three. Case resolution is transactional: the booking
  transition, the case state and the payout row commit together or not at all.

### DEFECT-009 — pickup window on the booking

- **PUBLISHED:** the booking view has no pickup window; the parcel has `window_start` / `window_end`.
- **OBSERVED:** the booking view exposes `pickup_window_start` / `pickup_window_end`, read from the
  parcel, so the booking page can say when pickup is expected.
- **Why:** the booking page is the only page a party opens after matching; sending them back to the
  parcel to learn the window is a dead end.
- **Consequence:** additive fields; no new storage.

### DEFECT-010 — actor role on timeline events

- **PUBLISHED:** `booking_events` records `actor_id` and `actor_kind` (`user` / `system` / `support`).
- **OBSERVED:** each serialised event also carries `actor_role` (`sender` / `traveller` / null).
- **Why:** with only `actor_kind: "user"`, the timeline cannot say "You" versus "Traveller", and
  showing the wrong one is worse than showing none.
- **Consequence:** additive field. It is derived per request from the booking's parties.

### DEFECT-011 — roles on the session user

- **PUBLISHED:** `/me` returns the profile; staff authorisation is enforced per endpoint.
- **OBSERVED:** `/me` and the login response include the caller's own `roles`.
- **Why:** without it the web has to probe a staff endpoint and treat a 403 as "not staff", which
  both leaks the existence of the endpoint and produces a console error on every ordinary visit.
- **Consequence:** additive field, own roles only. It is not an authorisation decision; the server
  still checks every staff route.

### DEFECT-012 — open case on the booking

- **PUBLISHED:** disputes have their own resource; the booking view has no case reference.
- **OBSERVED:** the booking view includes `dispute` (`id`, `state`, `category`, `created_at`) when a
  case is open.
- **Why:** the booking page tells people a case exists. Without the id it cannot link to the case or
  offer the evidence form, so the sentence "add evidence from the case page" was untrue.
- **Consequence:** additive field. The case itself is still only readable by the two parties.

### DEFECT-013 — evidence in the admin dispute list

- **PUBLISHED:** the admin dispute queue is not in the contract at all (see DEFECT-008).
- **OBSERVED:** each queue item carries `evidence[]` with `side: opener | counterparty`.
- **Why:** `GET /v1/disputes/:id` is restricted to the two parties, so staff have no other way to
  read what was submitted. Resolving a case without reading it would be deciding blind.
- **Consequence:** one extra query per queue page, not per row.

### DEFECT-014 — split settlement is refused, not faked

- **PUBLISHED** (`legal/LEGAL_REGULATORY_MATRIX.md` E-3, `legal/PAYMENTS_TAX_AND_SETTLEMENT.md`):
  split settlement capability is **UNKNOWN** pending written provider confirmation; there is no
  refund/settlement design for a partially upheld case.
- **OBSERVED:** `POST /v1/admin/disputes/:id/resolve` accepts `outcome: "split"` in the schema but
  returns `501 SPLIT_SETTLEMENT_NOT_ENABLED` before touching anything. The staff console shows the
  option disabled and explains why.
- **Why:** the earlier code mapped `split` to the sender outcome, which voided the traveller's whole
  share. That is a different decision from the one the reviewer made.
- **Consequence:** a real gap. A split needs an amount, a refund path, a payout adjustment, a ledger
  entry and an audit trail. None of that exists. The 501 is honest; it is not a feature.

### DEFECT-015 — matching engine rewritten around `match-p1.0`

- **PUBLISHED** (`docs/BUSINESS_LOGIC.md` §3, `docs/MATCHING_ENGINE.md` §3–§9): hard eligibility
  filters first, then a weighted score with the documented weights, a closed reason-code set, privacy
  bands for pickup distance, a low-confidence fallback, and reliability handling for thin records.
- **OBSERVED** (`packages/domain/src/matching.ts`): the engine is now two explicit stages. Fourteen
  hard constraints run first and each one is terminal — a score can never lift a trip that failed a
  gate. Eligible trips get `score = Σ(wᵢ·fitᵢ) × 100 / Σwᵢ` with `fitᵢ ∈ [0,1]`, weights
  `time 30 / departure 20 / detour 20 / reliability 15 / capacity 10 / preference 5`, and the formula
  version (`match-p1.0`), every fit and every point contribution are returned in
  `score_breakdown`, so the points add up to the score on the wire. Ties break
  `score → arrival → departure → trip id`, so ranking is deterministic.
- **Divergences worth naming:**
  - `BUSINESS_LOGIC.md` §3.2 allows a trip whose origin is a *different* city inside the detour limit
    (pilot 10 km). The engine accepts those and prices the detour down; it does not reject them.
  - Trips whose reliability is below 0.7 after ≥10 samples go to manual review in the pack (§9).
    There is no matching review queue in this build, so they are excluded and reported as
    `TRAVELLER_RELIABILITY_REVIEW` in the server-side rejection list rather than ranked into view.
  - There is no routing provider. Distances are great-circle between city centroids, which is a
    lower bound on road distance and is labelled as such in the UI and the contract. Within a city,
    proximity is area-**name** agreement, never a converted distance, because `areas` has no
    coordinates (see DEFECT-003).
  - `SMALL_DETOUR` and `HIGH_RELIABILITY` are only emitted when their underlying numbers support
    them; a reason code is a claim, not decoration.
- **Config:** `MATCH_MAX_ORIGIN_DETOUR_KM`, `MATCH_ARRIVAL_GRACE_HOURS`, `MATCH_MIN_SCORE`,
  `MATCH_MAX_RESULTS`, `MATCH_WEIGHTS` (`time=30,departure=20,…`), `MATCH_CANDIDATE_SCAN_LIMIT`.
  A malformed weight fails at boot, not at the first matching request.
- **Consequence:** the per-trip rejection list (`rejections`) is kept server-side and logged at debug
  only. It names other users' trips and why they were withheld, so it is not returned to the sender.

### DEFECT-016 — booking list carries parcel identity

- **PUBLISHED:** `openapi.yaml` `BookingSummary` has id, status, role, mode, amounts and timestamps.
- **OBSERVED:** `GET /v1/bookings` items also return `parcel_id`, `category`, `weight_kg`,
  `origin_city` and `dest_city` (one extra join, no N+1). The list screen used to render
  "Booking 1a2b3c4d · you are sending", which is not something a returning sender can act on; it now
  shows the parcel and the route.
- **Consequence:** additive contract surface; the pack's `BookingSummary` must gain these fields
  before freeze.

### DEFECT-017 — Phase C security sweep

- **PUBLISHED:** the pack lists webhook signature validation, admin/OTP exposure rules and file
  ownership as "assumed". Nothing in the pack says which routes are unauthenticated or which
  object keys may be referenced cross-account.
- **OBSERVED:** the audit walked every route and fixed the following in this build:
  - `keyBelongsTo(key, userId)` in `lib/storage.ts` (strict UUID-segment pattern) is enforced on
    every write path that persists an object key: parcels, booking pickup/delivery handovers,
    disputes, verification documents. A key that syntactically matches another user's segment is
    refused with `VALIDATION_FAILED (photo_key)`.
  - `verification.ts` no longer writes fabricated KYC metadata. The stored row now carries the
    real SHA-256 of the uploaded bytes, the object's actual MIME type and the actual byte size.
  - `google-auth.ts` revokes every active session of a phone account the moment it is linked to
    a Google identity, closing the "attacker's still-live session inherits the linked account"
    window.
  - `webhooks.ts`: only `payment.captured` moves the booking to `confirmed`. `payment.authorised`
    now updates the payment row to `authorised` and leaves the booking in `payment_pending`. The
    contract table in `api/WEBHOOK_CONTRACTS.md` matches this.
  - `webhooks.ts`: the public `GET /webhooks/payments/health` probe is gone. It leaked
    `PAYMENT_PROVIDER`, `PAYMENTS_LIVE` and `PAYOUTS_ENABLED` to any caller without auth.
  - `dev.ts`: `POST /dev/webhooks/simulate` now requires auth and checks that the caller is a
    party to the payment (or staff). `GET /dev/otp/:challengeId` carries a 20/min rate limit so a
    stray client cannot enumerate challenge ids.
  - `admin.ts`: dual-approval release now validates `approval_id` as a distinct finance user who
    wrote a prior `payout.approved` audit entry for the same booking. A new
    `POST /v1/admin/payouts/:bookingId/approve` records the second sign-off. Truthy strings are
    no longer accepted.
  - `admin.ts`: the "support_lead" role that used to be synthesized for anyone not trust & safety
    has been removed. Real role labels (`support_agent`, `trust_safety`, …) flow from `user_roles`
    into the transition context. Domain guards in `packages/domain/src/booking-machine.ts` match.
  - `admin.ts`: `/admin/verifications`, `/admin/bookings`, `/admin/disputes` and `/admin/audit-log`
    now validate their query strings with zod; date filters must be ISO-8601, `phone_hash` must be
    a lowercase 64-hex, state filters are enums. Malformed queries return 400 instead of producing
    `Invalid Date` rows or unbounded `WHERE` clauses.
  - `app.ts`: writes are rate limited at `RATE_LIMIT_WRITE_PER_MINUTE` per IP via a `preHandler`
    hook built on the plugin's manual `createRateLimit` API. Health and webhook routes are exempt.
  - `app.ts`: pino redact paths extended to `*.email`, `*.user_email`, `*.recovery_email`,
    `req.body.email`, `req.body.receiver_email`.
  - `auth.ts`: `/auth/otp/verify` capped at 10/min, `/auth/refresh` capped at 30/min.
  - `config.ts`: `assertSafetyRails` refuses to start in production with `SMS_PROVIDER=log` — that
    config prints OTP codes to stdout.
  - `apps/web/vite.config.ts`: `build.sourcemap` is true only outside production. Published bundles
    no longer ship `.ts` sources.
  - `bookings.ts`: `GET /bookings` list response carries `parcel_id`, `category`, weight and the
    two city names (also under DEFECT-016) — the list screen previously used to leak raw UUIDs.
- **Consequence:** the public OpenAPI surface is unchanged apart from the removal of the health
  probe (`GET /v1/webhooks/payments/health`) and the additive `POST /v1/admin/payouts/:bookingId/approve`.
  Smoke (44/44) and concurrency (11/11) both pass with these changes; `scripts/concurrency.mjs`
  no longer fakes `sealed_photo_key`.

### DEFECT-018 — Phase D: indexes, admin pagination, worker honesty

- **PUBLISHED:** the pack's `SCHEMA.md` shows indexes on hot foreign keys, and the API contract
  says list routes return "the current page" and "next cursor". The pack does not say whether
  `/me/export` and `/me/deletion-request` are backed by a worker, but the response shape
  (`status: 'queued'`, `hard_delete_after: <30d>`) implies they are.
- **OBSERVED:**
  - `migrations/0005_phase_d_indexes.sql` adds eight indexes: `payments(provider_ref)` — every
    webhook was doing a sequential scan on this lookup; `refunds(payment_id, created_at)` — the
    eligibility check on every refund; `audit_log(action, created_at)` and `audit_log(actor_id,
    created_at)` — the two filters the admin console actually applies; `bookings(status,
    created_at)`, `verifications(state, created_at)`, `disputes(state, created_at)` — admin
    queue filters; `notifications(user_id, status, created_at)` — the unread badge.
  - All four admin list routes (`/admin/verifications`, `/admin/bookings`, `/admin/disputes`,
    `/admin/audit-log`) accept `offset` and return `{ items, page: { limit, offset } }`. Prior
    to this they silently truncated to the head of the table, so a queue longer than 100 was
    not fully reachable. User-side list routes (`/bookings`, `/trips`, `/notifications`) already
    cursor-paginate; `parcels` has no list route to fix.
  - `/me/export` now returns `501 BACKGROUND_WORKER_UNAVAILABLE` with a plain-language message.
    It used to return `202 queued` and drop a `jobs` row that nothing reads. That was a fake
    success message; the honest answer here is "no".
  - `/me/deletion-request` still soft-deletes synchronously (that part is real), but the response
    no longer says `202 accepted / hard_delete_after`. It returns `200` with `hard_delete_worker:
    false` and a `note` explaining that the row-level purge after the retention window is a
    deploy-time job in this build. The timestamp is a target, not a scheduled event.
  - `queueNotification` no longer writes `status='sent'`. `in_app` rows are marked `delivered`
    (the write IS the delivery — GET /v1/notifications reads them back), other channels stay
    `queued` with `sent_at = NULL`. `enqueueJob` and `emitOutbox` gained doc comments that say
    plainly: "no consumer reads these rows in this build".
- **Consequence:** the OpenAPI contract needs `offset` and `page` on the four admin list routes,
  `501` on `/me/export`, and the new response body on `/me/deletion-request`. The pack's
  `queueNotification` description ("delivery is dispatched by the worker") is a HYPOTHESIS this
  build does not satisfy and now says so.

---

### DEFECT-019 — Launch UI pass (chrome, tokens, sandbox wording)

- **PUBLISHED:** the pack's UI copy refers to "the pilot" throughout. Nothing in the pack asks for
  a persistent "Test mode" badge in the application header.
- **CHANGED:**
  - The header no longer carries a sandbox badge and no longer falls back to the masked phone
    fragment (`…0001`) as the account label; it shows the account name or "Account". The seeded
    demo numbers were removed from the sign-in screen, which is now Google-first with the phone
    route as the alternative beneath it.
  - `SandboxChip` is gone. Where the sandbox actually matters — the money card and the pay panel —
    the build states it in one plain sentence ("Payments run through a sandbox provider in this
    build") instead of repeating a badge. Dev-only affordances (OTP peek, sample photo, advance-
    pickup) remain behind `import.meta.env.DEV` and no longer say "test mode" in their labels.
  - Landing dropped the mock "typical booking" panel and the hardcoded limits grid. The limits
    strip now reads `limits` from `GET /v1/config`, so the numbers cannot drift from the server.
  - Design tokens: the acid yellow accent is muted (`#e8b33c` / `#a9761a`), `brand-900` is a deep
    navy rather than electric blue, and the hero gradient moved with it. Button/control heights
    settled at 44px (`h-11`) and `h-12` for the primary CTA; cards use one padding rhythm
    (`p-5 sm:p-6`); section headings and page titles dropped a step; selection pills became
    underline tabs on the operations console and neutral segmented tabs on the parcel list.
  - Copy: "at pilot" reads as "at launch" in user-facing screens; legal pages still disclose the
    real limits (no insurance, no live tracking, payouts disabled) in the same place as before.
- **Consequence:** presentation only. No API surface, no state machine, no auth behaviour moved.
  Typecheck and `vite build` both pass; the smoke and concurrency suites are unaffected because
  they drive the API, not the DOM.

---

### DEFECT-020 — Booking-first homepage (Porter/Rapido study)

- **EVIDENCE LIMITATION:** REA's browser automation was refused by REA's own classifier for the
  third-party commercial targets (porter.in), so no pixel-level capture of the reference products
  exists in this build's evidence. Structural facts below come from the official sites' public
  pages and app-store listings; visual details (exact hex values, spacing) are stated as inferences.
- **REFERENCE FINDINGS (verified):**
  - Porter: the homepage hero is a booking panel — pickup, drop, vehicle type, one primary CTA —
    beside the value proposition; the top nav is thin (driver partner / support / enterprise);
    flow is pickup → drop → optional stops → vehicle class → price → book.
  - Rapido: one headline, two CTAs (ride / drive), scale-and-safety stats; driver onboarding is a
    first-class homepage path; yellow is the brand accent (hex not officially published).
- **CHANGED:**
  - `Landing.tsx` rebuilt: the navy hero now contains a white booking card — pickup city and
    destination city (serviceable cities only, from `GET /v1/cities`), a swap control, weight and
    category fields, client-side validation (both cities, different cities, 0.1–max kg from
    `GET /v1/config`), and one primary CTA that hands off to `/send` with `origin`, `dest`,
    `weight` and `category` query parameters. Signed-out visitors are routed through
    `/login?next=/send?…` and land back on the prefilled flow after sign-in.
  - `Send.tsx` now reads those query parameters: item state seeds weight/category (validated
    against domain `CATEGORIES` and the weight cap) and the route seeds origin/dest city IDs
    (validated against the city catalogue before the default Bareilly⇄Delhi seeding applies).
  - New `SwapIcon` in `icons.tsx`; how-it-works steps gained icons; two new landing cards surface
    the tracking path (`/bookings`) and the driver-onboarding path (`/trips/new`) with honest
    microcopy (no insurance claims, no live tracking claims).
- **Consequence:** no API or state-machine changes. Verified in the running app: panel submit with
  valid inputs reaches `/send` prefilled (cities, weight, category); swap and same-city validation
  behave; signed-out submit lands on `/login?next=/send?…` and returns prefilled after the dev-OTP
  sign-in. Typecheck, `vite build`, unit tests, smoke (44) and concurrency (11) all pass.

---

### DEFECT-021 — Sign-in page: balanced cards, official Google mark

- **OBSERVED:** the auth page grid used `lg:items-start`, so the shorter navy information card
  ended well above the form card's bottom edge, leaving an empty strip beside the form (the
  green-marked area in the reference screenshot). The Google button used a home-drawn placeholder
  glyph (circle + squiggle) rather than the Google mark.
- **CHANGED:**
  - `Login.tsx`: the grid now uses the default `align-items: stretch` and the navy card fills its
    column (`h-full`), so both cards share one height at `lg`. The information panel is no longer
    `hidden` below `lg` — the two cards stack vertically on mobile with the existing `gap-6`
    spacing. Content stays top-aligned inside both cards; no padding or typography changed.
  - `icons.tsx`: `GoogleIcon` now renders the official Google "G" mark (48px viewBox, the four
    brand colours `#EA4335`, `#4285F4`, `#FBBC05`, `#34A853`) instead of the placeholder glyph;
    the login button renders it at 20px to the left of the label. The icon is only used there.
- **Consequence:** presentation only — no auth, OTP, routing, or API behaviour moved. Verified by
  pixel-profiling a 1280px headless-Chrome capture of `/login` (both card bottom edges at the same
  row, no horizontal overflow) and by DOM checks of the four G fills at 530px (stacked layout,
  24px gap). Typecheck and `vite build` pass.

---

### DEFECT-022 — Landing hero: cityscape background, navy flush to the section edge

- **OBSERVED:** the hero was a self-contained `hero-gradient` card with rounded corners on all
  four sides, so the grey `bg-canvas` page background showed as a strip below the card and beside
  it — the red-marked bottom area in the reference screenshot. The user-supplied cityscape image
  was not part of the hero at all.
- **CHANGED:**
  - `Landing.tsx`: the hero `<section>` is now full-bleed (it breaks out of the centered
    `max-w-6xl` main via `-mx-[calc((100svw-100%)/2)]` and cancels main's top padding with
    `-mt-8`). The section carries the supplied image as `background-size: cover`,
    `background-position: center`, `background-repeat: no-repeat` (`public/hero-background.png`,
    copied from the user's asset — no generated replacement), with a subtle
    `bg-brand-900/25` overlay for text legibility. Inside it, the original content is wrapped in
    a centered `max-w-6xl hero-gradient rounded-t-sheet` card: rounded corners at the TOP only,
    bottom edge flush with the section's bottom edge. The card's bottom edge *is* the section's
    bottom edge, so there is no strip to fill and no separate navy rectangle was added. All hero
    content (eyebrow, headline, trust `<dl>`, booking form with swap and CTA, microcopy) is
    unchanged; handlers and routing untouched.
  - `index.css`: `overflow-x: clip` on `html`. The full-bleed breakout uses viewport units,
    which in Chrome include the classic scrollbar width (verified: every vw/svw/dvw unit
    resolved to 638.4 while `clientWidth` was 623), so the breakout overflowed horizontally by
    the scrollbar width. `clip` swallows that overflow without creating a scroll container, so
    sticky positioning and normal scrolling are unaffected.
- **Consequence:** presentation only — no booking, validation, routing, or API behaviour moved.
  Verified by pixel-profiling a 1280px headless-Chrome capture: navy from y=65 to y=691 flush
  with the section's bottom edge, canvas starting at y=692, image bands visible on both sides of
  the card (delivery van left, Hawa Mahal right), and no horizontal scrollbar track. A 390px
  capture confirms the stacked layout with the image visible at the frame edges. In-browser
  checks confirm the swap control and the signed-out submit → `/login?next=/send?…` prefill flow
  still work. Typecheck and `vite build` pass.

---

### DEFECT-023 — Homepage redesigned against a reference visual language

- **OBSERVED:** DEFECT-022's hero was a rectangular navy panel bled to the viewport with
  `-mx-[calc((100svw-100%)/2)]`. Two problems followed from that: the breakout is one viewport
  unit wide in Chrome when a classic scrollbar is reserved (`100svw` = window width, `clientWidth`
  = window − 15px), which cost the right-hand gutter on narrow screens, and the page read as a
  plain block — no shape, no overlapping elements, weak hierarchy below the fold.
- **CHANGED (presentation only):**
  - `Layout.tsx`: `<main>` is now conditional on the route. `/` gets an un-boxed
    `flex-1 pb-28 md:pb-16` and the landing page owns its own containers; every other route keeps
    the previous `max-w-6xl px-4 pt-8` box, so no other screen's layout moved. This is what makes
    the hero full-bleed — the viewport-unit negative margin and its scrollbar error are gone.
  - `index.css`: new `.hero-panel` utility layers the supplied cityscape under a navy scrim
    (`linear-gradient(180deg, rgb(10 23 48/.8) → rgb(7 15 30/.95)`) over `url('/hero-background.png')`,
    `cover`/`center`/`no-repeat`) and gives the section an elliptical bottom edge
    (`border-bottom-left/right-radius: 50vw 2.5rem`, `50vw 5rem` at `sm`). Added a `--shadow-float`
    token for the lifted form and card hover. `overflow-x: clip` on `html` is retained as a
    belt-and-braces guard for the card strip's bleed, not as an overflow workaround.
  - `Landing.tsx`: hero content is centred (eyebrow pill, headline with a `text-brand-200` accent
    phrase, subcopy, the `GET /v1/config` limits row) and the booking form became a wide lifted bar
    — pickup city, swap, destination on one row at `md`, weight and category below, full-width CTA.
    Six floating cards (Documents, Certificates, Business samples, Low-value accessories,
    Travelling & earning, Track a parcel) sit at `-mt-16 sm:-mt-24` so they straddle the curve;
    they are equal-height (`h-full` in a grid; a snap-scrolling flex row below `sm`). Below the fold
    a centred section heading plus four feature cards precede the existing three-step,
    what's-included, prohibited-items and tracking/driver sections, which were kept and re-spaced.
  - `icons.tsx`: added `AwardIcon`, `TagIcon`, `CoinsIcon` in the existing house style (24px grid,
    1.75px stroke, `currentColor`); no emoji were introduced.
- **Deliberate content deviation:** the reference is a shopping directory, and the requested card
  set included "Electronics". `packages/domain/src/enums.ts` lists `electronics`, `laptop`,
  `mobile_phone` and `battery` under `PROHIBITED_CATEGORY_KEYS`, so that card would have advertised
  something the API rejects. The card is `electronics_accessories_low_value` instead — the closest
  offerable category, which is itself soft-restricted (rule E8, human review). Likewise the
  "delivery tracking" feature is worded as **Recorded status** with "Live vehicle location is not
  offered", because the product does not track location. Every card links to a route that exists
  (`/send?category=…`, `/trips/new`, `/bookings`), wrapped in `/login?next=…` when signed out.
- **Consequence:** no booking, matching, auth, validation or API behaviour changed. Verified in the
  running app at 623px (`scrollWidth === clientWidth`, hero spans exactly the client width, form
  gutters 16px both sides, all six cards 129px tall and horizontally scrollable) and by pixel
  profiling 768px and 1280px captures (symmetric gutters, symmetric curve, equal-height card rows).
  Functional checks: swap exchanges the two city IDs; same-city submit shows the validation alert;
  a valid signed-out submit lands on
  `/login?next=/send?origin=…&dest=…&weight=1.5&category=documents`. Typecheck, `vite build`,
  domain tests and API tests pass. There is no lint script in this repo.
- **Verification caveat:** headless Chrome at `--window-size=390` lays the page out ~15px wider than
  the captured image when a classic scrollbar is reserved, so pixel measurements taken from a 390px
  screenshot overstate right-edge clipping. Geometry was therefore confirmed from live DOM
  metrics, with screenshots used only for appearance.

---

### DEFECT-024 — authentication lifecycle (the sign-in flicker)

- **OBSERVED:** a returning visitor was shown the signed-out interface for as long as the session
  restore took, then yanked back to the signed-in one. Four independent places treated an unknown
  session as "signed out":
  - `components/Layout.tsx` branched the header cluster on `user` alone, so the Sign In button was
    painted during the restore and replaced by the account chip when it finished;
  - `screens/Login.tsx` rendered the whole sign-in form while the restore was in flight, then
    navigated away — a signed-in visitor saw a form they had not asked for;
  - `screens/Landing.tsx` built every call-to-action href through `viaAuth()`, so the links pointed
    at `/login?next=…` and were rewritten a moment later;
  - the context exposed `loading: boolean` next to `user: Profile | null`, which is two booleans
    where one three-state value belongs. `loading` was simply not consulted in the header or on the
    landing page, so "not yet known" silently meant "signed out".
- **Why it is visible in production but not on a laptop:** restoring is two sequential round trips —
  `POST /v1/auth/refresh` (the HttpOnly cookie is the only durable credential) then `GET /v1/me`.
  Measured against the deployed API, a single unauthenticated `refresh` takes 313–358 ms, so the
  wrong-state window is roughly 0.7–1 s and longer on a cold instance or a phone; on the local API
  the same pair measured 14 ms + 11 ms, i.e. invisible. Nothing was broken locally, which is why the
  defect survived development.
- **A second, quieter defect:** the provider mounts twice under React StrictMode in development, and
  each mount ran its own restore. Two `POST /auth/refresh` calls rotate the refresh pair twice, so
  the answer the first one waits for is already spent.
- **CHANGED:**
  - `lib/session.tsx` — `loading: boolean` became `status: 'loading' | 'authenticated' |
    'unauthenticated'`, derived from one restore flag plus the profile, so no consumer has to guess.
    The restore is memoised at module level (`restoreSession()`), which is what caps a page load at
    one refresh regardless of how many times the provider mounts; `adoptSession()` and `signOut()`
    replace that memo, because after either one the answer for this page load is no longer what the
    cookie said. A restore that throws (no connection at all) resolves to "not signed in right now"
    instead of leaving the visitor on a skeleton for the rest of the page load.
  - `components/Layout.tsx` — while `status === 'loading'` the header reserves the signed-in cluster's
    own shape (a `h-9 w-24` chip plus a `h-10 w-10` circle, `aria-busy`, sr-only "Checking your
    session") instead of a Sign In button. The cluster is `ml-auto`, so a width difference moves only
    its own left edge and nothing else on the page.
  - `screens/Login.tsx` — the card shows `SignInPending`, block for block the shape of the phone
    stage (heading, Google button, divider, labelled field with hint, submit, legal line), so the
    card height does not change when the real form arrives.
  - `screens/Landing.tsx` — `viaAuth()` is gone. The links and the form submit target the real
    routes and `RequireAuth` decides, which is also where `next` is preserved. This removes a
    client-side duplicate of the router's own rule rather than adding a loading check to it.
  - `App.tsx` — `RequireAuth` / `RequireStaff` gate on `status === 'loading'` (they already rendered
    a fallback, so only the state name changed). No route, provider, token handling or server
    endpoint changed; the access token is still a module variable and the refresh token is still only
    ever in the HttpOnly cookie.
- **Consequence / verification:** measured in the running app with the restore deliberately stretched
  (a throwaway local proxy delaying `/auth/refresh`, since a 35 ms window cannot be observed), then
  with the normal API. Header cluster box identical while loading and after (40×40 at the same x);
  login card 446 px loading vs 445 px resolved; no "Sign in" string anywhere in the document during
  the restore; landing CTAs already carry their final `/send?category=…`, `/trips/new`, `/bookings`
  hrefs before the session resolves; buffered `layout-shift` total 0.00000 with zero entries across
  the swap; exactly one `POST /auth/refresh` and one `GET /me` per page load. Signed-out, revoked-
  cookie and direct-protected-URL loads each resolve to `/login?next=…` once, with no protected
  content painted first. Typecheck (all three workspaces), `vite build`, 64 domain tests and 3 API
  tests pass. The delay proxy and the second dev server were scratch tooling and have been removed;
  no test-only code or environment flag is left in the app.

---

### DEFECT-025 — Google sign-in refused in production, 400 before Google was called

- **OBSERVED:** the deployed web app showed "Sign-in failed — We could not complete the sign-in.
  Please try again." The Render log has two refused callbacks:
  - `GET /v1/auth/google/authorize` (client 223.188.135.37) answered 200, and 27.5 s later
    `POST /v1/auth/google/callback` from the same client answered **400 in 0.716 ms** on the same pod;
  - `POST /v1/auth/google/callback` (client 63.88.73.201) answered **400 in 0.77 ms** with **no
    `authorize` request from that client anywhere on that pod**;
  - a third attempt (171.76.110.173) logged `"Google OAuth successful"` with the same credentials, so
    the OAuth client and the redirect URI were not the problem;
  - `POST /v1/auth/refresh` answered 401 in 0.6–0.8 ms repeatedly, including twice for the failing
    223.188.135.37 client, so those browsers held no usable session either.
- **Why it is visible in production but not locally:** the sub-millisecond 400 rules out the Google
  call — a request that reaches `completeOAuthFlow` cannot answer that fast — so the callback was
  rejected by the handshake check. The handshake had two single points of failure, and the log shows
  both of them failing:
  1. **The state was remembered in one Node process.** `GET /authorize` stored `{codeVerifier, nonce}`
     in a module-level `Map` keyed by a random state. Render hibernates idle instances and replaces
     pods on every deploy (the log shows a redeploy mid-window), so a callback can arrive at a process
     that never minted that state — 63.88.73.201's missing `authorize` line is exactly that. A local
     single-process dev server never rotates, which is why this never reproduced on a laptop.
  2. **The browser-side half was a cross-site cookie.** `py_oauth` is written on `onrender.com` from a
     request made by `vercel.app` and has to come back on the POST from Google's origin. Safari's ITP,
     Firefox's total cookie protection and Chrome incognito partition or discard that cookie, so a
     browser that carried neither transport left `state` as the only evidence — and the old check also
     required the cookie to match, so a correct state alone was refused.
- **CHANGED:** the handshake is now self-contained, and the browser proves itself with a value it can
  carry two ways:
  - `routes/google-auth.ts` — the `Map` is gone. `authorize` seals
    `{codeVerifier, nonce, bindingHash, expiresAt}` into the state itself (AES-256-GCM, `lib/seal.ts`)
    and returns a 32-character random `binding` to the SPA as well as setting it as `py_oauth`.
    `callback` opens the state, checks the expiry, and accepts **either** transport of the binding —
    the `sessionStorage` copy in the body or the cookie — comparing SHA-256 hashes in constant time.
    PKCE still binds the code to the verifier, and Google still enforces a single-use authorization
    code, so dropping the server-side single-use check changes no attacker's options: a replayed state
    with a spent code fails at Google. Every refusal logs `{reason, path}` at `warn` (unreadable,
    expired, missing, mismatched), so a future failure names its branch instead of showing a bare 400.
  - `lib/seal.ts` — `seal`/`open` take an optional domain tag (`'oauth_state'`), so the OAuth key is
    derived separately from the handover-code key. The untagged call is unchanged, so existing sealed
    pickup codes stay readable.
  - `lib/cookies.ts` — cookie writes append to `set-cookie` instead of replacing it. Fastify's
    `reply.header` overwrote the header, so a response that set the session cookie next to another
    one would have silently dropped one of them.
  - `screens/Login.tsx` / `screens/GoogleCallback.tsx` — the SPA parks `handshake_binding` in
    `sessionStorage` beside the existing `next` value and sends it with the code; the callback screen
    now prints `errorCopy()` copy instead of a fixed "sign-in failed" line.
  - `lib/copy.ts` — `INVALID_STATE`, `GOOGLE_AUTH_FAILED` and `GOOGLE_OAUTH_DISABLED` get real copy.
  - `app.ts` — the deprecated top-level `maxParamLength` moved to `routerOptions` (FSTDEP022 in the
    Render log), keeping the 512-character limit the signed-file route needs.
- **Consequence / verification:** `apps/api/test/google-handshake.test.ts` (9 tests, run by
  `npm run test:api`) exercises the handshake without Google: a sealed foreign state — one this
  process never minted, the redeploy case — is accepted with the body binding only and completes to
  the Google call; the cookie alone is accepted (so the already-deployed pre-fix web bundle keeps
  working); a second tab's stale body binding does not outweigh a matching cookie; forged, tampered,
  expired, unsigned and unproven states are all refused with `INVALID_STATE`; a rejected callback
  still expires `py_oauth`. Also checked out of process: the API was rebuilt and restarted on a new
  PID, and a handshake minted before the restart completed afterwards — this is the claim the
  in-process suite cannot make. Typecheck (all three workspaces), 64 domain tests, 12 API tests and
  `vite build` pass. **Not covered:** there are no real Google credentials or client here, so the
  suite stops at `GOOGLE_AUTH_FAILED` (the placeholder code is rejected online or offline) rather than
  asserting a session; and no browser with third-party cookies actually blocked was used — that path
  is covered by construction (the body transport) and by the tests, not by a device.
- **Deploy order:** the API must go first. The new web bundle sends a `binding` field that the old
  API's `.strict()` schema rejects; the old bundle has no such field and keeps working against the
  new API through the cookie, so OTP sign-in and Google sign-in stay usable during the window.

### DEFECT-026 — a deleted account blocks its own Google sign-in, and its sessions keep refreshing

- **OBSERVED (production Render log):** `POST /v1/auth/google/callback` logged "Google OAuth
  successful" and then failed with
  `DatabaseError: duplicate key value violates unique constraint "users_google_sub_idx"`,
  `Key (google_sub)=(102010256565828400439) already exists.`, answering **500**. In the same session,
  `POST /v1/auth/refresh` answered **200** repeatedly while `GET /v1/me` answered **403**.
- **Cause:** the deleted row still owned the identity. `POST /me/deletion-request` set only
  `status='deleted'` and `deleted_at`:
  - `users_google_sub_idx` is `UNIQUE (google_sub) WHERE google_sub IS NOT NULL` — the predicate does
    not mention `deleted_at`, so the tombstone kept the subject and the next sign-in tried to insert a
    second row for it. The email index *is* filtered on `deleted_at IS NULL`, which is why only the
    subject collided.
  - `phone_hash` is plain `UNIQUE`, so the same number could never register again either.
  - Sessions were not revoked, so `/auth/refresh` kept minting access tokens for an account that
    `authenticate` refuses with `ACCOUNT_DELETED` (403) — the exact 200/403 pair in the log.
- **CHANGED — one policy, applied everywhere:** a deletion turns the row into a tombstone whose login
  identifiers are freed; signing in again creates a fresh account (the pack's deletion intent), while
  booking and payment rows stay attached to the tombstone.
  - `routes/me.ts` — the deletion is one transaction: `google_sub = NULL`, `phone_hash =
    'deleted:' || id`, `status/deleted_at` set, and every live session revoked.
  - `migrations/0009_free_deleted_identifiers.sql` — repairs rows deleted before this change
    (idempotent: the tombstone derives from the row id) and revokes their sessions.
  - `routes/google-auth.ts` — `upsertUserFromGoogle` retries once on a unique violation: the winner's
    row is returned, so two first sign-ins that race settle on one account; a legacy tombstone still
    holding the subject is freed and the person gets a fresh account. `finishSignIn` refuses
    `ACCOUNT_SUSPENDED`/`ACCOUNT_DELETED` before opening a session.
  - `routes/auth.ts` — `findOrCreatePhoneUser` does the same for OTP: live-only lookup, suspended
    refused (`ACCOUNT_SUSPENDED`), unique-violation loser re-reads the winner, deleted rows are never
    resurrected. `/auth/refresh` joins `users` and refuses a deleted account (`401
    AUTH_REFRESH_INVALID`, cookie cleared, session revoked) or a suspended one (`403
    ACCOUNT_SUSPENDED`) instead of issuing a token.
  - `lib/db-errors.ts` — `isUniqueViolation` (SQLSTATE 23505, optional constraint name).
- **Consequence / verification:** `apps/api/test/identity-recovery.test.ts` (8 tests) drives the real
  routes: deletion frees both identifiers and revokes every session; refresh refuses a deleted and a
  suspended account; the same Google subject signs in again on a fresh account; a pre-migration
  tombstone is self-healed; two concurrent first sign-ins resolve to one row; a deleted phone number
  registers again; a suspended number is refused at verify. The migration SQL was also executed
  against a hand-built legacy tombstone (subject attached, real phone hash, live session) and repaired
  it; a second execution changed nothing. Full run: 25/25 API tests, 64/64 domain, 8/8 mobile,
  typecheck clean, and the E2E harnesses against an isolated API — smoke 57, discovery 46, trips 40,
  messaging 33 (1 skip), journeys 52, concurrency 11, ratelimit 14, all 0 failed.
- **Not covered:** no real Google credential exists here, so the Google leg is exercised through
  `upsertUserFromGoogle` with a supplied identity, not through a live token exchange.
- **Deploy order:** migration 0009 must be applied. With `MIGRATE_ON_BOOT=true` (the value
  `.env.production.example` already asks for) a redeploy applies it before listening; otherwise run
  `npm run db:migrate` against the production `DATABASE_URL` first. A production boot with the
  migration pending and `MIGRATE_ON_BOOT` unset refuses to start by design.
- **Data consequence, stated plainly:** the account that triggered this is a tombstone. Signing in
  with the same Google account now creates a new account; bookings and payments made by the old one
  remain on the tombstone and are not transferred. The day-7 anonymisation and day-30 purge in
  `database/RETENTION_AND_DELETION.md` are still not automated (no worker in this build).

### DEFECT-027 — verification submission answers 400 "Check the details" and hides the reason

- **OBSERVED (production console):** signing in and opening `/verify`, `POST /v1/verifications`
  answered **400** and the page showed "Check the details / One of the fields needs a different
  value." with reference `d486072e-422b-4d99-a5fc-e3aeb836bea1`. A **401** on the first
  `GET /v1/verifications` appeared in the same console.
- **Cause — four layers of the same silence:**
  - The submit path re-reads every uploaded object to measure its true MIME type, size and hash
    (`getObject`). When the bytes were gone it threw `VALIDATION_FAILED { field: 'object_key' }`
    ("Upload the document again."). The client's `errorCopy` maps by code only, so
    `VALIDATION_FAILED` collapsed to the generic "Check the details" copy and discarded both the
    server message and `details`. Nothing told the person which field, or that re-uploading was the
    fix.
  - `cloudinaryGet` requested `/image/download` without `type: 'authenticated'`, while
    `cloudinaryPut` stores with `type: 'authenticated'`. Every Cloudinary-backed read would have
    returned a non-200 (and thus "bytes gone") even when the asset existed. The delivery-URL
    signature also used the default SHA-1 algorithm while the upload signature asked for SHA-256.
  - `signObjectKey` hand-built a Cloudinary CDN delivery URL for authenticated assets; that URL
    format is not reproduced by this adapter and would 404 for the reviewer.
  - On a host with an ephemeral filesystem (Render), a local-disk upload survives only until the
    next deploy/restart, which is how bytes go missing in the first place.
  - The 401 is separate: the page fires `GET /verifications/me` before the access token is in
    memory; the client refreshes once and retries, so it is a benign bootstrap 401 unless it
    repeats after sign-in.
- **CHANGED:**
  - `lib/errors.ts` — new `UPLOAD_EXPIRED` (400, "The uploaded photos are no longer available.
    Attach them again."), catalogued with the rest.
  - `routes/verification.ts` — a submit whose object cannot be read now throws `UPLOAD_EXPIRED`;
    a key owned by someone else still throws `VALIDATION_FAILED { field: 'object_key' }`. Both
    happen before the verification row is written, so a failed attempt is not spent.
  - `lib/storage.ts` — `cloudinaryGet` sends `type=authenticated` and
    `signature_algorithm=sha256` and fetches through `/image/download`; `cloudinaryPut` declares
    `signature_algorithm: 'sha256'`; `signObjectKey` returns the API's HMAC-signed proxy URL for
    both providers, so one verified code path serves reads.
  - `apps/web/src/lib/copy.ts`, `apps/mobile/src/lib/format.ts` — `UPLOAD_EXPIRED` copy, and
    `VALIDATION_FAILED { details.field: 'object_key' }` gets its own title/hint instead of the
    generic message.
  - `apps/web/src/screens/Verification.tsx`, `apps/mobile/app/verification.tsx` — on either code,
    the three uploaded keys are cleared so the panel asks for the photos instead of resubmitting
    keys the server will keep refusing.
- **Verification:** `apps/api/test/verification-upload.test.ts` (4 tests) drives the real routes
  over a ticket + upload sink: a submission with its own uploads returns 201 with two
  `verification_documents` rows carrying the measured MIME type, exact byte size and a 64-hex
  SHA-256; a fabricated ghost key returns 400 `UPLOAD_EXPIRED` and writes no verification row
  (the attempt is not spent); another account's key returns 400 `VALIDATION_FAILED` with
  `details.field === 'object_key'`; the upload URL points at the API sink and a PUT under a
  foreign key is refused. Full run: 29/29 API, 64/64 domain, 8/8 mobile, workspace typecheck
  clean.
- **Not covered:** no Cloudinary credentials exist in this environment, so the Cloudinary branch
  is code-reviewed and typechecked, not executed. The local branch is what the tests exercise.
- **Operational requirement, stated plainly:** production `POST /v1/verifications` can only keep
  working across restarts if `STORAGE_PROVIDER=cloudinary` with real
  `CLOUDINARY_CLOUD_NAME`/`API_KEY`/`API_SECRET`, or the API runs on a host with a persistent
  disk. With the default local provider on an ephemeral filesystem, uploads are lost on every
  deploy and the new error is what the person will see — correct, but a dead end.

### DEFECT-028 — the upload sink answers a bare 500 when the object write fails

- **OBSERVED (production console):** two `PUT /v1/files/local-upload/kyc_id/<userId>/<uuid>.png`
  requests answered **500**. Nothing in the route can 500 by design: every refusal is an
  `AppError` with a 4xx. Probes against the live API showed the route exists (401 without a
  token), the CORS preflight is clean, and `GET /v1/health` reports database and storage OK —
  so the 500 is an unmapped exception inside the handler, i.e. the storage write itself, and the
  API logged it as `unhandled error` while the browser showed nothing actionable.
- **Cause — three defects stacked:**
  - `putObject` failures (unwritable volume, provider refusal, quota) fell through the error
    handler's catch-all as 500 `INTERNAL_ERROR`; the cause went only to the log and the client
    got the generic "something went wrong" copy.
  - `cloudinaryPut` split the key across Cloudinary's `folder` and `public_id` parameters with
    `folder = 'kyc_id/<userId>'`. Cloudinary's `folder` parameter does not accept path
    separators, so **every** signed upload answered 400 and therefore **every** sink PUT
    answered 500 on a Cloudinary-backed deployment. The full path belongs in `public_id`
    (slashes there create the nested folders).
  - The web client hardcoded `/files/local-upload/...` and discarded the ticket's `upload_url`,
    so it could not follow a provider switch and bypassed the server's own contract.
- **CHANGED:**
  - `lib/errors.ts` — new `STORAGE_UNAVAILABLE` (503, "We could not store your upload right now.
    Try again in a moment."), catalogued.
  - `routes/files.ts` — both upload sinks catch `putObject` failures, log `{ err, object_key }`
    at error level, and answer `STORAGE_UNAVAILABLE` instead of a bare 500.
  - `lib/storage.ts` — `cloudinaryPut` sends the whole path as `public_id` and no longer uses
    the `folder` parameter.
  - `apps/web/src/lib/upload.ts` — the client follows `ticket.upload_url` (path part only),
    matching the mobile client, instead of guessing the sink.
  - `apps/web/src/lib/copy.ts`, `apps/mobile/src/lib/format.ts` — `STORAGE_UNAVAILABLE` copy.
- **Verification:** `apps/api/test/verification-upload.test.ts` (5 tests) adds "a failed object
  write is a retryable 503, not a 500": a file squatting on the purpose directory makes the
  recursive mkdir fail, and the sink answers 503 `STORAGE_UNAVAILABLE` — proving the envelope,
  not the provider. The happy-path helper now PUTs to the ticket's own URL, so the client
  contract is what is tested. Full run: 30/30 API, 64/64 domain, 8/8 mobile, workspace typecheck
  clean.
- **Not covered:** no Cloudinary credentials exist here, so the Cloudinary upload branch is
  code-reviewed, not executed. Whether Render runs `STORAGE_PROVIDER=cloudinary` or `local` is
  not observable from outside; with this change the next failed write names itself in the
  Render log (`object write failed` + the provider status/errno) instead of hiding behind a 500.

### DEFECT-028 follow-up — every signed Cloudinary upload still answers 503

- **OBSERVED (production console):** after the first fix the ticket switched to
  `PUT /v1/files/cloudinary-upload/...` (proving Render runs `STORAGE_PROVIDER=cloudinary`) and
  the sink answered **503** `STORAGE_UNAVAILABLE` on every PUT. The error text is the one the
  new envelope emits, so the write itself was refused by Cloudinary.
- **Cause:** the signature was wrong. `cloudinaryGet`/`cloudinaryPut` signed with SHA-256 and put
  `signature_algorithm=sha256` inside the signed string. A live probe (placeholder credentials,
  real Cloudinary endpoint) answered `Invalid Signature` and reported its
  **String to sign — `public_id=...&timestamp=...&type=authenticated`** — no
  `signature_algorithm`. The account validates **SHA-1**, which is Cloudinary's default:
  default accounts reject any signature that signs `signature_algorithm`; only accounts whose own
  security setting requires SHA-256 accept it. The signing also had to include `timestamp` and
  `type=authenticated` — parameters missing from earlier attempts.
- **CHANGED:**
  - `lib/storage.ts` — `cloudinarySignature` (now exported) hashes with
    `config.CLOUDINARY_SIGNATURE_ALGORITHM` (default `sha1`); `signature_algorithm: 'sha256'` is
    added to the signed params only in sha256 mode. Signed string: sorted `k=v` pairs joined by
    `&`, then the API secret appended — exactly as Cloudinary builds it (`file` and `api_key`
    are never in it).
  - `config.ts` — new `CLOUDINARY_SIGNATURE_ALGORITHM` (`sha1` | `sha256`, default `sha1`); flip
    to `sha256` only when the account's security setting requires it.
  - `apps/api/test/cloudinary-signature.test.ts` — two tests pin the construction: the SHA-1
    signature reproduces Cloudinary's documented worked example (secret `abcd`,
    `{timestamp: 1315060510}` → `a21ad0f63beb4de2e5575204b79ab90bffb02c10`) and the sorted
    params + secret string.
- **Verification:** both signature tests pass; full run 32/32 API, workspace typecheck clean.
- **Honest limit:** the signature is proven against Cloudinary's published vector, and the live
  probe proved the previous string was not what the account validates. An upload against the
  user's real account needs the deployed build on Render; if that still refuses, the account has
  been switched to SHA-256 in Cloudinary settings and the fix is
  `CLOUDINARY_SIGNATURE_ALGORITHM=sha256` in the Render environment.

---

### DEFECT-029 — no connected network, no road distances, no launch fare engine

- **OBSERVED:** the repository had three cities in the demo seeder, no state/zone/hotspot model, no
  directed city pairs, no distance cache, and one flat quote formula. Matching distances were
  great-circle only and the fare did not separate traveller pay, commission, subsidy, discount and
  tax. Nothing could say which city pairs were measured, approved or operational.
- **CHANGED:**
  - `apps/api/migrations/0010_geo_network.sql` — countries, states, zones, hotspots, directed
    `route_edges`, `distance_cache`, `pricing_policies`, `postal_benchmarks`; adds `state_id`,
    `status`, `coordinate_source`, `coordinate_verified_at` to cities. Seeds the 8 launch cities
    once each, 4–5 zones per city, 41 hotspot candidates with NULL coordinates, the 56 directed
    candidate edges and one active policy. Database checks enforce the route ladder
    (`operational` requires a distance), hotspot activation (coordinates + verification) and a
    single active policy.
  - `apps/api/src/lib/routing.ts` + `apps/api/scripts/geo-matrix.ts` — Google Routes
    `computeRouteMatrix` client, resolution precedence (edge → fresh cache → labelled estimate →
    refusal), per-element failure recording, and an offline matrix filler. Measurement is never on
    a request path, and approved/operational edges are never overwritten.
  - `packages/domain/src/launch-pricing.ts` — `v2.0-launch` formula with billable/volumetric
    weight, route and weight costs, surge, discount, tax, commission, traveller subsidy, platform
    net, minimum/maximum fare, with the reconciliation invariant checked before returning. The
    quote table's legacy `total = subtotal + platform + tax` constraint is satisfied by mapping
    commission into the split (`legacyQuoteColumns`); full decomposition is returned separately.
  - `apps/api/src/routes/geo.ts`, `admin-geo.ts`, quote handler changes — public geo/route/
    serviceability/journey endpoints; staff hotspot verification, route decisions, matrix refresh,
    policy and benchmark management, all audited; quotes now store their policy snapshot, distance
    provenance and cost decomposition.
  - `apps/web` — the price card shows road distance, Measured vs Estimate, billable weight and
    route status, with the provider and measurement time when a measured distance exists.
  - `apps/web/src/components/NetworkAdmin.tsx` + the `network` tab in `screens/Admin.tsx` — the
    staff console over the admin endpoints: coverage counters and per-city hotspot table, the route
    ladder with per-pair measure / approve / operational / retire, the hotspot editor (coordinates,
    verify / reject / suspend, activate, pickup and drop-off), pricing policy drafts with activation
    and the recorded postal benchmarks with their source links. Write controls are gated on the
    caller's own `/me` roles; the rows and refusals come from the server, and nothing is computed
    locally. `/admin/geo/routes` now also returns `origin_city_id` / `dest_city_id` so a row can be
    sent to `POST /admin/geo/routes/refresh`.
- **CONTRACT:** `parcel-yatra-startup-pack/api/openapi.yaml` lists neither the five `/geo/*`
  endpoints nor the eight `/admin/geo/*` endpoints, and its `Quote` schema is
  `additionalProperties: false` with only the legacy money columns. The quote response now carries
  `policy_version`, `commission_paise`, `traveller_subsidy_paise`, `discount_paise`,
  `platform_net_paise`, `loss_making`, `within_limits`, `warnings`, `road_distance_km`,
  `distance_source`, `route_status`, `route_provider`, `route_measured_at`, `billable_weight_kg`,
  `volumetric_weight_kg` and `service_mode` on top of them. Nothing validates responses against the
  pack at runtime, so no request breaks — but this is the same additive-contract situation as
  DEFECT-005: the pack should gain these paths and fields before the API is frozen. The pack is
  reference material, so it was not edited here.
- **UNVERIFIED / NOT DONE:** no `GOOGLE_MAPS_API_KEY` exists in this workspace, so all 56 pairs
  remain unmeasured and are priced on labelled estimates; no hotspot has coordinates, so doorstep
  is refused; no Speed Post benchmark is stored. The staff console is new and has no test of its
  own — it was walked through in a browser (below), but no state-changing press (verify a hotspot,
  approve a route, activate a policy, record a benchmark) has been driven through it, because doing
  so on this build would either need a provider key or write demo rows into the development
  database. See `docs/GEO_NETWORK.md` §9 for the full list.
- **Verification:** `geo-network`, `routing`, `launch-quote` and `geo-api` suites run against the
  real app and PGlite; counts are recorded in `docs/TEST_COVERAGE.md`.

### DEFECT-030 — remote homepage and festive campaign CMS

- **PACK:** the brief asks for a server-driven homepage with scheduled festive campaigns, a web
  CMS, draft/publish/rollback and no app update needed. The pack's `Homepage` contract is a static
  page description with no release, campaign or media tables.
- **ADDITIVE:** `0011_homepage_cms.sql` adds `homepage_releases` (immutable `draft` / `published` /
  `archived` rows for both the base page and campaigns, one live homepage enforced by a partial
  unique index) and `homepage_media` (the artwork allowlist). `@py/domain` owns the contract and the
  parser; the API validates on write, the app validates before render. `GET /v1/homepage` and
  `GET /v1/homepage/media/:id` are public and cacheable; fifteen `/admin/homepage…` routes manage
  drafts, publish, rollback, campaigns and media.
- **ROLES:** all five staff roles may read the console; only `trust_safety` may write. `admin_readonly`
  is excluded on purpose — its name promises it cannot change anything, and publishing under it
  would be a trap. The configured `ADMIN_EMAILS` owner receives `trust_safety` at sign-in.
- **UI:** the Expo home screen now renders the remote document over a fixed composition (header,
  hero carousel, search bar, live shipment, ordered sections, account block). The web console gains
  a **Homepage** tab with page and campaign editors, preview, schedule, publish, unpublish and
  restore. Campaign content may restyle, retitle, reorder and hide sections; it cannot add a
  component, move the search bar or install code.
- **NOT DONE:** per-user or per-city targeting (campaigns target platforms only); push delivery (a
  closed app sees the change on next open); a scheduler (windows are evaluated against server time
  per request, so there is nothing to be late).
- **VERIFICATION:** 18 API tests against the real app and PGlite. Browser: draft privacy, publish,
  scheduled dark, live campaign, automatic expiry on real elapsed time, rollback as a new version.
  App: a campaign published only through the API appeared in the running Expo Web build with no
  rebuild, and its 5-minute timer was observed applying the fallback campaign after the shown one
  was unpublished. **Not verified:** any device or emulator, the native file cache, the
  foreground-refresh branch (a synthetic `visibilitychange` did not trigger it), and image upload
  driven through the console end to end (upload and media registration are covered at the API). See
  [docs/HOMEPAGE_CMS.md](HOMEPAGE_CMS.md).

### DEFECT-031 — Android Google sign-in stopped at 400 `redirect_uri_mismatch`

- **SYMPTOM:** Google sign-in worked on the website but the installed Android app opened a browser
  page reading *Error 400: redirect_uri_mismatch* and never returned to the app.
- **CAUSE:** Android used `expo-auth-session`'s browser authorization-code flow. That flow builds
  `redirect_uri` from the application id → `in.parcelyatra.app:/oauthredirect`, while sending the
  request as the **Android** OAuth client. Google matches an Android client by package name and
  signing certificate and expects no redirect URI from it, so no console entry could have made that
  request valid. The mismatch was in the flow, not in a missing console value.
- **FIX:** the button is platform-split and the UI is unchanged. `GoogleSignInButton.native.tsx`
  uses `@react-native-google-signin/google-signin` — Play Services, no browser redirect, no client
  secret in the app. `GoogleSignInButton.tsx` keeps the browser flow for the web build byte-for-byte
  in behaviour. Both render `GoogleButtonShell`, and `src/lib/google.ts` is now the only place the
  client ids are read. The ID token still goes to `POST /v1/auth/google/token`; on Android its
  audience is the **web** client (`webClientId`), which the API already verifies as
  `GOOGLE_CLIENT_ID`. No OAuth check was relaxed and no redirect URI was added to the console.
- **REQUIRED IN THE CONSOLE:** in the Google Cloud project, open the **Android** OAuth client for
  package `in.parcelyatra.app` and make sure the SHA-1 of the certificate that signs the installed
  APK is listed. EAS-managed keystore: `npx eas-cli credentials -p android` lists the fingerprint;
  for an existing APK: `keytool -printcert -jarfile app.apk`. If the build is distributed through
  Play, add the **App signing key certificate** SHA-1 from Play Console → App integrity too. No
  client id goes into `GoogleSignin.configure` for Android: Google resolves the client from those two
  values.
- **CONSEQUENCE:** Google sign-in now needs a development or standalone build
  (`eas build -p android --profile preview` or `npx expo run:android`); Expo Go ships no such native
  module. Phone OTP still works in Expo Go. iOS is unchanged and has no iOS OAuth client, so the iOS
  build still reports Google as not configured.
- **VERIFICATION:** `npm run typecheck` passes in all four workspaces and `npm test` passes
  (90 domain, 70 API, 8 mobile). `npm run export:android` produced a bundle containing
  `RNGoogleSignin`/`hasPlayServices` and **no** `useIdTokenAuthRequest`/`oauthredirect`; a web export
  still contains the browser flow and no native module. The sign-in screen rendered in the Expo Web
  preview with the shared button and no console errors. **OBSERVED by the owner on 2026-10-28:** the
  EAS-built APK signed in with Google on a physical Android phone, which also proves the Android
  OAuth client and the signing certificate's SHA-1 are registered correctly in the console.

### DEFECT-032 — every scrolled screen rendered blank on Android

- **SYMPTOM:** on the first EAS-built APK (2026-10-28) Google sign-in completed and Profile rendered,
  while Home, Bookings, Trips and Inbox showed only their header, tab bar and background. Every
  detail screen built on `Screen` had the same problem.
- **CAUSE:** screens pass `refreshControl={<Refresh …/>}`. On Android, `ScrollView` does not mount
  that element next to its content: it clones the element and passes the whole scroll view — plus the
  layout style — **as its children** (`ScrollView.js`, the `Platform.OS === 'android'` branch).
  `Refresh` rendered a bare `<RefreshControl>` and ignored those props, so the screen content was
  never mounted. Profile is the only tab without a refresh control, which is why it was the only tab
  that rendered.
- **FIX:** `Refresh` now forwards `children` and `style` to `RefreshControl`, whose native control is
  the `SwipeRefreshLayout` that wraps the scroll view on Android. One component; no screen changed.
- **VERIFICATION:** typecheck, 168 tests and the Android Metro export pass. The device render must be
  re-checked on a rebuilt APK — this machine cannot run Android, so the native confirmation is the
  owner's, not this build's.



### Direct UPI collections — the launch payment rail (2026-10-29)

- **DECISION:** payments are collected on the owner's own merchant UPI handle
  (`PAYMENT_PROVIDER=upi_direct`) instead of a gateway. UPI person-to-merchant has no MDR, so the fee
  is zero; there is no gateway onboarding and no gateway KYC. The cost is that confirmation is
  manual: a bank line is not an API event, so a `finance` user compares the statement with the queue.
- **WHAT THE APP DOES:** `POST /bookings/{id}/payment-intent` stores a `upi_direct` row whose
  `provider_ref` is a `PY` + 8-character reference, always derived server-side from the stored quote.
  The response carries a `upi://pay` link (handle, exact amount, reference in `tr`/`tn`) and the
  payee. The web booking page renders it as a QR code plus an "Open UPI app" link; the mobile
  booking screen opens it with `Linking.openURL`. Both screens rebuild the same panel from
  `booking.payment` after a reload.
- **WHAT IT REFUSES:** no UPI app callback is trusted. The intent is `created` until a `finance` user
  records the bank UTR at `POST /admin/bookings/{id}/payment/receipt` (Admin → UPI receipts). That
  call is the only writer of a `upi_direct` capture: it sets `state='captured'`, stores the UTR in
  `payments.provider_event_id` (unique, so one bank line cannot settle two bookings), writes one
  `capture` ledger entry and applies `payment_authorised` in the same transaction. The mock webhook
  path only matches `mock`/`sandbox_provider` rows, and the dev simulator answers
  `PAYMENTS_NOT_ENABLED` under `upi_direct`, so neither can fake a receipt.
- **CONFIG GUARD:** `upi_direct` requires `PAYMENTS_LIVE=true`, a real `UPI_VPA` and
  `UPI_PAYEE_NAME`; `PAYMENTS_LIVE=true` with any other provider refuses to boot. A deployment
  therefore cannot take real money while calling itself sandbox.
- **VERIFICATION:** `apps/api/test/upi-payment.test.ts` (5 tests) covers the link/amount/reference,
  sender refusal (403) and finance capture, repeat capture (`409 PAYMENT_ALREADY_EXISTS`), a
  reused UTR (`409 CONFLICT`), a non-payable booking, and the finance-only queue. Full API suite
  133/133, mobile 23/23, root typecheck and the web build pass. A browser run on 2026-10-29 with
  `PAYMENT_PROVIDER=upi_direct PAYMENTS_LIVE=true`: the sender panel showed the QR, the handle and
  the reference; a finance user recorded the UTR from Admin → UPI receipts; the queue afterwards
  read "No UPI payments waiting"; the sender's booking then came back
  `payment: {state: "captured", sandbox: false}`; the audit log held `payment.intent_created` and
  `payment.upi_receipt_confirmed` against the same payment id; a repeated receipt answered
  `409 PAYMENT_ALREADY_EXISTS` in 6 ms and `/v1/health` stayed green.
- **OBSERVED, FIXED:** the receipt call first deadlocked the entire API on the embedded database.
  `applyBookingTransition` runs inside the caller's transaction, and `trackingService.stopTracking`
  wrote through the service's own outer handle; PGlite runs one connection, so that UPDATE queued
  behind the open transaction forever. `stopTracking(bookingId, using?: Db)` now takes the scoped
  handle and the call site passes it. The suite did not catch it because `trackingService.db` is
  unset in tests. Rule: a side effect invoked from inside `db.transaction` must use the scoped `db`
  (see `lib/db-scope.ts`), never a module-level handle.
- **NOT VERIFIED:** no real rupee was sent. The merchant VPA does not exist yet, so the `upi://`
  link was checked structurally, not by opening a UPI app on a phone; the QR was not scanned. The
  operator queue was exercised against synthetically created bookings, not a real bank statement.

### PGlite as the development database

- **OBSERVED:** the API runs embedded PostgreSQL (PGlite/WASM) from `apps/api/data/pgdata` unless
  `DATABASE_URL` is set. SQL is ordinary PostgreSQL and `schema.sql` is unmodified PostgreSQL.
- **Why:** no Docker or local PostgreSQL on the build machine.
- **Consequence:** single process, single writer, no connection pool, no `LISTEN/NOTIFY`, no
  concurrent-write testing. **A pooled `pg` client and a real migration run are required before any
  shared environment.** `db/client.ts` is the only file that should need to change.
- **OBSERVED twice on the build machine:** a development API killed with `taskkill /F` leaves
  `data/pgdata` unopenable — the next boot aborts inside the WASM Postgres (`RuntimeError: Aborted()`)
  and removing `postmaster.pid` does not help. The recovery is to move the directory aside and let
  migrations plus `AUTO_SEED` rebuild it. Two such quarantined directories are sitting in
  `apps/api/data/`. Treat this as a reason not to put anything real in the embedded engine, and as
  a second reason to stop two `dev:api` processes from racing for the same data directory.

### Build and run tooling

- **OBSERVED:** the API is bundled with esbuild (`--packages=external`) for `build`, and runs under
  `tsx watch` in development. Relative imports include `.ts`, so `allowImportingTsExtensions` is on.
- **Why:** keeps one source of truth and avoids a second compile step in development.
- **Consequence:** the shipped bundle is a single ESM file. `npm run build` and `npm start` exist;
  they are not a deployment recipe.

### Development-only affordances

- **OBSERVED:** with `ENABLE_DEV_ENDPOINTS=true` (never in production; `assertSafetyRails` refuses):
  - `GET /v1/dev/otp/:challengeId` reveals a sandbox OTP held in process memory;
  - `POST /v1/dev/webhooks/simulate` emits a signed provider webhook;
  - `POST /v1/dev/bookings/:bookingId/advance` moves a booking one step for demos and smoke tests;
  - `POST /v1/dev/seed/reset` truncates and reseeds (staff role), invalidating all sessions.
- **OBSERVED:** the OTP ceiling is raised to 100 per number per hour when dev endpoints are on. The
  documented pilot limit remains **3** (`RATE_LIMIT_OTP_PER_HOUR_PER_NUMBER=3`); the raise exists so
  a repeated demo does not lock itself out. This is a dev-only deviation, not the pilot limit.
- **OBSERVED:** the web shows "Test mode" chips, sample-image buttons, "Open pickup now", and a
  "use code NNNNNN" button only when `import.meta.env.DEV`.
- **Consequence:** none of this may ship to a shared environment. The production guard is a boot
  failure, not a runtime check.

### Admin console shares the public web origin

- **PUBLISHED** (`AGENTS.md`, `api/API_CONVENTIONS.md`): staff surfaces must be on a separate origin;
  `ADMIN_WEB_URL` must differ from `PUBLIC_WEB_URL`, and the API refuses to boot if they match.
- **OBSERVED:** the console is a lazy-loaded `/admin` route in the same Vite app, gated client-side
  by `RequireStaff` and server-side by roles on every endpoint. `ADMIN_WEB_URL` is set to
  `http://127.0.0.1:5174` to satisfy the boot check, but nothing is served there in this build.
- **Consequence:** **this does not meet the separate-origin requirement.** A deployment must serve
  the console from its own origin, with its own cookies/tokens and CSP.

### Notifications are in-app only

- **OBSERVED:** `queueNotification` writes an in-app row; there is no SMS or email provider and no
  job worker. Rows are written with `status='sent'` and `sent_at=now()` because writing the row *is*
  delivery to the in-app feed.
- **Consequence:** "sent" means "visible in the app", nothing more. No message leaves the system.
  External channels need a provider, templates, retries and delivery receipts.

### No background worker

- **OBSERVED:** `jobs` and `outbox` tables exist and rows are written, but nothing polls them.
  Expiry (accept window, quote validity, dispute window) is evaluated at read/transition time, not
  swept.
- **Consequence:** a booking does not move on its own when a deadline passes; it only changes state
  when someone acts or a route notices. Real operation needs a worker with locking and retries.

### Static legal pages

- **OBSERVED:** `/terms`, `/privacy` and `/grievance` summarise the draft documents and carry a
  visible "Draft — not legal advice, not yet reviewed" banner.
- **Consequence:** they are placeholders. **They are not the drafts and are not legal advice.** A
  qualified Indian lawyer must review the drafts before either page is presented as binding.

---

## 3. Gaps (asked for, not built)

| Gap | State | What is missing |
| --- | --- | --- |
| Split case settlement | 501 | Amount, refund path, payout adjustment, ledger entries, reviewer UI (DEFECT-014). |
| Payout release | 501 | No provider, no written fund-flow confirmation (GATE-3 / B-PROV-01). |
| Live payments | available, opt-in | `PAYMENT_PROVIDER=upi_direct` with `PAYMENTS_LIVE=true`, a real `UPI_VPA` and `UPI_PAYEE_NAME` collects on the merchant handle. Every receipt is confirmed by a `finance` user from the bank statement; there is no automatic confirmation. |
| Signed document viewer | absent | Staff see "documents are not rendered in this console"; no signed URL, no audit of views. |
| External notifications | absent | No SMS/email provider; in-app rows only. |
| Background expiry | absent | No job worker; deadlines are checked on access. |
| G-4 traveller suspended mid-trip | undefined | No defined behaviour in the pack or the build. |
| G-5 receiver refuses delivery | partial | `receiver_unavailable` exists for "not there"; a refusal with the parcel in hand has no path. |
| Analytics / KPIs | absent | No event pipeline, no dashboards. Do not infer metrics from this build. |
| Search / moderation tooling | absent | Prohibited-item checks are rule-based at parcel creation. |
| Data export / deletion jobs | partial | The endpoints record the request; no worker performs the export or the deletion. |

Traceability gaps **G-4** and **G-5** are recorded in the pack's testing artefacts; they remain
undefined here on purpose rather than being invented.

---

## 4. Verification performed on this build

**OBSERVED**, on the machine that built it:

- `npm run typecheck` — domain, API, web and mobile all clean.
- `npm test` — 73/73 domain tests pass (money, pricing, eligibility, the booking state machine,
  refunds, and the matching engine: hard gates, score arithmetic, tie-breaks, policy validation,
  low-confidence fallback, truthfulness of the reason codes — plus the nine launch-pricing cases in
  DEFECT-029), 50/50 API tests (the `ADMIN_EMAILS`
  grant, the Google handshake short of the call to Google, the native session transport, the
  deletion/recovery identity cases in DEFECT-026, the upload/submission cases in
  DEFECT-027/DEFECT-028, the Cloudinary signature construction, and the geo-network, routing,
  policy and geo-API suites), and 8/8 mobile transport
  tests. **The Google leg
  is not tested here**: it needs a real ID token from a configured OAuth client, and this build has
  no credentials. What is proven is the function that sign-in calls.
  **Re-run 2026-10-27 after the staff console (DEFECT-029) landed:** typecheck clean,
  73/50/8 still green, and `npm run build -w @py/web` produced the bundle with the new tab. The
  console itself adds no test file.
- `node scripts/smoke.mjs --reset` — 57 checks pass, 0 fail. Covers sign-in, upload ownership,
  parcel creation,
  prohibited-item refusal, matching, quote arithmetic, booking, acceptance, sandbox payment and
  signed webhook, pickup OTP (wrong then right), transit, arrival, delivery OTP, settlement, payout
  refusal (`PAYOUTS_NOT_ENABLED`), review, dispute creation, payout freeze, and evidence.
- `node scripts/concurrency.mjs` — 11 checks pass, 0 fail. Five simultaneous `POST /bookings` for
  one parcel: exactly one 201, four clean 409s, one booking row, capacity reserved once. Three
  simultaneous requests sharing one `Idempotency-Key` return the same booking and leave one row.
  A cancelled parcel can be booked again, so the "one active booking" index is genuinely partial.
- Browser walkthrough of the sender and traveller happy path, the dispute path, verification
  submission and staff approval, the admin case queue, refund/payout refusal, and the audit log.
- **RE-RUN 2026-10-27, after DEFECT-029 moved the quote to the v2 engine.** A temporary API on port
  3001 with its own PGlite directory (`AUTO_SEED`, `PUBLIC_API_URL` matching the port) ran the whole
  script matrix against itself: `smoke` 57 / `discovery` 46 / `trips` 40 / `journeys` 52 /
  `messaging` 33 with the one honest skip / `concurrency` 11, all 0 failed, and `ratelimit` 14/14 on
  a restart with `RATE_LIMIT_ENABLED=true` — the first attempt aborted because I had the limiters
  switched off, which is an artifact of my harness, not of the build. The temporary process and its
  database were removed afterwards; the developer's own API and web dev server were not touched.
- **OBSERVED in the browser on 2026-10-27** (the local vite dev server and its `/v1` proxy): a real
  three-step send — documents, 2 kg, 30×22×5 cm, ₹3,000 declared, Bareilly · Cantt → Delhi ·
  Connaught Place — rendered the new price-card line as `Road distance 274 km · Basis Estimate ·
  Billable 2 kg · Route unverified`, followed by "This fare uses an estimated road distance — no
  routing provider has measured this city pair yet. The total may change once it is measured." The
  server's breakdown came through as ₹12 base + ₹49.32 distance + ₹8 weight + ₹12.48 GST = ₹81.80,
  held for 14:57. "Estimate" computed to the warning colour and the rest to ink-900; the console
  showed no errors from this screen (only the pre-existing `hero-background.webp` preload warning on
  a page that does not use the hero). The card was read through the DOM and computed styles — the
  in-app browser had no visible surface, so no screenshot exists — and the **Measured branch has
  never been rendered with real data**, because there is no routing key here to measure a pair.
- **OBSERVED in the browser on 2026-10-27 (the new staff console).** Signed in as the seeded
  development staff account (`+919000000009`, the roles the seed grants) and opened **Operations →
  Network and pricing**: coverage read `10 active` cities, `56` directed routes with `0 measured ·
  0 operational (0%)`, `0` postal benchmarks and the single active policy
  `launch-2026-10-experiment (active)`; the route table held 56 rows all `candidate`, the hotspot
  table 41 rows with coordinates `none`, and the benchmark panel showed its empty state ("Nothing has
  been read from a postal tariff page and recorded here, so the product shows no comparison and
  claims no saving"). Opening a route row exposed the ladder with the buttons the status allows —
  Approve and Mark operational **disabled** on a candidate — and **Measure with the provider**
  returned the server's own refusal, "Configure ROUTING_PROVIDER=google and GOOGLE_MAPS_API_KEY
  before refreshing routes.", as a 503 with nothing written and the row still `candidate`. Filtering
  routes to `operational` produced the honest empty state. Opening a hotspot showed empty coordinate
  fields with **Save coordinates** disabled. The policy draft form opens with the launch tunables
  (₹12 / ₹0.18 / ₹4 / 6%) and **Save as draft** disabled until a version and name are typed. The only
  console error was that deliberate 503. Read through the DOM again — no screenshot surface. **Not
  driven:** any successful write through this panel (verify, approve, activate, record, delete); each
  of those transitions is covered by `geo-api.test.ts` against the API, not through this UI, and the
  panel has no test file of its own.
- `npm run build -w @py/web` — production bundle builds.
- `npm run export:android -w @py/mobile` — Metro produced the Android bundle, 56 assets and a
  metadata file. This proves the app compiles for the platform; it is not an installable APK.

**Not verified:** load, failover, backup/restore, real provider behaviour, accessibility audit,
penetration test, anything on a second machine, and any mobile UI on a real device or emulator
(no Android SDK, JDK or iOS toolchain on the build machine — see §6).

---

## 5. What this build does not claim

- It is **not** legally compliant, and nothing here has been reviewed by a lawyer.
- It is **not** secure. There has been no audit, no threat-model review of the implementation, and
  no penetration test.
- It is **not** production-ready. PGlite, the local upload sink, the shared admin origin, the absent
  worker and the 501s above are all disqualifying on their own.
- It does **not** prove money movement. The default build is sandbox. The direct-UPI rail can take
  real money when explicitly configured, but no rupee has been sent through it, and payouts and
  split settlement are still refused.
- It does **not** prove demand, unit economics, or any market claim. Prices are **HYPOTHESIS** from
  the pack; no figure here is measured.
- It does **not** store Aadhaar, track location continuously, or store raw phone numbers.

---

## 6. Mobile app (Expo) — what exists and what it refuses to fake

`apps/mobile` is an Expo SDK 58 / React Native 0.88 / TypeScript app in the same workspace as the
API and web client. It talks to the **same** deployed API (`https://parcelyatrafinal.onrender.com/v1`
by default); there is no second backend, no mock server and no seeded demo data in the app.

### Route inventory

| Route | File | Auth | Purpose |
| --- | --- | --- | --- |
| Home | `app/(tabs)/index.tsx` | public | Hero, categories from `/config`, how it works, recent bookings |
| Bookings | `app/(tabs)/bookings.tsx` | signed in | Booking list with status chips |
| Trips | `app/(tabs)/trips.tsx` | signed in | Traveller's own trips and opportunity entry |
| Profile | `app/(tabs)/profile.tsx` | signed in | Name/email/locale edit, verification, sign-out, deletion |
| Sign in | `app/sign-in.tsx` | public | Phone OTP, Google (native), session restore |
| Send | `app/send.tsx` | signed in | Parcel wizard: route, category, weight, window, quote, match, book |
| Parcel | `app/parcels/[id].tsx` | signed in | Parcel detail, offers, cancel |
| Booking | `app/bookings/[id].tsx` | signed in | Status timeline, next action, handover codes, chat, dispute, review |
| Publish trip | `app/trips/new.tsx` | signed in + verified | Trip form with the server's verification gate |
| Trip | `app/trips/[id].tsx` | signed in | Trip detail, opportunity offers, edit, cancel |
| Verification | `app/verification.tsx` | signed in | Upload ID + selfie, state, reasons, retry budget |
| Notifications | `app/notifications.tsx` | signed in | In-app rows, read state, deep link to booking |
| Help | `app/help.tsx` | public | FAQ, honest "what this build does not do" |
| Not found | `app/+not-found.tsx` | public | Recovery |

Auth-gated screens render `AuthGate`, which paints nothing protected while the stored refresh token
is being checked. The tab bar shows an unread badge fed by `GET /notifications`.

### Session transport (additive to the web contract)

The web keeps its refresh token in the HttpOnly `py_refresh` cookie, which a native client cannot
read. With `x-py-client: native`:

- `POST /auth/otp/verify`, `POST /auth/google/token` and `POST /auth/refresh` include
  `refresh_token` **in the JSON body** as well as setting the cookie;
- `POST /auth/refresh` accepts `{ refresh_token }` in the body;
- rotation and reuse detection are unchanged; a reused token still kills the session family.

The native app stores that refresh token in **SecureStore** (`py.refresh_token`, accessibility
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never in AsyncStorage. The access token lives only in module
memory: killing the process ends it, and the next boot refreshes from SecureStore. A per-install
random `py.device_id` is kept so the server can distinguish devices without a fingerprint.

`apps/api/test/native-session.test.ts` (5 tests inside `npm run test:api`) covers: the header makes
`refresh_token` appear in the body; a browser request does not get it; body-refresh rotates; reuse
of an old token is refused; and web cookie refresh still works.

### API client

`src/api/http.ts` normalises every failure into `ApiError { code, status, request_id, details }`:
`NETWORK` when fetch rejects, `TIMEOUT` at 20 s (per-request override available), `AUTH_REQUIRED`
after one failed refresh, and the server's own code/message otherwise. Every non-GET call carries an
`Idempotency-Key`. One 401 triggers one refresh and one retry; concurrent 401s share that refresh;
a second 401 ends the session. The module is free of React Native imports and is tested in Node
(`test/http.test.ts`, 8 tests).

### Backend changes the app needed

One additive field, no behaviour change for the web client:

- `bookingView` returns `viewer_role: 'sender' | 'traveller'` so the app knows which actions to
  offer without guessing from the user's roles.

`userProfile` already returned `verification_state`, defaulting to `not_started` (the same way
`/verifications/me` synthesises a row), so the app did not have to treat "no row" as "verified".

### Environment

`app.json` carries the production `extra.apiBase`; at runtime `EXPO_PUBLIC_API_BASE` overrides it.
Google sign-in needs client ids; without the one for the current platform the screen shows a
"not configured" notice instead of a button that cannot work.

| Variable | Required | Meaning |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE` | no (default in `app.json`) | Full API root, including `/v1` |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | for Google | **Web** OAuth client id — the web flow's client and the native ID token's audience |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | iOS Google | iOS OAuth client id; there is no fallback to the web id |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Android Google | Android OAuth client id; mirrors the console client, not passed at runtime |

The Android client exists only as a console registration: Google matches it by package name
(`in.parcelyatra.app`) and the signing certificate's SHA-1, and the app never sends its id. If the
client id is present but the SHA-1 of the installed APK is not listed on that client, Play Services
answers `DEVELOPER_ERROR` (code 10) instead of an ID token. See DEFECT-031.

`EXPO_PUBLIC_*` values are embedded in the bundle and are public by design. No secret belongs here;
the API's Google client secret stays on the server.

### Commands

```bash
npm run start -w @py/mobile          # Expo dev server (press w for the web preview)
npm run start -w @py/mobile -- --web # web preview directly
npm run typecheck -w @py/mobile      # tsc --noEmit
npm run test -w @py/mobile           # 8 transport tests in Node
npm run export:android -w @py/mobile
```

`export:android` writes `apps/mobile/dist-android` (git-ignored); it proves the JS and native
resolution, not a runnable app. `eas.json` defines `preview` (internal distribution, APK) and
`production` profiles, both pinned to the deployed API. Building needs the owner's Expo account and
lets EAS generate and hold the Android keystore; no signing material is committed here, and this
machine has no phone, emulator, JDK or Android SDK, so no build was produced or launched from it.

Expo Go still runs the app for SDK 58 (the community date picker is one of the modules it bundles)
for everything except Google sign-in, which needs the native module of DEFECT-031 and therefore a
development or standalone build. On a **physical iPhone**, Expo Go (SDK 57 and later) also requires
the CLI and the app to be signed in to the same free Expo account before it will open a project;
Android does not have that rule.

Android Google sign-in checklist, in the order it bites:

1. The APK is signed by a certificate whose SHA-1 is listed on the Android OAuth client for
   `in.parcelyatra.app` (EAS keystore, plus the Play App Signing certificate if the build ships
   through Play).
2. The build is not Expo Go.
3. `EXPO_PUBLIC_GOOGLE_CLIENT_ID` / `extra.googleWebClientId` holds the **web** client id; that is
   the audience the API verifies.
4. The API's `GOOGLE_CLIENT_ID` is that same web client id.

### Web preview (development only)

There is no emulator, phone, JDK or Android SDK on the build machine, so a React Native Web preview
is the only way to render this app locally. It is a convenience for development, not a supported
target: nothing here claims the app is a web product.

- `react-native-web` and a matching `react-dom` are installed in `apps/mobile` so `expo start --web`
  resolves. Expo Router needs both; without them the web bundle fails to resolve `react-native-web/dist/index`.
- `expo-secure-store` has no usable web implementation, so `src/lib/secret-store.ts` swaps in a
  module-scoped `Map` when `Platform.OS === 'web'`. Nothing is written to `localStorage`,
  `sessionStorage` or cookies. The cost is that a page reload signs the user out, because the
  refresh token only lives in memory there. Native builds are unaffected and still use SecureStore.
- `Screen` omits `refreshControl` on web. React Native Web's `ScrollView` clones the `refreshControl`
  element and renders it in place of the content, which blanked every screen that passed one.
- `DateTimeField` renders two text inputs (`YYYY-MM-DD` and `HH:MM`) on web because React Native Web
  has no native date dialog. The text is parsed locally and rejected if the calendar rolls it over
  (e.g. `2026-02-31`); the native build keeps the platform picker.
- A local API is needed for real data. Start it with an isolated database
  (`PGLITE_PATH=./data/pgdata.preview npm run dev:api`) and add `http://127.0.0.1:8081` to
  `WEB_ORIGINS` in `.env`; otherwise the preview's calls to the deployed API are blocked by CORS.
  Point the preview at it with `EXPO_PUBLIC_API_BASE=http://127.0.0.1:3000/v1`.
- Signing in on the preview uses the local sandbox. Like the web login, the sign-in screen asks
  `GET /v1/dev/otp/:challengeId` for the code and shows "Sandbox build: fill NNNNNN and continue".
  That route exists only with `ENABLE_DEV_ENDPOINTS` and answers loopback addresses only; on any
  other server the call fails and no hint appears. No SMS is sent and no production account is
  touched.

**OBSERVED on 2026-10-27**, desktop browser against the local sandbox: the home screen rendered the
config-driven categories and limits; phone sign-in completed (OTP request → dev-store code → session);
home then showed "Signed in as Aarti Verma" and the seeded booking; the Bookings tab and booking
detail rendered (route, pickup window, ₹935 total, ₹647 traveller share, chat composer, status
history); Trips showed the verification lock; Profile showed the masked phone, verification state and
API base; the send wizard's step 1 rendered with the web date fields and refused an empty route with
inline errors. `localStorage`, `sessionStorage` and `document.cookie` stayed empty throughout.

**OBSERVED on 2026-10-28**, same preview: the redesigned home screen rendered the remote document —
compact header with logo, pickup-city selector and unread badges; hero carousel ("Your parcel. Their
journey." with its badges and CTA); the search pill overlapping the hero; the category strip;
popular routes; then the ordered sections. A campaign created and published **only through the API**
appeared in the running app as its own eyebrow and headline with no rebuild and no reload of the
bundle. The app was not run on a device: native caching and native foreground events are unverified.
See [docs/HOMEPAGE_CMS.md](HOMEPAGE_CMS.md) §8.

### Branding and launch screen

The app now ships the supplied identity: a flat blue field (`#005DFD`, sampled from the supplied
artwork) with a white "Parcel Yatra" wordmark and the white P/arrow mark. The assets were generated
from the supplied PNGs rather than redrawn:

- `assets/brand-wordmark-white.png` — white wordmark on transparency, used by the native launch
  screen and the in-app splash.
- `assets/icon.png` — opaque 1024 blue tile with the white mark (iOS icon and fallback).
- `assets/android-icon-{foreground,monochrome,background}.png` — adaptive layers, mark inside the
  66% safe circle and solid blue background.
- `assets/parcel-yatra-logo.png` — the same tile for the sign-in header.
- `assets/favicon.png` and `apps/web/public/{logo,favicon}.png` — website header, tab icon and
  `apple-touch-icon` (the HTML now points both icon links at `/favicon.png`).

The native splash draws that wordmark on `#005DFD` (`expo-splash-screen` `image` +
`imageWidth: 180`, `resizeMode: contain`). 180 dp is the largest width that survives Android 12+'s
mask: the plugin composes the image into a 288 dp canvas and the system clips it to a 192 dp circle,
and a 6:1 wordmark 180 dp wide is only 30 dp tall, so it sits entirely inside the circle. A larger
wordmark would lose its ends. The React `BrandSplash` in `app/_layout.tsx` uses the same blue and
the **same 180 dp width**, so when the OS splash fades out the wordmark does not resize; the spinner
fades in with the JS half and stays through font loading and session bootstrap. The old navy
"Parcel Yatra" boot view is gone.

The UI accent token is unchanged (`colors.brand` / `--color-brand-600`, `#0a57ff`); it is a near
match to the artwork blue, and replacing it would restyle every screen rather than just the brand
marks.

**OBSERVED on 2026-10-28** in the Expo Web preview (fonts delayed in the page harness so the splash
could be sampled): the splash filled the 294x570 viewport in `rgb(0,93,253)`; the wordmark rendered
at 180x29.9 CSS px, loaded from `assets/brand-wordmark-white.png` at its natural 1024x170, centred
at y=285 (half the viewport); there were no console errors. A prebuild-parameter simulation of the
Android geometry (288 dp canvas, 180 dp image, 192 dp circle mask) shows the whole wordmark inside
the visible circle. The sign-in screen then loaded the 1024x1024 tile at 62 px with the 16 px
rounded clip. Typecheck, the full test suite (90 domain, 70 API, 8 mobile), the Android Metro export
and the prebuild config resolution pass.

**Not verified:** the native launch itself. The splash image, icon and colour are baked into the
native shell, so they only change after a new EAS build; Android's launcher masking of the adaptive
icon and the iOS launch screen have not been seen on a device.

### Phone screenshot corrections (2026-10-28)

Four items from the owner's Android screenshots of the EAS build:

- **Splash was blue only.** The native splash had no drawable, so the OS phase showed flat blue. It
  now carries the wordmark at the safe 180 dp width, and the JS splash matches that width.
- **Sign-in back arrow.** The circular top-left back button was removed from `app/sign-in.tsx`
  together with its styles. The screen is reached by redirect, and the header has its own back
  affordance where a screen is pushed.
- **Home hero CTA.** The yellow "Send a parcel" pill is no longer rendered by
  `HeroCarousel`. The search card already overlaps the hero seam and is the primary route action,
  so the hero now ends at its trust badges. The homepage document may still carry `hero.cta`; the
  app no longer draws it, and the admin preview is unaffected.
- **Sealed photo.** The card now says **Click photo** and calls `capturePhoto()`
  (`ImagePicker.requestCameraPermissionsAsync` + `launchCameraAsync`), so the camera opens directly
  instead of the photo library. The upload pipeline is unchanged. Library picking (`pickPhoto`) is
  still used for identity documents and handover/dispute evidence, where an existing photo is valid.

**OBSERVED on 2026-10-28** in the Expo Web preview, signed in with the loopback dev OTP route:
`/sign-in` had no back control (no top-left pressable, no "Go back" label); the home hero rendered
"PARCEL YATRA" → headline → subtitle → badges and then the search card, with no "Send a parcel"
control above the fold (the only remaining one is the empty-state action under Recent bookings); the
send wizard's step 2 showed a **Click photo** button under "Sealed photo".

**Not verified:** the camera itself. Expo Web maps `launchCameraAsync` to a file input with
`capture="camera"`; the native camera sheet needs the rebuilt APK on the phone. The Android manifest
merges `android.permission.CAMERA` from `expo-image-picker` (the plugin blocks it only when
`cameraPermission: false`), and `cameraPermission` text is already set in `app.json`.

### Home hero greeting and seam spacing (2026-10-28)

The campaign eyebrow ("PARCEL YATRA") is no longer drawn. In its place the hero shows a greeting
built from the signed-in profile and the device clock:

- `src/lib/greeting.ts` holds `greetingFor(date, name)`. Morning is 05:00–11:59, afternoon
  12:00–16:59 and evening 17:00–04:59; only the first word of the profile name is used, and a
  missing name yields `Good morning!` / `Good afternoon!` / `Good evening!` rather than a guessed
  one. The function is unit-tested at every boundary (`test/greeting.test.ts`).
- `app/(tabs)/index.tsx` keeps a `clock` timestamp and re-reads it on screen focus
  (`useFocusEffect`) and whenever `AppState` returns to `active`, so a screen left open overnight
  or in the background does not keep an old greeting. The name comes from `useSession()`.
- `HeroCarousel` takes `greeting` as a prop; the old pill styling (`eyebrow`, `eyebrowText`) is
  gone and the greeting is plain semibold text over the gradient, truncating to one line before
  the campaign countdown (when one exists).

The card still overlaps the hero by `HERO_SEAM` (40 dp), but the slide copy now reserves
`HERO_COPY_CLEARANCE` (seam + 16 dp), so a 16 dp band of blue separates the trust badges from the
white card instead of the two touching. Hero height, the card's negative margin and everything below
it are unchanged, so the category grid did not move; pagination dots follow the copy clearance.

The yellow ring around the header logo in the owner's annotated screenshot was a markup highlight,
not a defect: the logo is still the drawn white squircle with the navy "P" and the accent dot
(`rgb(242,179,61)`, white 1.6 px ring), with no border, outline or shadow.

**OBSERVED on 2026-10-28** in the Expo Web preview (302x570, signed in with the loopback dev OTP
after setting the profile name): the hero showed `Good afternoon, Kapil 👋` in TitilliumWeb
semibold 15 px white, 20 px tall at x=20; headline and subtitle were unchanged below it; the trust
badge bottom sat 20 px above the card top (the copy reserves 56 dp above the hero bottom, the card
overlaps 40 dp) with the card still overlapping the hero by 40 px; there was no `PARCEL YATRA` text, no horizontal overflow
(`scrollWidth` 302 = `clientWidth` 302) and no console errors. With `Date.prototype.getHours`
temporarily returning 21 and the page resumed from `hidden`, the greeting recomputed to
`Good evening, Kapil 👋`, then returned to `Good afternoon` after a tab round-trip — the focus and
`AppState` refresh paths both fired.

**Not verified:** the native rendering of the greeting (including the emoji fallback font on
Android) and the spacing on other phone sizes; the web pane is 302 px wide and the APK needs a
rebuild to contain the JS bundle.


### Deliberate limitations

- **No push notifications.** The bell polls `GET /notifications` every 60 s while the app is open;
  closed-app delivery needs a provider the API does not have.
- **No maps, GPS or live tracking.** Routes are city plus an optional free-text area, matching the
  API. No location permission is requested and no screen implies tracking.
- **No payment capture.** The booking screen requests an intent and then says plainly that the
  sandbox cannot charge; the server refuses live payments at boot.
- **No payout, wallet or cash collection.** The API refuses these, so the UI does not offer them.
- **No account export.** `POST /me/export` returns `BACKGROUND_WORKER_UNAVAILABLE`; the app exposes
  deletion but not export, rather than showing a button that always fails.
- **No offline cache for API data.** TanStack Query keeps bookings, trips and messages in memory
  only; a cold start without a network shows named errors, not stale bookings. The homepage is the
  exception: it has its own validated cache (a file on native, a module variable on web) so the
  first frame is never blank. That cache holds public page content and no account data.
- **No emulator or device run from this machine.** Type checking, unit tests, the Metro export and a
  React Native Web preview pass here, but Android has only run as the owner's EAS-built APK on a
  physical phone (2026-10-28): Google sign-in worked, and the blank screens of DEFECT-032 were found
  that way. iOS has never run at all.

## 7. Website (marketing) — 2026-10-28

The public site at `apps/web` is now the introduction to the Android product, not a second booking
surface. The signed-in screens (`/send`, `/bookings`, `/trips`, …) still exist and still work; they
are simply no longer promoted by the landing page.

- **Landing** (`src/screens/Landing.tsx`). Hero with a download CTA, an app-preview gallery, three
  "how it works" steps, the feature set, safety and prohibited-item notes, a pricing pointer, an
  FAQ built from `<details>`, and a final download band. The quick-booking form and the quick-link
  cards that sent people into the web app were removed, along with their `useConfig`/`useCities`
  calls; the landing page now makes no API request of its own. All product claims come from the
  existing pages (`/pricing`, `/prohibited`, `/safety`, `/help`) rather than new copy.
- **Download plumbing** (`src/lib/app-download.ts`). `APP_DOWNLOAD_URL` is the single place the
  public link is set. While it is empty, every download control renders a non-interactive
  `Get the Android app · Soon` state with no `href`, and the hero and final band say the link is
  being finalised. A value is accepted only when it starts with `https://`; once set, the same four
  controls become anchors with `target="_blank" rel="noopener noreferrer"` and the "being finalised"
  copy disappears. No APK/store URL exists in the repository, so the constant is deliberately empty.
- **App preview** (`src/components/PhoneMockup.tsx`). Three CSS-drawn screens (home, send, track)
  use the product's real vocabulary and the existing icons/tokens. The artwork is inside
  `aria-hidden` frames with visible captions and an "illustrative screens … real screenshots will
  replace them" note, so no mock value is announced or mistaken for live data. Swapping in the
  owner's screenshots later means replacing the frame contents, not the page layout.
- **Shell** (`src/components/Layout.tsx`). The header is a solid sticky bar with section links
  (`#app`, `#how-it-works`, `#safety`, `#faq`) that work from every route, a desktop download
  button, and the existing session cluster. Sections carry `scroll-mt-20`; a cross-route click
  navigates home with a `scrollTo` state and `ScrollToTop` scrolls after the landing page commits.
  Reloaded `/#section` URLs are handled the same way. The app-style bottom tab bar is now limited
  to the signed-in routes (`/send`, `/bookings`, `/parcels`, `/trips`, `/verification`, `/profile`,
  `/admin`), so the marketing pages do not pretend to be the app.
- **Cleanup.** `HeroBackdrop.tsx`, the `.hero-panel`/`.hero-backdrop`/`.hero-photo` rules and the
  `hero-background.webp` preload were removed. The image files remain in `public/` in case the owner
  wants them later. `index.html` now carries the marketing title, description and Open Graph tags.

**OBSERVED on 2026-10-28**, in the Vite dev server with no API running (the expected
`/v1/auth/refresh` 502 is the only console entry, and the UI treats the visitor as signed out):

- At 1280, 1024, 768, 640, 478, 390 and 320 px the document `scrollWidth` equalled the viewport —
  no horizontal overflow. The nav is hidden below `lg`; the header download control is hidden below
  `md`; the signed-out mobile header is the wordmark plus **Sign in**.
- The four download controls were spans with `aria-disabled="true"`, no `href` and a visible `SOON`
  tag. Temporarily setting the constant to `https://example.com/parcel-yatra-latest.apk` turned all
  four into anchors with `target="_blank"` and `rel="noopener noreferrer"`, and removed the "being
  finalised" copy; the constant was then reverted to empty.
- Clicking **How it works** from `/help` landed on `/` with `#how-it-works`, the section top at
  80 px (the 64 px sticky header plus `scroll-mt-20`). Clicking **Safety** while already on `/` did
  the same. Loading `/#faq` directly landed with the FAQ top at 80 px.
- The first FAQ item opened with its chevron rotated and the open card outlined in brand blue.
  `/help` and `/login` rendered with the new header and footer and no bottom tab bar.
- `npm run typecheck` and `npm run build` pass in `apps/web`.

**Not verified:** the site with a signed-in session (no local API in this run), real device
screenshots, and the real download destination — the owner still has to supply the APK/EAS URL for
`APP_DOWNLOAD_URL`. The wide-width visual check used a same-origin iframe at 1280 px inside the
478 px browser pane, not a native desktop window. No file under `apps/mobile` was touched.
