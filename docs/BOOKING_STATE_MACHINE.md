# Booking lifecycle — the state machine as it is implemented

**Scope:** one document for the transitions a booking can make, who may make them, what the server
checks first, and what happens on the way out. Everything below is read from the code that runs today,
with the file and line it comes from. Nothing here describes a plan.

Machine: `packages/domain/src/booking-machine.ts` (pure, no I/O).
Driver: `apps/api/src/routes/bookings.ts` → `applyBookingTransition()`.
Route a client calls: `POST /v1/bookings/:id/transitions` (users) and
`POST /v1/admin/bookings/:bookingId/incident` (staff outcomes).
Status labels shown to people: `packages/domain/src/enums.ts` → `BOOKING_STATUS_LABELS`.

---

## The rule every edge follows

`applyTransition(from, command, ctx)` (`booking-machine.ts:299`) answers in this order:

1. no rule for `(from, command)` → `INVALID_TRANSITION`;
2. rule exists but `ctx.actor` is not in `rule.actors` → `TRANSITION_NOT_PERMITTED`;
3. rule's `guard(ctx)` returns a failure → that failure code;
4. otherwise the move to `rule.to`.

A command with `dataGuard: true` (pickup/delivery confirmation) is still listed in `allowed_commands`
even though it will fail without an OTP or photo, so the UI can show the form instead of hiding the
step (`booking-machine.ts:104-108`).

`ctx` carries only facts the server measured: quote validity, held capacity, traveller verification,
accept-by and dispute deadlines, hours until the pickup window, whether the pickup code was already
consumed, OTP validity, photo presence, open disputes, captured ledger balance. None of these can be
supplied by the caller.

---

## States

`draft` → `pending_traveller_acceptance` → `payment_pending` → `confirmed` → `pickup_ready` →
`picked_up` → `in_transit` → `arrived` → `delivered` → `payout_eligible` → `paid_out`

Holds and exits: `delivery_attempt_failed`, `disputed`, `incident_open`, `locked_for_review`,
`cancelled_by_sender`, `cancelled_by_traveller`, `cancelled_ineligible`, `cancelled_safety`,
`expired`, `refunded`.

Terminal in this build: `paid_out`, `refunded`, the four `cancelled_*`, `expired`.

---

## Edges

`A` = actor(s) allowed by `rule.actors`. Guard failures are the code the client receives.

| From | Command | To | A | Guard / precondition | Source |
|---|---|---|---|---|---|
| `draft` | `submit` | `pending_traveller_acceptance` | sender | `QUOTE_EXPIRED` if the quote lapsed; `CAPACITY_UNAVAILABLE` if the trip lost the room | `:119` |
| `draft` | `expire` | `expired` | system | needs a scheduler — none runs today | `:130` |
| `pending_traveller_acceptance` | `accept` | `confirmed` | traveller | 30-minute window (`ACCEPT_WINDOW_CLOSED`), capacity still held, traveller ID verified (`VERIFICATION_REQUIRED`). No payment is asked for at this point. | `:131` |
| `pending_traveller_acceptance` | `decline` | `cancelled_by_traveller` | traveller | — | `:145` |
| `pending_traveller_acceptance` | `cancel` | `cancelled_by_sender` | sender | — | `:146` |
| `pending_traveller_acceptance` | `auto_expire` | `expired` | system | needs a scheduler — none runs today | `:147` |
| `payment_pending` | `payment_authorised` | `confirmed` | system | legacy only: bookings created before payment moved to delivery. Posted by the provider webhook after a verified signature. | `:148` |
| `payment_pending` | `payment_failed` | `cancelled_by_sender` | system | same | `:149` |
| `payment_pending` | `cancel` | `cancelled_by_sender` | sender | — | `:150` |
| `confirmed` | `open_pickup` | `pickup_ready` | system | run by the lifecycle sweep when the parcel's pickup window starts (`services/lifecycle.ts`, Cron Trigger every 5 min) | `:151` |
| `confirmed` | `cancel` | `cancelled_by_sender` | sender | refused inside 2 h of the pickup window (a fee would apply) | `:152` |
| `confirmed` | `cancel` | `cancelled_by_traveller` | traveller | refused once the pickup code has been consumed | `:160` |
| `confirmed` | `eligibility_failed` | `cancelled_ineligible` | system | — | `:167` |
| `confirmed` | `safety_block` | `cancelled_safety` | support | caller must hold `trust_safety` | `:168` |
| `pickup_ready` | `confirm_pickup` | `picked_up` | traveller | correct pickup OTP **and** a sealed-parcel photo | `:175` |
| `pickup_ready` | `cancel` | `cancelled_by_sender` | sender | — | `:187` |
| `pickup_ready` | `lock` | `locked_for_review` | system | raised when pickup code attempts are exhausted | `:188` |
| `picked_up` | `start_transit` | `in_transit` | traveller | — | `:194` |
| `picked_up` / `in_transit` / `arrived` / `delivery_attempt_failed` | `report_incident` | `incident_open` | sender, traveller, support | — | `:195,197,236,237` |
| `in_transit` | `arrive` | `arrived` | traveller | — | `:196` |
| `arrived` | `confirm_delivery` | `delivered` | traveller | correct delivery OTP **and** a delivery photo | `:198` |
| `arrived` | `receiver_unavailable` | `delivery_attempt_failed` | traveller | — | `:210` |
| `arrived` / `delivery_attempt_failed` | `lock` | `locked_for_review` | system | raised when delivery code attempts are exhausted | `:192,193` |
| `delivery_attempt_failed` | `confirm_delivery` | `delivered` | traveller | the second handover needs the same OTP + photo — a failed attempt is not a free pass | `:219` |
| `delivery_attempt_failed` | `escalate` | `incident_open` | system, support | — | `:231` |
| `delivered` | `raise_dispute` | `disputed` | sender, traveller | `DISPUTE_WINDOW_CLOSED` after `DISPUTE_WINDOW_HOURS` | `:243` |
| `delivered` | `payment_authorised` | `delivered` | system | a self-edge: the provider capture is recorded after delivery without moving the parcel. Posted only by the signed webhook. | `:154` |
| `delivered` | `settle_window` | `payout_eligible` | system | the lifecycle sweep requires the problem window to have elapsed **and** a capture in the ledger at least equal to the traveller's share | `:262` |
| `disputed` | `resolve_sender` | `refunded` | support | — | `:256` |
| `disputed` | `resolve_traveller` | `payout_eligible` | support | — | `:257` |
| `disputed` | `escalate` | `incident_open` | support | — | `:258` |
| `incident_open` | `clear` | `payout_eligible` | support | the traveller keeps their share | `:260` |
| `incident_open` | `compensate` | `refunded` | support | refund is capped at what was captured; `compensate` with nothing captured is refused rather than written | `:259` |
| `payout_eligible` | `release` | `paid_out` | system, support | no open dispute, dispute window elapsed, payout ≤ captured ledger balance | `:261` |
| `locked_for_review` | `clear` | `confirmed` | support | caller must hold `support_agent` | `:279` |
| `locked_for_review` | `cancel` | `cancelled_safety` | support | caller must hold `support_agent` | `:286` |

`release` is reachable in code only. `PAYOUTS_NOT_ENABLED` (HTTP 501) is what the running pilot returns
from `POST /v1/admin/payouts/:bookingId/release`, because no payout rail is configured. A booking that
reaches `payout_eligible` stays there.

---

## What the driver does around every accepted edge

`applyBookingTransition` (`bookings.ts:223-359`) writes, in one transaction when the caller holds none
(`dbIsScoped`, `lib/db-scope.ts`):

1. the status flip, guarded by `WHERE status = <the status we read>` — a concurrent writer gets
   `TRANSITION_CONFLICT` instead of overwriting it (`:264`);
2. a `booking_events` row (the timeline the UI shows is this table, never a computed guess);
3. if the target is `cancelled_*` or `expired`, the trip's `capacity_kg_remaining` is handed back using
   the same `weight_kg × packagingAllowance` measure the reservation took, clamped at `capacity_kg`, and
   a `full` trip returns to `partially_booked` (`:285-298`).

Then, outside the transaction, the effects that must not be able to fail a transition:

| Target state | Effect | Line |
|---|---|---|
| `pickup_ready` | pickup handover code issued; sender notified `pickup_code_ready` | `:305` |
| `arrived` | delivery code issued; sender notified `delivery_code_ready` (the receiver has no account) | `:309` |
| `delivered` | `dispute_deadline` and `delivered_at` set; payout row forced to `not_eligible`; sender notified | `:315` |
| `payout_eligible` | payout row → `eligible` | `:321` |
| any | `TRANSITION_ALERTS` notification to the counterparty (never to whoever pressed the button) | `:325` |
| any | outbox row `booking.<status>`; audit entry with `before`/`after` status and reason code | `:346,347` |

---

## Invariants this design is responsible for

- **A parcel is not delivered because a client asked.** `delivered` requires a valid OTP and a photo,
  and only the traveller on that booking can offer them (`:198`, `:219`).
- **Money does not move on a frontend word.** `payment_authorised` and `release` are system/support
  edges; the webhook route verifies the provider signature before it may post `payment_authorised`.
- **Capacity and status change together or not at all.** Both are inside the same transaction, so a
  crash cannot leave a trip selling space a cancelled booking still holds.
- **A hold is always exitable.** Every state that freezes the payout (`locked_for_review`,
  `incident_open`, `disputed`) has at least one staff edge out, and staff surface exists for them in
  `Admin → Incidents`.
- **Codes are not in the thread.** The system note in every booking conversation says so, and the staff
  message-removal reason list includes `contact_details_shared` and `off_platform_payment`.

## Known gaps, stated plainly

- `expire`, `auto_expire`, `open_pickup` and `settle_window` are `system` edges. They are run by
  `services/lifecycle.ts`: the Worker's Cron Trigger (`wrangler.jsonc` → `triggers.crons`, every five
  minutes) and the Node scheduler when `JOBS_ENABLED=true`. The sweep is idempotent and bounded.
  `POST /v1/dev/lifecycle/run` exercises it locally. Settlement still refuses a delivered booking
  whose sender has not paid: money must be in the journal before the traveller is called payable.
- There is no `paused` trip state; a traveller pauses by editing or cancelling a trip, and accepted
  bookings are protected from both (`routes/trips.ts`, proven by `npm run test:trips`).
- The outbox has producers but no consumer, so `booking.*` rows accumulate until something reads them.
- `release` is untestable end to end until a payout rail is configured; the pilot answers 501 and the
  suite asserts that rather than pretending otherwise.
