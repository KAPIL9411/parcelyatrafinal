-- 0015 — remember that the first-run profile setup was answered.
--
-- Why a timestamp and not "has an avatar": the setup screen has a deliberate skip ("Add the photo
-- later"). Gating only on `avatar_key` made that skip meaningless — the screen came back on every
-- sign-in because the account still had no photo, which reads as the app forgetting the answer.
--
-- Nullable with no default: every account that already exists has, in practice, answered the
-- question by signing in again and again; the client falls back to the old avatar rule for those
-- rows, so nobody is pushed through setup twice.

ALTER TABLE users ADD COLUMN profile_setup_completed_at timestamptz;

COMMENT ON COLUMN users.profile_setup_completed_at IS
  'When the user finished or skipped the first-run profile setup screen. Null means "never asked".';

-- Every account that exists today has already been shown this screen (repeatedly). Marking them
-- answered is the point of the column: without this they would each see it one more time after the
-- deploy. New Google accounts are created after this migration with NULL and are asked exactly once.
UPDATE users SET profile_setup_completed_at = now() WHERE profile_setup_completed_at IS NULL;
