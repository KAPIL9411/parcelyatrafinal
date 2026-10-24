import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import {
  createSession,
  makeAuthenticate,
  requireAuth,
} from '../lib/auth.ts';
import { generateOtp, hashCode, maskPhone, phoneHash, phoneLast4, safeEqual, sha256 } from '../lib/crypto.ts';
import { rememberCode } from '../lib/dev-store.ts';
import { deliverOtp } from '../lib/sms.ts';
import { userProfile } from '../lib/serialize.ts';
import { audit } from '../services/audit.ts';

const phoneSchema = z.string().regex(/^\+91[6-9][0-9]{9}$/, 'Enter a valid Indian mobile number');

const requestOtpSchema = z
  .object({
    phone: phoneSchema,
    purpose: z.literal('login'),
  })
  .strict();

const verifyOtpSchema = z
  .object({
    challenge_id: z.string().uuid(),
    code: z.string().regex(/^[0-9]{6}$/),
    device_id: z.string().max(128).optional(),
  })
  .strict();

const refreshSchema = z.object({ refresh_token: z.string().min(32) }).strict();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  const authenticate = makeAuthenticate(db);

  app.post('/auth/otp/request', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = requestOtpSchema.parse(req.body);
    const hash = phoneHash(body.phone);

    // Per-number throttle. The response is identical either way, so throttling is not an
    // account-enumeration oracle.
    //
    // Development note: a demo needs to sign the same three people in repeatedly, so when the dev
    // endpoints are on the ceiling is raised. The documented pilot limit (3 per number per hour)
    // applies in every other configuration.
    const otpLimit = config.ENABLE_DEV_ENDPOINTS
      ? Math.max(config.RATE_LIMIT_OTP_PER_HOUR_PER_NUMBER, 100)
      : config.RATE_LIMIT_OTP_PER_HOUR_PER_NUMBER;
    const recent = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM otp_challenges
       WHERE phone_hash = $1 AND purpose = 'login' AND created_at > now() - interval '1 hour'`,
      [hash],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= otpLimit) {
      throw new AppError('OTP_RATE_LIMITED', { retry_after_seconds: 600 });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + config.OTP_TTL_SECONDS * 1000);
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO otp_challenges (phone_hash, phone_last4, phone_masked, purpose, code_hash, max_attempts, expires_at)
       VALUES ($1, $2, $3, 'login', $4, $5, $6) RETURNING id`,
      [hash, phoneLast4(body.phone), maskPhone(body.phone), hashCode(code), config.OTP_MAX_ATTEMPTS, expiresAt],
    );

    // Delivery is best-effort and never echoed to the client. With SMS_PROVIDER=log the code goes
    // to the operator log, which is the zero-cost pilot path.
    void deliverOtp(req.log, {
      phone: body.phone,
      code,
      purpose: 'login',
      reference: inserted.rows[0]!.id,
    });
    if (config.ENABLE_DEV_ENDPOINTS) rememberCode(inserted.rows[0]!.id, code, 'login');

    return reply.code(202).send({
      challenge_id: inserted.rows[0]!.id,
      expires_in_seconds: config.OTP_TTL_SECONDS,
      resend_after_seconds: 30,
    });
  });

  app.post('/auth/otp/verify', async (req, reply) => {
    const body = verifyOtpSchema.parse(req.body);

    const found = await db.query<{
      id: string;
      phone_hash: string;
      phone_last4: string;
      phone_masked: string;
      code_hash: string;
      attempts: number;
      max_attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>(`SELECT * FROM otp_challenges WHERE id = $1`, [body.challenge_id]);

    const challenge = found.rows[0];
    if (!challenge) throw new AppError('OTP_CHALLENGE_NOT_FOUND');
    if (challenge.consumed_at) throw new AppError('OTP_ALREADY_USED');
    if (new Date(challenge.expires_at).getTime() < Date.now()) throw new AppError('OTP_EXPIRED');
    if (challenge.attempts >= challenge.max_attempts) throw new AppError('OTP_ATTEMPTS_EXCEEDED');

    if (!safeEqual(challenge.code_hash, hashCode(body.code))) {
      const updated = await db.query<{ attempts: number; max_attempts: number }>(
        `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts, max_attempts`,
        [challenge.id],
      );
      const row = updated.rows[0]!;
      if (row.attempts >= row.max_attempts) throw new AppError('OTP_ATTEMPTS_EXCEEDED');
      throw new AppError('OTP_INVALID', { attempts_remaining: row.max_attempts - row.attempts });
    }

    // Consume exactly once, even under a race.
    const consumed = await db.query(
      `UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
      [challenge.id],
    );
    if (consumed.rowCount === 0) throw new AppError('OTP_ALREADY_USED');

    const user = await db.transaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(`SELECT id FROM users WHERE phone_hash = $1`, [challenge.phone_hash]);
      let userId = existing.rows[0]?.id;
      if (!userId) {
        const created = await tx.query<{ id: string }>(
          `INSERT INTO users (phone_hash, phone_last4, phone_masked, phone_verified_at)
           VALUES ($1,$2,$3,now()) RETURNING id`,
          [challenge.phone_hash, challenge.phone_last4, challenge.phone_masked],
        );
        userId = created.rows[0]!.id;
        await tx.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'sender') ON CONFLICT DO NOTHING`, [userId]);
      } else {
        await tx.query(
          `UPDATE users SET phone_verified_at = now(), phone_masked = $2, updated_at = now() WHERE id = $1`,
          [userId, challenge.phone_masked],
        );
      }
      return userId;
    });

    const session = await createSession(db, user, {
      deviceId: body.device_id ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    await audit(db, {
      actorId: user,
      actorKind: 'user',
      action: 'auth.login',
      resource: 'user',
      resourceId: user,
    });

    const profile = await loadProfile(app, user);
    return reply.code(200).send({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: session.expiresIn,
      user: profile,
    });
  });

  app.post('/auth/refresh', async (req, reply) => {
    const body = refreshSchema.parse(req.body);
    const hash = sha256(body.refresh_token);

    const found = await db.query<{
      id: string;
      user_id: string;
      family_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      device_id: string | null;
    }>(`SELECT id, user_id, family_id, expires_at, revoked_at, device_id FROM sessions WHERE refresh_hash = $1`, [hash]);

    const session = found.rows[0];
    if (!session) throw new AppError('AUTH_REFRESH_INVALID');

    if (session.revoked_at) {
      // A rotated token was replayed. Kill the whole family.
      await db.query(`UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [session.family_id]);
      await audit(db, {
        actorId: session.user_id,
        actorKind: 'system',
        action: 'auth.refresh_reuse',
        resource: 'session',
        resourceId: session.id,
        reasonCode: 'AUTH_REFRESH_REUSE',
      });
      throw new AppError('AUTH_REFRESH_REUSE');
    }
    if (new Date(session.expires_at).getTime() < Date.now()) throw new AppError('AUTH_REFRESH_INVALID');

    // Rotate: revoke the old row (keeping its hash for reuse detection), issue a new one in the family.
    await db.query(`UPDATE sessions SET revoked_at = now(), last_used_at = now() WHERE id = $1`, [session.id]);
    const next = await createSession(db, session.user_id, {
      deviceId: session.device_id,
      userAgent: req.headers['user-agent'] ?? null,
      familyId: session.family_id,
    });

    const profile = await loadProfile(app, session.user_id);
    return reply.code(200).send({
      access_token: next.accessToken,
      refresh_token: next.refreshToken,
      expires_in: next.expiresIn,
      user: profile,
    });
  });

  app.post('/auth/logout', { preHandler: authenticate }, async (req, reply) => {
    const auth = requireAuth(req);
    await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [auth.sessionId]);
    await audit(db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'auth.logout',
      resource: 'session',
      resourceId: auth.sessionId,
    });
    return reply.code(204).send();
  });
}

export async function loadProfile(app: FastifyInstance, userId: string) {
  const res = await app.db.query<{
    id: string;
    name: string | null;
    email: string | null;
    phone_last4: string;
    status: 'active' | 'suspended' | 'deleted';
    risk_tier: number;
    locale: string;
    created_at: Date;
    verification_state: string | null;
  }>(
    `SELECT u.id, u.name, u.email, u.phone_last4, u.status, u.risk_tier, u.locale, u.created_at,
            (SELECT v.state FROM verifications v WHERE v.user_id = u.id ORDER BY v.created_at DESC LIMIT 1) AS verification_state
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND');
  const roles = await app.db.query<{ role: string }>(
    `SELECT role::text AS role FROM user_roles WHERE user_id = $1 ORDER BY role::text ASC`,
    [userId],
  );
  return userProfile(
    row as never,
    roles.rows.map((r) => r.role),
  );
}
