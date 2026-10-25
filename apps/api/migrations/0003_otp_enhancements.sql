-- Migration 0003: OTP lifecycle enhancements
-- Adds:
--   - provider_session_id: the session token returned by the SMS provider (e.g. 2Factor.in).
--     Stored for audit and optional provider-side re-verification. Nullable: log/none providers
--     do not return one.
--   - resend_after: earliest timestamp at which a new OTP may be sent for the same phone/purpose.
--     Enforced server-side; stored here so multiple API instances agree on the cooldown.
--   - otp_sms_counters: sliding-window counters for per-phone and per-IP OTP send limits.
--     Uses UPSERT with atomic increment. Safe for single- and multi-instance deployments that
--     share a PostgreSQL database. If the row does not exist it is created with count=1.

ALTER TABLE otp_challenges
  ADD COLUMN IF NOT EXISTS provider_session_id text,
  ADD COLUMN IF NOT EXISTS resend_after timestamptz;

-- Index for resend-cooldown lookups: find the most recent challenge for a phone/purpose.
CREATE INDEX IF NOT EXISTS otp_resend_idx
  ON otp_challenges(phone_hash, purpose, created_at DESC)
  WHERE consumed_at IS NULL;

-- otp_sms_counters — sliding-window rate-limit counters.
--
-- Each row tracks how many OTPs were sent to a given key (phone hash or IP) within a window
-- that resets at `window_end`. The row is upserted atomically:
--   INSERT ... ON CONFLICT DO UPDATE SET count = count + 1
-- so no row-level lock is needed and parallel requests are safe.
--
-- The `scope` column distinguishes window sizes:
--   'phone_15m'  — per phone, 15-minute window
--   'phone_1h'   — per phone, 1-hour window (existing RATE_LIMIT_OTP_PER_HOUR_PER_NUMBER)
--   'phone_24h'  — per phone, 24-hour window
--   'ip_15m'     — per IP address, 15-minute window
--
-- Stale rows (window_end < now()) are harmless and can be pruned periodically.

CREATE TABLE IF NOT EXISTS otp_sms_counters (
  key        text NOT NULL,
  scope      text NOT NULL CHECK (scope IN ('phone_15m','phone_1h','phone_24h','ip_15m')),
  count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  window_end timestamptz NOT NULL,
  PRIMARY KEY (key, scope)
);

CREATE INDEX IF NOT EXISTS otp_sms_counters_window_idx
  ON otp_sms_counters(window_end);
