# Dependencies and Blockers

**Status:** Draft v0.1 · **Date:** 2026-10-24
Separates what we control from what we do not. Most startup plans fail because they treat a legal
dependency as a task.

---

## 1. Blocker classification

| Class | Meaning | Who can clear it |
|---|---|---|
| **B-LEGAL** | Needs a lawyer or regulator | External counsel |
| **B-PROV** | Needs a provider's written confirmation | Payment provider, insurer, SMS provider |
| **B-TECH** | We can clear it with engineering | Team |
| **B-OPS** | Needs a process and a person | Founder |
| **B-MARKET** | Needs evidence from the real world | Pilot users |
| **B-UNKNOWN** | We do not know yet whether it is a blocker | Research |

A B-LEGAL or B-PROV item cannot be closed by working harder. It can only be closed by someone else
saying yes — or by designing around it.

---

## 2. Critical path (the honest one)

```
GATE-4 transport position ─────┐
                               ├──> can we operate at all?
GATE-2 terms/privacy review ───┤
                               ├──> can we invite the public?
GATE-6 grievance officer ──────┘

GATE-3 payment model ──────────────> can we ever take money?
GATE-5 insurance ──────────────────> can we ever claim safety?
```

**Engineering is not on the critical path after Phase 3.** The gates are. Plan accordingly.

---

## 3. Legal blockers

### B-LEGAL-01 — Is carrying a stranger's parcel in a private car lawful without a transport licence?

| | |
|---|---|
| Class | B-LEGAL |
| Impact | Blocks Phase 2 entirely |
| Why it is unclear | Motor Vehicles law and state carriage rules were written around commercial goods transport, not peer-to-peer incidental carriage. Whether a platform that *matches* such carriage becomes a "transport operator" is a legal question, not an engineering one |
| What we need | A written note from Indian counsel: under what conditions is this lawful, and what must the platform not do |
| Our working assumption (**unverified**) | A traveller carrying a small personal parcel on a journey they were already making, for cost-sharing, is different from operating a goods transport business. **This assumption drives the entire product and is not yet confirmed** |
| Owner | Founder + counsel |
| Fallback if the answer is no | Model changes to a licensed-transport partnership, or the business does not proceed as designed |
| Status | **OPEN — highest priority** |

> This is the single most important open question in the pack. `legal/TRANSPORT_MODE_FEASIBILITY.md`
> addresses it in detail and reaches the same conclusion: interpretation needed, counsel required.

### B-LEGAL-02 — Terms, privacy notice, refund policy review

| | |
|---|---|
| Class | B-LEGAL |
| Impact | Blocks any public launch (L2+) |
| Drafts exist | `legal/TERMS_OF_SERVICE_DRAFT.md`, `legal/PRIVACY_NOTICE_DRAFT.md`, `legal/REFUND_CANCELLATION_POLICY_DRAFT.md` |
| What we need | Counsel review with tracked changes, plus a DPDP-specific read |
| Cost/time (est.) | Unknown; typically weeks, not days |
| Status | **OPEN** |

### B-LEGAL-03 — DPDP obligations and their dates

| | |
|---|---|
| Class | B-LEGAL |
| Impact | Affects data architecture and retention |
| What we know | Obligations are phased; a secondary source suggests substantive duties commence 13 May 2027. **This date is from a secondary source and must be verified with counsel** |
| What we need | A dated obligations matrix from counsel |
| Our position | Build to DPDP now (consent records, deletion path, breach process) rather than wait |
| Status | **OPEN — but not blocking Phase 1** |

### B-LEGAL-04 — GST treatment of the platform fee and traveller payment

| | |
|---|---|
| Class | B-LEGAL (with a CA) |
| Impact | Pricing, invoicing, and the fund-flow model |
| Why it matters | Whether we are a marketplace facilitator, an agent, or a principal changes invoicing, TCS/TDS and the payment model |
| What we need | CA opinion with a worked example for one ₹900 booking |
| Status | **OPEN** |

### B-LEGAL-05 — Grievance officer obligations

| | |
|---|---|
| Class | B-LEGAL / B-OPS |
| Impact | Blocks public launch |
| What we need | Appoint a named person, publish contact, define the response window per applicable rules |
| Status | **OPEN — cheap to close, so close it early** |

---

## 4. Provider blockers

### B-PROV-01 — Payment provider confirmation of the fund-flow model

| | |
|---|---|
| Class | B-PROV (plus B-LEGAL) |
| Impact | Blocks all real money |
| The question | Can we (a) collect from the sender, (b) hold the amount with the provider until delivery, (c) pay the traveller — without being a payment aggregator ourselves? |
| Models considered | A: direct split at capture · B: provider-held escrow · C: sequential transfer. See `legal/PAYMENTS_TAX_AND_SETTLEMENT.md` |
| What we need | Written confirmation naming the specific model, from the provider's compliance team — not a sales email |
| Typical timeline | Weeks to months |
| Status | **OPEN — start before Phase 3, not during it** |

> **Do not** build the production payment integration before this is in writing. It is the most
> common way this class of product ends up with a compliance problem and a refund obligation.

### B-PROV-02 — Insurance for peer-carried goods

| | |
|---|---|
| Class | B-PROV |
| Impact | Blocks any safety claim, and probably blocks L3 |
| The problem | Insuring goods carried by an unlicensed individual in a private car is an unusual risk. It may not be available at a price that works, or at all |
| What we need | Either a policy, or a permanent, unambiguous "not insured" position in all copy |
| Our position | Ship with explicit "not insured" copy and a low declared-value cap. That is honest and it is what the drafts do |
| Status | **OPEN — may never close, and the product must work without it** |

### B-PROV-03 — SMS/DLT registration for transactional messages

| | |
|---|---|
| Class | B-PROV / B-LEGAL |
| Impact | Blocks OTP delivery at any real volume |
| What we need | Registered entity, approved templates (OTP, booking updates), DLT compliance |
| Note | OTP templates are regulated; you cannot send arbitrary text |
| Status | **OPEN — needed before Phase 2** |

### B-PROV-04 — Push notification and email deliverability

| | |
|---|---|
| Class | B-PROV |
| Impact | Degrades experience; not blocking |
| Status | Low priority |

### B-PROV-05 — Identity verification provider (if used instead of manual review)

| | |
|---|---|
| Class | B-PROV |
| Impact | Scales verification beyond manual review |
| Our position | Manual at pilot; provider later |
| Status | Deferred |

---

## 5. Technical blockers

| ID | Blocker | Impact | Plan |
|---|---|---|---|
| B-TECH-01 | PostGIS not needed yet; distance is approximated by area/city pairs | Match quality is coarse | ADR-004 defers it; revisit when a third corridor opens |
| B-TECH-02 | No job queue product; Postgres-backed queue chosen | Simpler, adequate at pilot | Revisit above ~10k jobs/day |
| B-TECH-03 | No separate read replica | Read latency at peak | Not needed at pilot scale |
| B-TECH-04 | Mobile app distribution | Android only; sideload or Play Store | Play Store review adds days; plan for it |
| B-TECH-05 | Screenshot blocking on Android | OTP screen exposure | `FLAG_SECURE`; verify on device |
| B-TECH-06 | Offline queue correctness | Duplicate handover confirmation | Idempotency keys persisted locally; `TC-OFF-02` |
| B-TECH-07 | Devanagari rendering on low-end devices | Text clipping | Line-height ≥ 1.6, device matrix testing |

None of these is a hard blocker. They are design constraints already reflected in the architecture
documents.

---

## 6. Operational blockers

| ID | Blocker | Impact | Plan |
|---|---|---|---|
| B-OPS-01 | Who answers the phone? | The product's main trust mechanism is a human | Founder for the first 14 days, by name |
| B-OPS-02 | Verification review capacity | Travellers cannot start | Manual review is fine at < 20/day; falls over above |
| B-OPS-03 | Dispute adjudication | Money frozen with no resolver | Written playbook + one trained person before launch |
| B-OPS-04 | Physical handover failures | The product's core promise | Scripted drill + escalation path |
| B-OPS-05 | Reconciliation discipline | Silent money drift | Daily job + a named owner, not "whoever remembers" |
| B-OPS-06 | Corridor supply | No travellers = no product | Recruit 10–15 travellers before inviting a single sender |

**B-OPS-06 is the commercial blocker people ignore.** A marketplace launched with demand and no supply
produces the worst possible first impression. Seed supply first.

---

## 7. Market dependencies (things only the pilot can answer)

| ID | Question | Why it matters | How we will know |
|---|---|---|---|
| B-MARKET-01 | Will people trust a stranger with documents? | The entire premise | Observed conversion from landing to booking |
| B-MARKET-02 | Will travellers actually carry parcels for money? | Supply side | Number of trips published vs. accepted requests |
| B-MARKET-03 | What price is acceptable? | Unit economics | Actual booking completion at the hypothesised price |
| B-MARKET-04 | What is the real match rate? | Liquidity | Matches per parcel posted |
| B-MARKET-05 | What is the real failure rate? | Safety and support load | Incidents per 100 bookings |
| B-MARKET-06 | Do users come back? | Whether this is a business | 30-day repeat booking rate |

**None of these can be answered by research.** `research/MARKET_VALIDATION.md` is explicit that no
demand evidence has been gathered.

---

## 8. Unknowns we have not resolved

| ID | Unknown | Why it is unresolved |
|---|---|---|
| B-UNK-01 | Whether any licence is required for matching | Legal question |
| B-UNK-02 | Whether a payment provider will accept the model | Provider decision |
| B-UNK-03 | Whether insurance is obtainable | Market question |
| B-UNK-04 | Real market size in Bareilly | No primary research done |
| B-UNK-05 | Whether Kootr or similar players are viable or defunct | Only public pages observed; no financial data |
| B-UNK-06 | The regulatory treatment of "cost sharing" vs. "fare" | Legal question |
| B-UNK-07 | Whether travellers will pass a background check at acceptable cost | Operational question |

---

## 9. Dependency summary: what blocks what

| To reach | Must first close |
|---|---|
| Phase 1 (core loop) | Nothing external — this is ours to do |
| Phase 2 (closed pilot) | B-LEGAL-01 (at least an interim position), B-PROV-03, B-OPS-06 |
| Phase 3 (hardening) | Phase 2 complete, B-LEGAL-05 |
| L2 (open pilot) | B-LEGAL-02, B-LEGAL-05, external pentest |
| L3 (real money) | B-PROV-01, B-LEGAL-04, B-LEGAL-02, B-PROV-02 (or permanent exclusion) |

---

## 10. The uncomfortable summary

Three things are true at once:

1. **The engineering is tractable.** A small team can build this in a few months. That is the easy part.
2. **The legal position is the actual risk.** B-LEGAL-01 and B-PROV-01 determine whether this is a
   business or an expensive prototype.
3. **No demand evidence exists yet.** Everything in `research/` is competitor observation and market
   context, not proof that anyone in Bareilly wants this.

The correct sequence is therefore: **close B-LEGAL-01 first, seed supply second, build third.** The
documents in this pack are ordered to support that, not to flatter a build-first plan.
