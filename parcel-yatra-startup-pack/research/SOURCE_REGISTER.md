# Source Register

**Status:** Draft v0.1 · **Research date:** 2026-10-24 · **Rule:** a source is only listed if it was actually accessed, or is
explicitly marked as *to verify*.

---

## 1. Sources actually accessed in this pass

| ID | Source | URL | Publisher | Date on source | Accessed | Supports |
|---|---|---|---|---|---|---|
| S-01 | Porter homepage | https://porter.in/ | Porter | n/a (live) | 2026-10-24 09:44Z | Service lines, capacity limits, cities, prohibited list, scale claims (E-02..E-04, E-07, E-08) |
| S-02 | Kootr homepage | https://www.kootr.com/ | Kootr Ventures (OPC) Pvt Ltd | © 2026 | 2026-10-24 09:47Z | Model, air-traveller positioning, PIN handover, entity details (E-05) |
| S-03 | Kootr FAQ index | https://www.kootr.com/faq | Kootr Ventures | © 2026 | 2026-10-24 09:52Z | FAQ categories exist; answers client-rendered (E-06) |
| S-04 | DPDP Act 2023 article (secondary) | https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Act,_2023 | Wikipedia contributors | rev. 2026 | 2026-10-24 | Commencement dates, citation of Gazette G.S.R. 843(E) (E-09) |
| S-05 | DPDP Rules 2025 article (secondary) | https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025 | Wikipedia contributors | rev. 2026-10-24 | 2026-10-24 | Rules notified 14 Nov 2025; PIB reference (E-10) |
| S-06 | RBI Master Directions index | https://rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12162 | RBI | updated Oct 2026 | 2026-10-24 | Confirms RBI site reachable; **did not yield the PA direction text** |

**Secondary-source caution:** S-04 and S-05 are encyclopaedic summaries that cite official gazette/PIB
documents. They are acceptable for *planning awareness* but **not** for a legal conclusion. The
underlying primary documents are listed in §3 and must be read by counsel.

## 2. Primary sources identified but NOT successfully opened

| ID | Source | URL | Blocker | Needed for |
|---|---|---|---|---|
| P-01 | DPDP Act 2023 gazette | https://egazette.gov.in/WriteReadData/2023/248045.pdf | Not attempted (PDF) | Exact statutory text |
| P-02 | DPDP commencement notification G.S.R. 843(E) | https://egazette.gov.in/WriteReadData/2025/267647.pdf | Not attempted (PDF) | Confirming 13 May 2027 date |
| P-03 | DPDP Rules 2025 text | https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf | meity.gov.in returned **403** to automated fetch | Consent/notice/breach details |
| P-04 | PIB release on DPDP Rules | https://www.pib.gov.in/PressReleseDetailm.aspx?PRID=2190014 | Not attempted | Official summary |
| P-05 | Consumer Protection (E-Commerce) Rules 2020 | consumeraffairs.nic.in | Not attempted | E-commerce obligations |
| P-06 | Motor Vehicles Act 1988 / CMVR | morth.nic.in, indiacode.nic.in | Not attempted | Permits, carriage rules |
| P-07 | MoRTH aggregator guidelines | morth.nic.in | Not attempted | Whether aggregator rules apply |
| P-08 | Indian Railways Act 1989 + parcel/luggage rules | indianrailways.gov.in | Not attempted | Train mode feasibility |
| P-09 | RBI Master Direction – Payment Aggregators | rbi.org.in | Fetched index page only | Fund-hold/settlement legality |
| P-10 | GST rate schedules | cbic.gov.in | Not attempted | Tax treatment |

## 3. Tool limitations encountered (recorded honestly)

| Limitation | Impact | Mitigation |
|---|---|---|
| `websearch` returned "No search results" for every query, including simple ones | Could not discover current versions of rules or news | Relied on direct URL fetches + labelled knowledge as requiring verification |
| `meity.gov.in` returned HTTP 403 | Could not read DPDP Rules text directly | Used secondary summary citing official PDFs; flagged for counsel |
| `egazette.gov.in` PDFs not fetched | Commencement date not read from primary text | Flagged as `PUBLISHED (secondary)` in E-09 |
| No authenticated access to competitor apps | Pricing, KYC, claims flows unknown | Marked `UNKNOWN`; feature matrix left blank rather than guessed |
| Kootr FAQ answers client-rendered | Their operational detail unknown | Marked `UNKNOWN` |
| No mobile APK inspection performed | Mobile UX unverified | Deliberate ethical/legal choice |

## 4. Sources to add before external publication

1. Primary text of DPDP Act + Rules + commencement notification.
2. Consumer Protection (E-Commerce) Rules 2020 current text.
3. MoRTH position on peer parcel carriage by private vehicles.
4. Indian Railways parcel/luggage rules.
5. RBI PA/PG Master Direction (fund-hold and settlement clauses).
6. CBIC GST classification for marketplace facilitation vs. transport of goods.
7. Insurer policy wording for goods in transit/peer custody.
8. Measured bus-parcel prices (primary field data).
9. At least one international crowdshipping case study with verifiable outcomes.

## 5. Citation policy for this pack

- Every legal claim is tagged with a verification level (see `legal/LEGAL_REGULATORY_MATRIX.md` §1).
- No quote is attributed to a source that was not read.
- Where a claim is widely known but unverified here, it is written as "requires verification" rather
  than asserted.
- Competitor numbers are always attributed as *their published claim*.
