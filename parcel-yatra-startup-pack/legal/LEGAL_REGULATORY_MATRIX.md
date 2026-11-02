# Legal & Regulatory Matrix

**Status:** Research draft for qualified Indian counsel — **NOT LEGAL ADVICE**
**Research date:** 2026-10-24 · **Jurisdiction:** India (Union) with Uttar Pradesh/Delhi operational notes

---

## 0. How to read this document

This matrix is a **map of issues and of what still needs verification**, not an opinion. Each row has a
verification level:

| Level | Meaning |
|---|---|
| **L1** | Verified requirement — primary/authoritative source read and applied |
| **L2** | Regulator or provider guidance — published, applicable, but needs applicability analysis |
| **L3** | Legal interpretation — reasoned, **requires counsel** |
| **L4** | Business risk recommendation — our judgement, not law |
| **L5** | Unresolved — requires written confirmation from counsel/regulator/operator/provider |

**Important honesty note:** in this research pass, tool limitations (search unavailable, `meity.gov.in`
returned HTTP 403) prevented reading several primary texts. Only the DPDP commencement *timing* was
obtained (from a secondary source citing the gazette). **Most rows below are therefore L3/L5, not L1.**
Where a claim is widely known but unverified here, it is marked explicitly.

---

## 1. Business & contractual model

| # | Issue | Applicable instrument | Status | Analysis | Level | Open question |
|---|---|---|---|---|---|---|
| B-1 | Marketplace vs. courier classification | Indian Contract Act, 1872; Consumer Protection Act, 2019 | Framework known; application **not verified** | Marketplace framing (facilitation) vs. carrier (bailee) depends on actual control: who sets price, who selects traveller, who takes custody. Our design lets travellers set/accept price and takes no custody — but the platform *does* select and sequence handover. | L3 | Does marketplace framing survive if we provide OTP custody proof and dispute adjudication? |
| B-2 | Who is the contracting party for carriage? | Contract Act | Structure proposed | Sender contracts with traveller for carriage; Parcel Yatra contracts separately for facilitation. Must be explicit in ToS and in the booking confirmation. | L3 | Enforceable? Get counsel sign-off on wording. |
| B-3 | Consumer protection — unfair terms, deficiency | Consumer Protection Act, 2019 | **Requires verification** of current text | Limitation-of-liability clauses are commonly challenged as unfair. Blanket "no liability" is likely unenforceable against consumers. | L3 | What liability cap is defensible? |
| B-4 | E-commerce obligations (grievance officer, disclosure, response times) | Consumer Protection (E-Commerce) Rules, 2020 (widely reported; **not re-read this pass**) | L5 | Commonly reported obligations include displaying entity details, appointing a grievance officer, acknowledging complaints within 48 h and resolving within one month. **Verify exact text before relying on it.** | L5 | Exact obligations + whether we are an "e-commerce entity" or "marketplace e-commerce entity". |
| B-5 | Grievance redressal mechanism | CPA 2019 + e-commerce rules | Required in substance | We will implement acknowledgement ≤ 48 h, resolution target ≤ 30 days regardless of final legal position. | L4 | Officer name/contact publication requirements. |
| B-6 | Entity structure | Companies Act, 2013 | Not researched | OPC vs. Pvt Ltd affects funding, liability and compliance load. | L5 | Counsel/CA recommendation. |
| B-7 | Local operating requirements (UP/Delhi) | State shop & establishment, local licences | Not researched | May apply to any physical drop point or office. | L5 | Whether a Bareilly office/drop point triggers registrations. |

## 2. Transport mode feasibility (summary)

**Full analysis:** `legal/TRANSPORT_MODE_FEASIBILITY.md`. Headline: **only car (and possibly bike) is
plausibly launchable**, and even that is unconfirmed.

| Mode | Provisional status | Level |
|---|---|---|
| Car (private, self-driven) | Plausible; **requires counsel confirmation** re: permits/commercial use | L5 |
| Bike | Same as car + insurance/pillion/cargo questions | L5 |
| Bus | **Do not launch** — operator rules + possible permit issues | L5 |
| Train | **Do not launch** — railway parcel/luggage rules | L5 |
| Air | Out of scope at pilot | L5 |

## 3. Parcel contents & liability

| # | Issue | Instrument | Status | Level |
|---|---|---|---|---|
| C-1 | Prohibited/restricted goods definition | Multiple statutes (NDPS Act, Arms Act, Explosives Act, IPC/BNS, Customs Act, etc.) | **Not researched in detail** — our list is risk-based, not a legal schedule | L5 |
| C-2 | Dangerous goods / lithium batteries | Applicable transport rules vary by mode | Not verified | L5 |
| C-3 | Medicines / controlled substances | Drugs & Cosmetics Act, NDPS | **Excluded from service** | L4 |
| C-4 | Cash, jewellery, high-value | RBI/AML considerations; theft risk | **Excluded by value cap ₹5,000** | L4 |
| C-5 | Identity/ownership verification of contents | No specific instrument verified | We rely on declaration + human review | L4 |
| C-6 | Loss/damage liability allocation | Contract Act; consumer law | Must be explicit; default "no liability" is risky | L3 |
| C-7 | Insurance availability for peer-carried goods | Insurance contract law | **UNKNOWN — broker quotes required** | L5 |
| C-8 | Evidence preservation for claims | Evidence Act / BSA 2023 (electronic records) | Photographs + timestamps + audit logs are our evidence base | L3 |

## 4. Data protection & privacy

| # | Issue | Instrument | Status | Level |
|---|---|---|---|---|
| D-1 | Applicable data law | Digital Personal Data Protection Act, 2023 (Act No. 22 of 2023) | **In force, phased** | L2 |
| D-2 | Commencement timing | Gazette G.S.R. 843(E) dated 13 Nov 2025 (via secondary source) | Provisions: **13 Nov 2025** (Board etc.), **13 Nov 2026** (s.6(9), s.27(1)(d)), **13 May 2027** (remaining) | L2 — **primary gazette not opened; verify** |
| D-3 | Subordinate rules | DPDP Rules, 2025 (notified 14 Nov 2025 per secondary source) | Consent/notice/breach detail still to be read | L2 |
| D-4 | Interim regime | IT Act, 2000 + SPDI Rules 2011 (widely reported as continuing until DPDP fully operational) | Not verified | L5 |
| D-5 | Intermediary obligations | IT Act s.79 + IT Rules 2021 (safe harbour, due diligence, grievance) | Not verified whether we qualify as intermediary | L5 |
| D-6 | Children's data | DPDP Act provisions on minors | We will require 18+ and block known-minor accounts | L3 |
| D-7 | Cross-border transfer | DPDP — permitted subject to government-specified restrictions | India-region hosting chosen | L3 |
| D-8 | Breach notification | DPDP + Rules timelines | Process designed; exact timelines to confirm | L5 |

**Practical consequence:** because substantive DPDP obligations commence **13 May 2027**, a pilot
starting before then should still be built to DPDP standards (consent, notice, minimisation, deletion)
to avoid a rewrite — but the *legal deadline* is not today. This is a planning conclusion (L4), not
legal advice.

## 5. Payments, settlement & tax

| # | Issue | Instrument | Status | Level |
|---|---|---|---|---|
| E-1 | Who may hold customer funds | Payment and Settlement Systems Act, 2007; RBI directions | Marketplace holding funds is **not** assumed lawful | L5 |
| E-2 | Payment aggregator framework | RBI PA/PG directions (index page reached; text not read) | Provider must be authorised; we must fit their permitted model | L5 |
| E-3 | Delayed/split settlement to travellers | Provider product terms | **UNKNOWN — written provider confirmation required** | L5 |
| E-4 | Escrow / nodal account | RBI directions | We will **not** operate one | L4 |
| E-5 | Wallet / stored value | PPI rules | **Excluded from scope** | L4 |
| E-6 | KYC of travellers for payout | Provider KYC policy + PMLA | Must match provider requirements | L5 |
| E-7 | GST treatment | CGST/IGST Acts, rate schedules | Marketplace facilitation vs. goods transport service — **unresolved** | L5 |
| E-8 | TDS/TCS on payouts | Income Tax Act | Not researched | L5 |
| E-9 | Invoicing | GST law | Who invoices whom is unresolved | L5 |
| E-10 | Chargebacks | Card network rules | Process designed; liability unclear | L5 |

## 6. Employment / worker classification

| # | Issue | Status | Level |
|---|---|---|---|
| F-1 | Is a traveller a worker/employee? | Our framing: independent user, no minimum hours, no exclusivity, no direction of work. **Not legally confirmed.** | L3 |
| F-2 | Platform-worker rules (state-level, e.g. Rajasthan/others reported) | Not researched; no known UP/Delhi equivalent verified | L5 |
| F-3 | Social security contributions | Not applicable if genuine independent contractor — needs confirmation | L5 |

## 7. Safety, police and incident obligations

| # | Issue | Status | Level |
|---|---|---|---|
| G-1 | Duty to report prohibited/illegal goods | Depends on item and statute | L5 |
| G-2 | Responding to police requests for data | Need a documented law-enforcement request process | L4 |
| G-3 | Emergency response for in-transit incidents | Operational SOP written (`docs/OPERATIONS_AND_SUPPORT.md`) | L4 |
| G-4 | Firearms/explosives/NDPS discovered | Immediate police contact + account suspension | L4 |

## 8. Launch gates derived from this matrix

A production launch (even a paid pilot) requires **all** of:

1. **GATE-1** Counsel memo on marketplace classification + ToS liability position (B-1, B-2, C-6).
2. **GATE-2** Written confirmation that car-based peer carriage does not require a transport permit
   (mode analysis).
3. **GATE-3** Payment provider written confirmation of permitted fund flow (E-1..E-3).
4. **GATE-4** GST/tax opinion on invoicing and TDS (E-7..E-9).
5. **GATE-5** Insurance position: either confirmed cover or explicit, prominent "uninsured" disclosure.
6. **GATE-6** DPDP-aligned notice, consent records and deletion process in place (D-1..D-8).
7. **GATE-7** Grievance officer appointed and published (B-4, B-5).

Until then: **sandbox payments only, no real money, no claims of insurance, no bus/train/air modes.**

## 9. What this document is not

It is not a legal opinion, not a compliance certificate, and not a substitute for review by a qualified
Indian lawyer. It is a structured brief that makes counsel's work faster and makes our assumptions
visible.
