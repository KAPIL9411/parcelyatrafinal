import type { Db } from '../db/client.ts';
import { adminEmails } from '../config.ts';

/**
 * Staff access, decided in one place.
 *
 * Roles are read from `user_roles` by every authorisation check; nothing here trusts a value that
 * came from the browser. The only way an address becomes staff is by appearing in `ADMIN_EMAILS`
 * *and* signing in through Google with a Google-verified email.
 *
 * `role_name` is a Postgres enum and does not contain a superuser value, so the configured admin
 * receives the concrete staff roles rather than a made-up one. Each of them is what the matching
 * endpoint already requires, which keeps the authorisation checks unchanged and auditable.
 */
export const STAFF_ROLES = [
  'support_agent',
  'verification_reviewer',
  'trust_safety',
  'finance',
  'admin_readonly',
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails.has(email.trim().toLowerCase());
}

/**
 * Make the database match the configuration. Runs on every Google sign-in, so removing an address
 * from ADMIN_EMAILS revokes the roles the next time that person signs in.
 */
export async function syncAdminRoles(db: Db, userId: string, email: string | null | undefined): Promise<boolean> {
  const shouldGrant = isAdminEmail(email);

  if (shouldGrant) {
    for (const role of STAFF_ROLES) {
      await db.query(
        `INSERT INTO user_roles (user_id, role, granted_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id, role) DO NOTHING`,
        [userId, role],
      );
    }
    await db.query(`UPDATE users SET admin_granted_at = now(), updated_at = now() WHERE id = $1 AND admin_granted_at IS NULL`, [
      userId,
    ]);
    return true;
  }

  const granted = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 AND admin_granted_at IS NOT NULL`,
    [userId],
  );
  if (granted.rows.length === 0) return false;

  // This account was configured in earlier; the configuration no longer says so.
  await db.query(`DELETE FROM user_roles WHERE user_id = $1 AND role::text = ANY($2::text[])`, [userId, [...STAFF_ROLES]]);
  await db.query(`UPDATE users SET admin_granted_at = NULL, updated_at = now() WHERE id = $1`, [userId]);
  return false;
}
