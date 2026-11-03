# Screen Specifications

**Status:** Draft v0.1 · **Date:** 2026-10-24

Each screen lists: purpose, required components, data, actions, and **all nine states**. A screen is
"specified" only when every state is described. Untested states are the main source of production
embarrassment.

---

## 0. Global states

| State | Treatment |
|---|---|
| Loading | Layout-preserving skeleton (no full-screen spinner except on cold start) |
| Offline | Persistent amber bar: "No connection. Changes will sync when you're back." Queued actions shown with a clock icon |
| Recoverable error | Inline panel with the specific `code` mapped to human text + Retry |
| Unrecoverable error | Full-screen with case/reference id + support button |
| Pending verification | Amber banner on traveller surfaces; actions disabled with explanation, not hidden |
| Rejected | Red panel, reason category, appeal/support path |
| Empty | Illustration-free, one sentence, one primary action |
| Success | Green confirmation with next step |

---

## 1. Landing (`/`)

**Purpose:** in ten seconds, a Bareilly sender must understand what this is, what it costs roughly,
what it will *not* carry, and how to start.

| Region | Content |
|---|---|
| Hero | "Send it with someone already going." Sub: Bareilly ⇄ Delhi · Lucknow. Primary CTA **Send a parcel**; secondary **I'm travelling** |
| Price strip | "Documents, up to 5 kg, Bareilly→Delhi: **₹—**" — a real server-fetched range, never a hardcoded marketing number. If unavailable: omit the strip rather than invent it |
| How it works | 3 steps with icons: Declare → Match → OTP handover |
| Trust block | Verified travellers · sealed-parcel photo · OTP at both ends · dispute support |
| Honesty block | "We do not carry cash, jewellery, medicines, electronics or passports. Parcels are **not insured** unless stated." |
| Limits block | 5 kg · 45 cm · ₹5,000 declared value · car travellers only at launch |
| Footer | Pricing · Prohibited items · Safety · Help · Terms · Privacy · Grievance officer |

**States**
- Loading: hero renders immediately (static); price strip shows a shimmer.
- Empty/error: price strip hidden with a one-line note.
- Offline: cached page; CTAs disabled with "You're offline".

**Anti-patterns forbidden here:** fake testimonials, invented "1 lakh+ deliveries", stock photos of
couriers who do not exist, countdown timers, "as seen in" press logos.

---

## 2. Sender onboarding

### 2.1 Phone entry
Fields: `+91` fixed prefix, 10-digit input, numeric keypad. Consent line below the button (short form
+ link to full notice). Button disabled until 10 valid digits.

States: idle · invalid number (inline) · sending (button spinner) · rate-limited (with countdown) ·
provider error (retry) · success (advance).

### 2.2 OTP entry
- 6 single-character boxes, auto-advance, paste-supported.
- "Resend in 0:24" countdown; resend enabled after 30 s.
- "Didn't get it? Call support" link after 60 s.
- Auto-submits on the 6th digit.

States: entering · verifying · wrong code (shake + clear, attempts remaining shown as "4 tries left")
· expired (with one-tap resend) · attempts exceeded (locked, "Try again in 15 minutes") · success.

**Never** display the OTP in the UI, a toast, or a notification preview.

### 2.3 Google sign-in (optional)
Secondary button below phone. Failure states are localised to the button and never block phone signup.

### 2.4 Profile completion
Name (required for booking, not for browsing) + optional email. Language toggle EN/हिं. Skippable —
the user is prompted again at first booking, not held hostage.

---

## 3. Traveller onboarding

Step 0: explain the deal — "You're already going. Carry a small sealed parcel. Get paid after
delivery." Show what they will *not* be asked to carry.

Step 1: ID type selection — Driving Licence / Voter ID / Passport. **Aadhaar is not offered**
(decision D-008); a footnote explains why and offers support contact.

Step 2: capture. Camera with a document frame overlay; limits shown ("JPEG or PNG, max 10 MB"); EXIF
stripped server-side (told to user: "we remove location data from your photo").

Step 3: selfie with liveness prompt.

Step 4: payout account (name must match ID; explainer: "we pay by bank transfer only").

Step 5: submitted → `PENDING_REVIEW` with an honest ETA and what happens on rejection.

States: permission denied (camera) · poor lighting (retry tips) · upload failed (retry with the same
object key) · pending · approved · rejected (reason category + attempt count) · attempts exceeded
(manual contact) · offline (queue, tell the user it will submit automatically).

---

## 4. Parcel creation (`/send`)

### Step 1 — Item

| Field | Control | Validation surfaced |
|---|---|---|
| Category | Radio list, eligible categories only | Prohibited categories are not listed; the prohibited page is linked |
| Description | Textarea, 5–300 chars, placeholder "e.g. A4 envelope with property papers" | Vague-input detection: "Please be specific — what is inside?" |
| Photo | Camera/gallery, 1 image | Required; "photograph the sealed parcel" |
| Weight | Numeric + stepper, 0.1–5 kg | "Up to 5 kg at launch" |
| Dimensions | 3 numeric fields | Each ≤ 45 cm |
| Declared value | ₹ input | ≤ ₹5,000; over-limit shows *why* (no insurance), no workaround |
| Packaging | Checklist: sealed / tamper-evident / no liquids | All must be ticked |

Restricted category path: an inline amber panel — "This needs a quick human check. Usually within 2
hours. We'll text you." Not an error dialog.

### Step 2 — Route and window
Origin city (fixed to Bareilly at pilot, with a "why only these cities" tooltip), origin area
(typeahead of localities, not free address), destination city, destination area, window start/end
(date + 2-hour slots).

Rules shown inline: "Window must be within the next 7 days."

### Step 3 — Price
Covered in §6.

### Step 4 — Matches
Covered in §7.

States across the wizard: draft restored ("We saved your draft") · step validation · server rejection
with the specific `code` · offline (draft saved, submit queued) · restricted-review · prohibited hard
stop.

---

## 5. Trip creation (`/trips/new`)

Fields: origin city/area · destination city/area · mode (car enabled; bike shown disabled with reason
"coming after insurance review" — or hidden entirely; **decision: hidden**, to avoid implying a
roadmap commitment) · departure date + time · arrival estimate · capacity kg (slider 1–20) ·
documents-only toggle.

Inline computed feedback: "You could earn about ₹— on this trip" — a range, clearly labelled as an
estimate, only if a comparable corridor price exists. Otherwise omitted.

States: not verified (blocking panel with CTA) · mode disabled · window in past · capacity invalid ·
published · offline.

**Guardrail copy:** "Only publish trips you are actually making." Repeated cancellations are visible
to us and reduce your ranking.

---

## 6. Price breakdown

A receipt-like card, not a marketing banner.

```
Traveller's share              ₹621
Service and platform fee       ₹116
Taxes (GST)                    ₹137
─────────────────────────────────
Total                          ₹899

This price is held for 14:52.
```

Requirements:
- Every line is a named, human-readable component.
- Tax is shown as an amount, not just "incl. taxes".
- Quote expiry is a live countdown; at zero the CTA becomes "Refresh price" and the amount may change
  **only with explicit re-consent**.
- A "How we price" link opens a plain-language explanation.
- If a surge multiplier ever applies it appears as a named line ("Peak demand ×1.2"), never silently.
- The traveller's share is shown to the *sender* — transparency about who gets what.

States: valid · expiring (< 2 min, amber) · expired (CTA changes, old amount struck through) ·
recalculated (diff shown) · unavailable/no match (no numbers at all).

---

## 7. Matching results

Card per candidate:

```
[Verified]  Imran S.        ★ reliable
Bareilly → Delhi · car
Departs tomorrow 07:00 · arrives ~12:30
Picks up within 3 km of you
₹899 · you pay on confirmation
Why this one: on your route · arrives in your window · small detour
```

Requirements:
- Ranked list, max 10, with a match band chip (Excellent/Good/Fair). No numeric score.
- Reasons come from the closed set in `docs/MATCHING_ENGINE.md` §5 — never invented copy.
- No phone number, no exact address, no live location, no full surname.
- "Why am I seeing this?" expander per card.
- Alternative actions when nothing fits: widen window, notify me, see what we can't carry.

States: loading (3 skeleton cards) · results · no results (reason-specific copy) · low confidence banner
("These are the closest we have — check the arrival time") · error · offline (cached results marked
stale with timestamp).

---

## 8. Booking confirmation

After the traveller accepts and payment is confirmed:

- Big status: **Confirmed**.
- What happens next, in order, with times.
- Counterparty: first name, verification badge, masked phone, "Message" (text only).
- Pickup area + a "share precise address when the traveller is on the way" step.
- **What to check at handover** checklist.
- Prominent: "Your parcel is not insured" (until GATE-5 changes it).
- Cancel link with the exact refund consequence stated.

States: pending acceptance (with the 30-minute clock visible) · accepted/awaiting payment · confirmed ·
payment failed (booking auto-cancelled, restart CTA) · expired.

---

## 9. Payment

Sandbox banner is mandatory while `sandbox: true`:

> **Test mode.** No real money will be charged.

States:
| State | UI |
|---|---|
| Creating intent | Full-width progress with "Setting up…" |
| Awaiting authorisation | Provider surface (redirect/hosted) — we do not render card fields |
| Confirming | "Confirming with your bank" with a 60 s expectation |
| Confirmed | Green check + booking confirmation |
| Failed (definitive) | "Payment didn't go through. Nothing was charged. Your booking was cancelled." + Retry |
| Unknown | "We're checking. We'll text you within 15 minutes." — **no retry button** |
| Disabled | If `payments_live=false` and no mock: "Payments aren't enabled yet." (internal builds only) |

---

## 10. Pickup instructions

- Where to be, when, who to expect (first name + vehicle colour if provided).
- "Have the parcel sealed before the traveller arrives."
- "You will get a 6-digit code. Give it to the traveller **only after** they have the parcel in hand."
- Do-not list: no cash inside, no extra items added after the photo.
- Support number with hours.

States: not yet in window · window open (OTP issued) · OTP expired (regenerate) · traveller late
(> 30 min, with a "contact" action before "cancel") · picked up.

---

## 11. Handover verification (traveller)

Single-purpose screen: giant 6-box OTP input, camera button for the sealed photo, checklist
(seal intact / weight matches), and one primary action.

Failure handling is explicit:
- Wrong code: "That code didn't match. 4 tries left." (never reveal the correct code, never hint)
- 5th failure: "This booking is paused for review. Our team will call you." Actions disabled.
- Offline: "No connection — we'll confirm when you're back online."
- Refused: reason picker (`HANDOVER_REFUSED_SEAL`, `HANDOVER_REFUSED_OVERWEIGHT`) + "no penalty"
  reassurance.

---

## 12. Delivery confirmation (traveller)

Same pattern as pickup, plus:
- Receiver-name confirmation checkbox.
- Delivery photo (parcel in hand or at the door).
- If receiver unreachable: "Receiver not available" → explains the three options and their
  consequences.

---

## 13. Tracking / status history

**No map.** A vertical timeline instead:

```
✓  Confirmed            Today 09:12
✓  Picked up            Today 09:41  · photo
●  In transit           Since 09:45
○  Arrived              Expected ~12:30
○  Delivered
```

- Each completed node can be tapped to see evidence (photos) where the viewer is entitled.
- Explicit "last updated" timestamp.
- Honest copy: "We don't track the traveller's live location. Status updates come from them."

States: no events yet · stale (> 3 h no update, show "no update since…") · incident open (red banner
with support CTA) · terminal.

---

## 14. Cancellation and refund

- Reason selector (required): plans changed / found another option / traveller too late / price /
  other.
- **Exact refund amount and traveller compensation shown before confirmation.**
- Consequence copy: "The traveller will be paid ₹X from your payment."
- Confirmation screen states the refund timeline band and that we do not control bank posting times.

States: not cancellable (after pickup → shows dispute CTA instead) · cancellable with fee · cancellable
free · already cancelled · refund pending · refund completed.

---

## 15. Dispute / claim

- Category selector (7 options).
- Description (≥ 10 chars) + optional photo.
- Explicit statement: "Raising this pauses the traveller's payment until we review it."
- Case ID issued; timeline of case states; evidence requests shown as tasks.
- Resolution screen: outcome, reason, money effect, appeal button (7 days).

States: eligible · window closed (with the exact deadline shown) · already open · evidence requested ·
under review · resolved · appealed · closed.

---

## 16. Ratings and reviews

- Appears only after `delivered`, within 7 days.
- 1–5 stars + optional tags (no free-text comments at pilot — moderation burden).
- Both sides rate; neither sees the other's rating until both submit or 7 days pass.
- "Your rating is separate from any incident report" — an incident is never hidden by a good rating.

States: not yet eligible · awaiting counterparty · submitted (locked) · window closed.

---

## 17. Profile, settings, privacy

Sections: Personal details · Verification · Payout account · Notifications (per channel, per category)
· Language · Privacy (download my data, delete my account, consent history) · Security (active
sessions, sign out everywhere) · Help.

Privacy screen requirements:
- Download-my-data triggers `POST /me/export`, explains the 24-hour link.
- Delete-my-account states plainly what is deleted and what is retained (payment records, fraud
  records, audit logs) **before** the confirm step.
- Consent toggles are as easy to turn off as on.

States: loading · saved · validation error · export queued · deletion blocked by open booking/dispute
· deletion scheduled.

---

## 18. Help and support

- Searchable FAQ (10–15 real questions, including "what if the traveller is late", "what isn't
  insured", "can I send my passport" → no).
- Contact: in-app message, phone with hours, email.
- Grievance officer details and response commitments.
- Per-booking "Get help with this booking" pre-fills the booking ID.

States: offline (phone number still visible) · no search results (show top categories) · outside hours
(show callback promise).

---

## 19. Admin — verification queue

Layout: list (left) + detail (right).

Detail shows: submitted time, ID type, front/back, selfie, liveness score if available, account age,
prior attempts, risk flags. Actions: Approve · Reject (reason dropdown) · Request more (structured
ask). Every document view writes an audit entry with the reviewer's ID.

Constraints: no free-text notes containing ID numbers; the ID number itself is displayed masked except
the last 4 characters; a "copy ID number" button does not exist.

States: empty queue · item loading · image failed to load (retry, cannot approve blind) · decision
saved · conflict (another reviewer acted first) · permission denied.

---

## 20. Admin — booking search and operations dashboard

- Search by booking ID, phone hash, corridor, status, date range.
- Table: ID (short), corridor, status, age, value, flags, traveller, sender.
- Row → booking timeline with evidence, payments, messages, flags.
- Dashboard tiles: bookings today, stuck > 2 h in a non-terminal state, disputes open, payouts
  awaiting approval, verification backlog age, incident count.
- Every tile links to a filtered list. No decorative charts.

States: no results · too-broad query (asks to narrow) · stale data indicator · permission-limited view
(`admin_readonly` sees no action buttons).

---

## 21. Admin — disputes, reconciliation, audit

**Disputes:** case view with evidence side-by-side, outcome code selector, justification (≥ 20 chars),
approval status, money effect preview.

**Reconciliation:** provider report vs. ledger, grouped by mismatch type; each row links to the
booking; "resolve" requires a note and is audited; unresolved mismatches block payouts.

**Audit log:** filterable by actor, resource, action, date; immutable; export requires a reason and is
itself audited; hash-chain verification button ("verify integrity") that reports pass/fail.

---

## 22. Screen-to-requirement traceability

| Screen | Requirements |
|---|---|
| Landing | — (marketing) |
| Sender onboarding | FR-101, FR-102, FR-104, FR-106 |
| Traveller onboarding | FR-103, FR-105 |
| Parcel creation | FR-201…FR-208 |
| Trip creation | FR-301…FR-306 |
| Matching | FR-401, FR-402 |
| Booking | FR-403…FR-407 |
| Payment | FR-601…FR-606 |
| Handover | FR-501…FR-506 |
| Disputes | FR-701…FR-706 |
| Admin | FR-801…FR-806 |

A screen not listed here is not traceable to a requirement and therefore out of scope.
