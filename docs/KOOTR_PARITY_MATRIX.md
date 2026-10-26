# Parcel Yatra ↔ Kootr — capability matrix and implementation status

**Date:** 2026-10-26 · **Reference product:** https://www.kootr.com/ · **Audited repo:** this repository.

## How to read this

Kootr is a closed mobile app. What is publicly observable is its marketing site: navigation, hero copy,
pillar blurbs, FAQ *headings* (answers render client-side and were not reachable without interacting
with a third-party site, which the method notes in
`parcel-yatra-startup-pack/research/COMPETITOR_WORKFLOW_OBSERVATIONS.md:137-141` record as a limitation),
app-store links and a footer address. Evidence IDs refer to that document (`E-05` landing, `E-06` FAQ
headings).

So each row separates three things that must not be conflated:

- **Kootr says** — a claim on their own site. Not proof it works, and not proof of how it works.
- **We ship** — code in this repo, with the file, endpoint and collection named, and a test that ran.
- **Unknown** — either unverifiable about Kootr, or a gap in ours. Stated as a gap, never filled with an
  assumption.

Status vocabulary: **done** (implemented and observed in a test), **partial** (works with a named
limitation), **missing** (no implementation), **not buildable here** (needs an external provider).

The `test:*` names are the E2E harnesses; [docs/TEST_COVERAGE.md](TEST_COVERAGE.md) maps them to the
brief's Journeys A–F and records the run that produced the counts quoted here.

---

| # | Capability | Kootr says (evidence) | We ship | Unknown / gap | Status |
|---|---|---|---|---|---|
| 1 | Public landing that explains the model | Yes — hero "India's 1st social networking app for inter-city deliveries", pillars Send / Travel & Earn / Eco / Secure PIN (E-05) | `apps/web/src/screens/Landing.tsx`, `/` route | Their conversion funnel depth is unverifiable | done |
| 2 | Unauthenticated "find a match" surface | A `Find a Match` nav link exists (E-05); never exercised | `POST /v1/parcels/:parcelId/matches` requires sign-in; `GET /v1/config`, `/v1/cities`, `/v1/cities/:cityId/areas` are public (`routes/catalogue.ts`) | Whether Kootr quotes without an account is unknown | partial — indicative pricing without login is not built |
| 3 | Phone-OTP sign-in | Unknown | `POST /v1/auth/otp/request`, `/v1/auth/otp/verify` (`routes/auth.ts`), 3/hour per phone, codes never logged | No real SMS provider is configured, so delivery is sandbox-only (`/dev/otp/:challengeId`, loopback + dev flag) | partial — not buildable here without a provider |
| 4 | Google sign-in | Unknown | `GET /v1/auth/google/authorize`, `/auth/google/callback`, `POST /v1/auth/google/token` (`routes/google-auth.ts`); state + PKCE + nonce held in HttpOnly cookies | Kootr's providers unknown | partial — needs `GOOGLE_CLIENT_ID/SECRET`; `POST /auth/google/token` does not bind the nonce (open finding) |
| 5 | Session durability without script-readable tokens | Unknown | Access token in memory only; refresh token **only** as `py_refresh` HttpOnly cookie (`lib/cookies.ts:31`), rotation with reuse detection, `POST /v1/auth/logout-all` revokes the whole family | — | done (`scripts/journeys.mjs`, 2026-10-26, observed) |
| 6 | Sender posts a parcel with category, weight, size, window, declared value | Implied by "Send Items" (E-05) | `POST /v1/parcels` (`routes/parcels.ts`), `parcels` collection, categories and ₹5,000 declared-value cap from policy | Their field set is unknown | done |
| 7 | Sender sees who is going and picks one | Unknown | `GET /v1/parcels/:parcelId/matches` + `.../interests`, `ParcelDetail.tsx` with hard-gate chips (`ON_ROUTE · CAPACITY_OK · VERIFIED_ID · ARRIVES_IN_WINDOW`) and an honest "Nobody has offered yet" | Their ranking is opaque | done |
| 8 | Traveller publishes an itinerary (mode, route, capacity, window) | "Travel & Earn — offset your flight costs" (E-05) — air only | `POST /v1/trips`, `GET /v1/trips`, `/v1/trips/:tripId/opportunities`, `/opportunities/:parcelId/interest` (`routes/trips.ts`); road modes (car/bike/on-foot), `accepts_documents_only` | Air-leg matching is deliberately out of scope | done for road; **by design** not air |
| 9 | Edit / pause / remove an itinerary without corrupting accepted deliveries | Unknown | `PATCH /v1/trips/:tripId` refuses changes that would strand accepted bookings; `DELETE` refuses a trip carrying an accepted booking; capacity is handed back on cancel (`applyBookingTransition`) | Their behaviour is unknown | done (`npm run test:trips`, 40/0) |
| 10 | Capacity enforcement at booking time | Unknown | Reservation and release both measured as `weight_kg × packagingAllowance` (`bookings.ts:285-298`), clamped at `capacity_kg`; `CAPACITY_UNAVAILABLE` guard on `submit`/`accept` | — | done (`test:trips`, `test:concurrency` 11/0) |
| 11 | Hard gates separated from a transparent ranking | Unknown | `packages/domain/src/matching.ts` (gates) + `eligibility.ts`; score never overrides a failed gate | Their gates are unknown | done |
| 12 | Honest empty state instead of fake matches | Unknown | `matches: []` + `no_match_reasons` (`NO_CAPACITY`, …); the UI prints the reason rather than a list | — | done (`test:discovery` 46/0) |
| 13 | Quote with a visible breakdown before booking | "Transparent" pillar (E-05); no pricing page reachable | `POST /v1/parcels/:parcelId/quote` (`routes/payments.ts`), `packages/domain/src/pricing.ts`, quote id carried into the booking and re-verified | Their fee split is unknown | done |
| 14 | Booking the chosen traveller atomically | Unknown | `POST /v1/bookings` with `idempotency-key`, conditional status writes, `TRANSITION_CONFLICT` on a lost race | — | done |
| 15 | Lifecycle state machine (accept → pay → pickup → transit → deliver) | FAQ mentions handover/delivery responsibilities (E-06) | `packages/domain/src/booking-machine.ts`; documented in [docs/BOOKING_STATE_MACHINE.md](BOOKING_STATE_MACHINE.md) | Their state names are unknown | done, but 4 system edges need a scheduler (below) |
| 16 | PIN-verified handover | "Secure — PIN-verified handover" pillar and "4-digit PIN" FAQ points (E-05, E-06) | 6-digit pickup and delivery codes (`ensureHandoverOtp`, `bookings.ts:361`), attempt budget with lock-out, expiry, `POST /v1/bookings/:id/handover/pickup\|delivery` requiring code + photo | Their digit count and attempt rules unverifiable | done (`test:smoke` 57/0, `test:journeys` 52/0) |
| 17 | Photo proof at both ends | Unknown (not claimed) | `POST /v1/files/upload-url` + PUT sink + `photo_key` required by `confirm_pickup` and `confirm_delivery`; a state cannot advance without it | — | done |
| 18 | Codes kept out of logs and out of API responses | Unknown | Codes are hashed at rest; `GET /v1/dev/handover-otp/:id/:phase` is dev-only, loopback-gated and party-checked (`routes/dev.ts:63`) | — | done |
| 19 | "Delivered" is not a frontend claim | Unknown | `delivered` needs a valid OTP **and** a photo from the traveller on that booking; a second attempt after `receiver_unavailable` needs them again (`booking-machine.ts:219`) | — | done |
| 20 | ID verification of travellers before first carry | "verified air travelers" (E-05); method unverifiable | `POST /v1/verifications`, `GET /v1/admin/verifications`, reviewer roles, `VERIFICATION_REQUIRED` guard on `accept` | Their process unknown | done; `GET /v1/verifications/me` fabricates a placeholder row id (open finding) |
| 21 | Ratings restricted to completed transactions | Unknown | `POST /v1/bookings/:id/review`, gated to `delivered`/`payout_eligible`/`refunded` states | Their rules unknown | done |
| 22 | In-app messaging between sender and traveller | "Social" pillar (E-05) implies a social layer; nothing observable | `GET/POST /v1/bookings/:id/conversation[/messages]`, `ChatPanel.tsx`, membership-only authorization (non-member gets 404), system note banning codes/documents/bank details in-thread | Their chat is unverifiable | done (polling every 10 s — there is no websocket; `test:messaging` 33/0) |
| 23 | Recipient participation in the thread | FAQ "Recipient" category exists (E-06) | `conversation_members` includes a `recipient` row **only** when a live account owns `parcels.receiver_phone_hash`; accounts are never invented | Their recipient model unknown | done, honestly conditional |
| 24 | Unread counts and read state | Unknown | `unread_count` per thread, `POST /v1/bookings/:id/conversation/read`, `GET /v1/conversations` inbox, chrome badge | — | done |
| 25 | Notifications with history | Unknown | `GET /v1/notifications`, `/notifications/:id/read`, `/read-all`; queued on transitions (`queueNotification`) | Delivery channels are not configured: rows are created, nothing sends SMS/WhatsApp/email | partial |
| 26 | Digital payment before pickup | Pricing/Earnings FAQ category (E-06); no rail named | `POST /v1/bookings/:id/payment-intent` (sandbox), `POST /v1/webhooks/payments/:provider` with signature + timestamp verification; `confirmed` only after a verified capture | Their provider and flow unknown | partial — **sandbox only**; a real checkout is an external dependency |
| 27 | Escrow / hold until delivery | FAQ categories hint at money questions; mechanism unverifiable | Nothing in this repo holds funds. Capture is recorded, payout is frozen until `payout_eligible`, and `release` answers `PAYOUTS_NOT_ENABLED` (501) | — | missing by design — **no escrow is claimed anywhere in the product** |
| 28 | Delayed payout to the traveller | Unknown | `payouts.state` (`not_eligible` → `eligible`), dual-approval refunds (`admin/refunds/:id/approve`), ledger balance compared to payout amount in the `release` guard | Their settlement timing unknown | partial — eligible but not payable without a rail |
| 29 | Insurance / claims | Unknown | Explicit "Your parcel is not insured. We're working on coverage" copy in `BookingDetail.tsx`; no claims entity | — | missing, and stated as missing rather than faked |
| 30 | Disputes with evidence and staff resolution | "Zero tolerance and reporting violations" FAQ points (E-06) | `POST /v1/disputes`, `/disputes/:id/evidence`, `GET /v1/disputes/:id`, `POST /v1/admin/disputes/:id/resolve`; 72-hour window, payout frozen while open | Their process unknown | done |
| 31 | Incident path *and* exit for a stuck parcel | Unknown | `report_incident` from `picked_up`/`in_transit`/`arrived`/`delivery_attempt_failed`; `clear` → `payout_eligible`, `compensate` → `refunded`; staff queue `GET /v1/admin/incidents` | — | done (observed in `test:journeys`) |
| 32 | Staff console for incidents and message moderation | Unknown | `Admin.tsx → Incidents`: queue by state, per-row capture vs quote, audited thread read ("This read is recorded"), removal with a reason code, resolve panel with outcome + note; `POST /v1/admin/messages/:id/remove` | — | done (verified in the browser against the running app, 2026-10-26) |
| 33 | Server-side staff authorization, not hidden buttons | Unknown | Role checks on every admin route (`ROLE_REQUIRED` 403 for a non-staff caller), `trust_safety` for message removal and `safety_block`, `support_agent` to clear a lock | — | done; `admin/refunds/:id/approve` still accepts `admin_readonly` (open finding) |
| 34 | Prohibited-items policy published | Unknown (not public on their site) | `/prohibited` screen (`StaticPages.tsx`), policy in `GET /v1/config`, enforced at parcel creation by category | Our list is our own drafting, not Porter's (see research notes) | done |
| 35 | Reporting a violation / trust-and-safety escalation | "Zero tolerance" copy (E-05/06) | `trust_safety` role, message removal reasons, dispute flow, grievance page (`/grievance`) | Their flow unknown | partial — no user-facing "report this user" endpoint |
| 36 | Rate limiting on auth, search, messaging, PIN and writes | Unknown | Global read limiter 300/min; manual write budget 60/min per address (`app.ts`); per-route limits on OTP, refresh, trips CRUD, messages; attempt budgets on handover codes | — | done, but **in-memory only**: per process, wiped on restart, multiplied per replica |
| 37 | Data export and deletion (privacy) | Unknown | `POST /v1/me/export`, `POST /v1/me/deletion-request` | Their compliance pages unread | done, request-based; no automated erasure job |
| 38 | Admin visibility into identity documents | Unknown | `GET /v1/admin/verifications/:id/documents` — role-gated to `verification_reviewer`/`trust_safety`, one audited read per submission, returning a short-lived single-object URL per capture plus the account name and masked phone to compare against; rendered in the decision sheet with a full-size viewer | Their process unknown | done — `test:kyc-review` 25/0. `verifications/me` placeholder id remains an open finding |

---

## What this audit found broken and what was done about it

Each item below is a code change in this repository, not a recommendation. The test named is one that was
executed against a running API on an isolated database (`data/pgdata.parity`), on 2026-10-26.

| Finding | Class | Fix | Test |
|---|---|---|---|
| `arrived → receiver_unavailable → confirm_delivery` reached `delivered` with no code and no photo, and qualified the payout | Critical | Second-attempt `confirm_delivery` now carries the same OTP + photo guard (`booking-machine.ts:219`) | `test:smoke` 57/0 |
| A payment webhook could release money past the pilot rail | Critical | `confirmed` only from a verified capture; release gated behind `PAYOUTS_NOT_ENABLED` | `test:journeys` F-block |
| The dev OTP peek route was unauthenticated and codes were logged | High | Loopback + dev-flag + party checks; codes hashed, never logged (`routes/dev.ts`) | `test:smoke`, `test:messaging` |
| Handover codes had no attempt budget | High | Per-phase attempt limit with lock-out to `locked_for_review` | `test:smoke` |
| Capacity hand-back was not atomic with the status change | High | Transition + event + capacity in one transaction; `dbIsScoped` marker lets a caller's transaction own it | `test:trips`, `test:concurrency` |
| The write-budget hook throttled routes that declared `rateLimit: false`, so `POST /dev/seed/reset` was refused and demo data could not be restored | High | `app.ts` honors the route-level opt-out | `test:ratelimit` 14/0 |
| A brand-new booking had no conversation row, so the booking page's first poll answered 404 and the chat panel printed "could not be loaded" | High | The poll opens the thread on first touch, and `openThread` now refuses to write for anyone who is not a party (`routes/messages.ts`) | `test:journeys` (2 new checks), browser |
| Staff had no surface for an open incident: the state was reachable but only `escalate` could leave it, and no screen issued it | High | `Admin → Incidents` queue, audited thread read, moderation, resolve | `test:journeys`, browser |
| Harnesses read `refresh_token` from a response body that never contains it, so every run silently re-issued OTPs | Medium | Cookie-based refresh in all six harnesses | full suite re-run |
| Throttled calls were reported as product failures — first writes, then reads too, when one suite left the shared 300/min read budget exhausted and the next suite's first three GETs failed | Medium | `call()` waits out the window the server names, for any method, bounded — and hands back anything longer | full suite re-run |

## Still open, by class

**Critical:** none known in the flows above. **High:** no scheduler, so `expire`, `auto_expire`,
`open_pickup` and `settle_window` never fire on their own — capacity held by an abandoned booking is
never returned, and a delivered booking never becomes payout-eligible by itself. `src/db/schema.sql` is
six migrations behind while `scripts/setup-neon.js` applies it, so a fresh Postgres built from
`schema.sql` is not the running schema. The read limiter is keyed on `req.ip` with `TRUST_PROXY=false`
by default: deployed behind any reverse proxy, every visitor shares one 300/min bucket, and a client
idle on the booking page alone costs ~9 reads/min (10 s message poll, 30 s booking, 60 s unread count —
`apps/web/src/lib/hooks.ts:147`, `apps/web/src/screens/BookingDetail.tsx:80`), so roughly thirty such
tabs trip a product-wide 429. Required action before launch: set `TRUST_PROXY=true` with a correct
proxy configuration, or raise `RATE_LIMIT_READ_PER_MINUTE` knowingly.

**Medium:** `parcels.review_required` is never consulted by the matching engine;
`GET /v1/verifications/me` returns a fabricated placeholder row id; Cloudinary signing uses SHA-256
where the provider expects SHA-1; `POST /admin/refunds/:id/approve` accepts `admin_readonly`;
`POST /auth/google/token` does not bind the nonce; `makeAuthenticate` never asserts
`claims.sub === sessions.user_id`; the audit hash chain is written non-atomically.

**Low:** no trip `paused` state (enum change is migration-risky); rate-limit state is per-process.

## External setup this code cannot do for itself

Nothing below is implemented, and none of it is claimed anywhere in the product:

- a payment provider's live checkout + webhook secret (capture and payout rails);
- an SMS/WhatsApp provider for OTP, and an email/push provider for notifications — today OTP is sandbox
  only and notifications are in-app rows;
- Cloudinary credentials for real photo storage (the local sink works for tests). This is load-bearing
  for identity review: on a host whose disk is rebuilt per deploy, an uploaded ID document disappears
  and the reviewer's console honestly says the file is no longer in storage;
- a real Postgres instance and a reviewed migration path (the pilot runs on PGlite);
- **a scheduler or worker** for the four system edges listed above and an outbox consumer.

Until those exist, the honest product copy stays as it is: sandbox payments, no escrow, no insurance, no
guaranteed settlement.
