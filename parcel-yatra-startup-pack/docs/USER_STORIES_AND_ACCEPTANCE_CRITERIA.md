# User Stories & Acceptance Criteria

**Status:** Draft v0.1 · **Format:** Gherkin-style. Every story has an ID, a priority, and at least one negative-path scenario.
Stories are only "Done" when automated tests exist (`testing/TEST_CASES.md`) **and** the acceptance
criteria below pass in staging.

---

## Epic A — Authentication & Identity

### US-A1 (P0) — Phone OTP signup
**As** a new sender **I want** to sign up with my mobile number **so that** I can book without a password.

```gherkin
Scenario: Successful OTP signup
  Given I am a new user on +91-9XXXXXXXX1
  When I request an OTP
  Then an SMS OTP is sent and stored only as a hash
  And the OTP expires in 5 minutes
  And I can verify it once

Scenario: OTP replay
  Given I verified an OTP successfully
  When I submit the same OTP again
  Then the request is rejected with OTP_ALREADY_USED

Scenario: Brute force
  Given I submit 5 incorrect OTPs for one challenge
  Then the challenge is invalidated
  And further attempts return OTP_ATTEMPTS_EXCEEDED
  And the event is recorded for abuse review

Scenario: Enumeration resistance
  When I request an OTP for a number that does not exist
  Then the response is identical to the success case (no user-existence leak)
```

**AC:** OTP never appears in logs, analytics events, or error messages. Rate limits: 3/hour/number,
10/hour/IP, 20/day/device.

---

### US-A2 (P0) — Google sign-in
**As** a sender **I want** to sign in with Google **so that** onboarding is faster.

```gherkin
Scenario: Valid Google ID token
  Given the mobile client supplies a Google ID token
  When the server verifies signature, iss, aud, exp and email_verified
  Then a session is created and linked to a user record
  And the server never trusts client-supplied email/name claims without verification

Scenario: Token audience mismatch
  Given a token issued for a different OAuth client
  Then the server rejects with AUTH_TOKEN_INVALID

Scenario: Expired token
  Then the server rejects with AUTH_TOKEN_EXPIRED
```

**AC:** No token is ever accepted from the client body as proof of identity without server-side
verification. Session tokens are short-lived; refresh handled server-side.

---

### US-A3 (P0) — Traveller KYC submission
**As** a traveller **I want** to submit my ID **so that** I can start accepting parcels.

```gherkin
Scenario: Submit ID for review
  Given I am authenticated as a traveller
  When I upload a front image of an accepted ID type
  Then the file is stored in private storage with a random object key
  And the upload is limited to 10 MB and to image/jpeg or image/png
  And EXIF metadata is stripped
  And my verification status becomes PENDING_REVIEW
  And I cannot accept a parcel until status is VERIFIED

Scenario: Malicious upload
  Given I upload a file whose magic bytes are not an image
  Then the upload is rejected with UPLOAD_INVALID_TYPE
  And the file is not stored or served

Scenario: Rejected verification
  Given my ID is rejected
  Then I see a reason category (not the reviewer's free text verbatim)
  And I may resubmit at most 2 times before manual contact is required
```

**AC:** ID images are readable only by `verification_reviewer` role; every read is audited. Aadhaar is
not an accepted upload type by default (see `legal/PRIVACY_DATA_PROTECTION.md`).

---

## Epic B — Parcel Creation

### US-B1 (P0) — Declare a parcel and see a price
```gherkin
Scenario: Price before posting
  Given I am a verified sender
  When I enter pickup area, drop area, category, weight 2 kg, value ₹3,000
  Then I see an itemised price: base, distance, weight/size, handling, platform fee, taxes
  And the quote expires in 15 minutes
  And the total includes all statutory taxes shown separately

Scenario: Prohibited category
  Given I select a category on the prohibited list
  Then posting is blocked with a specific reason
  And no matching is attempted

Scenario: Restricted category requiring review
  Given I select a category on the restricted list
  Then my parcel is queued for human review
  And I am told a human will review within 2 business hours
```

**AC:** Price is server-computed; tampering with client payload cannot change the charged amount.

---

### US-B2 (P0) — Declared value above pilot cap
```gherkin
Scenario: Value above ₹5,000
  Given I declare a value of ₹12,000
  Then posting is blocked with VALUE_ABOVE_PILOT_LIMIT
  And I am shown why (no insurance cover at pilot) and offered no workaround
```

---

## Epic C — Trip & Matching

### US-C1 (P0) — Publish a trip
```gherkin
Scenario: Publish within a valid window
  Given I am a verified traveller with mode_car enabled
  When I publish Bareilly→Delhi for tomorrow 07:00–09:00 with 8 kg capacity
  Then my trip is visible to senders as "car, 8 kg available"
  And my exact address is NOT exposed
  And my phone number is NOT exposed

Scenario: Mode disabled
  Given mode_bus is disabled by feature flag
  Then I cannot publish a bus trip and see a clear explanation
```

---

### US-C2 (P0) — Match a parcel to a trip
```gherkin
Scenario: Eligible match
  Given a parcel Bareilly→Delhi 3 kg with window tomorrow 10:00–18:00
  And a trip Bareilly→Delhi tomorrow 07:00 departing with 8 kg free
  Then the trip appears in results with a match band
  And the reason "on your route, arrives within your window" is shown

Scenario: No eligible match
  Given no trip satisfies origin, destination, capacity, window or mode
  Then the UI states "No traveller match yet" with options to widen the window
  And NO price is fabricated for an impossible match
```

---

### US-C3 (P0) — Traveller accepts
```gherkin
Scenario: Accept
  Given a booking request PENDING_TRAVELLER_ACCEPTANCE
  When the traveller accepts within 30 minutes
  Then the booking becomes CONFIRMED
  And trip capacity is decremented atomically
  And both parties can see the counterpart's first name and masked phone

Scenario: Request expiry
  Given 30 minutes pass without acceptance
  Then the booking becomes EXPIRED
  And any hold on capacity is released
  And the sender is prompted to choose another trip

Scenario: Concurrent acceptance of last capacity
  Given 1 kg of capacity remains and two acceptances arrive simultaneously
  Then exactly one succeeds
  And the other receives CAPACITY_UNAVAILABLE
```

---

## Epic D — Handover & Delivery

### US-D1 (P0) — Pickup OTP
```gherkin
Scenario: Correct pickup OTP
  Given the sender shares the pickup OTP with the traveller at handover
  When the traveller submits it within 10 minutes
  Then the booking becomes PICKED_UP
  And a pickup photo is stored as evidence
  And the OTP is invalidated permanently

Scenario: Wrong OTP 5 times
  Then the booking is LOCKED_FOR_REVIEW
  And a support task is created
  And neither party can advance the booking themselves

Scenario: Expired OTP
  Then PICKUP_OTP_EXPIRED is returned and the sender can regenerate a new one
```

---

### US-D2 (P0) — Delivery confirmation
```gherkin
Scenario: Receiver confirms
  Given the parcel is IN_TRANSIT
  When the receiver submits the delivery OTP within 10 minutes
  Then the booking becomes DELIVERED
  And a delivery photo is stored
  And payout eligibility is enabled (subject to dispute window)

Scenario: Receiver unavailable
  Given the parcel is IN_TRANSIT and the receiver does not respond for 6 hours
  Then the booking becomes DELIVERY_ATTEMPT_FAILED
  And support is notified
  And the traveller is shown safe options (hand to support point, return, hold)
```

---

## Epic E — Cancellation & Dispute

### US-E1 (P0) — Cancel before pickup
```gherkin
Scenario: Sender cancels after confirmation, before pickup
  Then the booking becomes CANCELLED_BY_SENDER
  And refund is computed per the refund policy
  And the traveller sees the reason code (not free text)
```

### US-E2 (P0) — Dispute freezes payout
```gherkin
Scenario: Dispute raised after delivery, before payout release
  Given booking DELIVERED and payout still in the dispute window
  When the sender raises "item damaged"
  Then a dispute is created and payout state becomes FROZEN
  And support must resolve before any release
```

---

## Epic F — Admin

### US-F1 (P0) — Verification review
```gherkin
Scenario: Reviewer approves
  Given a PENDING_REVIEW traveller
  When a verification_reviewer approves with reason code "id_clear"
  Then the traveller becomes VERIFIED and can accept parcels
  And the action is written to the audit log with actor, time and before/after state
```

### US-F2 (P0) — Maker-checker refund
```gherkin
Scenario: Refund above threshold
  Given a refund of ₹1,500 is proposed by agent A
  Then it requires approval by a different agent B
  And agent A cannot approve their own request
```

---

## Cross-cutting acceptance criteria

| Area | Criterion |
|---|---|
| Authorisation | Every endpoint re-checks resource ownership server-side; a valid token for user X cannot read user Y's booking |
| Idempotency | Repeat of any POST with same `Idempotency-Key` returns the original result, never a duplicate |
| Errors | All errors use the catalogue in `api/ERROR_CATALOG.md`; no stack traces or internal IDs leak |
| Audit | Every privileged mutation writes an immutable audit record |
| Privacy | No PII in URLs, analytics events, or logs; phone numbers masked in all non-essential views |
| Offline | Booking and handover screens survive a network drop and retry without duplicating actions |
