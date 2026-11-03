# Claims and Limitations

**Status:** Draft v0.1 · **Date:** 2026-10-24

A register of every substantive claim this pack makes, with its evidence level. The purpose is to make
it impossible to read the pack and come away believing something we did not verify.

---

## 1. Evidence labels used throughout the pack

| Label | Meaning | Example |
|---|---|---|
| **OBSERVED** | Directly seen by us, with a recorded source and timestamp | "porter.in lists a 20 kg limit for two-wheelers" |
| **PUBLISHED** | Stated by an identifiable third party we did not verify ourselves | "Kootr's site claims India-wide coverage" |
| **INFERRED** | Our reasoning from observations; could be wrong | "Porter's prohibited list suggests they avoid high-liability items" |
| **HYPOTHESIS** | A planning assumption with no evidence yet; must be tested | "300 bookings per day at peak" |
| **UNKNOWN** | We do not know, and we are not guessing | "Whether any licence is required" |

**Rule:** a number without a label is a bug. If a reader cannot tell how we know something, we have
failed.

---

## 2. What was actually observed (research)

| Claim | Label | Evidence |
|---|---|---|
| Porter offers on-demand intra-city delivery with 2W (≤ 20 kg) and trucks (≤ 2500 kg) | OBSERVED | `research/REA_METHOD_AND_EVIDENCE.md` E-03, `ev_e2468012…` |
| Porter also lists Packers & Movers, Enterprise and API surfaces | OBSERVED | same capture |
| Porter lists 22 cities | OBSERVED | same capture |
| Porter's prohibited list includes passports, currency, jewellery, electronics and "sensitive documents" | OBSERVED | same capture |
| Kootr describes air-traveller parcel carrying with "PIN-verified handover" and "Travel & Earn" | OBSERVED | E-04, `ev_a3a145da…` |
| Kootr claims India-wide coverage | PUBLISHED (their claim, not verified) | same capture |
| Kootr is an Indore-based OPC | PUBLISHED | same capture |
| Porter's prohibited list is Porter's policy, not Indian law | INFERRED | Reasoning; legal list is in `legal/PROHIBITED_RESTRICTED_GOODS.md` |
| Kootr's existence proves demand for this model | **NOT CLAIMED** | Existence proves intent, not demand, safety or profitability |

### What was not obtained

| Item | Why | Consequence |
|---|---|---|
| Porter's pricing | Dynamic, requires an address flow we did not run | No price comparison is made anywhere in the pack |
| Porter's volume or revenue | Not public | No market-share claims |
| Kootr's FAQ answers | Client-rendered; not extracted | Kootr's operational detail is thin |
| Kootr's financials or current status | Not public | Cannot say whether they are operating viably |
| Any Indian legal text on transport of goods by private car | Not fetched (RBI/MeitY pages returned 403 or wrong content) | All legal positions are marked as needing counsel |
| RBI Payment Aggregator direction text | Page returned the master-directions index, not the direction | Payment model is explicitly unresolved |

---

## 3. Claims about the market

| Claim | Label | Status |
|---|---|---|
| Bareilly ⇄ Delhi NCR is a plausible pilot corridor | HYPOTHESIS | Based on general knowledge of travel patterns; **no primary research done** |
| People currently ask relatives or bus conductors to carry documents | HYPOTHESIS | Common anecdote; not measured |
| Willingness to pay ~₹900 for a document parcel | HYPOTHESIS | `docs/PRICING_AND_UNIT_ECONOMICS.md`; all figures labelled |
| Match rate ≥ 50% | HYPOTHESIS | Pilot target, not a forecast |
| 25% repeat rate within 30 days | HYPOTHESIS | Pilot target |
| There is a large addressable market | **NOT CLAIMED** | No TAM/SAM/SOM numbers appear anywhere in this pack |
| Competitors are vulnerable | **NOT CLAIMED** | We have no evidence about their health |

**Explicit statement:** no market sizing, no user counts, no growth rates and no revenue projections
appear in this pack. If a reader needs those numbers, they must be gathered, not invented. See
`research/MARKET_VALIDATION.md` §5 for what would need to be measured.

---

## 4. Claims about the product

| Claim | Label | Note |
|---|---|---|
| The booking state machine prevents double-booking | HYPOTHESIS until implemented and tested | Design is sound; `TC-CRIT-01` exists but has not been run against code, because no code exists |
| OTP handover prevents handover to the wrong person | HYPOTHESIS | Depends on correct implementation; the design assumption is that the sender gives the code only after receiving the parcel |
| The system will be usable by a first-time smartphone user | HYPOTHESIS | No usability testing has been done. `testing/UAT_CHECKLIST.md` exists to test it |
| Hindi + English parity is achievable | HYPOTHESIS | Depends on native-speaker review; machine translation is explicitly rejected |
| WCAG 2.2 AA is achievable | HYPOTHESIS | No audit has been performed |
| The pilot can run with 2–4 people | HYPOTHESIS | `roadmap/SPRINT_BACKLOG.md` §13 gives estimates, not commitments |

## 5. Claims about security

| Claim | Label | Note |
|---|---|---|
| Threat model covers the main risks | INFERRED | Self-authored STRIDE pass; **no external review** |
| Each security test case would catch its threat | HYPOTHESIS | Untested, because no system exists |
| The system will not be independently penetrated before pilot | **FACT** | External pentest is a pre-scale gate, not a pilot gate. This is a real, accepted gap |
| No security guarantee of any kind is offered | **FACT** | The pack explicitly does not claim security certification, compliance or audit |

## 6. Claims about legality and compliance

This is the section where overclaiming is most dangerous.

| Claim | Label | Status |
|---|---|---|
| Carrying a stranger's parcel in a private car is lawful | **UNKNOWN** | B-LEGAL-01. Requires Indian counsel. **This is the single largest open question in the pack** |
| No transport licence is needed | **NOT CLAIMED** | Deliberately not asserted |
| The payment fund-flow model is permitted | **UNKNOWN** | B-PROV-01. Requires written provider confirmation |
| Parcel Yatra is a "marketplace" not a "transport operator" | **UNKNOWN** | Legal characterisation, not ours to make |
| DPDP obligations commence 13 May 2027 | PUBLISHED, **unverified** | Secondary source only; must be confirmed with counsel |
| The legal drafts are legally sufficient | **NO** | `legal/TERMS_OF_SERVICE_DRAFT.md`, `legal/PRIVACY_NOTICE_DRAFT.md` and `legal/REFUND_CANCELLATION_POLICY_DRAFT.md` are drafts **requiring review by a qualified Indian lawyer** |
| Parcel Yatra is compliant with any law | **NOT CLAIMED** | Never asserted anywhere in the pack |
| GST treatment is known | **UNKNOWN** | B-LEGAL-04 |
| Insurance is available for this activity | **UNKNOWN** | B-PROV-02; may never be available |

### The three sentences that must never be written about this pack

1. "Parcel Yatra is compliant with Indian law." — No. Nothing has been verified.
2. "The legal documents are ready." — No. They are drafts requiring a lawyer.
3. "Payments are ready to go live." — No. GATE-3 is open and it is not ours to close.

## 7. Claims about the API contract

| Claim | Label | Evidence |
|---|---|---|
| `api/openapi.yaml` is syntactically valid OpenAPI 3.1.0 | **OBSERVED** | `npx @redocly/cli@latest lint` → "Your API description is valid", 1 warning. Full result in `validation/VALIDATION_REPORT.md` |
| The spec contains no duplicate YAML keys | **OBSERVED** | The same validator was proven to reject duplicate keys using a control file (`validation/VALIDATION_REPORT.md` §3) |
| The spec has 42 operations | OBSERVED | Counted from the file |
| The error catalogue covers every code the spec can return | **INFERRED, not machine-checked** | The linter does not cross-check error codes. This is a manual review item, flagged in `api/ERROR_CATALOG.md` §14 |
| The spec is a good API design | **OPINION** | Reviewable, not verified |

## 8. Claims about this documentation pack itself

| Claim | Label | Note |
|---|---|---|
| The pack is complete per the requested file list | OBSERVED | Verified by directory listing; exact count in `validation/VALIDATION_REPORT.md` |
| The ZIP archive matches the source directory | OBSERVED | Verified by hash comparison after extraction (`validation/VALIDATION_REPORT.md` §5) |
| No file in the pack is copied from a competitor | **BELIEVED TRUE** | All prose is original; competitor observations are paraphrased facts, not copied text or assets |
| Every file has been proofread | **NO** | Written in one pass by one author. Expect errors of grammar and internal inconsistency |
| Internal cross-references are all correct | **NOT VERIFIED** | Cross-file links were written by hand and not machine-checked. Broken references are possible |
| The pack is ready to hand to a lawyer, an investor or an engineer | **PARTIALLY** | Useful as a starting brief; not a deliverable to sign without review |

---

## 9. Limitations of the research method

1. **Only two competitors were examined**, and only their public marketing pages.
2. **Only one research tool was usable** (`websearch` returned no results for every query).
3. **Several government sources were inaccessible** (HTTP 403 from MeitY; an RBI page returned the
   wrong content). No legal conclusion rests on a source we could not read.
4. **No primary research** — no user interviews, no surveys, no pilot data.
5. **No financial data** on any competitor.
6. **The observation window is a single day** (2026-10-24). Prices and offerings change.

Full detail: `research/SOURCE_REGISTER.md` and `research/REA_METHOD_AND_EVIDENCE.md`.

## 10. Limitations of the engineering plan

| Limitation | Consequence |
|---|---|
| No code exists | Every architectural claim is a design intention, not a measurement |
| No load test has been run | All performance numbers are targets |
| No security test has been run | All controls are specified, not verified |
| No restore drill has been performed | RTO/RPO are aspirations |
| Effort estimates are judgement | ±50% is realistic; the plan says so |
| PostGIS deferred | Match quality is coarse; acceptable for two corridors |
| Single region | No meaningful disaster recovery at pilot |

## 11. What this pack is good for

Honestly:

| Use | Suitability |
|---|---|
| Briefing a lawyer on what we intend to build | Good — the questions are specific |
| Briefing an engineer who will build it | Good — the contract and state machine are concrete |
| Deciding whether to fund this | Partial — it maps the risk clearly, but contains no market evidence |
| Starting a pilot tomorrow | **No** — nothing is built, and GATE-4 is open |
| Demonstrating compliance to a regulator | **No** — dangerously unsuitable |
| Raising money on the strength of the market opportunity | **No** — no market data exists |

## 12. The summary paragraph

> This pack is a serious, evidence-labeled design for a product that does not yet exist, in a legal
> position that has not yet been confirmed, for a market that has not yet been measured. Its most
> valuable contents are the open questions, the gates, and the places where it says "we do not know".
> Read it as a map of the risk, not as proof that the route is safe.
