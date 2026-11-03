-- 0014_profile_avatar.sql
--
-- A profile photo: the object key of a selfie the user took on the setup screen.
--
-- Why a key and not a URL: the bytes live in the same object store as identity documents and
-- handover photos (`lib/storage.ts`), so one upload path, one ownership rule and one purge story
-- covers all of them. What is stored here is only the key; the wire contract hands out a short-lived
-- signed URL instead, because a permanent public URL for a person's face is not something to invent.
--
-- Nullable with no default: an account that predates this screen has no photo, and it must not be
-- treated as broken. Nothing here forces an existing user into the setup flow.

ALTER TABLE users ADD COLUMN avatar_key text;
ALTER TABLE users ADD COLUMN avatar_updated_at timestamptz;
