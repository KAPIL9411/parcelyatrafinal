# Privacy & Data Protection

**Status:** Research + design draft — **NOT LEGAL ADVICE** · **Date:** 2026-10-24

---

## 1. Summary of what we verified, and what we did not

| Item | Finding | Verification |
|---|---|---|
| Primary statute | Digital Personal Data Protection Act, 2023 (Act No. 22 of 2023) | Known; text not opened |
| Commencement | Phased: **13 Nov 2025** (Board and certain provisions), **13 Nov 2026** (s.6(9), s.27(1)(d)), **13 May 2027** (remaining provisions) | **Secondary source citing Gazette G.S.R. 843(E); primary PDF not opened** |
| Subordinate rules | DPDP Rules, 2025 notified **14 Nov 2025** (per secondary source citing PIB) | Secondary; `meity.gov.in` returned HTTP 403 |
| Interim regime | IT Act 2000 + SPDI Rules 2011 likely continue to apply until DPDP is fully operational | **Not verified** |

**Consequence for planning (L4, business judgement):** A pilot starting before 13 May 2027 is not yet
subject to the full DPDP obligation set, but building to DPDP standards now avoids a costly rewrite and
is the right thing to do. **Do not describe Parcel Yatra as "DPDP compliant" today** — the compliance
date has not arrived and no audit has occurred.

## 2. Roles

| Party | Role under DPDP (provisional) | Notes |
|---|---|---|
| Parcel Yatra | Data Fiduciary for account, verification, booking and payment data | Determines purpose and means |
| Traveller | Data Fiduciary for the receiver's contact details they receive | Must be contractually constrained |
| Payment provider | Data Processor / separate fiduciary for payment data | Governed by their terms |
| SMS/email/push providers | Data Processors | Contracts required |
| KYC vendor | Data Processor (possibly fiduciary) | Contracts required |
| Cloud/object storage | Data Processor | India region |

**L3:** the traveller-as-fiduciary point needs counsel — it materially affects our ToS and our
obligation to obtain receiver consent.

## 3. Data inventory

| Data | Purpose | Lawful basis (provisional) | Sensitivity | Retention |
|---|---|---|---|---|
| Phone number | Auth, coordination, OTP | Consent / contract necessity | High | Account life + 90 d |
| Name | Identity, trust | Consent | Medium | Account life |
| Email (optional) | Receipts | Consent | Medium | Account life |
| Google account ID | Login | Consent | Medium | Account life |
| Device/IP | Security, fraud | Legitimate use / security | Medium | 90 d |
| Government ID image | Traveller KYC | Consent + legal obligation | **Very high** | 90 d after decision, then delete |
| Selfie/liveness | KYC match | Consent | **Very high** | 90 d after decision |
| Pickup/drop area | Matching | Contract | High | 180 d, then city-only |
| Exact handover address | Fulfilment | Contract | High | 30 d after delivery |
| Receiver name + phone | Delivery | **Consent of receiver required** | High | 30 d after delivery, masked thereafter |
| Parcel description/photo | Safety, evidence | Contract + safety | Medium | 180 d |
| Declared value | Pricing, risk | Contract | Medium | 180 d |
| OTP (hashed) | Handover | Security | High | Deleted on use/expiry |
| Booking/event history | Service, disputes | Contract | Medium | 3 years (limitation) |
| Messages | Coordination, safety | Contract | High | 180 d |
| Payment refs | Money movement | Legal obligation | High | 8 years (tax/audit) — **verify** |
| Payout account | Settlement | Contract + KYC | **Very high** | Account life + statutory |
| Ratings | Trust | Consent | Medium | 3 years |
| Audit logs | Security, accountability | Legal obligation | High | 1 year minimum |

## 4. Data minimisation decisions

1. **No Aadhaar** by default (decision D-008). Use alternative government ID + vendor verification.
2. **No continuous location tracking** (D-007). Status events, not GPS trails.
3. **No document upload of the parcel's contents** (e.g. we do not store a scan of the property papers).
4. **Receiver phone masked** in traveller UI until booking confirmed, and never returned by search.
5. **Free-text fields discouraged** for anything that could capture sensitive data.
6. **No analytics on ID documents**, ever.
7. **No advertising identifiers** used for profiling.

## 5. Notice & consent requirements (design, DPDP-aligned)

The privacy notice must, in **clear plain language (English + Hindi)**:

- state the purposes of processing, itemised;
- list the categories of data;
- state retention periods (or the basis for determining them);
- explain how to withdraw consent;
- explain how to exercise access, correction, erasure and grievance rights;
- name the grievance/contact point;
- be presented **before or at** collection, separately from the Terms.

Consent must be:
- **free, specific, informed, unconditional, unambiguous**, with clear affirmative action;
- **granular** — marketing consent separate from service consent;
- **withdrawable** as easily as given;
- **recorded** — we store `consent_id`, `user_id`, `purpose`, `policy_version`, `timestamp`, `method`,
  `ip`, `user_agent`.

`security/DATA_RETENTION_MATRIX.md` defines the retention schedule operationally.

## 6. Identity verification without Aadhaar

| Option | Status | Notes |
|---|---|---|
| Passport | **Not accepted as parcel content**, but usable as ID? | Passport as *ID document* for KYC is different from carrying one as cargo. Counsel to confirm. |
| Driving licence | Candidate | Widely held, photo, address |
| Voter ID (EPIC) | Candidate | Widely held in Tier-2 |
| PAN | Weak photo ID | Not sufficient alone |
| Aadhaar | **Avoid by default** | Requires authorised channel; storing copies is high risk |
| Vendor-verified digital KYC | Candidate | Must be an authorised entity; contract required |

**Acceptance rule:** at least one government photo ID + selfie liveness + phone ownership + payout name
match. Reviewer must not record ID numbers in free-text fields.

## 7. Data subject rights (design)

| Right | Implementation | SLA |
|---|---|---|
| Access | In-app "Download my data" → JSON/PDF | 30 days (target 7) |
| Correction | Profile edit + support for verified fields | 7 days |
| Erasure | Account deletion → soft delete → hard delete per matrix | 30 days |
| Withdraw consent | In-app toggle; effect explained | Immediate for future processing |
| Grievance | In-app + email + phone | Ack ≤ 48 h |
| Nomination (DPDP) | In-app nominee field | Before launch |

**Deletion vs. legal retention:** we cannot delete payment/tax records on request; the notice must say
so, and deletion must be *partial* with a clear explanation — not silently incomplete.

## 8. Security measures mapped to law

| Requirement | Implementation |
|---|---|
| Reasonable security safeguards | TLS 1.2+, encryption at rest, RBAC, MFA for admin, audit logs |
| Breach notification | Documented process + templates (`security/INCIDENT_RESPONSE_PLAN.md`) |
| Processor contracts | DPA with every vendor |
| Access control | Least privilege; ID docs restricted to reviewer role; access logged |
| Accuracy | User-editable profile; verification re-check |

## 9. Children's data

- Service restricted to **18+**.
- Age declaration at signup; accounts flagged as minor are blocked and deleted.
- No behavioural monitoring or targeted advertising to minors (aligned with DPDP restrictions).
- **L3:** whether we must implement verifiable parental consent if we ever allow 16–18 year olds.

## 10. Vendor & processor obligations

Every processor contract must cover: purpose limitation, confidentiality, security measures, breach
notification to us within 24 h, sub-processor approval, deletion on termination, audit rights, and
India data-residency where required.

## 11. Breach response (summary)

1. Detect and contain (see incident plan).
2. Assess: personal data? how many principals? sensitivity?
3. Notify the Data Protection Board and affected principals within the timelines prescribed by the
   Rules — **timelines to be confirmed from the Rules text** (L5).
4. Record in breach register; notify processors/customers as required.
5. Post-incident review within 7 days.

## 12. Open legal questions

1. Exact breach-notification timeline and format under the Rules.
2. Whether the traveller is a data fiduciary for receiver contact data.
3. Whether we must appoint a DPO and/or a India-based grievance officer.
4. Whether SPDI Rules still apply to us after 13 May 2027.
5. Lawful basis for processing receiver data without their prior consent (we currently plan a
   just-in-time SMS notice).
6. Cross-border transfer restrictions applicable to our vendors (support tooling, error tracking).
