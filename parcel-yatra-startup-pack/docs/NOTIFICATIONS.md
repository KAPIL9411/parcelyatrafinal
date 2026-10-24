# Notifications

**Status:** Draft v0.1 · **Last updated:** 2026-10-24

---

## 1. Channels

| Channel | Use | Provider | Fallback |
|---|---|---|---|
| Transactional SMS | OTP, critical state changes | DLT-registered SMS provider | Voice OTP (pilot: support call) |
| WhatsApp template | Booking updates, handover instructions | BSP with approved templates | SMS |
| Email | Receipts, policy notices, grievance acknowledgement | Transactional email provider | none |
| Push | App-side state changes, reminders | FCM / APNs | SMS |
| In-app | Full history and detail | — | — |
| IVR callback | Receiver without smartphone | Voice provider / support | Manual call |

All providers must be behind an adapter (`notifications/providers/*`) so a provider can be swapped
without touching domain code.

## 2. Event → notification matrix

| Event | Sender | Traveller | Receiver | Support |
|---|---|---|---|---|
| Booking requested | — | Push + SMS | — | — |
| Booking accepted | Push + SMS | Push | SMS (heads-up) | — |
| Payment authorised | Push + email receipt | Push | — | — |
| Pickup OTP issued | SMS + in-app | — | — | — |
| Picked up | Push | Push | SMS ("on the way") | — |
| Arrived | Push | Push | SMS + delivery OTP | — |
| Delivered | Push + email | Push + payout ETA | SMS confirmation | — |
| Delivery failed | Push | Push | SMS retry | **Task** |
| Dispute opened | Push + email | Push + email | — | **Task + alert** |
| Payout released | — | Push + email | — | — |
| Cancellation | Push + email | Push + email | SMS | — |
| Verification decided | — | Push + SMS | — | — |

## 3. Rules

1. **No PII in push body.** No full address, no phone number, no declared value, no item description.
2. **OTP delivery is single-channel** and never sent to a number supplied at handover.
3. **Rate limit:** max 6 marketing messages/week/user; transactional messages exempt but still capped
   at 20/day to prevent SMS bombing.
4. **Quiet hours:** non-critical messages 21:00–08:00 IST are queued to 08:00.
5. **Consent:** transactional messages are necessary for service; marketing requires a separate,
   recorded opt-in (DPDP notice).
6. **Idempotency:** each `(event_id, channel, recipient)` sends at most once; retries use the same key.
7. **Delivery failure** does not block a state transition — the booking proceeds; notification status
   is recorded for support.
8. **Language:** Hindi and English; user preference stored; templates must exist in both before a
   channel is enabled for a locale.

## 4. Template requirements

Every template must include: template ID, language, channel, variables, and a plain-language purpose.
Templates are versioned and reviewed; a changed template requires re-approval with the provider/operator
where applicable (WhatsApp BSP templates).

Example — `booking_accepted_sender_v2` (SMS, 160 chars):
> `Parcel Yatra: {traveller_first_name} accepted your parcel to {dest_city}. Pickup {pickup_window}. OTP will be shared at handover.`

## 5. Failure handling

| Failure | Behaviour |
|---|---|
| SMS provider 5xx | Retry ×3 with backoff, then queue for support review |
| SMS DLT template rejection | Alert engineering; do not retry blindly |
| Push token invalid | Mark token stale, fall back to SMS for critical events |
| WhatsApp template paused | Fall back to SMS, alert ops |
| Email bounce | Mark address unverified; do not block booking |

## 6. Open items

- Confirm DLT registration requirements and template approval lead time (blocks pilot SMS).
- Confirm WhatsApp BSP contract and template categories.
- Decide whether receiver SMS is opt-in or automatic (privacy vs. service necessity). **Needs legal
  input**, because it involves sharing receiver contact details with a traveller.
