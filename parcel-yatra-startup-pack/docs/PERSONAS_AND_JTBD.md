# Personas & Jobs To Be Done

**Status:** Draft — these are **research hypotheses**, not validated segments.
Evidence level: HYPOTHESIS unless marked otherwise. Validation plan: `research/MARKET_VALIDATION.md`.

---

## How to read this document

We have not yet interviewed users. Everything below is a *research instrument*: a set of sharp
guesses designed to be falsified cheaply in the first 3 weeks. Each persona states the assumption
being tested and the signal that would kill it.

---

## P1 — Rohit, 34, small trader (sender, business)

**Context:** Runs a 2-person shop in Bareilly selling machine parts / samples to buyers in Delhi.
Sends 2–6 small parcels a month. Currently uses a private bus parcel service or a national courier.

**Current behaviour (HYPOTHESIS):**
- Uses a bus parcel counter near the roadways bus stand because "it reaches Delhi same night".
- Has no receipt beyond a handwritten slip; no tracking.
- Lost one parcel; got no compensation; now insures nothing and simply accepts risk.

**JTBD:** *When a buyer needs a part urgently, I want it to reach Delhi today without me losing a
day of shop time, so I don't lose the order.*

**Pains:** no proof of handover, no accountability, unpredictable timing, must physically go to the
bus stand during shop hours.

**Gains sought:** someone comes to the shop; a receipt that means something; "it reached" notification.

**Willingness to pay (HYPOTHESIS H-WTP-01):** ₹250–₹450 for Bareilly→Delhi, 5 kg, same-day/next-morning.
Would pay a premium of ~20–30% over bus parcel for tracking + accountability.

**Kill signal:** if >70% of interviewed traders say price is the only factor and they will not pay any
premium for proof/accountability, the differentiation thesis for business senders is wrong.

---

## P2 — Anita, 41, parent / individual sender

**Context:** Needs to send documents (marksheets, property papers, medical reports) to a relative or
office in Delhi/Lucknow once every few months.

**JTBD:** *When a document must reach a specific person and cannot be emailed, I want certainty that
it arrived and who received it, without trusting a stranger blindly.*

**Emotional driver:** fear of loss is far stronger than price sensitivity. Documents are often
irreplaceable in practice (re-issuance takes weeks).

**Key objection (HYPOTHESIS):** "How do I know the traveller won't open it?"

**Design implication:** tamper-evident packaging guidance, sealed-photo evidence, OTP handover,
name of receiver shown to sender, no cash handling.

**Kill signal:** if senders refuse to hand over documents to a non-uniformed stranger even with
verification badges, documents may need a different trust mechanic (e.g. verified-agent drop points).

---

## P3 — Imran, 27, car traveller (traveller, primary supply)

**Context:** Drives Bareilly→Delhi 2–4 times a month for work/family, usually alone or with one
passenger. Boot is empty.

**Motivation:** offset fuel (₹1,200–₹1,800 one way, HYPOTHESIS). Not trying to become a courier.

**JTBD:** *When I'm already driving to Delhi, I want to cover part of my fuel cost without detours,
waiting, or risk, so the trip costs me less.*

**Rejection triggers (to test):**
- Any detour > 15 minutes.
- Waiting at pickup > 10 minutes.
- Uncertainty about what is inside.
- Fear of being stopped by police with a parcel that looks commercial.
- Fear of liability if something breaks.
- Awkward social interaction with an unknown receiver.

**Critical insight:** the traveller is the *scarcer* side and the one with more rejection triggers.
Every added verification step is a supply tax. Onboarding friction must be paid back immediately with
visible earnings.

**Kill signal:** if median accepted compensation is below ~₹150 on the Bareilly→Delhi corridor, the
traveller side is not economically motivated and needs a different model (e.g. scheduled professional
carriers, which changes the legal classification entirely).

---

## P4 — Sunita, 38, bus traveller (traveller, gated mode)

**Context:** Travels Bareilly→Delhi by UPSRTC/private bus monthly.

**Status: NOT LAUNCHABLE until `legal/TRANSPORT_MODE_FEASIBILITY.md` resolves carrier permission.**
A passenger ticket does not establish a right to carry commercial parcels, and bus operators have
their own parcel booking businesses that would compete with us. Persona retained for research only.

---

## P5 — Vikas, 30, train traveller (traveller, gated mode)

**Context:** Regular on the Bareilly–Delhi route by train.

**Status: NOT LAUNCHABLE.** Indian Railways has its own luggage/parcel rules and booking systems;
commercial carriage by passengers is restricted. Research only until written clarity exists.

---

## P6 — Meera, 29, receiver

**Context:** Receives the parcel in Delhi; may not be the person who paid.

**JTBD:** *When a parcel is coming to me, I want to know roughly when and from whom, and be able to
prove I received it, without downloading yet another app.*

**Design implication:** receiver should not be forced to install the app; SMS OTP + a web handover
page is the pilot approach. Receiver phone number is PII and must be masked in traveller-facing UI
until booking is confirmed.

---

## P7 — Operations agent "Kavita"

**Context:** Handles 40–80 bookings/day at pilot, plus verification queue and disputes.

**JTBD:** *When something goes wrong, I want the full history in one screen and a safe action, so I
can resolve it without guessing or escalating unnecessarily.*

**Design implication:** admin console is a first-class product, not an afterthought. Every privileged
action needs a reason code and an audit entry.

---

## Cross-persona trust model

| Trust barrier | Who feels it | Mitigation (product) | Mitigation (ops) | Evidence needed |
|---|---|---|---|---|
| Stranger touching my parcel | Sender | Sealed photo, OTP, ratings, verification badge | Manual review of first bookings | Interview |
| Unknown contents | Traveller | Mandatory category + description + photo, right to refuse at handover | Prohibited-goods training | Interview |
| Being robbed / scammed | Both | In-app comms, no cash, verified identities, report button | 24×7 escalation number | Interview |
| Police/legal trouble carrying goods | Traveller | Narrow eligible list, declaration record | Documented SOP + legal note | Legal review |
| Money not paid | Traveller | Provider-held payment before pickup | Payout SLA monitoring | Provider confirmation |

---

## Personas we deliberately exclude at pilot

- **Large e-commerce sellers** — need bulk APIs, pickup SLAs and volume pricing; would distort the
  pilot and invite comparison with Shiprocket-style aggregators.
- **High-value / luxury senders** — insurance and liability are unresolved.
- **International senders** — customs and air-mode regulation out of scope.

Excluding them is a scope decision, recorded in `docs/MVP_SCOPE_AND_NON_GOALS.md`.
