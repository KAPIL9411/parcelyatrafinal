# Environment Strategy

**Status:** Draft v0.1 · **Date:** 2026-10-24

---

## 1. Environment matrix

| Concern | local | test | staging | production |
|---|---|---|---|---|
| Database | Docker Postgres | Ephemeral per run | Managed (separate) | Managed HA |
| Payments | `mock` | `mock` | `mock`/sandbox | sandbox → live (gated) |
| SMS | console logger | fake provider | sandbox number | real, DLT-approved |
| KYC | auto-approve mock | mock | sandbox vendor | real vendor |
| Maps | cached fixtures | fixtures | real (rate-limited) | real |
| Email | MailHog | fake | sandbox | real |
| Object storage | MinIO | ephemeral | separate bucket | production bucket |
| Data | seed | fixtures | synthetic | real |
| Access | developer | CI | team | restricted + audited |
| Secrets | `.env.local` (gitignored) | CI secrets | staging store | production store |

## 2. Configuration rules

1. **One schema, validated at boot.** Missing required config = process exits.
2. **No default values for security-critical config** (payment mode, CORS origin, secrets).
3. **Feature flags** default to safe values in every environment.
4. **Production config diff** reviewed before each release.
5. **No production credentials** on developer machines.

## 3. Feature flags

| Flag | local | staging | production |
|---|---|---|---|
| `mode_car` | on | on | on |
| `mode_bike` | on | on | **off** |
| `mode_bus` / `mode_train` / `mode_air` | off | off | off |
| `payments_live` | off | off | **off until GATE-3/4** |
| `payouts_enabled` | off | off | **off until gates** |
| `disputes_auto_refund` | on | on | off (manual) |
| `city_bareilly` | on | on | on |
| `city_delhi` | on | on | on |

Flags are changed by deployment config, not by any user-facing endpoint.

## 4. Seed data policy

- Local/test seeds use **obviously fake** names (`Test Sender A`), reserved phone prefixes, and
  `example.com` emails.
- **No real personal data** may be copied into any non-production environment.
- If a production bug requires real data to reproduce, use a synthetic reproduction first; if
  unavoidable, use a scrubbed extract approved by the founder and deleted within 24 h.

## 5. Data promotion rules

| Direction | Allowed? | Conditions |
|---|---|---|
| local → staging | Yes (code, fixtures) | No real data |
| staging → production | Code only | Reviewed release |
| production → staging | **No** by default | Scrubbed extract only, time-boxed |
| production → local | **Never** | — |

## 6. Secret handling per environment

| Environment | Storage | Rotation |
|---|---|---|
| local | `.env.local`, gitignored | n/a |
| CI | CI secret store | 90 d |
| staging | managed secret store | 90 d |
| production | managed secret store | 90 d (critical: 30 d) |

## 7. Environment-specific risks

| Risk | Mitigation |
|---|---|
| Staging accidentally sends real SMS | Sandbox provider + allowlisted numbers |
| Staging hits real payment API | Mock adapter default; live keys absent |
| Dev machine reaches production DB | No production network access from laptops |
| Test data leaks into analytics | Separate analytics keys per env |

## 8. Promotion checklist

Before promoting a build:
- [ ] Staging smoke test passed
- [ ] Migration applied successfully in staging
- [ ] Feature flags reviewed
- [ ] Config diff reviewed
- [ ] Rollback plan known
- [ ] On-call notified

## 9. What "staging" must prove

Staging exists to answer: *would this break production?* It must therefore:
- run the same migrations,
- run the same container image,
- have the same module/flag configuration,
- exercise the payment **failure** paths, not just success.
