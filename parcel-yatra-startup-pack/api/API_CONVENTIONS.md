# API Conventions

**Status:** Draft v0.1 · **Date:** 2026-10-24 · **Contract:** `api/openapi.yaml` (OpenAPI 3.1.0)

---

## 1. Base URL and versioning

```
https://api.sandbox.parcelyatra.example/v1
```

- Major version in the path. Additive changes (new optional fields, new endpoints, new enum
  values where the client is instructed to tolerate them) do **not** bump the version.
- Removing a field, changing a type, changing semantics, or tightening validation **does**.
- Deprecation: announce, keep for ≥ 90 days, emit a `Deprecation` header and a `Sunset` date.

## 2. Naming and encoding

| Concern | Rule |
|---|---|
| Paths | plural nouns, kebab-free, lowercase: `/bookings/{bookingId}/handover/pickup` |
| JSON fields | `snake_case` |
| Enum values | `lowercase_snake_case`, identical to the database enum values |
| Money | integer **paise**, field name ends `_paise`. Never floats. Never rupees in the API. |
| Time | RFC 3339 UTC with `Z`. Server never returns local time. Rendering to IST is a client concern. |
| IDs | UUIDv4 for resources, opaque cursor strings for pagination |
| Booleans | `true`/`false`, never `1`/`0`, never `"yes"` |
| Null | explicitly `null` when a field is absent-but-known; omit only when the field is not applicable |

### Why the state-machine doc looks different

`docs/BOOKING_STATE_MACHINE.md` writes states as `PENDING_TRAVELLER_ACCEPTANCE`. The API and
database use `pending_traveller_acceptance`. **The mapping is case-only and mechanical.** There is
deliberately no second vocabulary: any new state must be added to the database enum, the OpenAPI
enum and the state-machine document in the same change.

## 3. Money

```json
{ "subtotal_paise": 64600, "platform_fee_paise": 11628, "tax_paise": 13721, "total_paise": 89949 }
```

- All arithmetic is integer arithmetic in paise.
- The server computes the total. **A client-supplied amount is ignored, not validated** — ignoring is
  safer than comparing, because it removes a class of "client said 1 paisa" bugs.
- Rounding: half-up at the component level, then sum. The stored `quotes` row is immutable and is
  the single source of truth for what was agreed.
- Any field named `total` without `paise` in the name is a bug.

## 4. Errors

Every non-2xx response body is exactly:

```json
{
  "error": {
    "code": "CAPACITY_UNAVAILABLE",
    "message": "Someone else booked the last space on this trip.",
    "request_id": "req_01J9Z8Q3K7",
    "details": { "field": "trip_id" }
  }
}
```

Rules:

1. `code` is stable and documented in `api/ERROR_CATALOG.md`. Clients branch on `code`, never on
   `message`.
2. `message` is safe to show a user, in English; the client may substitute a localised string keyed
   by `code`.
3. No stack traces, SQL, internal hostnames, provider payloads or personal data in any error.
4. Validation failures return `400` with `details.fields[]` listing JSON pointers.
5. Authentication failures return `401` with `WWW-Authenticate: Bearer`.
6. Authorisation failures return `403`; **resource non-disclosure** returns `404` instead when
   revealing existence would leak information.

## 5. Idempotency

Required on every state-changing POST that has money, booking or handover consequences:

```
Idempotency-Key: 3f2b0d0e-6f3a-4a4e-9f0e-2a1b7c9d8e4f
```

| Situation | Behaviour |
|---|---|
| Same key + same body, first request completed | Return the stored response, same status code |
| Same key + same body, first request in flight | `409 REQUEST_IN_PROGRESS` with `Retry-After: 2` |
| Same key + different body | `409 IDEMPOTENCY_KEY_REUSED` |
| Key older than 24 h | Treated as new (keys are purged) |
| Missing key on a required endpoint | `400 IDEMPOTENCY_KEY_REQUIRED` |

The stored response includes the status code. Storage: `idempotency_keys` table, unique on
`(user_id, scope, key)`.

## 6. Concurrency

| Resource | Strategy |
|---|---|
| Trip capacity | `UPDATE trips SET capacity_kg_remaining = capacity_kg_remaining - $1 WHERE id = $2 AND capacity_kg_remaining >= $1` — 0 rows affected ⇒ `409 CAPACITY_UNAVAILABLE` |
| Booking transitions | `SELECT ... FOR UPDATE` on the booking row plus an expected `from_state` check ⇒ `409 TRANSITION_CONFLICT` |
| OTP consumption | `UPDATE handover_otps SET used_at = now() WHERE id = $1 AND used_at IS NULL` — 0 rows ⇒ already used |
| Webhooks | Unique index on `payments.provider_event_id` |

Clients must treat `409` as a *normal* outcome requiring a UI decision, not as a crash.

## 7. Pagination

Cursor-based, never offset beyond 1,000 rows.

```
GET /bookings?limit=20&cursor=eyJjcmVhdGVkX2F0IjoiMjAyNi0xMC0yNCJ9
```

```json
{ "items": [ ... ], "next_cursor": "eyJjcmVhdGVkX2F0Ijoi..." }
```

`next_cursor` is `null` on the last page. Cursors are opaque, signed, and expire after 24 hours.

## 8. Rate limiting

| Class | Limit | Scope |
|---|---|---|
| OTP request | 3/hour/number, 10/hour/IP, 20/day/device | triple |
| Auth verify | 5 attempts/challenge | challenge |
| Read endpoints | 300/min | user |
| Write endpoints | 60/min | user |
| Match search | 30/min | user |
| Upload URL | 20/hour | user |
| Webhooks | 600/min | provider IP |

`429` responses include `Retry-After`. Limits are per-environment configurable but must never be
disabled in production.

## 9. Authorisation model

- Every route is deny-by-default; public routes are explicitly listed.
- Roles: `sender`, `traveller`, `support_agent`, `verification_reviewer`, `finance`,
  `trust_safety`, `admin_readonly`.
- Object-level checks are mandatory: the handler must prove the caller is a party to the resource.
- The client never sends `user_id` to identify itself. Identity comes from the token only.
- `allowed_commands[]` on a booking is server-computed and is the *only* set of transitions the UI
  should offer. The server re-validates anyway.

## 10. Request hygiene

- `Content-Type: application/json` required; `charset` ignored.
- Unknown properties are rejected (`additionalProperties: false`) on mutations — a typo must fail
  loudly, not be silently dropped.
- Body limit 100 KB (JSON), 10 MB (uploads, via presigned URL only).
- `X-Request-Id` accepted from clients but always replaced/validated server-side and echoed back.
- No PII in query strings (it lands in access logs). Phone lookup uses `phone_hash`.

## 11. Response headers

| Header | When |
|---|---|
| `X-Request-Id` | always |
| `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` | rate-limited routes |
| `Retry-After` | 429, 503, 409 in-flight |
| `Cache-Control: no-store` | all authenticated responses |
| `Deprecation`, `Sunset` | deprecated endpoints |

## 12. Caching

No caching of authenticated API responses at the CDN. Static content only. If a cache is added
later it must be keyed by user and never serve one user's data to another.

## 13. Contract testing

- The OpenAPI file is the source of truth; server types are generated from it.
- CI runs: schema validation → generated-type build → contract tests (request/response match) →
  breaking-change detection against the last released spec.
- A handler that returns an undocumented field fails the contract test. Undocumented fields are how
  PII leaks.

## 14. Sandbox signalling

Every payment-related response includes `"sandbox": true` while the mock or sandbox adapter is in
use. The UI must show a "Test mode — no real money" banner whenever this is true. Removing the
banner without switching the adapter is a release blocker.

## 15. Things this API deliberately does not do

- No GraphQL.
- No websockets (status is polled; see `docs/NOTIFICATIONS.md`).
- No client-controlled sorting on money fields.
- No bulk endpoints at pilot.
- No `PATCH` on any state field.
- No endpoint returns another user's phone number, exact address or live location.
