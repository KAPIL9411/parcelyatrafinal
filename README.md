# Parcel Yatra

An inter-city parcel marketplace for the Bareilly ⇄ Delhi NCR and Bareilly ⇄ Lucknow corridors.
A sender posts a parcel; a verified traveller who is already making that journey carries it. Both
sides confirm handover with one-time codes, and the sender can raise a problem for 72 hours after
delivery.

**This is a pilot build. Payments are sandbox-only. Payouts are disabled. It is not production-ready
and it makes no compliance, security or market claim.** Read
[`docs/BUILD_NOTES.md`](docs/BUILD_NOTES.md) before using it for anything real, and
[`parcel-yatra-startup-pack/AGENTS.md`](parcel-yatra-startup-pack/AGENTS.md) for the rules the pack
sets.

---

## What works

- Phone OTP sign-in (sandbox), sessions, refresh rotation.
- Send wizard: route, category, weight, prohibited-item checks, pilot limits, live quote.
- Matching against published trips, with a reason code on every match.
- Booking: request → accept → sandbox payment → pickup code → in transit → arrived → delivery code.
- Verification submission (photo ID + selfie) and a staff decision queue.
- 72-hour problem window, case evidence, staff resolution, payout freeze.
- Traveller trip publishing (car only at pilot).
- Staff console: verification queue, booking search, case queue, refund approval, audit log.
- Static pricing, prohibited items, safety, help, and draft legal pages.
- An Expo (React Native) app in `apps/mobile` that uses the same API and session rules; see
  [`docs/BUILD_NOTES.md` §6](docs/BUILD_NOTES.md#6-mobile-app-expo--what-exists-and-what-it-refuses-to-fake).
- A server-driven home screen: hero, gradient, decoration, sections and their order come from
  `GET /v1/home`, so a campaign ships without an app update. Staff edit it in the console under
  **Homepage** (presets, drag reorder, raw JSON with validator errors, publish, rollback); see
  [`docs/HOMEPAGE_CMS.md`](docs/HOMEPAGE_CMS.md).

## What is deliberately off

| Thing | State |
| --- | --- |
| Live payments | Refused at boot. `PAYMENTS_LIVE=true` is a startup error. |
| Payout release | `501 PAYOUTS_NOT_ENABLED`. |
| Split case settlement | `501 SPLIT_SETTLEMENT_NOT_ENABLED`; the staff option is disabled. |
| Bike / bus / train / air | Refused at boot; car only. |
| External SMS / email | None. Notifications are in-app rows only. |
| Real object storage | Local authenticated upload sink (dev only). |
| Aadhaar | Never collected or stored. |

---

## Run it

Requirements: **Node 22+** (built on 24), npm 10+. No Docker, no external database.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

- Web: <http://localhost:5173>
- API: <http://127.0.0.1:3000/v1/health>
- Mobile: `npm run start -w @py/mobile`, then open the project in Expo Go (SDK 58 includes the
  community date picker) or a development build. Nothing was launched here — no phone, emulator or
  Android SDK exists on the build machine; see `docs/BUILD_NOTES.md` §6.

First boot applies `apps/api/src/db/schema.sql` to an embedded PGlite database in
`apps/api/data/pgdata` and seeds demo data. The web dev server proxies `/v1` to the API, so the
browser sees one origin.

Run the two apps separately if you prefer:

```powershell
npm run dev:api
npm run dev:web
```

### Demo accounts (development seed only)

The OTP is shown on the login screen in dev ("Fill NNNNNN and continue"), on the web app and on the
mobile app's local preview when it points at a dev API. No SMS is sent.

| Phone | Name | What it is |
| --- | --- | --- |
| `+91 90000 00001` | Aarti Verma | Sender. Not verified as a traveller. |
| `+91 90000 00002` | Imran Sheikh | Verified traveller, has a Bareilly → Delhi trip. |
| `+91 90000 00003` | Neha Chauhan | Verified traveller, has a Bareilly → Lucknow trip. |
| `+91 90000 00009` | Ops Demo | Staff: all console roles. Console at `/admin`. |

These numbers, names and trips are fictional. Do not treat them as real users or real demand.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | API + web together. |
| `npm run typecheck` | TypeScript for domain, API, web and mobile. |
| `npm test` | Domain, API and mobile test suites. |
| `npm run build` | Bundle the API (esbuild) and build the web app (Vite). |
| `npm run db:migrate` | Apply `schema.sql` to the configured database. |
| `npm run db:seed` | Insert demo data. |
| `npm run db:reset` | Drop and rebuild the local database. |
| `node scripts/smoke.mjs` | 43-check HTTP smoke test against a running API. |
| `node scripts/smoke.mjs --reset` | Same, after restoring the seed (use this on a used database). |

The smoke test caches tokens in `.smoke-tokens.json` because sign-in is rate limited per number.
Both the cache and `apps/api/data/` are gitignored.

---

## Deploy

The API, web console, database and app deploy independently. The repo already contains the pieces
each host needs; nothing below requires a new service.

| Piece | Host | Build / config |
| --- | --- | --- |
| API | Render web service from `Dockerfile` | Image runs `dist/migrate.js` then `dist/index.js` |
| Web + staff console | Vercel, root `apps/web` | `vercel.json` rewrites all paths to `index.html` |
| Database | Neon Postgres | Set `DATABASE_URL`; `DATABASE_SSL=require` |
| App | EAS, `apps/mobile/eas.json` | `EXPO_PUBLIC_API_BASE` baked into the bundle |

1. **Database.** Create a Neon project and copy its connection string. The container migrates before
   it listens, so no separate migration step is needed; a failed migration stops the boot.
2. **API.** Set `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL=require`, and every secret from
   `.env.example` to a generated value (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
   `PUBLIC_API_URL` must include `/v1`. `WEB_ORIGINS` lists exact origins — a `https://*.vercel.app`
   pattern is refused. `ADMIN_WEB_URL` must differ from `PUBLIC_WEB_URL`. `PAYMENTS_LIVE` and
   `ENABLE_DEV_ENDPOINTS` must stay false; `assertSafetyRails` refuses to boot otherwise, and it also
   refuses default secrets. Leave `AUTO_SEED` unset (it defaults to false in production).
3. **Web.** On Vercel, set the project root to `apps/web`, build with `npm run build -w @py/web`, and
   set `VITE_API_BASE=https://<api-origin>/v1`. It is read at build time, so changing it needs a
   redeploy. Production cookies are `SameSite=None; Secure`, which is why the API must list the exact
   Vercel origin in `WEB_ORIGINS`.
4. **App.** Build with EAS (`eas build --platform android --profile preview`, or `production`). Every
   `EXPO_PUBLIC_*` value is embedded in the binary: a wrong API URL is fixed by a new build, not by a
   setting on the phone. `apps/mobile/eas.json` currently points at
   `https://parcelyatrafinal.onrender.com/v1`.
5. **Storage.** `STORAGE_PROVIDER=local` writes to the host's disk. Render's disk is ephemeral, so
   uploads — including homepage campaign artwork — disappear on redeploy. Switch to
   `STORAGE_PROVIDER=cloudinary` with the three `CLOUDINARY_*` keys before relying on uploaded files
   in production.
6. **Homepage content.** Deployment order for the server-driven home (API before console) is in
   [`docs/HOMEPAGE_CMS.md` §6](docs/HOMEPAGE_CMS.md#6-environment-and-deployment).

Never commit a filled `.env`; the example is placeholders only.

---

## Layout

```
apps/
  api/            Fastify + PGlite. Routes in src/routes, schema in src/db/schema.sql.
    data/         Local database and uploads (gitignored).
  web/            Vite + React 19 + TypeScript + Tailwind v4 + React Router + TanStack Query.
    src/screens/  One file per screen; /admin is lazy-loaded and staff-gated.
  mobile/         Expo SDK 58 + Expo Router. Routes in app/, shared code in src/. Android/iOS target;
                  a React Native Web preview exists for local development only.
packages/
  domain/         Framework-free pricing, enums, booking state machine, homepage contract. 90 tests.
scripts/
  smoke.mjs       End-to-end HTTP checks.
docs/
  BUILD_NOTES.md  Every departure from the pack, and every known gap.
parcel-yatra-startup-pack/
                  The specification. Treat it as read-only source material.
```

Money is an integer number of paise everywhere (`*_paise`). The server computes every amount; a
client-supplied amount is ignored. The pricing formula is `v1.0` and is a **hypothesis** from the
pack, not a measured market rate.

## Design

The visual language follows Porter's public site: **Titillium Web** (SIL Open Font License, bundled
via `@fontsource/titillium-web`) with a blue-led palette.

| Token | Value |
| --- | --- |
| Brand | `#0A57FF` / `#2962FF` |
| Deep brand | `#0039B8` |
| Navy | `#001366` |
| Ink | `#151C28` |
| Tint | `#F0F3FF` / `#EEF2FF` |
| Yellow accent | `#FEDF00` |
| Radii | 8–10 px and pills |

Only the font and colour language are borrowed. No Porter copy, layout, imagery or other asset is
copied.

## Screens

| Landing | Booking, ready for pickup |
| --- | --- |
| ![Landing page](docs/screenshots/landing.png) | ![Booking detail](docs/screenshots/booking-pickup-ready.png) |

Both were captured from the development build, which is why the "Test mode" chips and the visible
pickup code appear. In a real build the code arrives by SMS and none of those affordances exist.

---

## Safety rails in code

- `assertSafetyRails()` runs before the server listens. It refuses production with sandbox-only
  settings, dev endpoints, mock payments, default secrets, non-car modes, or a shared admin origin.
- `ENABLE_DEV_ENDPOINTS` is refused in production. Dev routes reveal sandbox OTPs, simulate signed
  webhooks, advance a booking, and reset the seed.
- Every "not yours" path returns `NOT_FOUND`, never `403`, so the API does not disclose that a
  resource exists.
- Uploads are JPEG/PNG only, ≤10 MB, and scoped to the caller's own object key.
- Payout release and split settlement return `501` rather than pretending to move money.

## Gates that are still open

The build does not close any launch gate. From
`parcel-yatra-startup-pack/legal/LEGAL_REGULATORY_MATRIX.md` §8:

- **GATE-1** counsel memo on marketplace classification and ToS liability.
- **GATE-2** written confirmation that car-based peer carriage needs no transport permit.
- **GATE-3** payment provider written confirmation of the fund-flow model.
- **GATE-4** GST/tax opinion on invoicing and TDS.
- **GATE-5** insurance position, or a prominent "uninsured" disclosure.
- **GATE-6** DPDP-aligned notice, consent records and deletion process.
- **GATE-7** grievance officer appointed and published.

Until GATE-3 closes in writing, no real money may move through this code.

## Licence and legal documents

The legal pages in the app are **drafts**. They are not legal advice and have not been reviewed by a
qualified Indian lawyer. The pack's `legal/` directory holds the drafts; do not present either as
binding.

Titillium Web is licensed under the SIL Open Font License 1.1. The rest of this repository is
internal pilot material; no licence for redistribution has been granted.
