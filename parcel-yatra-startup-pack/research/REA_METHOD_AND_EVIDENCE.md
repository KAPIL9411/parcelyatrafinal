# REA Method & Evidence Register

**Status:** Complete for this research pass · **Research date:** 2026-10-24 (IST)
**Client:** OpenCode (this session) · **REA version:** 6.7.0

---

## 1. Tool readiness verification (actually performed)

| Check | Method | Result |
|---|---|---|
| REA installed | `npx rea-agents@latest setup --client opencode` (approved plan) | Registered at `~/.config/opencode/opencode.jsonc`, pinned `rea-agents@6.7.0` |
| REA health | `npx rea-agents@6.7.0 doctor --client opencode --json` | `healthy: true`; registration `aligned`; skill v42 `aligned` |
| Tools exposed | `rea.binary_session` capability probe | **207 MCP tools** available in session |
| Native analysis engines | `binary_session.capabilities` | Ghidra/IDA/JADX/Kuna/Hopper **not configured**; `native-macos` unavailable on win32 |
| Browser inspection | Launch headless Chrome 155.0.8059.85 with `--remote-debugging-port=9222`, then `rea.list_browser_targets` | Working; CDP provider `rea-cdp-browser` v2 |
| Page navigation | Local helper `nav.mjs` over CDP `Page.navigate` (REA inspects, does not navigate) | Working |

**Explicit non-use:** No native binary, APK, .NET or Electron analysis was performed. No mobile app
package was downloaded or inspected. Nothing was modified in any third-party system.

## 2. What REA was and was not used for

| Used | Not used | Why |
|---|---|---|
| `list_browser_targets` | `open_binary`, `analyze_javascript_application` | No authorised target artifact |
| `inspect_web_page` (DOM + accessibility tree + network metadata) | Mobile APK inspection (`inspect_android_package`) | Would require downloading competitor APKs — not done, not authorised |
| Public-page observation only | Any authenticated or production flow | No accounts created, no bookings made, no payments initiated |

## 3. Observation environment

| Item | Value |
|---|---|
| Host | Windows, x64 |
| Browser | Chrome 155.0.8059.85 (headless, dedicated temp profile) |
| CDP endpoint | `http://127.0.0.1:9222` (loopback only) |
| Network | Public internet, unauthenticated |
| Time (first capture) | 2026-10-24T09:44:03Z |
| Rate discipline | Single page load per site, no repeated polling, no load testing |

## 4. Evidence register

| ID | Claim observed | Source URL | Observed at | Type | Confidence | Limitations |
|---|---|---|---|---|---|---|
| E-01 | REA 6.7.0 exposes 207 tools; browser provider operational | local session | 2026-10-24T09:40Z | OBSERVED | High | Self-reported by tool |
| E-02 | Porter homepage accessible; title "Reliable & Hassle-Free Goods Transportation in India - Porter" | https://porter.in/ | 2026-10-24T09:44Z | OBSERVED | High | Homepage only |
| E-03 | Porter's public service lines are Two-Wheeler (up to 20 kg), Trucks (up to 2500 kg), Packers & Movers, Porter Enterprise, API Integration | https://porter.in/ | 2026-10-24T09:44Z | OBSERVED | High | Marketing copy |
| E-04 | Porter's public FAQ lists an extensive prohibited-items list including passports, cash/currency, jewellery, expensive electronics, medicines, batteries, fragile items, livestock, "sensitive documents" | https://porter.in/ | 2026-10-24T09:44Z | OBSERVED | High | Their policy, not law |
| E-05 | Kootr is active, positions as "India's 1st social networking app for inter-city deliveries" via verified **air travellers**, with App Store + Google Play listings, Indore address, "PIN-verified handover" | https://www.kootr.com/ | 2026-10-24T09:47Z | OBSERVED | High | Marketing claims unverified |
| E-06 | Kootr's FAQ page exists with sections for General/Traveler/Sender/Recipient/Pricing & Earnings/Disclaimer | https://www.kootr.com/faq | 2026-10-24T09:52Z | OBSERVED | High | **Answers are client-rendered accordions; text not retrievable statically** |
| E-07 | Porter publishes city presence list including Delhi NCR, Lucknow, Kanpur, Jaipur, and many metros | https://porter.in/ | 2026-10-24T09:44Z | OBSERVED | Medium | Presence ≠ service depth |
| E-08 | Porter's homepage states (their claim) 3 countries, "15 Lakh+ Driver Partners", "1 Crore+ Customers", "10 Crore+ Trips" | https://porter.in/ | 2026-10-24T09:44Z | PUBLISHED (self-claimed) | Medium | **Not independently verified; do not present as market fact** |
| E-09 | DPDP Act 2023 commencement is phased: 13 Nov 2025 (Board etc.), 13 Nov 2026 (s.6(9), s.27(1)(d)), 13 May 2027 (remaining) | egazette G.S.R. 843(E) via secondary summary | 2026-10-24 | PUBLISHED (secondary) | Medium | **Primary gazette PDF not opened; counsel to confirm** |
| E-10 | DPDP Rules 2025 notified by MeitY on 14 Nov 2025 | PIB release + secondary summary | 2026-10-24 | PUBLISHED (secondary) | Medium | Rules text not read in full |

## 5. Reproduction commands

```powershell
# Health
npx rea-agents@6.7.0 doctor --client opencode --json

# Start a CDP-observable browser (dedicated temp profile)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new `
  --remote-debugging-port=9222 --user-data-dir="$env:TEMP\rea-cdp-profile" about:blank

# Navigate (helper, standard library only)
node nav.mjs 9222 "https://porter.in/"
```

REA calls used inside the agent runtime:

```
rea.list_browser_targets({ cdp_endpoint: "http://127.0.0.1:9222" })
rea.inspect_web_page({ cdp_endpoint, target_id, allowed_origins: ["https://porter.in"],
                       observation_ms: 800, include_accessibility_text: true })
```

Evidence IDs returned by REA: `ev_42d1dc76…` (targets), `ev_435a3154…` (targets),
`ev_e2468012…` (porter page), `ev_b270f2b3…` (porter text), `ev_a3a145da…` (kootr page).

## 6. What this method cannot tell us

- **No prices.** Porter and Kootr prices require location input or app use; we did not fabricate them.
- **No volumes.** Neither site publishes verifiable GMV, bookings or take rate.
- **No flow depth.** Booking creation requires an account and real inputs; not performed.
- **No mobile UX.** App store listings were not opened; APK inspection not performed.
- **Kootr FAQ answers** are rendered client-side and were not extracted; their operational detail
  remains **UNKNOWN** rather than assumed.

## 7. Ethical boundaries observed

- No login, no account creation, no test bookings, no messages, no payments.
- No CAPTCHA bypass, no rate-limit circumvention, no scraping at volume (1 page load each).
- No private endpoints, no customer data, no reverse engineering of protected assets.
- Only public marketing pages inspected.
