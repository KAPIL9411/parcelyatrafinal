# Cloudflare Workers migration — status, evidence, and limits

**Status: deployed and verified against Neon. Production traffic still on Render.**

- Worker: <https://parcel-yatra-api.parcelyatra.workers.dev> (`parcel-yatra-api`, version
  `ba2fb391-faaf-416f-9332-b7e0a90ff91d`, deployed 2026-10-29)
- Database: the same Neon project Render uses. No schema or data change; no migration was run by the
  Worker (`MIGRATE_ON_BOOT=false`).
- Render (`https://parcelyatrafinal.onrender.com`) keeps serving production and remains the rollback.
- Nothing in the web or mobile clients points at the Worker yet.

Everything below was measured on this machine on 2026-10-29 against the deployed Worker, not against
a local emulator.

---

## 1. What was built

Fastify cannot run on Workers (see §3), so the transport was replaced, not the application:

- `apps/api/src/http/fastify-compat.ts` — a Hono-backed implementation of the small Fastify API
  slice the route modules use (`app.get/post/put/patch/delete`, `app.register({prefix})`,
  `app.addHook('preHandler')`, `app.addContentTypeParser`, `app.db`, `app.log`,
  `req.params/body/query/headers/log/id/ip/url/server/routeOptions/socket`,
  `reply.code/status/header/type/getHeader/send`). Anything outside that slice throws at boot
  instead of behaving differently.
- `apps/api/src/routes/register.ts` — the route table, prefixes and auth scopes, extracted from
  `buildApp()`. Both hosts mount this one list, so they cannot diverge.
- `apps/api/src/worker.ts` — the Workers entry: lazy boot, safety rails, `deferredDb()`, console
  logger, `registerRoutes()`, and one database connection per request.
- `apps/api/src/http/{security,error-response,rate-limit,write-limit,logger}.ts` — the pieces that
  used to come from `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` and pino.
- `apps/api/src/app.ts` — still Fastify on Node/Render, now using the shared table and the shared
  error renderer.

The route modules, SQL, Zod validation, auth, cookies, OTP, payments, Cloudinary and webhooks are
unchanged.

### Bugs that only the real runtime exposed

Each of these was found by deploying and looking at the actual response, not by a local test.

1. **`ensureStorage()` at registration** did `mkdir`. A Worker has no writable volume, so the whole
   Worker failed to boot. Removed — `putObject()` already creates its directory on first write.
2. **Missing non-secret configuration.** The 14 secrets were uploaded, but `PAYMENT_PROVIDER` and
   `SMS_PROVIDER` are not secrets. `assertSafetyRails` therefore refused to start in production:

   ```
   Refusing to start:
     - Refusing to start in production with PAYMENT_PROVIDER=mock.
     - SMS_PROVIDER=log in production would print OTP codes to stdout.
   ```

   Every route answered `500` / Cloudflare `1101`. The values were recovered from the live Render
   API rather than guessed: its CORS allow-list named `https://parcelyatra.vercel.app` and
   `https://admin-parcelyatra.vercel.app` (the defaults in `config.ts` name `parcelyatrafinal…`,
   which Render refuses), and `/v1/auth/google/authorize` returned the real Google client id and
   redirect URI. All of it is now in `wrangler.jsonc` → `vars`.
3. **`PUBLIC_API_URL` was missing its `/v1` suffix.** The file helpers concatenate that value
   directly with `/files/…`, so every upload and signed URL would have 404'd. Fixed and verified by
   uploading through the returned URL.
4. **`pg.Pool` reused TCP sockets across requests.** Workers forbid that — "TCP sockets cannot be
   created in global scope and shared across requests"
   (<https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/>). The runtime closes the
   socket when the request ends; the pool then handed the next request a dead one. Measured on the
   deployed Worker: `/v1/homepage` alternated `500` (10.5 s) / `200` (1.5 s) forever. Fixed by
   giving each request its own `pg.Client` (carried to the routes through `AsyncLocalStorage`, so no
   route module changed) and letting **Hyperdrive** do the pooling, exactly as Cloudflare documents:
   "Create a new client instance for each request. Hyperdrive maintains the underlying database
   connection pool, so creating a new client is fast."
   (<https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/>)
5. **`/v1/readiness` could not read the migrations.** It used `node:fs`, which does not exist on
   Workers, so a healthy deployment reported `migrations: down / unreadable` and `503`.
   `scripts/gen-migrations.mjs` now compiles `migrations/*.sql` into
   `src/db/migrations.generated.ts` (run automatically by `deploy:worker`), and
   `test/migration-manifest.test.ts` fails if that copy is stale. Checksums are computed over
   LF-normalised text so a Windows checkout and a Linux deployment agree.
6. **`/v1/health` reported `storage: degraded`** because it probed a local directory that Workers do
   not have. With `STORAGE_PROVIDER=cloudinary` it now checks the credential set instead (the boot
   rails already require those three values).
7. **The first query timed out even with a warm pool.** Letting `query()` connect implicitly arms
   node-postgres' query timer while the Hyperdrive handshake is still in flight. An explicit
   `client.connect()` before the first query fixed it.

## 2. What was verified (PASS)

| Check | Evidence | Result |
|---|---|---|
| Deploy | `npm run deploy:worker -w @py/api` | PASS — 2,939 KiB upload / 565 KiB gzip, startup 63 ms |
| Root | `GET /` | PASS — `200 {"name":"Parcel Yatra API","status":"ok","version":"0.1.0"}` |
| Health | `GET /v1/health` | PASS — `200`, `database: ok`, `storage: ok`, `queue: ok` |
| Readiness | `GET /v1/readiness` | PASS — `200 {"status":"ready"}`, migrations `ok` (no drift, none pending) |
| Worker → Neon | health/readiness/homepage | PASS — real reads against the production database |
| Homepage | `GET /v1/homepage` | PASS — `200`, schema version 33, identical to Render's payload |
| Auth required | `GET /v1/me`, `GET /v1/sync/state` | PASS — `401 AUTH_REQUIRED`, same envelope as Render |
| Authenticated read | minted access token for a live session, then `GET /v1/me` and `GET /v1/sync/state` | PASS — `200` on both hosts, identical key sets, `id` matches the token subject |
| Authenticated write | `PATCH /v1/me` through the Worker, then `GET /v1/me` on Render | PASS — `200`; the write is visible on Render immediately (one database) |
| Cloudinary upload | `POST /v1/files/upload-url` → `PUT` the returned URL → `GET /v1/files/object/…` | PASS — `201`/`201`/`200`, bytes identical, URL carries the `/v1` prefix |
| Google sign-in entry | `GET /v1/auth/google/authorize` | PASS — `200`, same client id, redirect URI, scopes, PKCE challenge as Render |
| CORS | allowed origin, disallowed origin, preflight | PASS — allowed origin echoed, disallowed not echoed, preflight `204` with the same method/header lists |
| Security headers | CSP, COOP, CORP, HSTS, nosniff, frame options, referrer policy | PASS — identical to Render |
| Error envelopes | `401`, `404`, `405→404`, malformed JSON `400`, unknown method | PASS — same `code`/`message` shape |
| Latency (warm) | `curl -w` against both hosts | PASS — Worker `0.47–0.76 s`, Render `0.49–1.03 s`; SQL 3–10 ms warm, 127 ms on the first query per isolate |
| Whole API suite | `npm run test -w @py/api` | PASS — 121/121 (including the new manifest test) |
| Typecheck | `npm run typecheck -w @py/api` | PASS |
| Fastify vs Workers parity | `apps/api/test/hono-parity.test.ts` | PASS — 21/21 |
| Worker entry | `apps/api/test/worker-entry.test.ts` | PASS — 6/6 |

The only header difference found by the Render-vs-Worker sweep is `Vary: Accept-Encoding`: Render
adds it from `@fastify/compress`, the Worker does not compress and Cloudflare handles encoding at
the edge. Responses are identical; only a cache key differs.

## 3. Why Fastify itself cannot run on Workers

`wrangler dev` booted the isolate, loaded Fastify, and died while the first route was registered:

```
Uncaught EvalError: Code generation from strings disallowed for this context
    at new Function (<anonymous>)
    at HandlerStorage._compileCreateParamsObject (find-my-way/lib/handler-storage.js:82)
    at HandlerStorage.addHandler (…:31)
    at Node.addRoute (find-my-way/lib/node.js)
    at Router._on (find-my-way/index.js)
    at Router.on
    at Router.all
    at Object._setNotFoundHandler (fastify/fastify.js)
```

`find-my-way` 9.10.0 (Fastify 5's only router) builds its hot paths with `new Function`:

- `lib/handler-storage.js:82` — the per-route params-object factory, called for **every** route;
- `lib/handler-storage.js:175` — the constraint matcher;
- `lib/compiler.js:203` — the route-tree matcher;
- `lib/constrainer.js:173` — the constraint deriver;
- `lib/node.js:36` — the parametric-brother matcher.

Cloudflare forbids this outright:

> For security reasons, the following are not allowed: `eval()`, `new Function`, …
> — <https://developers.cloudflare.com/workers/runtime-apis/web-standards/>

There is **no compatibility flag** that re-enables code generation; it is a V8-level restriction.
`nodejs_compat` (on by default for compatibility date `2026-08-04`) does not change it, and neither
does the `cloudflare:node` HTTP bridge: the bridge delivers the request to Fastify correctly, and
Fastify then fails to register a single route. That is why the Worker entry no longer uses it.

Hono is used only for routing: it compiles regular expressions at registration time and never
evaluates a string. The facade above it reproduces the Fastify behaviour the route modules expect.

## 4. Compatibility matrix

| Area | Verdict | Evidence / reason |
|---|---|---|
| Fastify 5 HTTP layer | **BLOCKER (bypassed)** | `new Function` in `find-my-way`; replaced by the Hono facade |
| Hono routing, 121 routes | **PASS** | Real table served on Workers; parity + entry tests |
| CORS / security headers | **PASS** | Compared per request against the live Render API |
| Body limits and parsers | **PASS** | 1 MiB default, 10 MiB files, raw webhook bodies, 413/415 envelopes; a real PNG went through the upload sink byte-for-byte |
| `pg` + Neon over TCP | **PASS, with Hyperdrive** | Direct pooling is unusable (§1.4). Hyperdrive (free plan, 100k queries/day) with one `pg.Client` per request: warm SQL 3–10 ms |
| Cloudinary | **PASS** | Upload authorisation, signed write, authenticated read-back |
| Google OAuth | **PASS (entry), NOT VERIFIED (callback)** | `/authorize` matches Render; the code exchange needs a browser round-trip |
| Rate limiting | **PARTIAL** | Counted per isolate, not global. Stops double-submits and one abusive client; not a distributed defence. Global enforcement needs a Durable Object |
| Socket.IO | **BLOCKER** | Workers have no HTTP `upgrade` event. Mitigated: clients use `/v1/sync/state` + polling |
| Background jobs (`setInterval`) | **HIGH** | Timers do not outlive a request; `JOBS_ENABLED=false`. OTP-counter pruning and trip-route backfill need a Cron Trigger |
| Live tracking store | **HIGH** | The default store is per-isolate memory. Cross-isolate tracking needs `REDIS_URL` or a Durable Object |
| Migrations at boot | **LOW** | Still a separate step (`npm run db:migrate`); `/v1/readiness` reads the compiled manifest |
| Free-tier budget | **MEDIUM** | 100k requests/day, 10 ms CPU, 50 subrequests, 128 MB; Hyperdrive free adds 100k queries/day. A 25 s foreground poll is ~3,456 requests/user/day; ~25 concurrently active users fit |

## 5. Behaviour parity, case by case

`apps/api/test/hono-parity.test.ts` sends the same request through the Fastify app and the Workers
layer over one PGlite database and compares status, `content-type`, selected headers and the body:

- `200` root and health; `304` on a matching `ETag`; `204` CORS preflight; `HEAD` with no body;
- `400` malformed and empty JSON; `401` missing and invalid token; `404` unknown path and unknown
  method; `413` over the 1 MiB limit; `415` unsupported content type; `429` route rate limit;
- CORS: allowed origin echoed, disallowed origin not echoed, preflight methods/headers/credentials;
- the full helmet header set (CSP, COOP, CORP, referrer policy, nosniff, frame options, …);
- a wildcard upload path (`/v1/files/object/kyc_id/...`) matched and still authenticated;
- the webhook raw-body parser, including its (existing) 500 on malformed JSON;
- a binary `image/png` response with its content type and byte-for-byte body.

The same sweep was then run against the two live hosts for `/`, health, readiness, `401`s,
`/v1/cities`, `/v1/config`, `/v1/homepage`, Google authorize, `404`, wrong method, preflight,
disallowed origin and malformed JSON: all identical apart from request ids, latencies and the
`Vary` header noted in §2.

## 6. Known limits on Workers

- **Rate limiting is per isolate.** `RATE_LIMIT_ENABLED` stays on, and per-route limits work, but a
  distributed attacker sees a higher effective limit. This is a best-effort guard, not a security
  boundary. A Durable Object or shared Redis is the follow-up.
- **No timers.** OTP-counter pruning and the trip-route backfill do not run. A Cron Trigger (or a
  scheduled GitHub Action against an authenticated endpoint) is required.
- **Live tracking is per isolate** unless `REDIS_URL` is configured. The change feed
  (`/v1/sync/state`) and tracking polling still work; only the in-memory geofence/telemetry store is
  local.
- **`statement_timeout` is not applied on Workers.** node-postgres sends it as a startup parameter
  and Hyperdrive did not honour it, which hung the query. Hyperdrive enforces its own 60 s statement
  limit; the client keeps a 20 s query timeout.
- **Hyperdrive has a 100k queries/day free ceiling.** Every statement through Hyperdrive counts,
  including the two the auth hook runs on each authenticated request. Exceeding it fails queries
  until 00:00 UTC.
- **Local storage is not durable.** `STORAGE_PROVIDER=cloudinary` is required and set.

## 7. Commands

```powershell
# Regenerate the compiled migration manifest (deploy:worker does this automatically)
npm run gen:migrations -w @py/api

# Bundle only — proves nothing about runtime
npm run build:worker -w @py/api

# Local Worker (Miniflare). Without a DATABASE_URL it boots in development mode and only the
# routes that do not touch the database will answer.
cd apps/api
npx wrangler dev --var NODE_ENV:development --var JOBS_ENABLED:false --var AUTO_SEED:false

# Secrets (one per command, never on the command line in a shared shell)
npx wrangler secret put DATABASE_URL
npx wrangler secret put JWT_ACCESS_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
npx wrangler secret put OTP_HMAC_SECRET
npx wrangler secret put PHONE_HASH_SECRET
npx wrangler secret put OTP_SEAL_SECRET
npx wrangler secret put FILE_SIGNING_SECRET
npx wrangler secret put PAYMENT_WEBHOOK_SECRET
# plus CLOUDINARY_*, GOOGLE_CLIENT_SECRET, FAST2SMS_API_KEY, REDIS_URL for the configured providers

# Hyperdrive: one config, pointing at the DIRECT Neon endpoint (the -pooler host hung)
npx wrangler hyperdrive create parcel-yatra-neon-direct --connection-string="postgres://…"

# Migrations still run from a machine with Node, not from the Worker
npm run db:migrate -w @py/api

# Deploy (regenerates the manifest first)
npm run deploy:worker -w @py/api
```

`wrangler.jsonc` holds the non-secret production configuration copied from Render:
`PUBLIC_API_URL` (must end in `/v1`), `PUBLIC_WEB_URL`, `ADMIN_WEB_URL`, `PAYMENT_PROVIDER`,
`SMS_PROVIDER`, `GOOGLE_OAUTH_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`,
`STORAGE_PROVIDER=cloudinary`, `DATABASE_SSL=require`, `TRUST_PROXY=true` (so the per-IP OTP budget
reads `cf-connecting-ip`).

**Rollback:** Render is untouched and still serving. `npx wrangler delete` removes the Worker with no
effect on the live API. The Hyperdrive config and the Neon database are independent of the Worker.

## 8. Not verified

- **`SMS_PROVIDER=fast2sms` is inferred, not confirmed.** It was set because `FAST2SMS_API_KEY` is
  present as a Worker secret; compare the Render Environment tab before switching traffic. No OTP
  was sent — that would have texted a real phone number.
- **Google OAuth callback** (`/v1/auth/google/callback`) was not exercised: it needs a browser
  round-trip with a real Google account.
- **Payment webhooks** were not replayed: a valid signature creates real payment records.
- **Live tracking writes** (`POST /v1/tracking/…`) were not exercised: they need a live trip.
- **Socket.IO** is not available on Workers at all (see §4); clients already fall back to polling.
- **Cron jobs** (OTP-counter prune, trip-route backfill) do not run on Workers.
- **Load and concurrency** were not tested. The free plan allows 6 simultaneous outbound connections
  per invocation and 100k requests/day; the pilot's ~25 concurrent users is an estimate, not a
  measurement.
- **Clients still point at Render.** `apps/mobile/app.json`, `apps/mobile/eas.json`,
  `apps/mobile/src/api/client.ts`, `apps/web/src/components/LiveTrackingMap.tsx` and
  `EXPO_PUBLIC_API_BASE` all reference `parcelyatrafinal.onrender.com`. Switching them is a separate,
  reversible step, and the Android build must be re-cut for a native URL change.
- **Registered third-party URLs still name the old hosts**: Google OAuth redirect URIs, payment
  webhook URLs and any Cloudinary callback. None were changed.

## 9. What also shipped from this work

Independent of the host, and verified by the suite:

- `GET /v1/sync/state` — a per-user change feed of opaque revisions plus unread counts, staff queues
  only for staff, `cache-control: no-store`.
- Web and mobile `SyncBridge` — foreground polling that invalidates only the query families whose
  revision moved, pauses when hidden/backgrounded, resumes on visibility/focus/online/AppState, and
  backs off on failure.
- Removal of the ad-hoc `refetchInterval` polling that the feed now covers, keeping only the
  discovery and live-position polls where seconds matter.
- `deferredDb()`, lazy `getDb()` retry, lazy tracking store — all three are correct on Node too and
  remove module-scope side effects.
- `scripts/gen-migrations.mjs` + `test/migration-manifest.test.ts` — one compiled source of migration
  text for hosts without a filesystem, with a test that refuses to let it drift.
