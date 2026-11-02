import type { FastifyRequest } from 'fastify';

import type { Db } from '../db/client.ts';
import { AppError } from './errors.ts';
import { requestHash } from './crypto.ts';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

export function idempotencyKey(req: FastifyRequest): string {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.length < 16 || key.length > 128) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
  return key;
}

/**
 * Replay-safe execution. Same key + same body returns the original response and status. Same key
 * with a different body is rejected. A key that is still executing returns REQUEST_IN_PROGRESS.
 */
export async function withIdempotency<T>(
  db: Db,
  userId: string,
  scope: string,
  req: FastifyRequest,
  body: unknown,
  handler: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const key = idempotencyKey(req);
  const hash = requestHash(body ?? {});
  const expiresAt = new Date(Date.now() + 24 * 3_600_000);

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO idempotency_keys (user_id, scope, key, request_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, scope, key) DO NOTHING
     RETURNING id`,
    [userId, scope, key, hash, expiresAt],
  );

  if (inserted.rows.length === 0) {
    const existing = await db.query<{
      request_hash: string;
      response: unknown;
      status_code: number | null;
    }>(
      `SELECT request_hash, response, status_code FROM idempotency_keys
       WHERE user_id = $1 AND scope = $2 AND key = $3`,
      [userId, scope, key],
    );
    const row = existing.rows[0];
    if (!row) throw new AppError('CONFLICT');
    if (row.request_hash !== hash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
    if (row.response === null || row.status_code === null) throw new AppError('REQUEST_IN_PROGRESS');
    return { status: row.status_code, body: row.response as T, replayed: true };
  }

  const result = await handler().catch(async (err: unknown) => {
    // A failed attempt must not burn the key: leaving the row behind with a null response would
    // make every retry of the same key answer REQUEST_IN_PROGRESS forever.
    await db.query(`DELETE FROM idempotency_keys WHERE user_id = $1 AND scope = $2 AND key = $3`, [
      userId,
      scope,
      key,
    ]);
    throw err;
  });

  await db.query(
    `UPDATE idempotency_keys SET response = $1, status_code = $2
     WHERE user_id = $3 AND scope = $4 AND key = $5`,
    [JSON.stringify(result.body), result.status, userId, scope, key],
  );

  return { ...result, replayed: false };
}
