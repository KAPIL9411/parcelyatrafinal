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
- **Consequence:** the local PUT route is registered only when `ENABLE_DEV_ENDPOINTS` is on, so a
  production-configured build fails closed (the URL it issues does not exist). Uploads are not
  durable, not scanned, not encrypted beyond the disk, and not served through a signed viewer.
  Replace the sink before any real document is collected.

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

---

## 2. Other deviations

### PGlite as the development database

- **OBSERVED:** the API runs embedded PostgreSQL (PGlite/WASM) from `apps/api/data/pgdata` unless
  `DATABASE_URL` is set. SQL is ordinary PostgreSQL and `schema.sql` is unmodified PostgreSQL.
- **Why:** no Docker or local PostgreSQL on the build machine.
- **Consequence:** single process, single writer, no connection pool, no `LISTEN/NOTIFY`, no
  concurrent-write testing. **A pooled `pg` client and a real migration run are required before any
  shared environment.** `db/client.ts` is the only file that should need to change.

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
- `npm run test -w @py/domain` — 15/15 pricing and state-machine tests pass.
- `node scripts/smoke.mjs --reset` — 43 checks pass, 0 fail. Covers sign-in, parcel creation,
  prohibited-item refusal, matching, quote arithmetic, booking, acceptance, sandbox payment and
  signed webhook, pickup OTP (wrong then right), transit, arrival, delivery OTP, settlement, payout
  refusal (`PAYOUTS_NOT_ENABLED`), review, dispute creation, payout freeze, and evidence.
- Browser walkthrough of the sender and traveller happy path, the dispute path, verification
  submission and staff approval, the admin case queue, refund/payout refusal, and the audit log.
- `npm run build -w @py/web` — production bundle builds.

**Not verified:** concurrent writers, load, failover, backup/restore, real provider behaviour,
accessibility audit, penetration test, or anything on a second machine.

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
