-- 0009 — free the login identifiers held by soft-deleted accounts.
--
-- Why: `POST /me/deletion-request` only set `status`/`deleted_at`. The row kept `google_sub`, and
-- `users_google_sub_idx` has no `deleted_at` filter, so the next Google sign-in for that person
-- tried to insert a second row for the same subject and answered 500 — "duplicate key value
-- violates unique constraint users_google_sub_idx". `phone_hash` is unique the same way, so the
-- deleted person's number could never register again either. Sessions were also left live, so
-- `/auth/refresh` kept minting tokens for an account every other route rejected with 403.
--
-- The deletion route now clears the subject, writes a tombstone hash and revokes sessions. This
-- migration repairs rows deleted before that change. It is idempotent: the tombstone derives from
-- the row id, and a repaired row already has a NULL subject.

UPDATE users
   SET google_sub = NULL,
       phone_hash = 'deleted:' || id::text,
       updated_at = now()
 WHERE deleted_at IS NOT NULL;

-- Deleted accounts' sessions are already useless — the auth middleware refuses them — but revoking
-- them stops the refresh route from rotating a credential that belongs to nobody.
UPDATE sessions s
   SET revoked_at = now()
  FROM users u
 WHERE u.id = s.user_id
   AND u.deleted_at IS NOT NULL
   AND s.revoked_at IS NULL;
