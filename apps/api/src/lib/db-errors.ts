/**
 * The two identity writes that insert a user row (`upsertUserFromGoogle`, OTP verify) can lose a
 * race with themselves: two sign-ins for the same new identity both read "no account" and both
 * insert. The database settles it with a unique violation, and the caller retries the lookup instead
 * of answering 500.
 */
interface PgError {
  code?: unknown;
  constraint?: unknown;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as PgError;
  if (candidate.code !== '23505') return false;
  if (!constraint) return true;
  return candidate.constraint === constraint;
}
