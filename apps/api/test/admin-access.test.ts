/**
 * Admin access, exercised against a real database.
 *
 * The question this answers is the one that matters for staff access: does the address in
 * `ADMIN_EMAILS` become an administrator *in the database*, and does removing it revoke that? The
 * Google leg cannot run here — it needs a real ID token from a configured OAuth client — so the
 * assertion stops at the function Google sign-in calls, and the HTTP guard is covered by
 * scripts/smoke.mjs ("a non-staff user is refused the audit log").
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ADMIN_ADDRESS = 'kapil-admin@example.test';

// `adminEmails` is built when the config module first loads, so the environment has to be set
// before anything imports it. A dynamic import is the only honest way to do that.
process.env.ADMIN_EMAILS = `  ${ADMIN_ADDRESS.toUpperCase()}  `;
process.env.PGLITE_PATH = './data/pgdata.apitest';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';

const { adminEmails } = await import('../src/config.ts');
const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { isAdminEmail, syncAdminRoles, STAFF_ROLES } = await import('../src/lib/admin-access.ts');

async function freshUser(db: Awaited<ReturnType<typeof getDb>>, tag: string) {
  const res = await db.query<{ id: string }>(
    `INSERT INTO users (phone_hash, phone_last4, name) VALUES ($1, '0007', $2) RETURNING id`,
    [`apitest:${tag}:${crypto.randomUUID()}`, `Test ${tag}`],
  );
  return res.rows[0]!.id;
}

test('ADMIN_EMAILS is normalised: trimmed and case-insensitive', () => {
  assert.ok(adminEmails.has(ADMIN_ADDRESS), 'the configured address is in the set');
  assert.equal(isAdminEmail(ADMIN_ADDRESS), true);
  assert.equal(isAdminEmail(` ${ADMIN_ADDRESS.toUpperCase()} `), true, 'padding and case do not matter');
  assert.equal(isAdminEmail('someone-else@example.test'), false);
  assert.equal(isAdminEmail(null), false);
  assert.equal(isAdminEmail(''), false);
});

test('the configured address receives the staff roles in the database', async () => {
  const db = await getDb();
  await runMigrations(db);
  const userId = await freshUser(db, 'grant');

  const granted = await syncAdminRoles(db, userId, ADMIN_ADDRESS);
  assert.equal(granted, true);

  const roles = await db.query<{ role: string }>(
    `SELECT role::text AS role FROM user_roles WHERE user_id = $1 ORDER BY role::text`,
    [userId],
  );
  assert.deepEqual(
    roles.rows.map((r) => r.role),
    [...STAFF_ROLES].sort(),
    'every staff role the admin endpoints require is present',
  );

  const stamped = await db.query<{ at: string | null }>(`SELECT admin_granted_at AS at FROM users WHERE id = $1`, [userId]);
  assert.notEqual(stamped.rows[0]!.at, null, 'the grant is recorded on the account');

  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await closeDb();
});

test('a non-admin sign-in gets no roles, and removal revokes a previous grant', async () => {
  const db = await getDb();
  await runMigrations(db);
  const userId = await freshUser(db, 'revoke');

  assert.equal(await syncAdminRoles(db, userId, 'plain@example.test'), false);
  const none = await db.query(`SELECT 1 FROM user_roles WHERE user_id = $1`, [userId]);
  assert.equal(none.rows.length, 0, 'an unlisted address cannot acquire staff roles by signing in');

  await syncAdminRoles(db, userId, ADMIN_ADDRESS);
  const revoked = await syncAdminRoles(db, userId, 'plain@example.test');
  assert.equal(revoked, false, 'taking the address out of the configuration revokes it at the next sign-in');

  const leftover = await db.query(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role::text = ANY($2::text[])`,
    [userId, [...STAFF_ROLES]],
  );
  assert.equal(leftover.rows.length, 0, 'no staff role survives the revocation');

  const cleared = await db.query<{ at: string | null }>(`SELECT admin_granted_at AS at FROM users WHERE id = $1`, [userId]);
  assert.equal(cleared.rows[0]!.at, null);

  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await closeDb();
});
