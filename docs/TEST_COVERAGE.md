# E2E test coverage — Journeys A–F

Maps the fourteen-phase brief's Phase 13 journeys to the harnesses that actually exercise them, with
the result of the run that produced this file. Every number below is a count printed by a suite that
was executed, not an estimate.

The whole matrix was re-run on 2026-10-27 against a temporary API instance, after DEFECT-029 moved
quotes onto the v2 pricing engine and added the launch-network routes. The counts did not change,
which is the point of re-running them: the new quote response and the new `cities.status` gate broke
nothing on the paths these scripts walk.

## How to run

The API must be listening on `127.0.0.1:3000` with the isolated parity database:

```
cd apps/api
PGLITE_PATH=./data/pgdata.parity npx tsx src/index.ts
```

Then, from the repository root, `node scripts/<suite>.mjs`. Suites share one per-address rate-limit
pool, so they are run **sequentially**. A throttled call is waited out by the harness itself; where a
limit cannot be sat out (a per-route hourly window) the harness says "this run is throttled, not
broken" and stops rather than printing a pass it did not earn.

| Command | Journey | Result |
|---|---|---|
| `node scripts/smoke.mjs --reset` | A | 57 passed, 0 failed |
| `node scripts/discovery.mjs --reset` | B | 46 passed, 0 failed |
| `node scripts/trips.mjs --reset` | B | 40 passed, 0 failed |
| `node scripts/messaging.mjs` | C | 33 passed, 0 failed, 1 skipped |
| `node scripts/journeys.mjs --reset` | D, E, F + staff incident API | 52 passed, 0 failed |
| `node scripts/kyc-review.mjs` | supporting (staff identity review) | 25 passed, 0 failed |
| `node scripts/concurrency.mjs` | supporting (booking atomicity) | 11 passed, 0 failed |
| `node scripts/ratelimit.mjs` | supporting (limiters) | 14 passed, 0 failed |
| `npm test` | unit: domain + api + mobile | 73 passed + 50 passed + 8 passed, 0 failed |
| `npm run typecheck` | all four workspaces | clean |
| `npm run build` | `@py/web` production build | clean (one chunk-size warning) |

The skip in `messaging.mjs` is honest: the closed-thread assertion only runs when the demo booking has
reached a closed status (`cancelled_by_sender`, `refunded`, `paid_out` or `expired`), and this run
found it `disputed`, which is a hold, not a close. The suite prints the status it skipped on instead
of quietly counting 34 passes.

## Journey A — a successful shipment, end to end

`scripts/smoke.mjs`. Sign in with an OTP, post a parcel, get a quote, match a traveller, book, have
the traveller accept, pay in sandbox, hand over with the pickup code and a photo, travel, deliver with
the delivery code, review. It also asserts the negatives that make the happy path meaningful: staff
cannot read a booking through the user route, an unauthenticated request is refused, a non-staff user
is refused the audit log, and a dispute opens, freezes the payout and moves the booking to `disputed`.

## Journey B — discovery, capacity and trip editing

`scripts/discovery.mjs` proves the traveller half of matching cannot lie: a parcel is offered only
when the engine's hard gates pass, both directions agree on the same pair, a stranger's trip is a 404
and an anonymous call a 401, an empty list names the reason it is empty instead of padding itself, an
offer is idempotent and notifies once, and a trip carrying accepted work cannot be cancelled out from
under it.

`scripts/trips.mjs` proves an edit never corrupts accepted deliveries: only the owner edits, a change
that would strand a parcel is refused with the booking id and the gate code, a refused change writes
nothing and audits nothing, an accepted edit keeps every reservation, the capacity column and the live
bookings agree, and cancelling hands the space back.

## Journey C — messaging, notifications and the handover code

`scripts/messaging.mjs` proves a thread exists per booking and only members read it (a non-member gets
404, never 403), a post by one party is readable by the other with an unread count, a closed booking
refuses posts, notifications carry read state and an unread count that falls when marked read, and —
the step that used to dead-end every delivery — the delivery code reaches the sender at `arrived`.

Two assertions pin the defect fixed in `apps/api/src/routes/messages.ts`: a brand-new booking has a
readable thread before anybody has posted, and a stranger polling the same route is still refused.
They live in `scripts/journeys.mjs`, where the fresh booking is created.

## Journey D — session recovery and sign-out

`scripts/journeys.mjs`. A wrong OTP does not burn a valid challenge; the long-lived credential is set
as an HttpOnly cookie and never appears in a response body; refresh rotates the pair and the new
access token works; "sign out everywhere" kills the whole session family, so the first refresh token
and the access token it issued are both dead afterwards.

## Journey E — authorization is server-side

`scripts/journeys.mjs`. A non-staff account is refused the incident queue, the incident decision, the
thread read and the message removal. A stranger is refused someone else's booking, their transitions,
and their conversation — with 404, so existence is not leaked. Staff roles are checked per endpoint,
not per page.

## Journey F — payment integrity

`scripts/journeys.mjs`. One capture per provider reference; the captured amount equals the quoted
total to the paisa; `payout_eligible` still cannot move money on its own; a forged webhook is refused.
Payouts themselves are disabled in this configuration, so the release path answers
`PAYOUTS_NOT_ENABLED` (501) and the suite asserts that instead of pretending a transfer happened.

## Staff review of an identity document

`scripts/kyc-review.mjs`. A traveller uploads three real PNGs and submits them; the queue row carries
no images; a reviewer opening them gets one short-lived URL per file plus the account details that
make a name comparison possible, with the phone still masked and the raw storage keys never leaving
the server. Each URL is then fetched with no credentials at all and the served bytes are hashed and
compared to the upload, so a truncated or collapsed object cannot pass quietly. One changed character
in a token is a 404, the applicant is refused the staff read, a missing record is a 404, the read
lands in the audit log against the reviewer's own id, and approving grants the traveller role and
clears the queue.

It caught a live defect while being written: Fastify's default `maxParamLength` is 100 and a signed
file token is ~190 characters, so every `GET /files/signed/:token` answered `FST_ERR_MAX_PARAM_LENGTH`
before the route ran. See `maxParamLength` in [apps/api/src/app.ts](../apps/api/src/app.ts).

## Google sign-in handshake

`apps/api/test/google-handshake.test.ts` (9 tests, part of `npm run test:api`). Google itself is not
called successfully anywhere here, so these tests stop one step short of a session and say so.

The handshake is the half of the flow that production actually refused (400 in 0.7 ms, i.e. before
the code was sent to Google — see DEFECT-025). The suite covers:

* a state minted by a different process — the redeploy case, and the only thing that can explain a
  callback with no matching `authorize` on the pod — is accepted using only the `sessionStorage`
  binding, and reaches `GOOGLE_AUTH_FAILED` (Google rejecting the placeholder code), which is the
  marker for "the handshake passed";
* the cookie transport alone is accepted too, so the web bundle deployed before the binding was
  added keeps working through a deploy window in either order;
* two tabs: a stale body binding next to a matching cookie is accepted, because either copy is proof;
* forged, truncated, tampered, expired and unsigned states are refused with `INVALID_STATE`;
* a valid state with neither transport is refused (a link handed to someone else);
* a valid state with a different binding is refused;
* a refused callback still expires `py_oauth` rather than leaving a stale cookie in the jar.

Every refusal assertion checks the error code, not just the status, so a future 400 for another
reason cannot masquerade as a correct rejection.

The "other process" claim was also checked out of process once, by hand: a state minted while one
API process was running was accepted by a different PID after a full restart. The test above proves
the same thing in-process by minting the state outside the app; neither is a substitute for the
deploy.

**Not covered:** no real `GOOGLE_CLIENT_ID/SECRET`, so no test reaches a session or a `py_refresh`
cookie; no browser with third-party cookies genuinely blocked; no assertion about Google's own JWKS
or the ID-token audience (the placeholder code never gets that far).

## Mobile transport (`apps/mobile/test/http.test.ts`)

Eight tests, run by `npm test` (or `npm run test:mobile`), against a fake `fetch` — no server and no
emulator. They pin the client rules the screens rely on: a dropped connection is `NETWORK` and a
never-answered request is `TIMEOUT` (not an empty success); the server's error envelope survives into
`ApiError`; one 401 causes exactly one refresh and one retry with the new token; a failed refresh
ends the session once and does not loop; concurrent 401s share a single refresh; mutations carry an
`Idempotency-Key` while reads do not; and a 204 resolves `undefined`.

The API's half of the native session is covered by `apps/api/test/native-session.test.ts` inside
`npm run test:api`: the `x-py-client: native` header adds `refresh_token` to auth bodies, a browser
request does not receive it, body refresh rotates, an old token is refused on reuse, and the web
cookie path still works.

**Not covered:** the native mobile UI. No emulator, device, Android SDK or iOS toolchain was
available, so no screen has been rendered on Android or iOS; the Metro Android export proves the
bundle compiles, nothing more. A React Native Web preview against a local sandbox was walked through
on 2026-10-27 (home, phone sign-in, bookings list and detail, trips, profile, send step 1); that
exercises shared components and the API client, not the native renderer. Push notifications, offline
behaviour and deep links are untested.

## Launch network, distance engine and pricing

Run by `npm test`; 18 API tests and 9 domain tests were added for the launch network.

| File | Tests | What it pins |
|---|---|---|
| `apps/api/test/geo-network.test.ts` | 3 | 8 unique cities with state links; 4–5 zones each; 41 hotspot candidates with NULL coordinates and no pickup/drop-off; 56 directed candidate edges; exactly one active policy matching compiled defaults; a rerun applies nothing; DB constraints refuse an operational edge without a distance and an active hotspot without coordinates + verification |
| `apps/api/test/routing.test.ts` | 5 | Google `computeRouteMatrix` request shape; success and per-element failure mapping; HTTP 403 surfaced; an unresolved pair is a labelled estimate and becomes `routed` after a fake matrix; approved edges are never overwritten and are refused under `REQUIRE_OPERATIONAL_ROUTE`; a failed attempt is recorded and leaves the estimate available |
| `apps/api/test/launch-quote.test.ts` | 3 | The seeded active policy is loaded, validated and matches the compiled default; activating a new policy changes the next quote and a malformed policy refuses to activate; the second active policy is blocked; a v2 quote stored in the legacy columns still satisfies `total = subtotal + platform + tax` |
| `apps/api/test/geo-api.test.ts` | 7 | Real app through `buildApp()` + `app.inject`: the 8 cities and candidate routes; estimates labelled; anonymous and non-staff callers refused; hotspot verification ladder plus doorstep availability and the coordinate-change refusal; route calculated→approved→operational with serviceability and journey changes; a two-leg journey is not bookable; finance-only policy and benchmark CRUD; audit rows |
| `packages/domain/test/launch-pricing.test.ts` | 9 | Reconciliation invariant, billable vs volumetric weight, minimum fare, maximum cap, explicit traveller subsidy, discount that never reduces the payout, estimate labelling, and rejection of an invalid policy |

`geo-api.test.ts` and `launch-quote.test.ts` clear their dedicated PGlite directory before opening
it, because they move seeded rows through their lifecycle; `routing.test.ts` resets the pair it
uses. All three were run twice in a row to confirm the result does not depend on the previous run.

**Not covered:** no real Google Routes call (no key exists here), so no test claims a measured road
distance; doorstep is never *available* because no hotspot has coordinates; multi-leg custody is
untested because it is not implemented. The staff console (`NetworkAdmin.tsx`) has **no test file** —
it is typechecked and bundled, and its rendered state was read in a browser (see
"Browser-verified" below), but no successful write has been driven through it; the transitions behind
its buttons are covered by `geo-api.test.ts` at the API, not at the screen.

## What these suites do not cover

* Real payment capture, real SMS/WhatsApp/email delivery, real image storage and real managed
  Postgres — none of those providers are configured here. The sandbox webhook, the dev OTP peek and
  the local file sink stand in for the transport only, and each endpoint says so in its response.
* A real Google sign-in end to end. `google-handshake.test.ts` stops at the call to Google, and the
  `POST /auth/google/token` path (ID token obtained by the client) has no test at all in this repo.
* Time-based transitions (`expire`, `auto_expire`, `open_pickup`, `settle_window`) have no scheduler
  to fire them; see "Known gaps" in [docs/BOOKING_STATE_MACHINE.md](BOOKING_STATE_MACHINE.md).
* Mobile browsers and assistive technology: the UI was verified on a desktop Chromium viewport.
* The outbox has no consumer, so "an event was emitted" is not "a job ran".

## Browser-verified (not covered by a script)

* The booking page chat panel for a brand-new booking — before the `messages.ts` fix the first poll
  answered 404 and the panel printed "the conversation could not be loaded"; after it the system note
  renders and a message sends.
* The staff console driving a real `incident_open` booking: queue → audited thread read → message
  removal → resolve → empty state.
* The **Network and pricing** tab (DEFECT-029), opened as the seeded development staff account:
  coverage `10 active` cities / `56` routes / `0 measured · 0 operational` / `0` benchmarks / one
  active policy; 56 route rows all `candidate`, with Approve and Mark operational disabled by the
  ladder; the status filter to `operational` returning the empty state; 41 hotspot rows with
  coordinates `none` and **Save coordinates** disabled on empty fields; the policy draft form
  prefilled with the launch tunables and **Save as draft** disabled until version and name are
  typed. Pressing **Measure with the provider** surfaced the server's 503 refusal verbatim and left
  the row `candidate` — nothing was invented, and the only console error was that deliberate 503.
  Read through the DOM; the in-app browser has no screenshot surface.
* Sign-in through the SPA restores the session from the HttpOnly cookie with no token in
  `localStorage`.
* The auth lifecycle in DEFECT-024, driven against a temporary proxy that stretched `POST
  /auth/refresh` to 45 s so the restore window could be sampled at all (it is ~35 ms against the
  local API). With the window open: the header held its placeholder at the same box it ends at, no
  "Sign in" string existed anywhere in the document, the landing call-to-actions already pointed at
  `/send?category=…`, `/trips/new` and `/bookings`, the sign-in card measured 446 px against the
  445 px it swaps to, and a direct `/bookings` load painted no protected content before deciding.
  Across the swap the buffered `layout-shift` total was 0.00000 with no entries, and exactly one
  refresh plus one `/me` ran per page load. Signed-out, revoked-cookie and offline loads each
  resolved to `/login?next=…` once instead of hanging on the placeholder.
* The verification decision sheet rendering all three identity captures: opened as the seeded
  reviewer, each `<img>` reached `naturalWidth` 240 with the shimmer removed, and the full-size
  overlay opened on click with the file's size, type, capture time and hash, then closed on Escape.
