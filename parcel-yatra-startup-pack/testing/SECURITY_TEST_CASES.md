# Security Test Cases

**Status:** Draft v0.1 · **Date:** 2026-10-24
Companion to `security/SECURITY_TEST_PLAN.md` (which defines *when* these run) and
`security/THREAT_MODEL.md` (which defines *why* each exists). Every case cites the threat ID it
verifies.

---

## 1. Rules of engagement

- Tests run only against environments we own: local, CI, staging.
- **Never** against production, against a third party, or against real user data.
- No denial-of-service testing beyond the agreed k6 profile (`testing/LOAD_TEST_PLAN.md`).
- No social engineering, no physical testing, no credential stuffing with real lists.
- Any finding that reveals a live vulnerability in a production dependency is reported privately
  before a ticket is opened.

## 2. Severity of a finding

| Level | Meaning | Response |
|---|---|---|
| Critical | Auth bypass, ID document exposure, money creation, RCE | Stop release, fix before anything else |
| High | Cross-user data access, privilege escalation, OTP bypass | Fix before release |
| Medium | Information leak, rate-limit bypass, weak crypto | Fix before release or accept with named owner |
| Low | Hardening gap, missing header | Ticket, fix within a sprint |

A security test that was not run is not a pass. Record the run in the release report.

---

## 3. Authentication (`SR-A*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-AUTH-01` | OTP brute force: 100 sequential wrong codes for one challenge | Challenge invalidated after 5; `429`; constant response time | S-1 |
| `SEC-AUTH-02` | OTP enumeration: request OTP for existing vs non-existing numbers, 200 samples | No timing or body difference (Kolmogorov–Smirnov on latency, p > 0.05) | S-2 |
| `SEC-AUTH-03` | OTP replay after successful verification | `400 OTP_ALREADY_USED` | S-1 |
| `SEC-AUTH-04` | OTP reuse across challenges (same digits, different challenge) | `400 OTP_INVALID` | S-1 |
| `SEC-AUTH-05` | JWT `alg: none` | `401` | S-3 |
| `SEC-AUTH-06` | JWT signed with a guessed secret (`HS256` confusion) | `401` | S-3 |
| `SEC-AUTH-07` | JWT with `kid` set to a path traversal string | `401`, no file read | S-3 |
| `SEC-AUTH-08` | JWT `exp` in the future but `nbf` in the future too | `401` | S-3 |
| `SEC-AUTH-09` | Refresh token reuse after rotation | Family revoked; both tokens `401` | S-4 |
| `SEC-AUTH-10` | Access token from deleted user | `401`, session gone | S-4 |
| `SEC-AUTH-11` | Session fixation: attacker-supplied token accepted after login | Not accepted; server always mints new | S-4 |
| `SEC-AUTH-12` | OTP appears in application logs | Zero occurrences across log files and error tracker | S-5 |
| `SEC-AUTH-13` | OTP appears in notification preview text | Zero occurrences (payload inspection) | S-5 |
| `SEC-AUTH-14` | Google ID token with `email_verified: false` | `401` | S-3 |
| `SEC-AUTH-15` | Google ID token replayed after `exp` | `401` | S-3 |

## 4. Authorisation (`SR-Z*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-AUTHZ-01` | IDOR sweep: for each resource, substitute another user's UUID | `404` for all of parcel, quote, trip, booking, dispute, verification | Z-1 |
| `SEC-AUTHZ-02` | Mass-assignment: `PATCH /me` with `status:"active"`, `risk_tier:0`, `role:"finance"` | `400 UNKNOWN_FIELD`, nothing changes | Z-2 |
| `SEC-AUTHZ-03` | Booking status via `PATCH` | No such field; `400` | Z-2 |
| `SEC-AUTHZ-04` | `POST /bookings/{id}/transitions` with `command:"refund"` as sender | `403 TRANSITION_NOT_PERMITTED` | Z-2 |
| `SEC-AUTHZ-05` | Admin endpoint as a normal user | `403`; audit logs the attempt | Z-3 |
| `SEC-AUTHZ-06` | Admin endpoint with a valid but expired admin session | `401` | Z-3 |
| `SEC-AUTHZ-07` | `finance` role calls `POST /admin/verifications/.../decision` | `403 ROLE_REQUIRED` | Z-3 |
| `SEC-AUTHZ-08` | `verification_reviewer` reads `/admin/audit-log` | `403` unless `admin_readonly` | Z-3 |
| `SEC-AUTHZ-09` | Two staff users, one suspends the other | `403 SELF_APPROVAL_FORBIDDEN` equivalent guard; audit entry | Z-3 |
| `SEC-AUTHZ-10` | Direct object access with a valid token from a *different tenant* (future) | `404` | Z-1 |

## 5. Files and uploads (`SR-U*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-UPL-01` | Upload `.php`/`.svg` with an image content type | Rejected; magic-byte check fails | U-1 |
| `SEC-UPL-02` | Upload a 10.5 MB file | `400 UPLOAD_TOO_LARGE` | U-2 |
| `SEC-UPL-03` | Image with a polyglot payload (JPEG header + JS) | Re-encoded server-side; payload gone | U-1 |
| `SEC-UPL-04` | EXIF GPS coordinates present | Stripped; verified with `exiftool` on the stored object | U-3 |
| `SEC-UPL-05` | Signed URL used after 5 min | Rejected by storage | U-4 |
| `SEC-UPL-06` | Signed URL used from another IP | Accepted (documented limitation) or rejected by policy — recorded honestly | U-4 |
| `SEC-UPL-07` | Object key traversal `../../` | `400` | U-5 |
| `SEC-UPL-08` | Reference another user's `object_key` | `400`/`403` ownership check | U-5 |
| `SEC-UPL-09` | Bucket listing without credentials | `403` | U-6 |
| `SEC-UPL-10` | ID document URL shared with a third party | URL is signed + short-lived; note this is a residual risk requiring auth on the viewer | U-4 |

## 6. Webhooks and payment integrity (`SR-W*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-WH-01` | Forge a webhook without the secret | `401`; alert | W-1 |
| `SEC-WH-02` | Replay a captured valid webhook | `200` but no duplicate effect | W-2 |
| `SEC-WH-03` | Change the body after signing | `401` | W-1 |
| `SEC-WH-04` | Old timestamp (1 hour) | `401` | W-2 |
| `SEC-WH-05` | Timing attack on signature comparison | Constant-time comparison; measured variance < 1 ms | W-3 |
| `SEC-WH-06` | Webhook with amount ≠ stored quote | Rejected; alert | W-4 |
| `SEC-WH-07` | Webhook for an unknown `provider_ref` | `202`; no state change | W-4 |
| `SEC-WH-08` | Client sends `amount_paise` in a payment intent | `400 UNKNOWN_FIELD`; stored quote used | W-5 |
| `SEC-WH-09` | Client sends `status:"captured"` in a booking transition | `403`/`400`; server-computed only | W-5 |
| `SEC-WH-10` | Ledger row mutated by the app role | DB permission denied | W-6 |
| `SEC-WH-11` | Ledger row deleted | DB permission denied (no `DELETE` grant) | W-6 |

## 7. Injection and input handling (`SR-I*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-INJ-01` | SQL injection in every string field (`' OR 1=1--`, `"; DROP TABLE`) | Parameterised queries; no error text leakage; `400` or stored literally | I-1 |
| `SEC-INJ-02` | NoSQL-style operator injection `{"$ne": null}` in a JSON body | `400 VALIDATION_FAILED` | I-1 |
| `SEC-INJ-03` | Stored XSS in parcel description rendered in admin | Escaped; no script execution (Playwright assertion) | I-2 |
| `SEC-INJ-04` | Stored XSS in receiver name rendered in the receiver web page | Escaped | I-2 |
| `SEC-INJ-05` | CSV injection in the audit export (`=cmd|...`) | Prefixed with `'` on export | I-3 |
| `SEC-INJ-06` | Path traversal in `object_key` | `400` | I-4 |
| `SEC-INJ-07` | Header injection in a user-controlled value reflected into a header | Sanitised | I-5 |
| `SEC-INJ-08` | Oversized JSON (100 KB + 1) | `413` | I-6 |
| `SEC-INJ-09` | Deeply nested JSON (10,000 levels) | `400`, no stack overflow | I-6 |
| `SEC-INJ-10` | Unicode/emoji in every field | Stored and rendered correctly, no crash | I-6 |
| `SEC-INJ-11` | Devanagari, RTL override characters, zero-width joiners in a name | Rendered safely; no visual spoofing of a name | I-7 |
| `SEC-INJ-12` | Prototype pollution `{"__proto__": {"admin": true}}` | Ignored; no privilege change | I-1 |

## 8. Privacy (`SR-P*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-PRV-01` | Full response body scan of 20 representative endpoints | No phone number, no Aadhaar, no ID number, no exact address, no coordinates | P-1 |
| `SEC-PRV-02` | Matches endpoint body | Only first name + initial, distance band, no address | P-1 |
| `SEC-PRV-03` | Access log scan after 100 requests | No phone numbers, no OTPs, no tokens, no `Authorization` values | P-2 |
| `SEC-PRV-04` | Error tracker scan after forcing 20 errors | No PII in stack traces or breadcrumbs | P-2 |
| `SEC-PRV-05` | Push notification payload | No address, item description or value | P-3 |
| `SEC-PRV-06` | Referrer header on the receiver page | No booking ID or token leaked to third parties | P-3 |
| `SEC-PRV-07` | Data export contains another user's data | Not possible; export scoped to the caller | P-4 |
| `SEC-PRV-08` | Deletion leaves PII in backups | Documented retention window; test asserts the documented behaviour, not zero retention | P-4 |
| `SEC-PRV-09` | Analytics event payload inspection | No PII; IDs only, hashed where needed | P-5 |
| `SEC-PRV-10` | Aadhaar field cannot be submitted anywhere | Enum excludes it; no free-text field accepts it | P-6 |

## 9. Abuse and rate limiting (`SR-R*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-RL-01` | 4 OTP requests in an hour from one number | `429` + `Retry-After` | R-1 |
| `SEC-RL-02` | 11 OTP requests in an hour from one IP | `429` | R-1 |
| `SEC-RL-03` | Distributed OTP requests across 50 IPs for one number | Number-level limit still triggers | R-1 |
| `SEC-RL-04` | 31 match searches in a minute | `429` | R-2 |
| `SEC-RL-05` | 21 upload URLs in an hour | `429` | R-2 |
| `SEC-RL-06` | Rate limit bypass via `X-Forwarded-For` spoofing | Trusted-proxy config ignores client value | R-3 |
| `SEC-RL-07` | Two accounts created from one device to bypass the cancel limit | Device-level signal recorded; documented as best-effort | R-4 |
| `SEC-RL-08` | Enumeration of booking IDs at 5 requests/second | `404` uniformly; rate limited; no timing signal | R-2 |

## 10. Transport, headers, configuration (`SR-C*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-CFG-01` | TLS 1.0/1.1 handshake | Rejected | C-1 |
| `SEC-CFG-02` | Weak cipher suite | Rejected | C-1 |
| `SEC-CFG-03` | HSTS header | `max-age ≥ 31536000`, `includeSubDomains` | C-2 |
| `SEC-CFG-04` | CSP header | Present, no `unsafe-inline` for scripts | C-2 |
| `SEC-CFG-05` | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors` | Present and correct | C-2 |
| `SEC-CFG-06` | CORS with `Origin: https://evil.example` + credentials | Rejected; no wildcard with credentials | C-3 |
| `SEC-CFG-07` | Error response in production mode | No stack trace, no ORM message, no framework version | C-4 |
| `SEC-CFG-08` | `Server` / `X-Powered-By` headers | Removed or generic | C-4 |
| `SEC-CFG-09` | Debug endpoint (`/debug`, `/metrics` without auth) | Not exposed | C-4 |
| `SEC-CFG-10` | Secrets in the client bundle | Zero matches for `SECRET`, `sk_`, `PRIVATE KEY` | C-5 |
| `SEC-CFG-11` | Secrets in the repository history | Zero (gitleaks scan) | C-5 |
| `SEC-CFG-12` | Dependency vulnerability scan | No unpatched critical/high in runtime deps | C-6 |
| `SEC-CFG-13` | Container runs as root | No; non-root user | C-7 |
| `SEC-CFG-14` | Container filesystem writable at runtime | Read-only root FS with explicit tmpfs | C-7 |

## 11. OTP and handover-specific (`SR-H*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-OTP-01` | OTP is 6 digits, generated with a CSPRNG | Entropy check: no repeats in 100k generations beyond chance; not sequential | H-1 |
| `SEC-OTP-02` | OTP stored in plaintext in DB | **Must be hashed** (Argon2id or HMAC-SHA256 with server key) | H-2 |
| `SEC-OTP-03` | OTP visible in a database dump to support staff | Not readable (hashed) | H-2 |
| `SEC-OTP-04` | Generate OTP for another user's booking | `404` | H-3 |
| `SEC-OTP-05` | Regenerate 10× to exhaust | Rate limited; old codes invalidated | H-3 |
| `SEC-OTP-06` | OTP in the URL / query string | Never; only in POST bodies | H-4 |
| `SEC-OTP-07` | OTP in the response of any endpoint | Never (automated scan across all responses) | H-4 |
| `SEC-OTP-08` | Support override without a reason code | `400`; override requires `reason_code` + audit | H-5 |
| `SEC-OTP-09` | Android screenshot of the OTP screen | Blocked via `FLAG_SECURE` (manual device test) | H-4 |

## 12. Logging and monitoring (`SR-L*`)

| ID | Test | Expected | Threat |
|---|---|---|---|
| `SEC-LOG-01` | Admin action without an audit row | Every mutating admin endpoint writes one; test enumerates all | L-1 |
| `SEC-LOG-02` | Audit log tampering (UPDATE/DELETE) | DB permission denied; hash chain detects modification | L-2 |
| `SEC-LOG-03` | Audit log export without a reason | `400` | L-1 |
| `SEC-LOG-04` | Failed login burst | Alert fires within 5 min (test the alert rule, not just the log) | L-3 |
| `SEC-LOG-05` | Signature-invalid webhook burst | Alert fires | L-3 |
| `SEC-LOG-06` | Log injection: newline in `User-Agent` | Escaped; cannot forge a log line | L-4 |

## 13. Manual / out-of-band checks

Some things cannot be automated. These are done by a human and recorded in the release report.

| Check | Method |
|---|---|
| Backup restore integrity | Restore into a clean database; compare row counts and ledger sums |
| Secret rotation drill | Rotate JWT key and webhook secret in staging; verify no downtime beyond the documented window |
| Access review | List every human with production DB or admin console access; confirm each is justified |
| Device security | Android: screenshots blocked on OTP, no data in the recents preview |
| Phishing resistance | Confirm no staff action in the admin console can be triggered by a link alone |
| Dependency licence check | Confirm no GPL/AGPL dependency in a distributed client |

## 14. Reporting template

For each release, record:

```
Date:
Environment:
Tester:
Build / commit:

Automated suite:            <pass>/<total>   (command used)
Manual checks:              <pass>/<total>
Critical findings:          <n> (must be 0)
High findings:              <n> (must be 0 to release)
Medium findings:            <n> (owner + date for each)
Low findings:               <n>
Not run / not applicable:   <list with reason>
Residual risks accepted:    <list with sign-off>
```

**Honesty rule:** a "0 findings" report from a suite that failed to start is fraud. Attach the raw
output.

---

## 15. Known limitations of this plan (state them, do not hide them)

1. **No independent penetration test at pilot.** All testing is by the team that built the system.
   This is a real, acknowledged gap; an external test is a pre-scale gate.
2. **No formal threat-model review by an outsider.** `security/THREAT_MODEL.md` is self-authored.
3. **No bug bounty.** No incentive for external researchers to look.
4. **No fuzzing at scale.** Only targeted malformed inputs.
5. **Mocked payments** mean payment-integrity tests exercise our logic, not a real provider's failure
   modes.
6. **No mobile app hardening review** (root/jailbreak detection deliberately not implemented —
   obfuscation is not security; documented as accepted).

Each of these belongs in the release report under "residual risk", not in a footnote nobody reads.
