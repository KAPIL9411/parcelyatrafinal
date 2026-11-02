# MVP Scope & Non-Goals

**Status:** Draft v0.1 · **Last updated:** 2026-10-24

---

## 1. Why scope discipline matters here

Parcel Yatra touches **trust**, **money**, **identity documents** and **transport law** simultaneously.
Each one is a source of unbounded scope. The MVP is therefore defined by what we are willing to
*exclude*, and every exclusion has a reason and a revisit trigger.

## 2. MVP scope (closed pilot)

### 2.1 Geography
- Bareilly ⇄ Delhi NCR, Bareilly ⇄ Lucknow only.
- City-level matching; area-level pickup/drop within 10 km.
- No intermediate-city pickups.

### 2.2 Transport modes
- **Car** (self-driven or family car) — enabled.
- **Bike** — behind a flag, disabled until insurance answer is obtained.
- **Bus, train, air** — disabled. Not "coming soon" in the UI; simply absent.

### 2.3 Item scope
- Documents (papers, certificates, contracts) — primary.
- Small sealed goods ≤ 5 kg, ≤ 45 cm longest side, declared value ≤ ₹5,000.
- Restricted list requires human review before matching.

### 2.4 Surfaces
- Responsive web (sender + traveller + admin).
- Android app at pilot start; **iOS is P1** (not a launch blocker).
- Admin console: desktop web only.

### 2.5 Money
- Sandbox/mock payment adapter only.
- No real capture, no real payout, no wallet, no COD.
- Pricing shown and recorded as if real, for pricing research.

### 2.6 Trust & safety
- Phone OTP, optional Google sign-in, traveller KYC with human review.
- OTP handover + photo proof.
- Manual dispute handling.
- No automated fraud scoring beyond simple rules (same-device, velocity, blocklists).

### 2.7 Operations
- Manual verification queue.
- Manual reconciliation.
- Support via in-app + phone during operating hours.

## 3. Non-goals (explicit, with reasons)

| Non-goal | Reason | Revisit trigger |
|---|---|---|
| Real money movement | Requires licensed provider approval + legal review; holding funds is a regulated activity | Written provider + counsel sign-off |
| Bus/train/air mode | Carrier rules and law unresolved; see `legal/TRANSPORT_MODE_FEASIBILITY.md` | Written operator permission / legal memo |
| Insurance product | Cannot promise cover not confirmed in writing | Insurer-approved policy wording |
| Cash on delivery | Creates cash handling, theft and AML exposure | Not planned |
| Stored-value wallet | Would be a regulated payment instrument | Only via licensed partner product |
| Continuous GPS tracking | Privacy-invasive, battery-heavy, legally sensitive | Documented need + consent + retention policy |
| International shipping | Customs + air regulation | Year 2+ |
| B2B bulk API | Different product, different buyers, distorts pilot | After corridor viability proven |
| Multi-leg custody transfer | Liability and chain-of-custody complexity | After insurance clarity |
| ML-based fraud/ranking | No data, unexplainable to users/regulators | ≥ 1,000 labelled bookings |
| In-app chat with media | Abuse and illegal-content surface | After moderation capability exists |
| High-value / jewellery / electronics | Insurance and theft risk | Insurer + security controls |
| Medicines / medical samples | Regulatory classification and cold chain | Not planned without licence clarity |
| Marketplace for professional couriers | Changes the legal classification and the entire trust model | Separate product decision |
| Public ratings with comments | Abuse, defamation, moderation load | After moderation capacity |

## 4. Deferred but designed-for

These are P1/P2, documented so architecture does not block them: iOS app, WhatsApp notifications,
receiver accounts, business invoicing, scheduled repeat shipments, saved addresses, multi-language
beyond Hindi/English, route overlays.

## 5. Scope-change rule

Any addition to MVP scope requires:
1. A decision record (`templates/ADR_TEMPLATE.md`).
2. An explicit statement of what is removed or delayed to pay for it.
3. Sign-off from the founder responsible for launch gates.

"We'll just add it" is not a valid scope decision.

## 6. What "done" means for MVP

MVP is complete when every P0 requirement in `docs/PRD.md` is implemented **and** all launch gates in
`release/GO_NO_GO_CRITERIA.md` are satisfied. Code completeness alone is explicitly insufficient.
