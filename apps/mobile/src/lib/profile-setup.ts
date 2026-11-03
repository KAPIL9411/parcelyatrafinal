import type { Profile } from '../api/types.ts';

/**
 * Does this account still need the first-run profile setup screen?
 *
 * The question is "has this account been asked and answered", not "does it have a photo". The
 * screen has a deliberate skip ("Add the photo later"), so a photo-only rule made that skip
 * meaningless: the account still had no `avatar_key`, and the screen came back on every sign-in.
 *
 * `profile_setup_done` is the server's record of that answer (`users.profile_setup_completed_at`).
 * The `avatar_key` check stays as the fallback for a client talking to an API that predates the
 * column: there the old behaviour is still better than skipping setup for a brand-new account.
 *
 * Only the Google handoff calls this. Phone accounts, staff accounts and every profile created
 * before this screen existed may legitimately have no photo, and nothing sends them to setup.
 */
export function needsProfileSetup(user: Profile | null | undefined): boolean {
  if (!user) return false;
  if (user.profile_setup_done === true) return false;
  return !user.avatar_key;
}
