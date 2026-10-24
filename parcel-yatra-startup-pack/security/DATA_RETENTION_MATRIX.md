# Data Retention Matrix

**Status:** Draft v0.1 · **Date:** 2026-10-24 · **Review:** quarterly + on legal advice change

> Retention periods are **business proposals pending legal confirmation**. Statutory retention
> (tax, accounting, limitation periods) overrides user deletion requests.

---

## 1. Matrix

| Data | Table / store | Retention | Trigger | On expiry | Legal basis (provisional) |
|---|---|---|---|---|---|
| Phone number | `users.phone_hash` | Account life + 90 d | Account deletion | Hard delete | Contract |
| Name | `users.name` | Account life + 90 d | Account deletion | Hard delete | Contract |
| Email | `users.email` | Account life | Account deletion | Hard delete | Consent |
| Google subject | `users.google_sub` | Account life | Account deletion | Hard delete | Consent |
| Device/IP | `security_events` | 90 d | Rolling | Delete | Security |
| ID image | `verification_documents` | 90 d after decision | Decision date | Delete object + row | Consent + legal obligation |
| Selfie/liveness | `verification_documents` | 90 d after decision | Decision date | Delete | Consent |
| Verification decision | `verifications` | 3 y | Decision date | Anonymise | Dispute defence |
| Pickup/drop area | `parcels` | 180 d | Delivery | Reduce to city only | Contract |
| Exact address | `bookings.address_enc` | 30 d after delivery | Delivery | Null + delete key | Contract |
| Receiver name/phone | `bookings.receiver_*` | 30 d after delivery | Delivery | Mask/delete | Consent |
| Parcel photo | object storage | 180 d | Delivery | Delete | Safety/evidence |
| Parcel description | `parcels` | 180 d | Delivery | Delete | Safety |
| Declared value | `bookings` | 3 y | Booking | Keep (financial) | Legal |
| Booking + events | `bookings`, `booking_events` | 3 y | Terminal state | Anonymise | Limitation period |
| OTP | `otps` | 24 h max | Use/expiry | Delete | Security |
| Messages | `messages` | 180 d | Booking close | Delete | Safety |
| Ratings | `reviews` | 3 y | Created | Anonymise | Trust |
| Payment ledger | `payment_ledger` | 8 y | Created | **Never delete** | Tax/audit — **verify** |
| Payout details | `payout_accounts` | Account life + 1 y | Closure | Delete/tokenise | KYC/legal |
| Disputes | `disputes` | 3 y | Closed | Anonymise | Limitation |
| Audit log | `audit_log` | 1 y min (propose 3 y) | Created | Archive | Accountability |
| Backups | object storage | 35 d | Rolling | Expire | Recovery |
| Analytics events | warehouse | 13 months | Rolling | Aggregate/delete | Consent |
| Consent records | `consents` | Account life + 3 y | Withdrawal/deletion | Keep | Proof of consent |
| Support tickets | helpdesk | 3 y | Closed | Anonymise | Dispute |

## 2. Deletion mechanics

| Stage | Time | Action |
|---|---|---|
| 1. Soft delete | Immediately on request | Account marked deleted; login blocked; data hidden |
| 2. Revoke access | Immediately | Sessions revoked; signed URLs invalidated |
| 3. Anonymise | Day 7 | Name/email/phone replaced with tombstone values |
| 4. Hard delete | Day 30 | Rows deleted except legally retained |
| 5. Backup expiry | Day 35 | Backups naturally rotated out |
| 6. Warehouse delete | Day 90 | Analytics pseudonym keys removed |

## 3. What cannot be deleted on request

| Data | Reason | What we tell the user |
|---|---|---|
| Payment/tax records | Statutory retention | "We must keep financial records as required by law." |
| Fraud/abuse records | Legitimate defence, legal claims | "We retain limited records to prevent fraud." |
| Audit logs | Accountability | "Security logs are kept for a limited period." |
| Dispute records | Legal claims | "Case records are kept while a claim could be made." |

The privacy notice must state this **before** the user deletes, not after.

## 4. Verification of compliance

| Check | Frequency | Owner |
|---|---|---|
| Retention job ran and deleted expected rows | Daily | Engineering |
| Sample audit: 10 random deleted accounts have no residual PII | Monthly | Trust & Safety |
| Backup expiry verified | Monthly | Engineering |
| ID documents older than 90 d all gone | Monthly | Engineering |
| Access logs for ID docs reviewed | Monthly | Founder |

## 5. Data minimisation opportunities (backlog)

1. Replace exact addresses with pick-up point codes where operationally viable.
2. Delete chat after booking closes instead of 180 days (needs dispute window).
3. Tokenise payout account numbers with provider, store only reference.
4. Aggregate analytics at 90 days rather than 13 months.
5. Avoid storing receiver phone after delivery (replace with masked value + provider ref).

## 6. Open legal questions

- Exact statutory retention for tax records in our structure (8 years is a placeholder).
- Whether dispute records must be kept for the full limitation period.
- Whether consent records must survive account deletion permanently.
