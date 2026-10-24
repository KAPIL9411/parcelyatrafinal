# Transport Mode Feasibility

**Status:** Research draft — **NOT LEGAL ADVICE** · **Date:** 2026-10-24
**Rule:** no mode launches until its status is `PERMITTED` or `APPROVED-IN-WRITING`. `UNCERTAIN` = do not launch.

---

## 1. Decision summary

| Mode | Provisional status | Launch at pilot? | Why |
|---|---|---|---|
| **Car** (private, self/family-driven) | `UNCERTAIN → likely workable with counsel confirmation` | Conditional — GATE-2 | Private vehicle, no separate commercial permit evidenced; passenger-carriage vs. goods-carriage distinction unresolved |
| **Bike** | `UNCERTAIN` | **No** | Cargo carriage, insurance, and rider classification unclear; no observed precedent |
| **Bus** | `UNCERTAIN → likely RESTRICTED` | **No** | Operator rules + operator-run parcel business; passenger ticket does not grant commercial carriage rights |
| **Train** | `UNCERTAIN → likely RESTRICTED` | **No** | Railways run their own parcel/luggage regime; commercial carriage by passengers is a different matter |
| **Air** | `OUT OF SCOPE` | **No** | Airline baggage rules, security screening, customs for international |

> **Central caution:** a passenger ticket is a contract for *carriage of a person and their personal
> baggage*. It is **not** evidence of a right to carry a third party's goods for payment. We do not assume
> otherwise for any mode.

## 2. Mode analysis template (applied below)

For each mode we assess: (a) vehicle/operator rules, (b) permit/commercial-use implications,
(c) baggage/cargo rules, (d) insurance, (e) prohibited-item screening, (f) conclusion.

### 2.1 Car

| Question | Finding | Level |
|---|---|---|
| Is a private car permitted to carry goods for another person? | Generally, carrying a passenger's own goods is ordinary use. Carrying goods for **hire or reward** may bring the vehicle into a commercial/goods-carriage frame. | L5 — counsel |
| Does a private (white-board) car need a transport/goods permit? | Unverified. Goods-carriage permits are a recognised category; whether a one-off ₹300 parcel triggers it is unresolved. | L5 |
| Does insurance cover goods carried for reward? | Private-car policies commonly exclude use for hire/reward; **must be checked with insurer in writing**. | L5 |
| Is the traveller a "carrier" for liability purposes? | Depends on regularity, control and payment. | L3 |
| Practical police risk | A traveller with a sealed parcel and a digital receipt is in a stronger position than an informal courier, but this is **not** legal protection. | L4 |

**Provisional position:** car is the only plausible pilot mode, **conditional on**:
1. Counsel memo confirming one-off peer carriage on a private trip is not goods-carriage-for-hire.
2. Written insurer position on goods in the vehicle.
3. Documentation carried by the traveller (digital booking record, sender declaration, item list).
4. Volume caps to avoid looking like a commercial courier operation (e.g. ≤ 4 parcels/month/traveller).

### 2.2 Bike

Additional issues beyond car: cargo securement, maximum load, rider licensing class, pillion/cargo
insurance, weather exposure, theft risk. **No observed precedent for inter-city bike parcel carriage.**
Status: `UNCERTAIN`, feature flag off.

### 2.3 Bus

| Question | Finding | Level |
|---|---|---|
| Do bus operators permit a passenger to carry a third party's parcel for payment? | Almost certainly governed by operator conditions; many operators run their **own** parcel booking counters, creating a direct commercial conflict. | L5 |
| Does the passenger ticket cover commercial goods? | No basis to assume so. | L5 |
| Would this require an operator agreement? | Likely yes, for any systematic use. | L5 |
| Safety/security screening | Bus operators may screen baggage; unaccompanied parcels are especially sensitive. | L4 |

**Provisional position:** `RESTRICTED`. Do not launch. If pursued later, requires a **written agreement
with each operator** plus a legal review of permit implications for the operator and for us.

### 2.4 Train

| Question | Finding | Level |
|---|---|---|
| Do Indian Railways rules permit passengers to carry commercial parcels? | Railways operate a separate parcel/luggage regime with booking and charges; passenger luggage allowances are for personal baggage. | L5 |
| Is there a licensing/booking requirement? | Likely, via railway parcel offices. | L5 |
| Would a platform intermediating this need Railway Board clarity? | Likely. | L5 |

**Provisional position:** `RESTRICTED`. Do not launch. Any future train product should be built **with**
the railway's parcel system, not around it.

### 2.5 Air

Out of scope. Air introduces: airline cabin/checked baggage rules, security screening of goods, potential
dangerous-goods regime, and customs for international. Note: Kootr publicly operates an air-traveller
model (E-05) — **we have not verified their legal basis and must not treat their existence as approval.**

## 3. Cross-mode controls (apply even to car)

| Control | Requirement |
|---|---|
| Item screening | Closed category list + description + photo + human review for restricted items |
| Declaration | Sender affirms contents and legality; stored with timestamp |
| Volume cap | Per-traveller monthly parcel cap to avoid commercial-carrier appearance |
| Documentation | Traveller can show booking record + item declaration on request |
| Insurance disclosure | Explicit "uninsured unless stated" disclosure |
| Refusal right | Traveller may refuse at handover without penalty |
| Prohibited items | `legal/PROHIBITED_RESTRICTED_GOODS.md` |

## 4. Questions that must be answered in writing before launch

| # | Question | Who must answer |
|---|---|---|
| T-1 | Does one-off peer parcel carriage for reward on a private car trip require a goods-carriage permit in UP/Delhi? | Transport counsel |
| T-2 | Does the traveller's private-car policy respond to goods carried for reward? | Insurer (written) |
| T-3 | Does Parcel Yatra become a "transport aggregator" or similar under any state/central rule? | Counsel |
| T-4 | Is there any restriction on the *platform* facilitating such carriage (as opposed to the driver)? | Counsel |
| T-5 | What documentation should a traveller carry to demonstrate lawful carriage? | Counsel |
| T-6 | Are there state-specific rules in UP (e.g. passenger/goods carriage by private vehicle)? | Counsel |

## 5. Recommendation

**Pilot only car mode, only after GATE-2 is cleared, with volume caps and explicit uninsured
disclosure.** If GATE-2 cannot be cleared, the correct decision is to **not launch** rather than to
launch and hope — because the entire supply side would be operating in legal uncertainty.
