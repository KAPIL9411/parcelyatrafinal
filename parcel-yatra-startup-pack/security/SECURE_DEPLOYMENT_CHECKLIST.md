# Secure Deployment Checklist

**Status:** Draft v0.1 · **Date:** 2026-10-24
Every item must be checked before a production deploy. Unchecked items block release.

---

## 1. Pre-deploy (code)

- [ ] CI green: lint, typecheck, unit, integration, contract
- [ ] Dependency scan: no critical/high CVEs unresolved
- [ ] Secret scan: no credentials in diff or history
- [ ] SAST: no new high findings
- [ ] No security check disabled to make CI pass
- [ ] Migrations reviewed and reversible (or explicitly forward-only with backup)
- [ ] Feature flags default **off** for: `payments_live`, `payouts_enabled`, `mode_bike`
- [ ] `PAYMENTS_LIVE` not present in this environment's config unless explicitly approved

## 2. Configuration

- [ ] Environment variables set from secret store, not files
- [ ] Separate DB credentials per service; least privilege
- [ ] `NODE_ENV=production`
- [ ] Debug/verbose logging disabled
- [ ] Error messages do not include stack traces to clients
- [ ] CORS allowlist restricted to known origins
- [ ] CSP header present, no `unsafe-eval`
- [ ] HSTS enabled, `includeSubDomains`, `preload`
- [ ] Cookies: `Secure`, `HttpOnly`, `SameSite=Strict`
- [ ] Rate limits configured per route class
- [ ] Upload limits configured
- [ ] Request body size limits configured

## 3. Data

- [ ] Backup completed in last 24 h
- [ ] Restore tested in last 90 days
- [ ] Encryption at rest verified for DB + bucket
- [ ] Bucket is private; no public ACLs
- [ ] Retention jobs scheduled and last run successful
- [ ] No test/seed data with realistic personal data in production

## 4. Access

- [ ] Admin console reachable only on its own hostname
- [ ] MFA enforced for all staff accounts
- [ ] No shared staff accounts
- [ ] Former staff access revoked
- [ ] Production DB access requires bastion/VPN + audit
- [ ] Payout account change flow requires step-up

## 5. Observability

- [ ] Structured logs shipping; redaction verified with a sample
- [ ] Error tracking configured with PII scrubbing
- [ ] Alerts configured: 5xx, auth failures, webhook signature failures, payout failures, backup failure
- [ ] Health endpoint returns dependency status
- [ ] Dashboards show booking funnel and payment states
- [ ] Audit log writable and append-only

## 6. Payments

- [ ] Webhook signature verification tested against a forged payload
- [ ] Replay protection tested
- [ ] Idempotency tested for duplicate payment intent
- [ ] Reconciliation job tested with sandbox data
- [ ] Refund path tested including partial refund
- [ ] Payout path tested in sandbox only
- [ ] Ledger has no UPDATE/DELETE grant

## 7. Notifications

- [ ] OTP delivery tested on a real number (test account)
- [ ] Templates approved (DLT/WhatsApp) where required
- [ ] Fallback channel tested
- [ ] No PII in push bodies verified

## 8. Mobile

- [ ] API base URL points to the correct environment
- [ ] No secrets in bundle
- [ ] Tokens in secure storage
- [ ] Certificate pinning configured or risk accepted in writing
- [ ] OTP/ID screens block screenshots

## 9. Post-deploy (first hour)

- [ ] Smoke test: signup → post parcel → match → booking (sandbox payment)
- [ ] Admin login + one safe read action
- [ ] Error rate normal
- [ ] No spike in 401/403 (could indicate auth misconfiguration)
- [ ] Webhook endpoint receiving provider pings
- [ ] Rollback command verified available

## 10. Rollback readiness

- [ ] Previous artifact still deployable
- [ ] DB migration rollback plan documented
- [ ] Feature flags can disable new behaviour without redeploy
- [ ] On-call engineer identified and reachable

## 11. Sign-off

| Role | Name | Time | Notes |
|---|---|---|---|
| Deployer | | | |
| Reviewer | | | |
| Incident Commander (if SEV) | | | |

**Deploying with unchecked items requires an explicit, written risk acceptance from the founder and is
logged in `release/RELEASE_CHECKLIST.md`.**
