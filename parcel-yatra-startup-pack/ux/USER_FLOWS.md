# User Flows

**Status:** Draft v0.1 · **Date:** 2026-10-24
Flows are written against the state machine in `docs/BOOKING_STATE_MACHINE.md` and the error codes in
`api/ERROR_CATALOG.md`. Every branch below has a corresponding test case.

---

## 1. Sender: first parcel (happy path)

```mermaid
flowchart TD
    A[Landing: 'Send a parcel'] --> B{Signed in?}
    B -->|No| C[Phone + OTP]
    B -->|Yes| D[Step 1: Item]
    C --> D
    D --> E{Category}
    E -->|Prohibited| E1[Hard stop + reason + what we do carry]
    E -->|Restricted| E2[Queued for review, 2h promise]
    E -->|Eligible| F[Step 2: Route + window]
    F --> G[Step 3: Price breakdown + 15 min timer]
    G --> H[Step 4: Matches]
    H -->|None| H1[No match: widen window / notify me / try courier]
    H -->|Some| I[Select trip → Request booking]
    I --> J[PAYMENT_PENDING]
    J --> K[Sandbox payment screen]
    K --> L[CONFIRMED + pickup instructions]
```

**Time budget:** the target is under 4 minutes for a signed-in returning sender, under 7 minutes for
a first-time sender including OTP.

## 2. Sender: no match

The most commercially important flow, because it is where the marketplace fails the user.

```mermaid
flowchart TD
    A[Matches screen] --> B{Any eligible trip?}
    B -->|No| C[Explain why, in one sentence]
    C --> D{Which reason?}
    D -->|No trip on date| E[Show nearest available dates]
    D -->|No capacity| F[Show trips with capacity but late arrival]
    D -->|Window too tight| G[Offer to widen by 2h / 4h / tomorrow]
    D -->|City not served| H[State clearly; no fake demand capture]
    E --> I[Notify me when a traveller posts]
    F --> I
    G --> J[Re-run matching]
    H --> K[Courier fallback info - P2, not at pilot]
```

**Rule:** never show a price when there is no match. A price implies availability.

## 3. Traveller: publish a trip and accept

```mermaid
flowchart TD
    A[Traveller home] --> B{Verified?}
    B -->|No| C[Verification flow]
    B -->|Yes| D[Trip create: route, date, window, capacity, mode]
    D --> E{Mode enabled?}
    E -->|No| E1[Explain mode is unavailable, do not offer a waitlist]
    E -->|Yes| F[Trip published]
    F --> G[Push: booking request - 30 min clock]
    G --> H{Review parcel}
    H -->|Accept| I[PAYMENT_PENDING → CONFIRMED]
    H -->|Decline| J[CANCELLED_BY_TRAVELLER, sender re-matched]
    H -->|Ignore 30 min| K[EXPIRED, capacity released]
```

**Traveller decision screen must show**: category, weight, declared-value band (not exact), pickup
area (not address), arrival window, their share in ₹, and the detour in minutes. Nothing else. Every
extra field is a reason to decline.

## 4. Verification (traveller)

```mermaid
flowchart TD
    A[Start] --> B[Choose ID type]
    B --> C[Capture front]
    C --> D{Quality ok?}
    D -->|No| C
    D -->|Yes| E[Capture selfie]
    E --> F[Submit]
    F --> G[PENDING_REVIEW]
    G --> H{Reviewer decision}
    H -->|Approve| I[VERIFIED → can accept]
    H -->|Reject| J[Reason category + resubmit up to 3]
    H -->|Request more| K[Specific ask + resubmit]
    J --> L{3 attempts used?}
    L -->|Yes| M[Manual contact required]
```

Review SLA shown to the user: "usually within 12 hours". If the queue is slower than that, the app
must show the real current estimate, not the marketing number.

## 5. Handover: pickup

```mermaid
flowchart TD
    A[Booking CONFIRMED] --> B[Window opens → PICKUP_READY]
    B --> C[Sender receives 6-digit OTP by SMS]
    C --> D[Traveller arrives]
    D --> E{Inspect parcel}
    E -->|Seal damaged| E1[Refuse: HANDOVER_REFUSED_SEAL, no penalty]
    E -->|Weight too high| E2[Refuse: HANDOVER_REFUSED_OVERWEIGHT, no penalty]
    E -->|OK| F[Sender reads OTP aloud]
    F --> G[Traveller enters OTP + takes sealed photo]
    G --> H{Valid?}
    H -->|Yes| I[PICKED_UP, OTP consumed forever]
    H -->|No, 1-4 attempts| G
    H -->|No, 5 attempts| J[LOCKED_FOR_REVIEW + support task]
```

**Offline branch:** the traveller may have no signal. The screen must queue the submission and retry;
the OTP is validated server-side, so an offline "success" is impossible and must never be faked in
the UI. Copy: "No signal — we'll confirm as soon as you're back online. Keep the parcel."

## 6. Handover: delivery

```mermaid
flowchart TD
    A[ARRIVED] --> B[Receiver gets SMS with OTP + link]
    B --> C{Receiver has smartphone?}
    C -->|Yes| D[Web page: enter OTP shown to traveller]
    C -->|No| E[Support-assisted: callback verification]
    D --> F[Traveller enters OTP + delivery photo]
    F --> G[DELIVERED]
    E --> H[Support records override with reason + audit]
    H --> G
    G --> I[72h dispute window starts]
    I --> J{Dispute raised?}
    J -->|No| K[PAYOUT_ELIGIBLE → PAID_OUT]
    J -->|Yes| L[DISPUTED, payout frozen]
```

**Receiver no-show:** after 2 hours at destination the traveller may mark
`DELIVERY_ATTEMPT_FAILED` and chooses: hold 24 h, hand to a support point (P2), or return. The UI
must never suggest abandoning the parcel.

## 7. Cancellation

```mermaid
flowchart TD
    A[Booking detail → Cancel] --> B{State}
    B -->|Before accept| C[Free cancel, 100% refund]
    B -->|Confirmed, >2h before window| D[100% minus provider fee]
    B -->|Confirmed, <=2h| E[50% refund, show exact amount before confirming]
    B -->|Picked up| F[Cancel not offered. Show 'Raise a problem']
    F --> G[Dispute flow]
    E --> H[Confirm dialog with explicit amount + reason code]
    C --> I[Reason code selector → done]
    D --> H
    H --> I
```

**Rule:** the refund amount is shown as a number *before* the user confirms. No "you may be eligible
for a partial refund".

## 8. Dispute

```mermaid
flowchart TD
    A[Booking → Report a problem] --> B[Category]
    B --> C[Description + optional photo]
    C --> D[Submit]
    D --> E[DISPUTED: payout frozen automatically]
    E --> F[Confirm screen: what happens next, 72h target, case id]
    F --> G[Support may request evidence → user gets push]
    G --> H[Resolution with reason code]
    H --> I{User disagrees?}
    I -->|Yes, within 7 days| J[Appeal]
    I -->|No| K[Closed]
```

The user must be told, at submission, that **payout to the traveller is paused** — not doing so is a
transparency failure.

## 9. Payment states surfaced to the user

| Internal state | What the screen says | Allowed action |
|---|---|---|
| `payment_pending` (creating) | "Setting up payment…" | Wait |
| `payment_pending` (provider slow) | "We're confirming with your bank" | Wait, do not retry |
| `authorised` | "Payment confirmed" | Continue |
| `failed` (definitive) | "Payment didn't go through. Your booking was cancelled." | Retry with new booking |
| unknown | "We're not sure yet — we'll text you." | None; support follows up |

**Never** show a retry button while payment state is unknown. Double capture is worse than a delay.

## 10. Admin: dispute resolution

```mermaid
flowchart TD
    A[Queue: Disputes] --> B[Open case]
    B --> C[Evidence panel: photos, OTP log, timeline, messages]
    C --> D{Enough evidence?}
    D -->|No| E[Request from party, 24h deadline]
    E --> C
    D -->|Yes| F[Choose outcome code]
    F --> G{Amount > Rs.1000?}
    G -->|Yes| H[Second approver required]
    G -->|No| I[Execute]
    H --> I
    I --> J[Both parties notified with reasons]
    J --> K[Audit entry]
```

Admin UI constraint: the "execute" button is disabled until an outcome code **and** a free-text
justification of ≥ 20 characters exist. This is friction by design.

## 11. Flow-level acceptance criteria

| Flow | Criterion |
|---|---|
| Send | Completable in < 4 min (returning) / < 7 min (new) on a 3G connection |
| Send | Abandonment at any step preserves entered data for 24 h |
| Accept | Traveller can decide from the notification alone (all decision data in the push payload minus PII) |
| Handover | Works with 0 bars; queues and retries without duplicating the OTP consumption |
| Receiver | Completable by a first-time user on a feature phone via SMS link, no app |
| Dispute | Payout freeze is visible to both parties immediately |
| All | Every error state has a next action; no dead ends |

## 12. Flows explicitly not designed at pilot

- Multi-parcel consolidated shipments.
- Recurring/scheduled bookings.
- Business accounts with multiple users.
- In-app wallet top-up.
- Live map tracking.
- Returning a delivered parcel.

Each is absent rather than half-built (see `docs/MVP_SCOPE_AND_NON_GOALS.md`).
