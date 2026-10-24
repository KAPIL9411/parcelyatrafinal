# Content & Microcopy

**Status:** Draft v0.1 · **Date:** 2026-10-24
Language: English and Hindi (both mandatory at launch). This file is the source of truth for tone and
for the exact wording of high-stakes strings.

---

## 1. Voice

**Plain, specific, unexcited.** We are moving someone's document; the copy should sound like a careful
person, not a growth team.

| Do | Don't |
|---|---|
| "Your parcel reached Delhi." | "Woohoo! Delivered! 🎉" |
| "We don't carry cash or jewellery." | "Certain items may be restricted." |
| "The traveller is running about 40 minutes late." | "Slight delay possible." |
| "This parcel is not insured." | "Travel with peace of mind." |
| "You can cancel free until the traveller accepts." | "Flexible cancellation." |

### Rules
1. Sentence case everywhere except proper nouns.
2. Active voice, second person.
3. No jargon: not "consignment", not "consignee", not "SLA", not "escrow". Say "parcel", "receiver",
   "we'll respond within 48 hours", "we hold nothing".
4. Numbers are specific or absent. Never "several", "many", "soon" where a number is knowable.
5. Never promise what we cannot control: bank posting times, traveller behaviour, exact arrival.
6. Hindi is a **parallel original**, not a translation of English idiom. Hinglish is acceptable where
   it is how people actually speak ("parcel", "OTP", "booking" stay as-is).

## 2. High-stakes strings (must be exact)

### Insurance / liability
> **Your parcel is not insured.**
> We're working on cover. Until it exists, if something goes wrong we can help you investigate and may
> offer a goodwill amount, but we cannot repay the full value.

Hindi:
> **आपका पार्सल बीमित नहीं है।**
> हम बीमा पर काम कर रहे हैं। जब तक वह उपलब्ध नहीं है, कुछ गलत होने पर हम जाँच में मदद करेंगे और मुझे
> क्षतिपूर्ति भी दे सकते हैं, लेकिन पूरी कीमत नहीं लौटा सकते।

**Never** write: "insured", "protected", "guaranteed", "100% safe", "we cover your parcel".

### No live tracking
> **We don't track the traveller's live location.**
> You'll get updates when they pick up, when they're on the way, and when they arrive.

Rationale: setting the expectation prevents the "where is he right now" support call.

### Payment hold
> **We don't hold your money.**
> Payment is handled by a licensed payment provider. The traveller is paid after delivery, once the
> problem window has passed.

Only use once GATE-3 is cleared; before that, sandbox copy applies (§3).

### Prohibited items
> **We can't carry cash, jewellery, medicines, electronics or passports.**
> The full list is short and specific — please read it before you pack.

### Cancellation consequence
> Cancelling now refunds **₹{refund}** to you and pays the traveller **₹{traveller_share}**.

Numbers inline, never "a partial refund may apply".

### Dispute freeze
> **Raising this pauses the traveller's payment** until we've reviewed it.

### Verification rejection
> We couldn't verify this ID. The photo was too blurry to read the number. You can try again — you
> have {n} attempts left.

Reason comes from a **catalogue**, never the reviewer's free text.

## 3. Sandbox / test-mode strings

Mandatory while payments are mocked:

> **Test mode.** No real money is charged and no real payout is made.

Hindi:
> **टेस्ट मोड।** कोई असली पैसा नहीं कटेगा और कोई असली भुगतान नहीं होगा।

Removing this string without switching the adapter is a release blocker.

## 4. Error copy

Rule: **what happened → what it means for my parcel → what to do now.**

| Code | Copy |
|---|---|
| `CAPACITY_UNAVAILABLE` | "That space was just taken. Here are other travellers on your route." |
| `QUOTE_EXPIRED` | "This price has expired. Tap to see the current price — it may have changed." |
| `PAYMENT_PROVIDER_UNAVAILABLE` | "Your bank hasn't confirmed yet. Don't pay again — we'll text you within 15 minutes." |
| `OTP_INVALID` | "That code didn't match. {n} tries left." |
| `BOOKING_LOCKED` | "This booking is paused so our team can check it. We'll call you shortly." |
| `NO_MATCH` | "No traveller matches this route and time yet." (followed by options, never a price) |
| `VALUE_ABOVE_PILOT_LIMIT` | "We only carry items worth up to ₹5,000 right now, because parcels aren't insured yet." |
| `ITEM_PROHIBITED` | "We can't carry this. It's on our list of items we don't accept." |
| `ACCOUNT_SUSPENDED` | "This account is on hold. Contact support to resolve it." |
| `INTERNAL_ERROR` | "Something went wrong on our side. Reference {request_id}. Our team can look it up." |

Forbidden in any error: stack traces, HTTP codes shown to users, "unknown error", "oops", blame
("you entered invalid data"), and the raw submitted value.

## 5. Empty states

| Screen | Copy | Action |
|---|---|---|
| No bookings | "No parcels yet." | Send a parcel |
| No trips | "You haven't posted a trip." | Post a trip |
| No requests | "No one has asked you to carry anything yet." | — (do not invent urgency) |
| No matches | "No traveller matches this route and time yet." | Widen window · Notify me |
| No notifications | "Nothing new." | — |
| No disputes | "No open cases." | — |
| Admin queue empty | "Queue is clear." | — |

## 6. Permission and consent copy

Camera:
> We use the camera to photograph your ID and your sealed parcel. Photos are stored privately and
> deleted on schedule.

Notifications:
> Booking updates are sent as part of the service. Offers and news need a separate yes — you can turn
> that off any time without affecting your bookings.

Location:
> We don't ask for your live location. Pickup and drop use the area you type, not GPS.

## 7. Money and numbers

- Currency: `₹899` (no space, no decimals unless paise are non-zero).
- Indian grouping: `₹1,00,000`, not `₹100,000`.
- Ranges: `₹250–₹450` (en dash).
- Time: `7:00 am`, `12:30 pm`; dates `24 Oct`, `24 Oct 2026` when the year matters.
- Durations: "about 40 minutes", "within 2 hours", "by 6 pm tomorrow".
- Never: "₹899/-", "Rs. 899", "INR 899.00", "899 ₹".

## 8. Tone under stress

| Situation | Copy |
|---|---|
| Traveller very late | "Imran hasn't updated the status for 3 hours. Call them, or we can step in." |
| Parcel reported lost | "We've paused this booking and opened a case. A person will call you within 4 hours. Case {id}." |
| Prohibited item found | "We've stopped this delivery and opened a case. Please don't send this item again." |
| Data breach notice | "We're writing to tell you about a security incident that affected your account. Here is exactly what happened…" |

Never use passive voice to avoid responsibility ("errors were made"). Never say "we apologise for the
inconvenience" as the only content.

## 9. Accessibility copy

- Link text is descriptive: "Read the full prohibited items list", not "click here".
- Icon-only buttons have accessible names that match their tooltip.
- Error messages are announced (see `ux/ACCESSIBILITY.md`).

## 10. Notification copy rules

- No PII in push: not the address, not the item description, not the value.
- OTP messages state the purpose and expiry: "Your Parcel Yatra pickup code is 482913. It expires in
  10 minutes. Never share it before handing over the parcel."
- A receiver's first message must explain why they got it: "Rohit is sending you a parcel from
  Bareilly. Here's how to receive it."

## 11. Legal-adjacent copy constraints

These phrases may **not** appear until the corresponding gate is cleared:

| Phrase | Blocked until |
|---|---|
| "Insured" / "covered" / "protected" | GATE-5 written insurer confirmation |
| "Escrow" / "we hold your money" | GATE-3 provider confirmation (and even then, prefer "held by our payment partner") |
| "Guaranteed delivery" | Never — structurally false for a marketplace |
| "Verified by government" | Never — our verification is ours, not the state's |
| "Safe for valuables" | Never at pilot |
| Bus / train / flight modes | Written operator/legal clearance |

Enforced by a copy-lint test in CI over the string catalogue (`testing/TEST_CASES.md` §Copy).

## 12. String catalogue requirements

- Every user-visible string lives in a versioned catalogue with an ID.
- Each string has `en` and `hi`; missing Hindi blocks release.
- Strings contain no HTML; formatting is applied by the component.
- Placeholders are named (`{refund}`), never positional.
- Copy changes require review by someone who did not write them.

## 13. What we will never write

- "Trusted by thousands" (we have no thousands).
- "India's #1" (unverifiable and legally risky comparative claim).
- "100% secure" (no system is).
- "Instant delivery" (we do not offer it).
- Fake scarcity, fake countdowns, fake reviews.
- Anything implying we employ the traveller.
