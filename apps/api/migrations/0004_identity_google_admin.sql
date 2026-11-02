-- 0004 — Google identity, optional phone, server-side admin grant.
--
-- Why: a Google account has no phone number, but `users.phone_hash`/`phone_last4` were NOT NULL,
-- so the OAuth route had to invent a placeholder hash from the Google subject. That placeholder
-- occupied the UNIQUE phone slot, which blocked the same person from ever attaching a real number,
-- and it let a Google sign-in match an account on email alone with nothing recording *which* Google
-- account owns the row.
--
-- `google_sub` is now the authoritative identity for OAuth users; email is a lookup key only.

ALTER TABLE users ADD COLUMN google_sub text;
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN admin_granted_at timestamptz;

-- One Google subject maps to exactly one local account. NULLs (phone-only accounts) are unconstrained.
CREATE UNIQUE INDEX users_google_sub_idx ON users (google_sub) WHERE google_sub IS NOT NULL;

-- Two live accounts sharing one email would make email-based lookup non-deterministic.
CREATE UNIQUE INDEX users_email_live_idx ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE users ALTER COLUMN phone_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN phone_last4 DROP NOT NULL;

-- Backfill the subjects of accounts previously created through Google sign-in. Their placeholder
-- phone_hash was sha256('google:<sub>'); the subject itself cannot be recovered from the digest, so
-- the row keeps its placeholder and re-links by email on the next sign-in.
