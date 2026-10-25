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
import type { Db } from '../db/client.ts';

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

// ---------------------------------------------------------------------------
// OTP rate-limit helpers (DB-based sliding-window counters).
//
// Each counter is stored in otp_sms_counters with a window_end timestamp.
// On a new window, the old row is replaced (ON CONFLICT DO UPDATE resets count when
// window_end has passed). Within a window, count is incremented atomically.
//
// This is safe for single- and multi-instance deployments that share PostgreSQL.
// It is NOT safe for multi-instance with PGlite (each instance has its own embedded DB).
// PGlite is development-only; production always uses PostgreSQL via DATABASE_URL.
// ---------------------------------------------------------------------------

async function incrementOtpCounter(
  db: Db,
  key: string,
  scope: 'phone_15m' | 'phone_1h' | 'phone_24h' | 'ip_15m',
  windowMs: number,
): Promise<number> {
  const windowEnd = new Date(Date.now() + windowMs);

  // UPSERT: if the row exists and the window is still valid, increment.
  // If the window has expired, reset count to 1 and update window_end.
  const result = await db.query<{ count: number }>(
    `INSERT INTO otp_sms_counters (key, scope, count, window_end)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (key, scope) DO UPDATE
       SET count = CASE
             WHEN otp_sms_counters.window_end > now() THEN otp_sms_counters.count + 1
             ELSE 1
           END,
           window_end = CASE
             WHEN otp_sms_counters.window_end > now() THEN otp_sms_counters.window_end
             ELSE $3
           END
     RETURNING count`,
    [key, scope, windowEnd],
  );
  return result.rows[0]?.count ?? 1;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  const authenticate = makeAuthenticate(db);

  // POST /auth/otp/request
  // Normalise phone, enforce rate limits and resend cooldown, generate OTP, commit challenge,
  // deliver via configured SMS provider.
  app.post(
    '/auth/otp/request',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      // ── Kill switch ──────────────────────────────────────────────────────
      if (config.OTP_KILL_SWITCH) {
        // Return a generic 429 — do not reveal that the kill switch is on.
        reply.header('Retry-After', '3600');
        throw new AppError('OTP_RATE_LIMITED', { retry_after_seconds: 3600 });
      }

      const body = requestOtpSchema.parse(req.body);
      const hash = phoneHash(body.phone);

      // ── Per-number rate limits ───────────────────────────────────────────
      // Development mode raises the per-hour limit so a demo can be driven repeatedly.
      const hourLimit = config.ENABLE_DEV_ENDPOINTS
        ? Math.max(config.RATE_LIMIT_OTP_PER_HOUR_PER_NUMBER, 100)
        : config.RATE_LIMIT_OTP_PER_HOUR_PER_NUMBER;

      // Read the three per-number windows from the DB (not counters — we use the
      // otp_challenges table for the original 1h limit to preserve backward compat,
      // and otp_sms_counters for the additional 15m and 24h windows).
      const recentHour = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM otp_challenges
         WHERE phone_hash = $1 AND purpose = 'login' AND created_at > now() - interval '1 hour'`,
        [hash],
      );
      if (Number(recentHour.rows[0]?.count ?? 0) >= hourLimit) {
        reply.header('Retry-After', '3600');
        throw new AppError('OTP_RATE_LIMITED', { retry_after_seconds: 3600 });
      }

      // 15-minute window
      if (!config.ENABLE_DEV_ENDPOINTS) {
        const count15m = await incrementOtpCounter(db, hash, 'phone_15m', 15 * 60 * 1000);
        // We already incremented; check against the limit.
        if (count15m > config.RATE_LIMIT_OTP_PER_15MIN_PER_NUMBER) {
          reply.header('Retry-After', '900');
          throw new AppError('OTP_RATE_LIMITED', { retry_after_seconds: 900 });
        }

        // 24-hour window
        const count24h = await incrementOtpCounter(db, hash, 'phone_24h', 24 * 60 * 60 * 1000);
        if (count24h > config.RATE_LIMIT_OTP_PER_24H_PER_NUMBER) {
          reply.header('Retry-After', '86400');
          throw new AppError('OTP_RATE_LIMITED', { retry_after_seconds: 86400 });
        }
      }

      // ── Per-IP rate limit ────────────────────────────────────────────────
      // Only enforce when TRUST_PROXY is configured and an IP is available.
      // Never trust client-supplied X-Forwarded-For without TRUST_PROXY=true.
      const clientIp = config.TRUST_PROXY ? (req.ip ?? null) : null;
      if (clientIp && !config.ENABLE_DEV_ENDPOINTS) {
        const ipKey = `ip:${sha256(clientIp)}`; // hash to avoid storing raw IPs
        const countIp = await incrementOtpCounter(db, ipKey, 'ip_15m', 15 * 60 * 1000);
        if (countIp > config.RATE_LIMIT_OTP_PER_15MIN_PER_IP) {
          reply.header('Retry-After', '900');
          throw new AppError('OTP_RATE_LIMITED', { retry_after_seconds: 900 });
        }
      }

      // ── Resend cooldown ──────────────────────────────────────────────────
      // Find the most recent unconsumed challenge for this phone+purpose and check resend_after.
      const recentChallenge = await db.query<{ resend_after: Date | null }>(
        `SELECT resend_after FROM otp_challenges
         WHERE phone_hash = $1 AND purpose = 'login' AND consumed_at IS NULL
           AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1`,
        [hash],
      );
      const resendAfter = recentChallenge.rows[0]?.resend_after;
      if (resendAfter && new Date(resendAfter).getTime() > Date.now()) {
        const secondsLeft = Math.ceil((new Date(resendAfter).getTime() - Date.now()) / 1000);
        reply.header('Retry-After', String(secondsLeft));
        throw new AppError('OTP_RATE_LIMITED', { retry_after_seconds: secondsLeft });
      }

      // ── Generate and commit challenge ────────────────────────────────────
      const code = generateOtp();
      const expiresAt = new Date(Date.now() + config.OTP_TTL_SECONDS * 1000);
      const resendAt = new Date(Date.now() + config.OTP_RESEND_COOLDOWN_SECONDS * 1000);

      const inserted = await db.query<{ id: string }>(
        `INSERT INTO otp_challenges
           (phone_hash, phone_last4, phone_masked, purpose, code_hash, max_attempts, expires_at, resend_after)
         VALUES ($1, $2, $3, 'login', $4, $5, $6, $7)
         RETURNING id`,
        [
          hash,
          phoneLast4(body.phone),
          maskPhone(body.phone),
          hashCode(code),
          config.OTP_MAX_ATTEMPTS,
          expiresAt,
          resendAt,
        ],
      );
      const challengeId = inserted.rows[0]!.id;

      // ── Deliver OTP ──────────────────────────────────────────────────────
      // Delivery is fire-and-forget. The challenge is already committed; a provider outage
      // must not turn a committed challenge into a 500.
      //
      // If the provider returns a session ID, store it for supplementary audit metadata.
      void (async () => {
        const result = await deliverOtp(req.log, {
          phone: body.phone,
          code,
          purpose: 'login',
          reference: challengeId,
        });

        if (result.providerSessionId) {
          await db
            .query(
              `UPDATE otp_challenges SET provider_session_id = $2 WHERE id = $1`,
              [challengeId, result.providerSessionId],
            )
            .catch((err) => {
              req.log.error({ err, reference: challengeId }, 'failed to store provider_session_id');
            });
        }

        if (result.outcome === 'failed') {
          req.log.warn({ reference: challengeId }, 'OTP delivery failed — user may retry via resend');
        }
      })();

      // The development store keeps the plaintext code in memory so the /dev/otp endpoint can
      // reveal it without database access. Never used in production.
      if (config.ENABLE_DEV_ENDPOINTS) rememberCode(challengeId, code, 'login');

      return reply.code(202).send({
        challenge_id: challengeId,
        expires_in_seconds: config.OTP_TTL_SECONDS,
        resend_after_seconds: config.OTP_RESEND_COOLDOWN_SECONDS,
      });
    },
  );

  // POST /auth/otp/verify
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

    // Atomically consume — prevents replay under concurrent requests.
    const consumed = await db.query(
      `UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
      [challenge.id],
    );
    if (consumed.rowCount === 0) throw new AppError('OTP_ALREADY_USED');

    const user = await db.transaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(`SELECT id FROM users WHERE phone_hash = $1`, [
        challenge.phone_hash,
      ]);
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

  // POST /auth/refresh
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
      // A rotated token was replayed. Kill the whole family (reuse detection).
      await db.query(`UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [
        session.family_id,
      ]);
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

    // Rotate: revoke the old row (keeping its hash for reuse detection), issue a new one.
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

  // POST /auth/logout
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
