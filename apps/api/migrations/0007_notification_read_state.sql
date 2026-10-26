-- 0007 — notification read state.
--
-- Why: `GET /v1/notifications` returns history but nothing marks a row as seen, so the bell in the
-- app cannot show a count and a user has no way to tell what they have already read. Without a
-- stored state there is nothing to count; this adds it.
--
-- `read_at` stays nullable and separate from `status`. `status` describes delivery to a channel
-- (`delivered` / `queued` / `failed`); `read_at` describes whether the human looked. Folding them
-- together would corrupt the delivery record.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Partial index: the unread query is the hot one, and rows already read do not need to be indexed.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL AND user_id IS NOT NULL;
