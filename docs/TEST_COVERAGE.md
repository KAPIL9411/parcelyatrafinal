# E2E test coverage — Journeys A–F

Maps the fourteen-phase brief's Phase 13 journeys to the harnesses that actually exercise them, with
the result of the run that produced this file. Every number below is a count printed by a suite that
was executed, not an estimate.

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
| `node scripts/concurrency.mjs` | supporting (booking atomicity) | 11 passed, 0 failed |
| `node scripts/ratelimit.mjs` | supporting (limiters) | 14 passed, 0 failed |
| `npm test` | unit: domain + api | 64 passed + 3 passed, 0 failed |
| `npm run typecheck` | all three workspaces | clean |
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

## What these suites do not cover

* Real payment capture, real SMS/WhatsApp/email delivery, real image storage and real managed
  Postgres — none of those providers are configured here. The sandbox webhook, the dev OTP peek and
  the local file sink stand in for the transport only, and each endpoint says so in its response.
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
* Sign-in through the SPA restores the session from the HttpOnly cookie with no token in
  `localStorage`.
