# Open Questions

**Status:** Living document · **Last updated:** 2026-10-24
Rule: an open question that blocks a launch gate must appear in `roadmap/DEPENDENCIES_AND_BLOCKERS.md`.

---

## 1. Legal & regulatory

| ID | Question | Why it blocks | Owner | Status |
|---|---|---|---|---|
| Q-L1 | Does carrying a parcel for compensation on a private car trip make the traveller a commercial carrier or require a transport permit? | Determines whether car mode is legal at all | Counsel | OPEN |
| Q-L2 | Is the traveller an independent contractor, a marketplace user, or a worker? | Affects liability, tax, insurance | Counsel | OPEN |
| Q-L3 | Are bus operators' rules compatible with third-party parcel carriage by their passengers? | Bus mode launch | Operator + counsel | OPEN |
| Q-L4 | What do Indian Railways rules say about commercial carriage by passengers? | Train mode launch | Counsel | OPEN |
| Q-L5 | Is a marketplace-only model sufficient to avoid being classified as a courier/logistics operator? | Liability regime | Counsel | OPEN |
| Q-L6 | What exactly must the privacy notice contain, and in which languages? | DPDP compliance at 13 May 2027 | Counsel | OPEN |
| Q-L7 | Do we need to appoint a Data Protection Officer / grievance officer? | DPDP + consumer rules | Counsel | OPEN |
| Q-L8 | Is sharing receiver phone numbers with travellers lawful and on what basis? | Core flow | Counsel | OPEN |
| Q-L9 | Consent age: do we permit 18+ only? What if a 16-year-old sends a parcel? | DPDP children's data | Counsel + product | OPEN |
| Q-L10 | Is Aadhaar-based verification permissible for us, and via which authorised channel? | Verification design | Counsel | OPEN — assume **no** until proven |

## 2. Payments, tax, insurance

| ID | Question | Blocker? | Status |
|---|---|---|---|
| Q-P1 | Which licensed payment provider will onboard a marketplace where the payout is to a private traveller? | Yes | OPEN |
| Q-P2 | Can the provider hold funds until delivery confirmation, and how is that product named in their contract? | Yes | OPEN |
| Q-P3 | What is the correct GST treatment: marketplace facilitation fee vs. transport service? | Yes (before real money) | OPEN |
| Q-P4 | TDS/TCS obligations on traveller payouts? | Yes | OPEN |
| Q-P5 | What invoice must be issued, by whom, to whom? | Yes | OPEN |
| Q-P6 | Does any insurer cover goods in the custody of a peer traveller? What are the exclusions? | Yes | OPEN |
| Q-P7 | Who bears liability if the parcel is lost — platform, traveller, or nobody? | Yes | OPEN |
| Q-P8 | Chargeback liability when a sender disputes a card payment after delivery | No | OPEN |

## 3. Product & market

| ID | Question | Method to resolve | Status |
|---|---|---|---|
| Q-M1 | Do travellers actually accept a stranger's parcel for ₹150–₹400? | 20 interviews + pilot | OPEN |
| Q-M2 | What do bus parcel counters charge Bareilly→Delhi today? | In-person price survey | OPEN |
| Q-M3 | Is the traveller-price or platform-quote model better? | Concierge test of both | OPEN |
| Q-M4 | Do senders prefer phone call or app chat for coordination? | Interviews | OPEN |
| Q-M5 | Is receiver OTP workable for non-smartphone receivers? | Pilot | OPEN |
| Q-M6 | Minimum corridor density for a 60% match rate | Pilot measurement | OPEN |
| Q-M7 | Do business senders need GST invoices to use us? | Interviews | OPEN |
| Q-M8 | What is the acceptable maximum delay before senders defect? | Interviews | OPEN |

## 4. Technical

| ID | Question | Impact | Status |
|---|---|---|---|
| Q-T1 | Managed identity provider vs. self-hosted auth for OTP + Google | Build effort, security | OPEN |
| Q-T2 | Which map/geocoding provider balances cost and India accuracy? | Cost, privacy | OPEN |
| Q-T3 | Do we need PostGIS at all for city-level matching? | Simplicity | OPEN — likely **no** at pilot |
| Q-T4 | SMS DLT registration timeline | Blocks OTP | OPEN |
| Q-T5 | Hosting region and data-residency confirmation | DPDP + cost | OPEN |
| Q-T6 | Offline behaviour on 2G for handover screens | Rural usability | OPEN |

## 5. Operational

| ID | Question | Status |
|---|---|---|
| Q-O1 | Who physically handles a parcel when a traveller abandons it? | OPEN |
| Q-O2 | Is there a safe drop point in Delhi for failed deliveries? | OPEN |
| Q-O3 | What is the on-call rota for a 2-person team? | OPEN |
| Q-O4 | How do we verify a receiver's identity without an account? | OPEN |

## 6. Answered questions (log)

| ID | Question | Answer | Date | Evidence |
|---|---|---|---|---|
| Q-A1 | Is Kootr a real, active product? | Yes — active site, iOS + Android listings, Indore-based OPC | 2026-10-24 | `research/REA_METHOD_AND_EVIDENCE.md` E-05 |
| Q-A2 | Does Porter operate inter-city peer carriage? | No evidence of it; positioned as on-demand intra-city goods transport with 2W/truck/packers | 2026-10-24 | `research/REA_METHOD_AND_EVIDENCE.md` E-03 |
| Q-A3 | Has DPDP Act commenced? | Partially: certain provisions from 13 Nov 2025; substantive obligations 13 May 2027 per commencement notification | 2026-10-24 | `legal/PRIVACY_DATA_PROTECTION.md` §2 |
| Q-A4 | Is REA installed and usable? | Yes — 6.7.0, 207 MCP tools, browser inspection via local CDP | 2026-10-24 | `research/REA_METHOD_AND_EVIDENCE.md` |
