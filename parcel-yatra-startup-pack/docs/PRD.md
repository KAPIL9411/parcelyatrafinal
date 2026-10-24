# Product Requirements Document (PRD) — Parcel Yatra

**Status:** Draft v0.1 for internal review · **Last updated:** 2026-10-24
**Related:** `docs/PRODUCT_VISION.md`, `docs/BOOKING_STATE_MACHINE.md`, `api/openapi.yaml`

---

## 0. Reading guide

Every requirement carries:

- **ID** — stable reference used by tests and backlog.
- **Priority** — `P0` (pilot blocker), `P1` (pilot desirable), `P2` (post-pilot).
- **Status** — Draft / Approved / Blocked.
- **Evidence tag** where a claim about users or competitors is involved.

Anything marked `BLOCKED-LEGAL` must not ship to production regardless of code completeness.

---

## 1. Scope of this release (MVP — Closed Pilot)

**In scope:** Bareilly ⇄ Delhi NCR and Bareilly ⇄ Lucknow, road modes only (car and bike self-drive
travellers), documents and low-value non-restricted goods, website (responsive) + Android app, admin
console, sandbox payments only.

**Out of scope:** real money movement, bus/train/air modes, international, same-day intra-city,
high-value electronics, medicines, cash/jewellery, business bulk API, iOS at pilot start (P1),
continuous GPS tracking, insurance claims automation.

See `docs/MVP_SCOPE_AND_NON_GOALS.md` for the full non-goal list with reasons.

---

## 2. Actors

| Actor | Description | Auth |
|---|---|---|
| Sender | Individual or business posting a parcel | Phone OTP + optional Google |
| Traveller | Person with a planned inter-city trip | Phone OTP + KYC verification |
| Receiver | Person accepting the parcel at destination | Phone OTP (no account required at pilot) |
| Support agent | Handles disputes, verification queues | Staff SSO + MFA |
| Operations admin | Full operational access, cannot alter payments | Staff SSO + MFA + RBAC |
| Finance admin | Reconciliation, refunds, payout release | Staff SSO + MFA + separate role |
| Auditor | Read-only access to audit log and evidence | Staff SSO + MFA |

---

## 3. Functional requirements

### 3.1 Identity and onboarding

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-101 | User signs up with Indian mobile number; OTP is 6 digits, expires in 5 minutes, max 5 attempts, single use, rate-limited per number/IP/device. | P0 | Draft |
| FR-102 | Optional Google sign-in; ID token is verified server-side (signature, `aud`, `iss`, `exp`, `email_verified`). Client-supplied identity claims are never trusted. | P0 | Draft |
| FR-103 | Traveller must complete KYC before accepting any parcel: government ID (type-restricted), selfie liveness check, phone ownership, and payout account name match. | P0 | Draft |
| FR-104 | Sender verification is **risk-based**: phone + name always; ID only above a declared-value threshold or on risk flags. | P0 | Draft |
| FR-105 | Aadhaar is **not** collected or stored by default. If ever required, only via an authorised provider flow and after legal sign-off. See `legal/PRIVACY_DATA_PROTECTION.md` §6. | P0 | Draft |
| FR-106 | Every user can see, correct, and request deletion of their profile data; deletion is a soft-delete + scheduled hard-delete per `security/DATA_RETENTION_MATRIX.md`. | P0 | Draft |
| FR-107 | Account can be suspended by support with a reason code; suspension blocks new bookings and payout release but preserves evidence. | P0 | Draft |

### 3.2 Parcel creation and eligibility

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-201 | Sender declares: pickup area, drop area, item category, description, declared value, weight, dimensions (L×W×H), packaging type, recipient name + phone, delivery window, special handling. | P0 | Draft |
| FR-202 | Item category is chosen from a closed list; free-text description is required and screened against a prohibited-terms list. Free text alone never authorises carriage. | P0 | Draft |
| FR-203 | The system **blocks** categories on the prohibited list and **queues for human review** categories on the restricted list (`legal/PROHIBITED_RESTRICTED_GOODS.md`). | P0 | Draft |
| FR-204 | Hard limits at pilot: weight ≤ 5 kg, longest side ≤ 45 cm, declared value ≤ ₹5,000, one parcel per booking. | P0 | Draft |
| FR-205 | Sender must upload a photo of the sealed parcel. Photo is stored privately; only the matched traveller and support can view it. | P0 | Draft |
| FR-206 | Sender must accept the declaration ("contents accurate, not prohibited, packaging adequate") with a timestamped consent record. | P0 | Draft |
| FR-207 | A parcel becomes `INELIGIBLE` if it fails screening; the sender is told which rule failed, without exposing internal risk logic. | P0 | Draft |
| FR-208 | Estimated price is shown **before** posting, with a full breakdown and a stated expiry (15 minutes). | P0 | Draft |

### 3.3 Trip creation (traveller)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-301 | Traveller publishes: origin city, destination city, travel date, departure window, arrival window, mode (car/bike), and available capacity (kg + rough size). | P0 | Draft |
| FR-302 | Traveller may publish a trip without exact home address; only city/area granularity is public. | P0 | Draft |
| FR-303 | Traveller cannot publish a trip in a mode that is disabled by a feature flag (`mode_car`, `mode_bike`, `mode_bus`, `mode_train`, `mode_air`). | P0 | Draft |
| FR-304 | Trip capacity is decremented on booking acceptance inside a transaction; it can never go negative. | P0 | Draft |
| FR-305 | Traveller declares whether they will accept only documents, or documents + sealed goods. | P1 | Draft |
| FR-306 | Trip auto-expires after its arrival window + 6 hours, releasing any held capacity. | P0 | Draft |

### 3.4 Matching, offers, booking

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-401 | Sender sees ranked candidate trips with: match score band, detour estimate, pickup/drop flexibility, traveller rating band, verification badge, and price. Exact traveller identity and live location are hidden until booking. | P0 | Draft |
| FR-402 | Ranking must be explainable: the UI can state *why* a trip is shown ("on your route, leaves after your window opens"). | P0 | Draft |
| FR-403 | Sender requests a booking; traveller has 30 minutes to accept, else the request expires and capacity is released. | P0 | Draft |
| FR-404 | Only one booking may occupy a given capacity unit; concurrent acceptance of the same trip capacity is serialised (`SELECT ... FOR UPDATE`). | P0 | Draft |
| FR-405 | Booking creation is idempotent via `Idempotency-Key`; duplicate submissions return the same booking. | P0 | Draft |
| FR-406 | Either party may cancel before handover under the rules in `docs/BUSINESS_LOGIC.md` §6, with a recorded reason code. | P0 | Draft |
| FR-407 | No client (web/mobile/admin) may set booking status directly; status changes go through server-side transition rules. | P0 | Draft |

### 3.5 Handover, delivery, proof

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-501 | Pickup is confirmed by a 6-digit OTP given by the **sender** to the traveller at handover, plus a sealed-parcel photo and optional in-app checklist. | P0 | Draft |
| FR-502 | Delivery is confirmed by a 6-digit OTP given by the **receiver** to the traveller, plus a delivery photo. | P0 | Draft |
| FR-503 | OTPs are hashed at rest, single-use, expire in 10 minutes, max 5 attempts, and are bound to booking + role (pickup/delivery). | P0 | Draft |
| FR-504 | Confirming delivery with an expired/incorrect OTP repeatedly (5x) locks the booking and raises a support task. | P0 | Draft |
| FR-505 | Receiver without a smartphone can be served by a **support-assisted handover**: agent verifies identity by callback and records the override with a reason + audit entry. | P1 | Draft |
| FR-506 | Proof artefacts (photos, timestamps, OTP attempt counts, device metadata) are retained per policy and linked to the booking as evidence. | P0 | Draft |

### 3.6 Payments (sandbox only at pilot)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-601 | Pricing is computed server-side only; the client never sends a price. | P0 | Draft |
| FR-602 | Payment intent is created through a provider adapter; the **mock adapter** is the only enabled implementation at pilot. | P0 | BLOCKED-LEGAL for production |
| FR-603 | Webhooks are signature-verified, timestamp-checked, replay-protected, and idempotent by provider event ID. | P0 | Draft |
| FR-604 | "Release to traveller after delivery confirmation" is implemented as a **provider-supported payout instruction**, not as Parcel Yatra holding funds. | P0 | BLOCKED-LEGAL |
| FR-605 | Every payment state change is written to an append-only ledger with provider reference. | P0 | Draft |
| FR-606 | Refunds follow `legal/REFUND_CANCELLATION_POLICY_DRAFT.md` and require no manual step for eligible automated cases. | P1 | Draft |

### 3.7 Support, disputes, trust

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-701 | Sender or traveller can raise a dispute up to 72 h after delivery or 7 days after expected delivery, whichever is later. | P0 | Draft |
| FR-702 | Raising a dispute **freezes payout** for that booking until resolution. | P0 | Draft |
| FR-703 | A dispute has states: OPEN → EVIDENCE_REQUESTED → UNDER_REVIEW → RESOLVED (outcome codes) → CLOSED/APPEALED. | P0 | Draft |
| FR-704 | Ratings are collected after delivery and are not editable after 7 days. Ratings are never used to hide incidents. | P1 | Draft |
| FR-705 | Blocking/reporting a user is available from booking detail and from handover screens. | P0 | Draft |
| FR-706 | Grievance acknowledgement within 48 h and resolution target of 30 days, tracked in admin. | P0 | BLOCKED-LEGAL (see `legal/GRIEVANCE_AND_INCIDENT_PROCESS.md`) |

### 3.8 Admin

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-801 | Verification queue for traveller KYC with approve/reject/request-more-info and mandatory reason. | P0 | Draft |
| FR-802 | Booking search by ID, phone (hashed lookup), route, status, date. | P0 | Draft |
| FR-803 | Evidence viewer with access logging; ID documents open only for `verification_reviewer` role. | P0 | Draft |
| FR-804 | Refund and payout-release actions require a second approver above ₹1,000 (maker-checker). | P0 | Draft |
| FR-805 | Immutable audit log of all privileged actions, exportable for a date range. | P0 | Draft |
| FR-806 | Feature flags: `mode_car`, `mode_bike`, `payments_live`, `disputes_auto_refund`, `city_bareilly`. | P0 | Draft |

---

## 4. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-101 | API p95 latency (read endpoints) | < 300 ms at 50 rps |
| NFR-102 | API p95 latency (booking writes) | < 800 ms |
| NFR-103 | Availability (pilot) | 99.5% monthly, single region |
| NFR-104 | RPO / RTO | ≤ 5 min / ≤ 2 h |
| NFR-105 | All traffic TLS 1.2+; HSTS enabled | Mandatory |
| NFR-106 | Secrets in managed secret store | Zero secrets in Git |
| NFR-107 | Accessibility | WCAG 2.2 AA for sender/traveller web + app |
| NFR-108 | Localisation | English + Hindi at pilot; number/date in `en-IN` |
| NFR-109 | Mobile low-connectivity | Core booking/handover usable on 2G; optimistic UI with retry queue |
| NFR-110 | Data residency | India region for primary DB, object storage, logs |

---

## 5. Key edge cases the product must handle explicitly

1. Parcel becomes ineligible **after** booking (e.g. value raised, prohibited item admitted).
2. Traveller cancels after pickup — parcel is in transit with a non-traveller.
3. Receiver does not show up; traveller cannot complete handover.
4. Two travellers accept the same parcel capacity simultaneously.
5. Payment provider times out — money status unknown.
6. OTP delivered to a recycled phone number.
7. Sender and traveller collude to fake a delivery.
8. Parcel weight at handover exceeds declaration.
9. Traveller's vehicle breaks down mid-route.
10. Duplicate webhook arrives twice with different payload timestamps.

Behaviour for each is specified in `docs/BUSINESS_LOGIC.md` §7 and tested in
`testing/TEST_CASES.md`.

---

## 6. Open product decisions

| # | Decision | Blocking? |
|---|---|---|
| D-01 | Does the traveller set price, or accept a platform quote? (Both in MVP adds complexity.) | Yes — affects pricing engine |
| D-02 | Is receiver required to install the app at pilot, or SMS/IVR OTP only? | No |
| D-03 | Do we charge the sender a cancellation fee if cancelled < 2 h before pickup? | No |
| D-04 | Is bike mode enabled at pilot or car-only? | Yes — insurance question |
| D-05 | Do we require sender ID for all parcels or only above ₹2,000? | Yes — friction vs trust |

Tracked in `docs/OPEN_QUESTIONS.md`.

---

## 7. Traceability

Each FR maps to user stories in `docs/USER_STORIES_AND_ACCEPTANCE_CRITERIA.md`, endpoints in
`api/openapi.yaml`, and test cases in `testing/TEST_CASES.md`. A requirement without an acceptance
test is not "done".
