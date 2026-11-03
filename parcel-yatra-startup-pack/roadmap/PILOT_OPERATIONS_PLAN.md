# Pilot Operations Plan

**Status:** Draft v0.1 · **Date:** 2026-10-24
**Pilot:** Bareilly ⇄ Delhi NCR, Bareilly ⇄ Lucknow. Documents + goods ≤ 5 kg / ≤ ₹5,000.
**Money:** sandbox only. **Users:** 20–30 senders, 10–15 travellers, invited.

---

## 1. What the pilot is actually testing

Ranked by importance. If the pilot answers only the first three, it succeeded.

| # | Question | Measurement |
|---|---|---|
| 1 | Will a stranger hand over a sealed parcel to a verified traveller? | Share of posted parcels that reach `confirmed` |
| 2 | Can the handover be completed reliably in the real world? | Successful handovers / attempted handovers |
| 3 | Will travellers carry parcels repeatedly? | Trips published per traveller per month |
| 4 | What breaks, and how loudly? | Support contacts per 100 bookings, by category |
| 5 | Is the price acceptable? | Conversion at the hypothesised price |
| 6 | Would they use it again? | 30-day repeat rate |

**What the pilot cannot test:** unit economics at scale, payment legality, insurance viability, market
size. Those need gates and time, not users.

---

## 2. Corridors and scope

| Corridor | Distance (approx.) | Typical drive | Why |
|---|---|---|---|
| Bareilly → Delhi NCR | ~250–280 km | 5–6 h | High daily traffic of people who know someone in both places |
| Bareilly → Lucknow | ~250 km | 4–5 h | Same-day return possible; easier recovery if something goes wrong |
| Reverse directions | same | same | Symmetric; supply usually exists both ways |

Constraints:

- **Car only.** No bike, bus, train, air — legally and operationally out of scope.
- **≤ 5 kg, ≤ 45 cm longest side, declared value ≤ ₹5,000.**
- **Documents and low-value goods** from the approved category list.
- **No cash, jewellery, medicines, electronics, passports.** Enforced server-side.
- **No same-day delivery promise.** Windows only.

---

## 3. Recruitment: supply first

The single most common pilot failure is inviting senders before travellers exist.

### 3.1 Travellers (do this first — 2 weeks before launch)

| Channel | Approach |
|---|---|
| Personal network | People who commute Bareilly⇄Delhi/Lucknow regularly |
| Local colleges | Students travelling home on weekends |
| Small business owners | Already moving samples to Delhi |
| Referral | Existing travellers refer one person; no cash incentive at pilot |

Target: **10–15 verified travellers, each with ≥ 2 trips planned in the pilot window.**

Screening:

- [ ] ID verified through the manual queue (not selfie-only)
- [ ] Phone conversation before approval — 5 minutes, talk about what they will and will not carry
- [ ] Explicit acknowledgement of the prohibited list
- [ ] Bank account in their own name (for the future payout path; not used at pilot)

**Do not** onboard a traveller you would not let carry your own documents. That is the actual bar.

### 3.2 Senders (after supply exists)

| Channel | Approach |
|---|---|
| Personal network | Direct conversations, not broadcast messages |
| Local print/stationery shops near courts and colleges | Where document-sending actually happens |
| WhatsApp community groups | Only where permitted and relevant |
| Referral from travellers | A traveller's own contacts are the warmest lead |

Target: **20–30 senders, each with a real parcel to send within 2 weeks.** A sender with no parcel is a
survey respondent, not a pilot user.

---

## 4. The first 10 parcels: high-touch by design

For the first 10 bookings, a team member is present (physically or on call) at both ends.

| Step | Team action |
|---|---|
| Before posting | Walk the sender through the app in person, silently note where they hesitate |
| Before pickup | Confirm the traveller knows the pickup area and the OTP rule |
| At pickup | Be reachable by phone; do not intervene unless asked |
| In transit | One check-in message at the midpoint; do not chase |
| At delivery | Confirm the receiver got the OTP; confirm the photo was taken |
| After delivery | 5-minute call: what was confusing, what was frightening, what was missing |

Notes from these sessions go into a single file and drive the next sprint. This is more valuable than
any analytics at this stage.

---

## 5. Support model at pilot

| Channel | Hours | Response target |
|---|---|---|
| Phone | 08:00–21:00 IST | Answer within 3 rings |
| In-app message | 08:00–21:00 | 30 minutes |
| Email | Anytime | 4 business hours |
| Emergency (lost parcel / safety) | 24×7 during pilot | 15 minutes, by named person |

One person owns support each day. The rota is published a week ahead. **The founder is on the rota** —
not as an escalation, as a shift.

### Support scripts required before launch

- [ ] "The traveller is late"
- [ ] "The traveller isn't responding"
- [ ] "The parcel hasn't arrived"
- [ ] "The parcel arrived damaged"
- [ ] "I want to cancel"
- [ ] "Can I send my passport / medicine / phone?" → no, with the reason
- [ ] "The OTP isn't working"
- [ ] "How do I know the traveller is verified?"

Each script: what to say, what not to promise, what to record, when to escalate.

---

## 6. Incident handling at pilot

| Incident | Severity | First action | Owner |
|---|---|---|---|
| Parcel not delivered within 12 h of the window | High | Call both parties, freeze payout if any | Duty support |
| Parcel reported lost | Critical | Open case, call sender within 1 h, freeze everything | Founder |
| Parcel reported damaged | High | Photos, freeze payout, dispute workflow | Support |
| Prohibited item discovered | Critical | Stop the delivery, involve local police per counsel advice, preserve evidence | Founder + counsel |
| Traveller unresponsive > 6 h in transit | High | Call, then emergency contact, then police per counsel | Founder |
| Safety threat to a traveller | Critical | Immediate call, police if warranted, suspend the account | Founder |
| Data breach suspected | Critical | `security/INCIDENT_RESPONSE_PLAN.md` | Eng + founder |

**Rule:** any incident involving a prohibited item or a personal safety threat stops the pilot until
reviewed. Do not "keep going and see".

### Lost-parcel drill (before the first real parcel)

Tabletop, 60 minutes, written outcome:

1. Who calls whom, in what order?
2. What do we tell the sender in the first hour?
3. What is our actual compensation policy when there is no insurance?
4. What evidence do we already have (photos, OTP log, timeline)?
5. What would we do differently in the product after this?

If the honest answer to (3) is "we don't know", the pilot is not ready.

---

## 7. Metrics to watch (weekly, with a human reading them)

| Metric | Definition | Pilot target |
|---|---|---|
| Posted → confirmed | Parcels that get a traveller | ≥ 50% (HYPOTHESIS) |
| Confirmed → picked up | Handovers that happen | ≥ 90% |
| Picked up → delivered | Successful completion | ≥ 95% |
| Time to match | Posted to first booking request | < 24 h median |
| Support contacts per 100 bookings | Volume | < 25 |
| Incidents per 100 bookings | Lost/damaged/safety | 0 target; anything else is investigated |
| Repeat booking within 30 days | Loyalty | ≥ 25% (HYPOTHESIS) |
| Traveller trips published | Supply health | ≥ 2 per traveller per month |

All targets are **hypotheses**. They exist so that a number is wrong loudly rather than quietly.

---

## 8. Weekly operating rhythm

| Day | Activity |
|---|---|
| Monday | Review last week's bookings, incidents, support categories |
| Tuesday | Call 3 senders and 2 travellers (not a survey — a conversation) |
| Wednesday | Fix the one thing that caused the most support contacts |
| Thursday | Recruit (supply first) |
| Friday | Ship, if there is something to ship; otherwise do not deploy before the weekend |
| Sunday evening | Rota for next week; check every open case has an owner |

**No deploys on Friday evening or Saturday.** Pilot users need a working product on the weekend, which
is when most travel happens.

---

## 9. Pilot exit criteria

The pilot ends — successfully or not — when one of these is true:

| Outcome | Condition | Next step |
|---|---|---|
| **Continue** | 20+ deliveries, 0 unresolved safety incidents, ≥ 25% repeat intent, support load manageable | Phase 3 hardening |
| **Iterate** | Deliveries happen but conversion is poor or support load is high | One more pilot cycle with the specific fix |
| **Stop** | Any serious safety incident, or < 20% posted→confirmed after 6 weeks | Redesign or wind down |

Committing to an end date *and* an end condition prevents the pilot from drifting into an unexamined
habit.

---

## 10. What we will tell pilot users, explicitly

Not buried in terms — said at onboarding:

1. This is a pilot. Things will go wrong.
2. Your parcel is **not insured**.
3. We do not track the traveller's live location.
4. The traveller is a verified private individual, not our employee.
5. If something goes wrong, call this number, and a person will answer.
6. We may ask you questions afterwards; you can decline.

Saying this costs some conversions and buys the only thing that matters at this stage: users who
trust us because we told them the truth.

---

## 11. Roles at pilot (2–4 people)

| Role | Responsibilities |
|---|---|
| Founder | Support shift, recruitment, incident owner, go/no-go |
| Engineer 1 | Backend, payment sandbox, reconciliation |
| Engineer 2 | Mobile + web, accessibility |
| Ops (part-time) | Verification queue, support backup, reconciliation check |

Everyone does support. Nobody is "too senior" to answer the phone during a pilot — the phone calls are
the product research.

---

## 12. Cost discipline

| Item | Approach |
|---|---|
| SMS | Sandbox numbers where possible; real numbers only for actual users |
| Hosting | Two small instances; tear down load-test environments |
| Verification | Manual (free) over a paid provider |
| Support | Founder time (the most expensive item, and the most valuable) |
| Marketing | Zero paid spend at pilot. If it needs ads to get 20 users, the proposition is unproven |

Total pilot cash cost should be small enough that failure is survivable. That is a design goal, not an
afterthought.
