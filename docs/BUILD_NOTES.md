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

## 2. Other deviations

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
| Live payments | refused at boot | Sandbox only; `PAYMENTS_LIVE=true` is a startup error. |
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

- `npm run typecheck` — domain, API and web all clean.
- `npm test` — 63/63 domain tests pass (money, pricing, eligibility, the booking state machine,
  refunds, and the matching engine: hard gates, score arithmetic, tie-breaks, policy validation,
  low-confidence fallback, truthfulness of the reason codes) plus 3/3 API tests
  (`npm run test:api`): the `ADMIN_EMAILS` address receives every staff role in `user_roles`, an
  unlisted address receives none, and removing the address revokes the grant at the next sign-in.
  **The Google leg is not tested here**: it needs a real ID token from a configured OAuth client,
  and this build has no credentials. What is proven is the function that sign-in calls.
- `node scripts/smoke.mjs --reset` — 44 checks pass, 0 fail. Covers sign-in, parcel creation,
  prohibited-item refusal, matching, quote arithmetic, booking, acceptance, sandbox payment and
  signed webhook, pickup OTP (wrong then right), transit, arrival, delivery OTP, settlement, payout
  refusal (`PAYOUTS_NOT_ENABLED`), review, dispute creation, payout freeze, and evidence.
- `node scripts/concurrency.mjs` — 11 checks pass, 0 fail. Five simultaneous `POST /bookings` for
  one parcel: exactly one 201, four clean 409s, one booking row, capacity reserved once. Three
  simultaneous requests sharing one `Idempotency-Key` return the same booking and leave one row.
  A cancelled parcel can be booked again, so the "one active booking" index is genuinely partial.
- Browser walkthrough of the sender and traveller happy path, the dispute path, verification
  submission and staff approval, the admin case queue, refund/payout refusal, and the audit log.
- `npm run build -w @py/web` — production bundle builds.

**Not verified:** load, failover, backup/restore, real provider behaviour, accessibility audit,
penetration test, or anything on a second machine.

---

## 5. What this build does not claim

- It is **not** legally compliant, and nothing here has been reviewed by a lawyer.
- It is **not** secure. There has been no audit, no threat-model review of the implementation, and
  no penetration test.
- It is **not** production-ready. PGlite, the local upload sink, the shared admin origin, the absent
  worker and the 501s above are all disqualifying on their own.
- It does **not** move real money. Payments are sandbox; payouts and split settlement are refused.
- It does **not** prove demand, unit economics, or any market claim. Prices are **HYPOTHESIS** from
  the pack; no figure here is measured.
- It does **not** store Aadhaar, track location continuously, or store raw phone numbers.
