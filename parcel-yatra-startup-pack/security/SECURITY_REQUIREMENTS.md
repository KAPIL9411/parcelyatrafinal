# Security Requirements

**Status:** Draft v0.1 · **Date:** 2026-10-24
Each requirement is testable. `MUST` = release blocker. `SHOULD` = required before scale.

---

## 1. Authentication

| ID | Requirement |
|---|---|
| SR-A1 | MUST: OTP is 6 digits, CSPRNG-generated, stored only as a keyed hash, single-use. |
| SR-A2 | MUST: OTP expires in 5 minutes (auth) / 10 minutes (handover); max 5 attempts; then invalidated. |
| SR-A3 | MUST: rate limits — 3/hour/number, 10/hour/IP, 20/day/device for OTP issuance. |
| SR-A4 | MUST: OTP responses are indistinguishable for registered and unregistered numbers. |
| SR-A5 | MUST: Google ID tokens verified server-side (signature, `iss`, `aud`, `exp`, `nbf`, `email_verified`). |
| SR-A6 | MUST: access tokens ≤ 30 min; refresh tokens rotate with reuse detection; logout revokes. |
| SR-A7 | MUST: refresh token stored in httpOnly, Secure, SameSite=Strict cookie (web) or secure storage (mobile). |
| SR-A8 | MUST: passwordless only; no passwords stored. |
| SR-A9 | SHOULD: step-up verification for payout account changes and for traveller re-verification. |

## 2. Authorisation

| ID | Requirement |
|---|---|
| SR-Z1 | MUST: every request re-checks object ownership server-side (no client-trusted IDs). |
| SR-Z2 | MUST: deny-by-default route policy; new routes are protected unless explicitly public. |
| SR-Z3 | MUST: RBAC with roles `sender`, `traveller`, `support_agent`, `verification_reviewer`, `finance`, `trust_safety`, `admin_readonly`. |
| SR-Z4 | MUST: admin actions require MFA and are audit-logged. |
| SR-Z5 | MUST: no client can set `booking.status`, `payment.state`, `payout.state`, `user.role`. |
| SR-Z6 | MUST: automated test asserts user A cannot access user B's booking, parcel, trip, dispute, payment. |

## 3. Input & output

| ID | Requirement |
|---|---|
| SR-I1 | MUST: schema validation on every request body, query and path param (JSON Schema). |
| SR-I2 | MUST: reject unknown properties (`additionalProperties: false`) on mutation endpoints. |
| SR-I3 | MUST: parameterised SQL only; no string interpolation in queries. |
| SR-I4 | MUST: output encoding; CSP with no `unsafe-inline` for scripts; no `dangerouslySetInnerHTML`. |
| SR-I5 | MUST: HTML sanitisation for any user-generated text rendered in admin. |
| SR-I6 | MUST: phone numbers masked in all non-essential views; never in URLs. |
| SR-I7 | SHOULD: request size limits (JSON ≤ 100 KB; uploads ≤ 10 MB). |

## 4. Uploads

| ID | Requirement |
|---|---|
| SR-U1 | MUST: accept only `image/jpeg`, `image/png` for KYC; verify magic bytes, not just content-type. |
| SR-U2 | MUST: strip EXIF (including GPS) before storage. |
| SR-U3 | MUST: store in private bucket; access only via short-lived signed URL (≤ 5 min). |
| SR-U4 | MUST: random object keys; no user-controlled paths. |
| SR-U5 | MUST: re-encode images to neutralise polyglot files. |
| SR-U6 | MUST: per-user upload quota and rate limit. |
| SR-U7 | SHOULD: malware scan for any non-image upload added later. |

## 5. Secrets & configuration

| ID | Requirement |
|---|---|
| SR-S1 | MUST: no secrets in Git; CI secret scanning blocks merge. |
| SR-S2 | MUST: secrets in managed store, injected at runtime; rotated ≤ 90 days for high-value keys. |
| SR-S3 | MUST: separate credentials per environment; production secrets never available in staging. |
| SR-S4 | MUST: webhook secrets per provider; rotation procedure documented. |
| SR-S5 | MUST: `.env` files gitignored; `.env.example` contains only placeholders. |
| SR-S6 | SHOULD: least-privilege cloud IAM; no long-lived root keys. |

## 6. Data protection

| ID | Requirement |
|---|---|
| SR-D1 | MUST: TLS 1.2+ everywhere; HSTS with preload; no mixed content. |
| SR-D2 | MUST: encryption at rest for DB, object storage, backups. |
| SR-D3 | MUST: ID documents and payout details in a separate schema/table with restricted grants. |
| SR-D4 | MUST: no Aadhaar numbers stored (default policy). |
| SR-D5 | MUST: field-level encryption or tokenisation for payout account numbers. |
| SR-D6 | MUST: retention job enforces `security/DATA_RETENTION_MATRIX.md`. |
| SR-D7 | SHOULD: pseudonymised analytics identifiers. |

## 7. Logging & monitoring

| ID | Requirement |
|---|---|
| SR-L1 | MUST: never log passwords, OTPs, tokens, full ID docs, card data, or full phone numbers. |
| SR-L2 | MUST: structured JSON logs with allowlisted fields; redaction middleware tested. |
| SR-L3 | MUST: audit log for privileged actions, append-only, hash-chained. |
| SR-L4 | MUST: alert on auth anomalies, payout failures, webhook signature failures, 5xx spikes. |
| SR-L5 | MUST: correlation IDs across request → job → provider call. |

## 8. Payments

| ID | Requirement |
|---|---|
| SR-P1 | MUST: amount computed server-side from stored quote. |
| SR-P2 | MUST: webhook signature verification + timestamp tolerance + replay cache. |
| SR-P3 | MUST: idempotency keys on all provider mutations and all booking mutations. |
| SR-P4 | MUST: unknown provider state never treated as success or failure. |
| SR-P5 | MUST: append-only ledger with compensating entries only. |
| SR-P6 | MUST: daily reconciliation job with mismatch alerting. |
| SR-P7 | MUST: `PAYMENTS_LIVE=false` enforced by config, with a startup guard refusing live mode unless approved env var present. |

## 9. Availability & recovery

| ID | Requirement |
|---|---|
| SR-R1 | MUST: automated daily backups; PITR where available; RPO ≤ 5 min. |
| SR-R2 | MUST: documented restore procedure, tested quarterly. |
| SR-R3 | MUST: health endpoints and uptime alerting. |
| SR-R4 | MUST: graceful degradation — if notifications fail, bookings still work. |
| SR-R5 | SHOULD: circuit breakers on external providers. |

## 10. Supply chain

| ID | Requirement |
|---|---|
| SR-C1 | MUST: dependency scanning in CI; block on critical CVEs. |
| SR-C2 | MUST: lockfiles committed; reproducible installs (`npm ci`). |
| SR-C3 | MUST: secret scanning + SAST on every PR. |
| SR-C4 | MUST: pinned base images; rebuild monthly. |
| SR-C5 | MUST: no `--no-verify`, no disabling of security checks to make CI pass. |
| SR-C6 | SHOULD: signed commits / branch protection with required review. |

## 11. Admin console hardening

| ID | Requirement |
|---|---|
| SR-AD1 | MUST: separate origin/subdomain; not reachable from the public app session. |
| SR-AD2 | MUST: MFA mandatory; session idle timeout 15 min. |
| SR-AD3 | MUST: every ID-document view logged with actor and reason. |
| SR-AD4 | MUST: maker-checker for refunds/payouts > ₹1,000. |
| SR-AD5 | MUST: read-only role for auditors; no export without logging. |

## 12. Mobile app

| ID | Requirement |
|---|---|
| SR-M1 | MUST: no secrets embedded in the app bundle. |
| SR-M2 | MUST: certificate pinning (or documented risk acceptance) for API domain. |
| SR-M3 | MUST: secure storage for tokens (Keychain/Keystore), not AsyncStorage plaintext. |
| SR-M4 | MUST: root/jailbreak detection advisory, not blocking (avoid false positives). |
| SR-M5 | MUST: screenshot protection on OTP and ID screens. |
| SR-M6 | SHOULD: obfuscation; integrity checks. |

## 13. Compliance-adjacent

| ID | Requirement |
|---|---|
| SR-CM1 | MUST: consent records stored with policy version. |
| SR-CM2 | MUST: data export and deletion endpoints functional and tested. |
| SR-CM3 | MUST: breach-response runbook accessible offline. |
| SR-CM4 | SHOULD: vendor DPAs signed before production data flows. |
