# Threat Model (STRIDE)

**Status:** Draft v0.1 · **Date:** 2026-10-24 · **Method:** STRIDE per trust boundary
**Scope:** Parcel Yatra web, Android, admin console, API, database, payment integration, notifications.

---

## 1. Assets

| Asset | Why it matters | Sensitivity |
|---|---|---|
| Identity documents (ID image, selfie) | Fraud, privacy harm | **Critical** |
| Traveller payout account details | Financial fraud | **Critical** |
| Payment ledger + provider refs | Money integrity | **Critical** |
| Booking + custody state | Trust, liability | High |
| OTPs | Handover integrity | High |
| Phone numbers / addresses | Stalking, harassment | High |
| Admin sessions | Full platform control | **Critical** |
| Audit log | Accountability | High |
| API keys / webhook secrets | Forgery | **Critical** |

## 2. Trust boundaries

| # | Boundary | Crossing |
|---|---|---|
| TB1 | Internet → public API | Untrusted input |
| TB2 | Mobile app → API | Untrusted client, possibly tampered |
| TB3 | API → database | Privileged |
| TB4 | API ↔ payment provider | Mutual, signed |
| TB5 | API → notification providers | Outbound, contains PII |
| TB6 | API → object storage | Private bucket, signed URLs |
| TB7 | Staff → admin console | Privileged, MFA |
| TB8 | API → KYC vendor | Very high sensitivity |
| TB9 | CI/CD → production | Supply chain |

## 3. STRIDE analysis

### S — Spoofing

| ID | Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| S-1 | Attacker logs in with victim's phone via SIM swap / OTP interception | Medium | High | OTP short TTL, attempt limits, device binding, anomaly alerts, optional authenticator for repeat travellers |
| S-2 | Forged Google ID token | Low | High | Server-side verification: signature, `aud`, `iss`, `exp`, `email_verified`; never trust client claims |
| S-3 | Stolen session token replayed | Medium | High | Short-lived access tokens, rotating refresh tokens with reuse detection, device binding, revoke-all |
| S-4 | Attacker impersonates a traveller using stolen ID | Medium | Critical | Liveness check, ID–selfie match, vendor score, manual review, payout name match |
| S-5 | Spoofed webhook from "payment provider" | Medium | Critical | HMAC signature verification, timestamp window, source allowlist, replay cache |
| S-6 | Staff account takeover | Low | Critical | SSO + MFA, IP allowlist, session timeout, step-up for sensitive actions |

### T — Tampering

| ID | Threat | Mitigation |
|---|---|---|
| T-1 | Client modifies booking status or price | Server-side state machine; client never sends price/status |
| T-2 | Client modifies declared value to bypass cap | Server recomputes eligibility from declared inputs + review for anomalies |
| T-3 | Tampering with parcel contents after sealing | Tamper-evident packaging guidance + seal photo at pickup + receiver photo at delivery |
| T-4 | Audit log alteration by insider | Append-only storage, separate write-only credentials, hash chaining, export to immutable storage |
| T-5 | Ledger row edited | No UPDATE/DELETE grants on `payment_ledger`; corrections via compensating entries |
| T-6 | Uploaded file replaced after review | Content hash stored; re-verification detects change; object keys immutable |

### R — Repudiation

| ID | Threat | Mitigation |
|---|---|---|
| R-1 | Sender denies handing over the parcel | Pickup OTP consumed + photo + timestamp + device metadata |
| R-2 | Traveller denies receiving custody | Same evidence, plus OTP bound to booking and role |
| R-3 | Receiver denies receiving | Delivery OTP + photo; support callback for assisted handover with audit |
| R-4 | User denies accepting terms | Consent records with version, timestamp, IP, user agent |
| R-5 | Admin denies an action | Immutable audit with actor, before/after state, reason code |

### I — Information disclosure

| ID | Threat | Mitigation |
|---|---|---|
| I-1 | IDOR/BOLA: read another user's booking by changing an ID | Object-level authorisation on every request; UUIDs + ownership check; tests per endpoint |
| I-2 | Exact address exposed pre-booking | Area-only matching; address revealed only to matched counterparty |
| I-3 | Receiver phone harvested by traveller | Mask until booking confirmed; no bulk access; access logging |
| I-4 | ID documents readable via guessable URL | Private bucket, short-lived signed URLs (≤ 5 min), no public ACLs |
| I-5 | PII in logs / error trackers | Structured logging with allowlist of fields; redaction middleware; no request bodies for auth/ID endpoints |
| I-6 | Location stalking via tracking | No continuous GPS; coarse city check-ins only; no historical trail exposed |
| I-7 | Database backup leaked | Encrypted backups, restricted restore access, key separation |
| I-8 | Enumeration of users by phone | Uniform responses, rate limits, no "user not found" distinction |
| I-9 | Analytics containing PII | Event schema review; PII denylist; CI check |

### D — Denial of service

| ID | Threat | Mitigation |
|---|---|---|
| D-1 | OTP request flooding (SMS cost attack) | Per-number/IP/device limits, CAPTCHA after threshold, spend caps with provider |
| D-2 | Search endpoint scraping | Auth required, per-user quotas, response size caps, anomaly detection |
| D-3 | Large file upload exhaustion | 10 MB limit, type sniffing, streaming validation, per-user quota |
| D-4 | Expensive query (geo) abuse | Query timeouts, indexes, pagination required |
| D-5 | Webhook flood | Signature check before processing, queue with backpressure, dedupe |

### E — Elevation of privilege

| ID | Threat | Mitigation |
|---|---|---|
| E-1 | User reaches admin endpoints | Separate host/route, separate auth realm, RBAC checks server-side, deny-by-default |
| E-2 | Support agent performs finance action | Role separation; maker-checker; no self-approval |
| E-3 | Mass assignment sets `role`/`is_admin` | Explicit DTO allowlists; never bind raw body to model |
| E-4 | JWT `alg: none` / key confusion | Pinned algorithms, key rotation, library defaults enforced |
| E-5 | SQL injection via filters | Parameterised queries only; ORM/sql template; no string concatenation |
| E-6 | SSRF via URL fetch (e.g. image proxy) | No arbitrary URL fetch; allowlist; block link-local/metadata IPs |
| E-7 | XSS in chat/description rendered in admin | Output encoding, CSP, sanitisation, no `dangerouslySetInnerHTML` |
| E-8 | CSRF on cookie-based admin actions | SameSite=strict, CSRF tokens, or token-based auth |

## 4. Business-logic abuse (outside STRIDE but critical)

| ID | Threat | Mitigation |
|---|---|---|
| B-1 | Two users accept the same capacity | Row lock + conditional update; test with concurrent requests |
| B-2 | Fake delivery to trigger payout | Receiver OTP required; anomaly detection on pairs/devices |
| B-3 | Fake loss claim for refund | Evidence requirements; claim history; payout freeze; investigator review |
| B-4 | Sender+traveller collusion to launder or move prohibited goods | Pair-repeat detection, device fingerprint reuse, volume caps, human review |
| B-5 | Duplicate refund via retry | Idempotency keys + ledger uniqueness |
| B-6 | Booking spam to harvest traveller data | Rate limits, verified sender requirement after N posts |
| B-7 | Referral/promo abuse (future) | Device + payment instrument binding, caps |

## 5. Severity matrix

| Severity | Definition | Fix deadline |
|---|---|---|
| **Critical** | Direct money loss, ID document exposure, full account takeover, RCE | 24 h (hotfix) |
| **High** | Unauthorized access to one user's data, OTP bypass, payout manipulation | 72 h |
| **Medium** | Limited info disclosure, DoS of a feature, privilege within same role | 14 days |
| **Low** | Hardening, minor info leak, best-practice gap | 90 days |

## 6. Residual risks accepted at pilot (documented)

| Risk | Why accepted | Compensating control |
|---|---|---|
| No continuous tracking | Privacy decision | Status events + support call |
| Manual KYC review (human error) | Cost | Two-step check, sample audit by founder |
| Single-region deployment | Cost | Frequent backups, tested restore |
| Text-only chat | Moderation capacity | Report button, message retention, no media |
| No formal pen-test yet | Pre-launch | Internal security test plan + external test before scale |

## 7. Out of scope for this threat model

Physical security of parcels, vehicle safety, insider collusion at a partner warehouse (none exist),
nation-state actors, and third-party (Porter/Kootr) systems.
