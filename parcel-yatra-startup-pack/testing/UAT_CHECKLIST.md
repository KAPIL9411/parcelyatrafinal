# UAT Checklist

**Status:** Draft v0.1 · **Date:** 2026-10-24
**Executed by:** the founder / ops lead, not the engineer who built the screen. That is the control.
**Environment:** staging, mock payments, sandbox SMS numbers only.

---

## 0. How to use this

1. Work on a real phone, on mobile data, not on a laptop with wifi.
2. Use a device that is not the one you developed on.
3. Reset the app data before starting.
4. Tick only what you actually did. An untested box is an honest box.
5. Any unticked box in a P0 section blocks release.

Legend: **P0** = release blocker · **P1** = must be fixed within the first sprint · **P2** = backlog.

---

## 1. Buyer-side reality check (do this first, before anything technical)

Before touching the app, write down the answers honestly:

- [ ] **P0** Can I explain, in one sentence and without jargon, what this product does?
- [ ] **P0** Can I explain what happens if the parcel is lost?
- [ ] **P0** Would I hand my own documents to this traveller?
- [ ] **P0** Is there anything on the landing page I do not actually believe?
- [ ] **P0** Are there any numbers on any screen that we invented? (If yes, remove them)

If any of these fail, stop. Fix the product story before testing the buttons.

---

## 2. Device and environment matrix

| Device | Required | Done |
|---|---|---|
| Android mid-range (≤ 4 GB RAM), Android 11+ | P0 | ☐ |
| Android low-end (2 GB), Android 9/10 | P0 | ☐ |
| iPhone (any, for receiver web page only) | P0 | ☐ |
| Desktop Chrome (sender web) | P0 | ☐ |
| Desktop Chrome at 320 px width | P1 | ☐ |
| Feature phone / SMS-only receiver | P0 | ☐ |

Record: device model, OS version, network type, and build hash.

---

## 3. Landing and public pages

- [ ] **P0** The page states what we carry and what we refuse in the first viewport
- [ ] **P0** The price strip shows a real server-fetched range, or is absent — never a hardcoded number
- [ ] **P0** "Not insured" is visible without scrolling on the safety page
- [ ] **P0** Prohibited items page lists specific items, not "certain items"
- [ ] **P1** No stock photo of a courier who does not exist
- [ ] **P1** No testimonial, rating, user count or press logo that we cannot substantiate
- [ ] **P1** Grievance officer name and contact are present and correct
- [ ] **P1** Terms, Privacy and Refund pages are reachable from the footer
- [ ] **P0** Every legal page carries the "requires lawyer review" state only in internal builds; the public build must not ship an unreviewed policy (see §14)

---

## 4. Sign-up and sign-in

- [ ] **P0** First-time sign-up completes in under 2 minutes on mobile data
- [ ] **P0** OTP arrives within 30 s (sandbox may be instant — note if it is)
- [ ] **P0** Wrong OTP shows a clear message with attempts remaining
- [ ] **P0** Resend countdown works and does not allow immediate resend
- [ ] **P1** Paste of a 6-digit code works
- [ ] **P1** Back button from OTP returns to phone entry with the number preserved
- [ ] **P1** Google sign-in works, and its failure does not block phone sign-up
- [ ] **P0** The OTP never appears on screen, in a toast, or in the notification preview

## 5. Traveller: verification

- [ ] **P0** Aadhaar is not offered, and the reason is stated
- [ ] **P0** Camera permission denial is handled with an alternative path
- [ ] **P0** A blurry photo is rejected with a specific reason, not a generic error
- [ ] **P0** Pending state shows an honest ETA and what happens next
- [ ] **P0** Rejection shows a reason category and the remaining attempt count
- [ ] **P0** A pending traveller cannot publish a trip (blocked with explanation, not a silent failure)

## 6. Sender: create a parcel

- [ ] **P0** The wizard is completable by someone who has not read the PRD
- [ ] **P0** Prohibited category is not selectable and the refusal explains why
- [ ] **P0** Weight above 5 kg is blocked with the reason ("not insured yet")
- [ ] **P0** Declared value above ₹5,000 is blocked with the reason, not a workaround
- [ ] **P0** A vague description ("gift") asks for specifics
- [ ] **P0** Draft survives an app kill and a phone call interruption
- [ ] **P0** Offline: the form still lets you fill it in and says the submit is queued
- [ ] **P1** Every field has a visible label and an example
- [ ] **P1** Hindi length does not break any field or button

## 7. Price and matching

- [ ] **P0** The breakdown shows traveller share, fee, tax and total as separate lines
- [ ] **P0** The 15-minute countdown is visible and honest
- [ ] **P0** On expiry, the amount is not silently changed — the CTA changes and re-consent is required
- [ ] **P0** When there is no match, **no price is displayed anywhere**
- [ ] **P0** No-match reasons are specific (no trip on date / no capacity / window too tight)
- [ ] **P0** No-match offers a real next step (widen window / notify me), not a dead end
- [ ] **P0** Match cards contain no phone number, no exact address, no live location, no full surname
- [ ] **P0** "Why am I seeing this?" expands and the reasons match the documented set
- [ ] **P1** Match card fits 320 px without truncating the route

## 8. Booking

- [ ] **P0** The 30-minute traveller decision clock is visible to both parties
- [ ] **P0** Accepting as the traveller moves the sender to a clear payment step
- [ ] **P0** Declining as the traveller returns the sender to matching with an explanation
- [ ] **P0** Letting the clock expire releases the capacity and tells both parties
- [ ] **P0** Two senders racing for the last slot: one succeeds, the other gets a clear alternative
- [ ] **P0** Payment failure cancels the booking and says so plainly ("nothing was charged")

## 9. Payment (sandbox)

- [ ] **P0** The "Test mode — no real money" banner is visible on every payment screen
- [ ] **P0** No card fields are rendered by us (the provider's surface handles it)
- [ ] **P0** A slow provider shows "confirming", not a spinner forever
- [ ] **P0** Unknown state shows **no retry button** and promises an SMS
- [ ] **P0** Definitive failure offers a retry that creates a *new* booking, not a duplicate charge
- [ ] **P0** No screen says "escrow", "we hold your money" or "insured"

## 10. Handover: pickup

- [ ] **P0** Sender receives a 6-digit code only when the pickup window opens
- [ ] **P0** The traveller can refuse on seal damage or weight mismatch without penalty, and the reason is recorded
- [ ] **P0** Correct code + photo moves the booking to picked up, once
- [ ] **P0** Five wrong codes lock the booking and tell the user a human will call
- [ ] **P0** Airplane mode: the traveller is told the confirmation is queued, never shown a fake success
- [ ] **P0** Reconnecting applies the queued confirmation exactly once
- [ ] **P1** The photo checklist is usable with one hand in a car

## 11. Handover: delivery

- [ ] **P0** Receiver gets an SMS with a link that works on a device with no app installed
- [ ] **P0** The receiver page is one screen, no login, no marketing
- [ ] **P0** The receiver page works at 200% zoom on a small phone
- [ ] **P0** A receiver with no smartphone can be handled by a support-assisted flow
- [ ] **P0** Delivery photo is captured and visible to the sender afterwards
- [ ] **P0** The dispute window (72 h) is stated to both parties at delivery

## 12. Dispute

- [ ] **P0** The dispute form says, before submitting, that the traveller's payment will be paused
- [ ] **P0** After submitting, both parties see the case and the frozen payout
- [ ] **P0** Evidence request from support appears as a task with a deadline
- [ ] **P0** Resolution states the outcome, the reason and the money effect
- [ ] **P0** Appeal is possible within 7 days and is not hidden
- [ ] **P0** The window closes with the exact deadline shown, not "you may no longer be eligible"

## 13. Admin console

- [ ] **P0** A `verification_reviewer` can decide a verification; a `support_agent` cannot see the ID image
- [ ] **P0** Every document view writes an audit entry with the actor
- [ ] **P0** A refund above ₹1,000 requires a second person; self-approval is refused
- [ ] **P0** Payout release is refused with an open dispute
- [ ] **P0** The audit log cannot be edited or deleted from the UI
- [ ] **P0** No screen displays a full ID number (masked to the last 4)
- [ ] **P1** The reconciliation screen shows seeded mismatches and blocks payouts
- [ ] **P1** Admin is unusable on mobile by design and says so

## 14. Legal and copy gates

These are **release blockers**, not documentation chores.

- [ ] **P0** Terms of Service reviewed and signed off by an Indian lawyer (or the build is internal-only)
- [ ] **P0** Privacy notice reviewed; DPDP-relevant notices present
- [ ] **P0** Refund/cancellation policy matches what the app actually does, line by line
- [ ] **P0** Grievance officer published with the statutory response window
- [ ] **P0** No copy claims insurance, guarantee, escrow, or government verification
- [ ] **P0** Payment flow is not live unless the provider has confirmed, in writing, that this fund-flow model is permitted
- [ ] **P0** Sandbox banner cannot be switched off by a configuration mistake without also switching the adapter

## 15. Language

- [ ] **P0** Every screen has a Hindi variant and it is not machine-translated nonsense
- [ ] **P1** Language switch does not lose form state
- [ ] **P1** Numbers and currency render in Indian format (`₹1,00,000`)
- [ ] **P1** Error messages exist in both languages, not English-only

## 16. Accessibility spot-check (not a full audit)

- [ ] **P0** Full sign-up → send → handover journey possible with TalkBack only
- [ ] **P0** Every status is conveyed by icon + text, not colour alone
- [ ] **P1** 200% font scale does not clip Devanagari
- [ ] **P1** Keyboard-only completion of the sender web flow
- [ ] **P1** Focus visible everywhere

## 17. Support readiness

- [ ] **P0** The support phone number on screen actually rings, during published hours
- [ ] **P0** The help page answers: what if the traveller is late, what is not insured, can I send a passport
- [ ] **P0** A stuck booking can be found in the admin console by booking ID within 60 s
- [ ] **P0** The escalation path for a lost parcel is written down and someone owns it
- [ ] **P0** Someone is on call for the first 14 days after launch — by name

## 18. Trust and honesty audit (the section people skip)

Read every screen again and answer:

- [ ] **P0** Is there any claim we cannot evidence today?
- [ ] **P0** Is there any number on screen we did not measure?
- [ ] **P0** Is there any place where the UI implies live tracking?
- [ ] **P0** Is there any place where the UI implies insurance?
- [ ] **P0** Does any error message blame the user?
- [ ] **P0** Does any screen try to stop the user from cancelling?
- [ ] **P0** Does the sandbox state look unmistakably like a test?

---

## 19. Sign-off

```
Build / commit:                 ______________________
Environment:                    ______________________
Executed by:                    ______________________
Dates:                          ______________________

P0 boxes ticked:                ____ / ____
P0 boxes not ticked (must be 0):____

P1 boxes ticked:                ____ / ____
P1 accepted-with-owner items:   ______________________

Open S1 defects:                ____ (must be 0)
Open S2 defects:                ____ (must be 0)

Residual risks accepted:
  1. ______________________________  Owner: __________
  2. ______________________________  Owner: __________

Verdict:  GO / NO-GO

Signature:                      ______________________
```

**Rule:** "GO with one P0 unticked" is not a verdict that exists in this document. Either the box is
ticked or the release does not happen. If the box genuinely does not apply, remove it from the
checklist in the same commit that ships the release, with a written reason.
