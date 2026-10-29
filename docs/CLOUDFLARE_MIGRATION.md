# Cloudflare Workers migration — status, evidence, and limits

**Status: implemented, not deployed.** The API can now run on Cloudflare Workers through a
Workers-native HTTP layer. Render is still the production host and no traffic has been switched.
The Worker has been bundled and its entry exercised locally; it has **not** been deployed to a real
Cloudflare account and has **not** talked to Neon.

Everything below was run on this machine on 2026-10-29 against the code in `apps/api`.

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
  logger, and `registerRoutes()`.
- `apps/api/src/http/{security,error-response,rate-limit,write-limit,logger}.ts` — the pieces that
  used to come from `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` and pino.
- `apps/api/src/app.ts` — still Fastify on Node/Render, now using the shared table and the shared
  error renderer.

The route modules, SQL, Zod validation, auth, cookies, OTP, payments, Cloudinary and webhooks are
unchanged.

One real bug surfaced only in the Workers runtime: `fileRoutes()` called `ensureStorage()` while
registering, which does `mkdir`. A Worker has no writable volume, so **the whole Worker failed to
boot** (`Error: operation not permitted`). The call was redundant — `putObject()` already creates its
directory on the first write — so it was removed. This is exactly the class of problem the Node
tests could not catch, and the reason `wrangler dev` is part of the check list.

## 2. What was verified (PASS)

| Check | Command / file | Result |
|---|---|---|
| Worker bundle builds | `npm run build:worker -w @py/api` | PASS — 2,939 KiB upload / 565 KiB gzip, 28 text modules (migrations + `schema.sql`) |
| Worker runs in the real runtime | `npx wrangler dev` (workerd) | PASS — `GET /` 200, `GET /v1/nope` 404, `OPTIONS /v1/me` 204, `GET /v1/me` 401, security/CORS/rate-limit headers correct. `GET /v1/health` 503 with `database: down` because no `DATABASE_URL` was supplied |
| Worker entry boots and serves | `apps/api/test/worker-entry.test.ts` | PASS — 6/6: root, health, 404, 401, preflight, wildcard |
| Fastify vs Workers parity | `apps/api/test/hono-parity.test.ts` | PASS — 21/21 (status, headers, bodies; see §5) |
| Whole API suite | `npm run test -w @py/api` | PASS — 119/119 |
| Whole repository suite | `npm run test` | PASS — domain 108, api 119, web 7, mobile 16 |
| Typecheck | `npm run typecheck` | PASS — domain, api, web, mobile |
| Global-scope timer removed | `apps/api/src/services/redis.ts` | PASS — `MemoryTrackingStore` sweeps on write, no constructor timer |
| Lazy tracking store | same file | PASS — constructed on first use, not at import |
| Database kept out of boot | `deferredDb()` in `apps/api/src/db/client.ts` | PASS |
| `getDb()` retries after a failed connect | same file | PASS — a rejected connect promise is cleared |
| pino resolves to its Node build | `alias` in `apps/api/wrangler.jsonc` | PASS — the `pino.symbols` crash is gone |

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
| Hono routing, 121 routes | **PASS** | `hono-parity.test.ts` and `worker-entry.test.ts` register and serve the real table |
| CORS / security headers | **PASS (parity)** | Captured from the running Fastify app, reproduced, compared per request |
| Body limits and parsers | **PASS (parity)** | 1 MiB default, 10 MiB files, raw webhook bodies, 413/415 envelopes |
| Rate limiting | **PARTIAL** | Counted per isolate, not global. Stops double-submits and one abusive client; not a distributed defence. Global enforcement needs a Durable Object |
| Socket.IO | **BLOCKER** | Workers have no HTTP `upgrade` event. Already mitigated: clients use `/v1/sync/state` + polling |
| Background jobs (`setInterval`) | **HIGH** | Timers do not outlive a request; `JOBS_ENABLED=false`. OTP-counter pruning and trip-route backfill need a Cron Trigger |
| Live tracking store | **HIGH** | The default store is per-isolate memory. Cross-isolate tracking needs `REDIS_URL` or a Durable Object |
| `pg` over TCP to Neon | **HIGH, unverified** | Documented as supported; 6 outbound connections per invocation on the free plan. Never exercised against a real Neon database here |
| `node:fs` virtual file system | **MEDIUM** | Supported but per-isolate and ephemeral: `STORAGE_PROVIDER=cloudinary` is required |
| pino | **MEDIUM** | Node build pinned via `alias`; the Worker uses a console JSON logger instead |
| PGlite | **N/A** | Development-only; `deferredDb()` keeps its WebAssembly out of the Worker path |
| Migrations at boot | **LOW** | Already a separate step (`npm run db:migrate`); bundled as text modules for `/v1/readiness` |
| Free-tier budget | **MEDIUM** | 100k requests/day, 10 ms CPU, 50 subrequests, 128 MB. A 25 s foreground poll is roughly 3,456 requests/user/day; ~25 concurrently active users fit the daily budget |

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

Two intentional differences remain, both documented above: rate-limit counters are per isolate, and
there are no background jobs.

## 6. Known limits on Workers

- **Rate limiting is per isolate.** `RATE_LIMIT_ENABLED` stays on, and per-route limits work, but a
  distributed attacker sees a higher effective limit. This is a best-effort guard, not a security
  boundary. A Durable Object or shared Redis is the follow-up.
- **No timers.** OTP-counter pruning and the trip-route backfill do not run. A Cron Trigger (or a
  scheduled GitHub Action against an authenticated endpoint) is required.
- **Live tracking is per isolate** unless `REDIS_URL` is configured. The change feed
  (`/v1/sync/state`) and tracking polling still work; only the in-memory geofence/telemetry store is
  local.
- **Local storage is not durable.** Use `STORAGE_PROVIDER=cloudinary`.

## 7. Commands

```powershell
# Bundle only — proves nothing about runtime
npm run build:worker -w @py/api

# Local Worker (Miniflare). Without a DATABASE_URL it boots in development mode and only the
# routes that do not touch the database will answer.
cd apps/api
npx wrangler dev --var NODE_ENV:development --var JOBS_ENABLED:false --var AUTO_SEED:false

# Local Worker against Neon, with the real secrets
npx wrangler dev --var DATABASE_URL:"postgres://…neon.tech/…?sslmode=require"

# Secrets (one per command, never on the command line in a shared shell)
npx wrangler secret put DATABASE_URL
npx wrangler secret put JWT_ACCESS_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
npx wrangler secret put OTP_HMAC_SECRET
npx wrangler secret put PHONE_HASH_SECRET
npx wrangler secret put OTP_SEAL_SECRET
npx wrangler secret put FILE_SIGNING_SECRET
npx wrangler secret put PAYMENT_WEBHOOK_SECRET

# Migrations still run from a machine with Node, not from the Worker
npm run db:migrate -w @py/api

# Deploy
npm run deploy:worker -w @py/api
```

`PUBLIC_API_URL` in `apps/api/wrangler.jsonc` is a placeholder and must be replaced with the real
`workers.dev` (or custom domain) URL before deploy, because it is embedded in file-signing and OAuth
callbacks. `TRUST_PROXY=true` is set there so the per-IP OTP budget reads the client address from
`cf-connecting-ip`.

**Rollback:** no production traffic is switched by any of this. Render keeps serving; deleting the
Worker (`npx wrangler delete`) has no effect on the live API.

## 8. Not verified

- No Cloudflare account or credentials were available: no real `workers.dev` deployment exists. The
  Worker has run locally in `wrangler dev` (workerd), but not on Cloudflare's network.
- No Neon credentials and no local PostgreSQL: no Worker request ever reached a database. The local
  health check correctly reported `database: down` instead of crashing.
- No staging environment: nothing here proves the API works under load, or that Neon's pooled
  connection limit survives the Worker's per-invocation connections.
- Google OAuth redirect URIs, payment webhooks and Cloudinary callbacks would all need their
  registered URLs updated for any new host; none were changed.

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
