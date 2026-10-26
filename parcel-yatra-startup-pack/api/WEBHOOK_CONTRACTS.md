# Webhook Contracts

**Status:** Draft v0.1 · **Date:** 2026-10-24
Applies to `POST /webhooks/payments/{provider}`. **Sandbox only until GATE-3.**

---

## 1. Why this document exists

A payment webhook is the highest-value untrusted input the system receives. If an attacker can forge
one, they can mark a booking paid without paying, or trigger a payout. Every rule below is a security
control, not a style preference.

## 2. Non-negotiable rules

| # | Rule | Failure behaviour |
|---|---|---|
| 1 | Verify HMAC over the **raw body bytes** before any parsing | `401 WEBHOOK_SIGNATURE_INVALID`, alert |
| 2 | Constant-time comparison (`crypto.timingSafeEqual`) | same |
| 3 | Reject timestamps outside ±300 seconds | `401 WEBHOOK_TIMESTAMP_INVALID` |
| 4 | Deduplicate on `id` (provider event ID) — unique index | return `200`, no side effect |
| 5 | Deduplicate on `(type, provider_ref)` as a second guard | return `200`, no side effect |
| 6 | Never trust amounts from the body; re-read the quote/ledger | ignore body amount |
| 7 | Never trust identity from the body; map by `provider_ref` to our row | `400` if unmappable |
| 8 | Process inside a transaction with the state transition | rollback on any error |
| 9 | Return `2xx` fast (p99 < 1 s); do slow work in a job | queue |
| 10 | Log the event ID and outcome, never the full payload | — |

### Signature scheme

```
signed_payload = timestamp + "." + raw_body
signature      = HMAC-SHA256(signed_payload, provider_webhook_secret)
header         = "t=<unix>,v1=<hex>"
```

Secrets are per provider, per environment, rotated ≤ 90 days, stored in the secret manager with an
overlap window so in-flight events still verify.

## 3. Event catalogue

| Event type | Meaning | Our effect |
|---|---|---|
| `payment.authorised` | Funds authorised/hold placed | Payment state → `authorised`; booking stays `payment_pending` (an authorisation is not settled money) |
| `payment.captured` | Capture settled | Booking `payment_pending` → `confirmed`; Ledger `capture` entry; idempotent |
| `payment.failed` | Definitive failure | Booking → `cancelled_by_sender`, capacity released |
| `payment.refunded` | Refund completed | Ledger `refund` entry; refund row → `processed` |
| `payout.succeeded` | Traveller paid | Payout → `released`, booking → `paid_out` |
| `payout.failed` | Payout rejected | Payout → `frozen`, finance alert, booking stays `payout_eligible` |

Anything else: `400 WEBHOOK_UNKNOWN_TYPE`, logged, not retried by us (the provider will retry).

## 4. Payload shape

```json
{
  "id": "evt_sbx_01J9Z8Q3K7ABCDEF",
  "type": "payment.authorised",
  "created_at": "2026-10-24T09:44:03Z",
  "data": {
    "provider_ref": "pay_sbx_9f2c1",
    "amount_paise": 89949,
    "currency": "INR",
    "status": "authorised",
    "metadata": { "booking_id": "0f2a...-..." }
  }
}
```

`data.metadata.booking_id` is **advisory only**. The authoritative mapping is
`payments.provider_ref` → our row. If the metadata disagrees with our record, we trust our record and
raise an alert (possible tampering or a provider bug).

## 5. Processing algorithm

```
1. Read raw body (limit 64 KB)
2. Parse headers; require both signature and timestamp
3. Reject if |now - t| > 300s
4. Compute HMAC; constant-time compare
5. Parse JSON
6. BEGIN
     INSERT INTO payments(provider_event_id ...) ON CONFLICT DO NOTHING
       -> if 0 rows: already processed -> COMMIT, return 200
     SELECT payment FOR UPDATE by provider_ref
     validate amount == stored quote total
     apply state transition (guarded by from_state)
     append ledger entry
     insert audit_log row
   COMMIT
7. Enqueue notification job
8. Return 200 {"received": true}
```

Steps 4–6 must be reachable only after step 4 succeeds. A `try/parse/verify` ordering bug here is a
critical vulnerability.

## 6. Failure and retry semantics

| Situation | Our response | Provider behaviour | Our follow-up |
|---|---|---|---|
| Our DB is down | `503` | Retries with backoff | Reconciliation job catches up |
| Our handler throws | `500` | Retries | Alert; investigate |
| Duplicate event | `200` | Stops | None |
| Unknown `provider_ref` | `202` | Stops | Alert; manual mapping (orphan payment) |
| Amount mismatch | `200` + alert | Stops | Freeze booking, investigate as fraud |
| Signature invalid | `401` | May retry | Alert; treat as attack attempt |

**Never** return `200` for an event we failed to process. That silently loses money state.

## 7. Reconciliation backstop

Webhooks are not a ledger. A daily job:

1. Pulls the provider's settlement report for the previous day.
2. Matches against `payment_ledger`.
3. Reports: missing captures, missing refunds, amount mismatches, orphan payments,
   duplicate ledger entries.
4. Any unresolved mismatch **blocks payout release** for affected bookings until cleared.

This is what makes webhook loss survivable.

## 8. Outbound webhooks (future)

Not implemented at pilot. If we later notify business customers of booking events, the same
principles apply in reverse: sign with a per-subscription secret, include a timestamp, expose a
replay window, retry with exponential backoff for 24 h, and publish the event schema. Documented
here so the design is not reinvented badly later.

## 9. Testing requirements

| Test | Expected |
|---|---|
| Valid signature, new event | `200`, state changed once |
| Valid signature, same event twice | `200` both times, state changed once |
| Invalid signature | `401`, no state change, alert emitted |
| Correct signature, timestamp 10 min old | `401` |
| Correct signature, body modified after signing | `401` |
| Amount in body ≠ quote | no state change, alert |
| Unknown `provider_ref` | `202`, no crash, alert |
| Concurrent duplicate deliveries | exactly one effect |
| Provider retries after our 503 | succeeds on retry, single effect |
| Oversized body | `413` |

These map to `testing/API_TESTS.md` §Webhooks and `security/SECURITY_TEST_PLAN.md` §6.

## 10. Secrets hygiene

- Webhook secret is **not** the API key. Separate credential, separate rotation.
- Secret never appears in logs, error messages, or client bundles.
- Rotation: add new secret → accept both for 24 h → switch provider → remove old.
- A leaked webhook secret is a SEV-2 incident (`security/INCIDENT_RESPONSE_PLAN.md`).
