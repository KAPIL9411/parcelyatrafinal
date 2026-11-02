-- 0006 — coordination messaging (sender / traveller / recipient on one thread per booking).
--
-- Why: the product has never had a chat. `BookingDetail.tsx` told users the pickup window was
-- "shared in messages", and the handover flow has no channel for the parties to agree a place and
-- time — the one thing every peer-to-peer delivery marketplace depends on. The old copy was a claim
-- with nothing behind it; this migration gives it something behind it.
--
-- Shape:
--   - one conversation per booking (UNIQUE, so a retried create can never fork a thread);
--   - membership is explicit and is the only authorisation check — a user who is not a member gets
--     a 404, not a 403, so booking ids do not disclose which bookings exist;
--   - `recipient` is a real member only when a registered account owns the phone number stored on
--     the parcel (`parcels.receiver_phone_hash`). No phantom accounts are created for people who
--     have never signed up;
--   - messages are immutable appends. Moderation sets `removed_at` and keeps the row: silently
--     deleting chat history would destroy the evidence disputes are decided on.
--
-- Additive only. No column is dropped, no existing row is modified, nothing is re-typed, so an
-- already-populated database can take this without a backup-and-restore exercise.

CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('sender','traveller','recipient')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

-- The inbox query is "my conversations, newest activity first", and the unread count is a
-- partial-aggregate over the same key, so both want the user first.
CREATE INDEX conversation_members_user_idx ON conversation_members(user_id, conversation_id);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users(id),
  kind            text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system')),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Moderation. The body stays: `removed_at` plus `removed_reason` is an audit trail, a delete is
  -- a hole. `removed_by` is nullable because a removal can be automated.
  removed_at      timestamptz,
  removed_by      uuid REFERENCES users(id),
  removed_reason  text
);

-- Read path is "this thread, oldest first, after a cursor"; the write path is the same order.
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at, id);
CREATE INDEX messages_active_idx ON messages(conversation_id, created_at) WHERE removed_at IS NULL;

-- Existing bookings already in flight get a thread with their two parties. Nothing else: a
-- recipient is only added when the account genuinely exists, which the route-level helper does.
INSERT INTO conversations (booking_id)
SELECT id FROM bookings;

INSERT INTO conversation_members (conversation_id, user_id, role)
SELECT c.id, b.sender_id, 'sender'
FROM conversations c JOIN bookings b ON b.id = c.booking_id
ON CONFLICT (conversation_id, user_id) DO NOTHING;

INSERT INTO conversation_members (conversation_id, user_id, role)
SELECT c.id, b.traveller_id, 'traveller'
FROM conversations c JOIN bookings b ON b.id = c.booking_id
ON CONFLICT (conversation_id, user_id) DO NOTHING;
