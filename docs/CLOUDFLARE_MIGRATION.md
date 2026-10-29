# Cloudflare Workers migration — status, evidence, and the blocker

**Status: BLOCKED. The API does not run on Cloudflare Workers, and nothing in this document has
been deployed.** Render stays the production host. This page records what was actually tested, why
the Workers path fails, and what the realistic options are, so the decision is made on evidence
rather than on an assumption that "Node compatibility" means "runs Node frameworks".

Everything below was run on this machine on 2026-10-29 against the code in `apps/api`.

---

## 1. What was verified (PASS)

| Check | Command | Result |
|---|---|---|
| Worker bundle builds | `npx wrangler deploy --dry-run --outdir dist-worker` | PASS — 4,469 KiB upload / 831 KiB gzip, 28 text modules (migrations + `schema.sql`) |
| Worker boots and reaches Fastify | `npx wrangler dev` | PARTIAL — starts, then fails inside Fastify route registration (see §2) |
| Global-scope timer removed | `apps/api/src/services/redis.ts` | PASS — `MemoryTrackingStore` no longer calls `setInterval` in its constructor |
| Lazy tracking store | same file | PASS — Redis/memory store is constructed on first use, not at import |
| Database kept out of boot | `deferredDb()` in `apps/api/src/db/client.ts` | PASS — `buildApp()` no longer connects before the first query |
| `getDb()` retries after a failed connect | same file | PASS — a rejected connect promise is cleared instead of poisoning the isolate |
| pino resolves to its Node build | `alias` in `apps/api/wrangler.jsonc` | PASS — the `pino.symbols` crash is gone |
| Change-feed endpoint | `npm run test:api` | PASS — 5/5 in `apps/api/test/sync-state.test.ts` |
| Client sync bridges | `npm run test -w @py/web`, `-w @py/mobile` | PASS — 7/7 and 6/6 |
| Whole suite | `npm run test` | PASS — domain 108, api 92, mobile 16 |
| Typecheck | `npm run typecheck` | PASS — domain, api, web, mobile |

## 2. The blocker: Fastify's router generates code at runtime

`wrangler dev` boots the isolate, loads Fastify, and then dies while the first route is registered:

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

- `lib/handler-storage.js:82` — the per-route params-object factory, called by `addHandler()` for
  **every** route, including routes with no parameters;
- `lib/handler-storage.js:175` — the constraint matcher;
- `lib/compiler.js:203` — the route-tree matcher;
- `lib/constrainer.js:173` — the constraint deriver;
- `lib/node.js:36` — the parametric-brother matcher.

Cloudflare forbids this outright:

> For security reasons, the following are not allowed: `eval()`, `new Function`, …
> — <https://developers.cloudflare.com/workers/runtime-apis/web-standards/>

There is **no compatibility flag** that re-enables code generation; it is a V8-level restriction,
not a runtime option. `nodejs_compat` (on by default for compatibility date `2026-08-04`) does not
change it, and neither does the `cloudflare:node` HTTP bridge: the bridge delivers the request to
Fastify correctly, and Fastify then fails to register a single route.

**Consequence:** the existing Fastify application cannot be reused on Workers. This is not a
configuration problem, a bundling problem, or something a polyfill can fix. Two independent
workarounds were attempted and both are dead ends:

1. Supplying a custom logger through `loggerInstance` — fixes pino but not the router.
2. Aliasing `pino` to its Node build — same.

## 3. Compatibility matrix

| Area | Verdict | Evidence / reason |
|---|---|---|
| Fastify 5 HTTP layer | **BLOCKER** | `new Function` in `find-my-way`; see §2 |
| Socket.IO | **BLOCKER** | Workers have no HTTP `upgrade` event. Already mitigated: clients use `/v1/sync/state` + polling |
| Background jobs (`setInterval`) | **HIGH** | Timers only exist inside a request; `JOBS_ENABLED=false` in the Worker config, so OTP-counter pruning and trip-route backfill do not run. Needs a Cron Trigger |
| `pg` over TCP to Neon | **HIGH, unverified** | Documented as supported; 6 outbound connections per invocation on the free plan. Never exercised against a real Neon database here |
| `node:fs` virtual file system | **MEDIUM** | Supported, but per-isolate and ephemeral: local storage mode cannot be used. `STORAGE_PROVIDER=cloudinary` is required |
| pino | **MEDIUM** | Node build must be pinned via `alias`; the console logger in `worker.ts` exists because pino's default destination is a file descriptor |
| `ioredis` | **MEDIUM** | Works only if `REDIS_URL` is set and the connection is opened inside a request. Without it the memory store is per-isolate, so live tracking would not be shared across isolates |
| PGlite | **N/A** | Development-only; `deferredDb()` avoids bundling its WebAssembly |
| Migrations at boot | **LOW** | Already a separate step (`npm run db:migrate`); bundled as text modules for `/v1/readiness` |
| Free-tier budget | **MEDIUM** | 100k requests/day, 10 ms CPU, 50 subrequests, 128 MB. A 25 s foreground poll is roughly 3,456 requests/user/day; ~25 concurrently active users fit the daily budget |

## 4. Options, honestly

### A. Workers-native HTTP layer in front of the existing handlers (the only real Workers path)

Replace Fastify with a Workers-native router (Hono) and keep the route modules, which use a small,
regular slice of the Fastify API:

- `app.get/post/put/patch/delete`, `app.db`, `app.log`, `app.addHook`, `app.register`,
  `app.addContentTypeParser`;
- `req.params/body/query/log/headers/url/server/ip/socket`, `reply.code/header/send/status`.

A compatibility facade plus a refactor of `buildApp()` would cover it, but it also has to reproduce
CORS allow-listing, security headers, rate limiting, body limits, raw webhook bodies (signature
verification), the error envelope, and cookie handling. That is a rewrite of the security-sensitive
HTTP layer, and it cannot be called done until it is exercised against a real database and a real
deployment — neither of which is available here. Estimated: several focused sessions, then a staging
verification pass.

### B. A Node host that keeps Fastify (smallest change, different trade-offs)

The application is unchanged; only the process host moves. This preserves every route, hook, cookie
and signature behaviour that is already tested. The catch is the free-tier terms of the candidate
hosts: several "free" Node platforms are restricted to non-commercial projects, which a marketplace
with payments is not.

### C. Stay on Render (zero work, known behaviour)

Render's free web service sleeps after inactivity, which is the cold-start problem Workers would
have solved. Everything else — Neon, auth, payments, Socket.IO, jobs — keeps working exactly as it
does today.

## 5. Free-tier arithmetic (Workers, for reference)

- 100,000 requests/day. One foreground client polling `/v1/sync/state` every 25 s for an hour is 144
  requests; a user with the app open 4 hours a day is ~576 requests/day. Budget: ~170 daily-active
  users if that were the only traffic.
- The feed is one SQL statement per poll, so it also costs one database round trip. Neon's free plan
  is 100 compute-hours/month; a poll every 25 s from a handful of users keeps the compute awake far
  more than a 5-minute idle timeout would.
- 10 ms CPU per request is enough for Fastify-class routing but not for large JSON transforms; the
  bundle is 831 KiB gzip, well under the 3 MB free limit.

## 6. Commands (for when the blocker is resolved)

```powershell
# Bundle only — proves nothing about runtime
npm run build:worker -w @py/api

# Local Worker, with the real Neon URL and the real secrets
cd apps/api
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

# Deploy (only after the HTTP layer is Workers-compatible)
npm run deploy:worker -w @py/api
```

`PUBLIC_API_URL` in `apps/api/wrangler.jsonc` is a placeholder and must be replaced with the real
`workers.dev` (or custom domain) URL before deploy, because it is embedded in file-signing and
OAuth callbacks.

**Rollback:** no production traffic is switched by any of this. Render keeps serving; deleting the
Worker (`npx wrangler delete`) has no effect on the live API.

## 7. Not verified

- No Cloudflare account or credentials were available: no real `workers.dev` deployment exists.
- No Neon credentials and no local PostgreSQL: no Worker request ever reached a database.
- No staging environment: nothing here proves the API works under load, or that Neon's pooled
  connection limit survives the Worker's per-invocation connections.
- Google OAuth redirect URIs, payment webhooks and Cloudinary callbacks would all need their
  registered URLs updated for any new host; none were changed.

## 8. What did ship from this work

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
