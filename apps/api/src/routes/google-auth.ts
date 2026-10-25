import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { googleAuthService } from '../lib/google-auth.ts';
import { createSession } from '../lib/auth.ts';
import { sha256 } from '../lib/crypto.ts';
import { userProfile } from '../lib/serialize.ts';
import { audit } from '../services/audit.ts';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';

const googleAuthSchema = z
  .object({
    code: z.string().min(1),
    state: z.string().optional(),
    device_id: z.string().max(128).optional(),
  })
  .strict();

const googleLoginSchema = z
  .object({
    id_token: z.string().min(1),
    device_id: z.string().max(128).optional(),
  })
  .strict();

export async function googleAuthRoutes(app: FastifyInstance): Promise<void> {
    const db = app.db;

  // One-time-use OAuth state values issued by /auth/google/authorize. Valid for five minutes and
  // consumed (deleted) on first use at /auth/google/callback, so a leaked state can only be used once.
  const oauthStates = new Map<string, { expiresAt: number }>();
  const STATE_TTL_MS = 5 * 60 * 1000;

  function issueState(): string {
    const state = randomBytes(16).toString('hex');
    oauthStates.set(state, { expiresAt: Date.now() + STATE_TTL_MS });
    return state;
  }

  function consumeState(state: string | null | undefined): boolean {
    if (!state) return false;
    const entry = oauthStates.get(state);
    if (!entry || entry.expiresAt < Date.now()) return false;
    oauthStates.delete(state);
    return true;
  }

  // Drop expired states so the in-memory store does not grow unbounded.
  setInterval(() => {
    const now = Date.now();
    for (const [state, entry] of oauthStates) {
      if (entry.expiresAt < now) oauthStates.delete(state);
    }
  }, STATE_TTL_MS).unref();

  // GET /auth/google/authorize
  // Generate Google OAuth authorization URL
  app.get('/auth/google/authorize', async (req, reply) => {
    if (!config.GOOGLE_OAUTH_ENABLED) {
      throw new AppError('GOOGLE_OAUTH_DISABLED');
    }

    // Generate state parameter to prevent CSRF
    const state = issueState();

    const authUrl = googleAuthService.getAuthorizationUrl(state);
    
    return reply.send({ 
      authorization_url: authUrl,
      state,
    });
  });

  // POST /auth/google/callback
  // Handle Google OAuth callback with authorization code
  app.post(
    '/auth/google/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!config.GOOGLE_OAUTH_ENABLED) {
        throw new AppError('GOOGLE_OAUTH_DISABLED');
      }

      const body = googleAuthSchema.parse(req.body);
      
      if (!consumeState(body.state)) {
        throw new AppError('INVALID_STATE');
      }

      // Complete OAuth flow
      const googleUser = await googleAuthService.completeOAuthFlow(body.code, req.log);

      // Check if email is verified
      if (!googleUser.email_verified) {
        throw new AppError('GOOGLE_AUTH_FAILED', {
          message: 'Email not verified by Google',
        });
      }

      // Find or create user
      const user = await findOrCreateUserFromGoogle(db, googleUser, req.log);

      const roles = await db.query<{ role: string }>(
        `SELECT role FROM user_roles WHERE user_id = $1`,
        [user.id],
      );

      // Create session
      const { accessToken, refreshToken } = await createSession(db, user.id, {
        deviceId: body.device_id,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });

      // Audit log
      await audit(db, {
        actorId: user.id,
        actorKind: 'user',
        action: 'google_signin',
        resource: 'user',
        resourceId: user.id,
        after: { googleUserId: googleUser.sub, email: googleUser.email },
      });

      return reply.send({
        user: userProfile(user, roles.rows.map((r) => r.role)),
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: config.JWT_ACCESS_TTL_SECONDS,
      });
    },
  );

  // POST /auth/google/token
  // Alternative: Direct authentication with Google ID token (for mobile apps)
  app.post(
    '/auth/google/token',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!config.GOOGLE_OAUTH_ENABLED) {
        throw new AppError('GOOGLE_OAUTH_DISABLED');
      }

      const body = googleLoginSchema.parse(req.body);
      
      // Verify ID token
      const googleUser = await googleAuthService.verifyIdToken(body.id_token);

      // Check if email is verified
      if (!googleUser.email_verified) {
        throw new AppError('GOOGLE_AUTH_FAILED', {
          message: 'Email not verified by Google',
        });
      }

      // Find or create user
      const user = await findOrCreateUserFromGoogle(db, googleUser, req.log);

      const roles = await db.query<{ role: string }>(
        `SELECT role FROM user_roles WHERE user_id = $1`,
        [user.id],
      );

      // Create session
      const { accessToken, refreshToken } = await createSession(db, user.id, {
        deviceId: body.device_id,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });

      // Audit log
      await audit(db, {
        actorId: user.id,
        actorKind: 'user',
        action: 'google_signin_token',
        resource: 'user',
        resourceId: user.id,
        after: { googleUserId: googleUser.sub, email: googleUser.email },
      });

      return reply.send({
        user: userProfile(user, roles.rows.map((r) => r.role)),
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: config.JWT_ACCESS_TTL_SECONDS,
      });
    },
  );
}

/**
 * Find existing user by email or create new user from Google OAuth data
 */
async function findOrCreateUserFromGoogle(
  db: Db,
  googleUser: { sub: string; email: string; name: string; picture?: string; locale?: string },
  log: FastifyBaseLogger,
) {
  return await db.transaction(async (tx) => {
    // Check if user exists with this email
    const existingUser = await tx.query<{
      id: string;
      phone_hash: string | null;
      phone_last4: string;
      phone_masked: string;
      name: string | null;
      email: string | null;
      status: 'active' | 'suspended' | 'deleted';
      risk_tier: number;
      locale: string;
      phone_verified_at: Date | null;
      fraud_flag: boolean;
      created_at: Date;
      updated_at: Date;
      deleted_at: Date | null;
    }>(
      `SELECT * FROM users 
       WHERE email = $1 AND deleted_at IS NULL 
       LIMIT 1`,
      [googleUser.email],
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0]!;
      
      // Update user profile with latest Google info
      await tx.query(
        `UPDATE users 
         SET name = COALESCE($1, name), 
             locale = COALESCE($2, locale),
             updated_at = now()
         WHERE id = $3`,
        [googleUser.name || user.name, googleUser.locale || user.locale, user.id],
      );

      log.info({ userId: user.id, email: googleUser.email }, 'Existing user logged in via Google');
      return user;
    }

    // Google users have no phone number. Use a deterministic hash of the Google subject as the
    // unique phone_hash (NOT NULL UNIQUE in the schema) so the same Google account always maps
    // to the same local user; derive a placeholder last-four from it.
    const phoneHash = sha256(`google:${googleUser.sub}`);

    // Create new user
    const newUser = await tx.query<{
      id: string;
      phone_hash: string | null;
      phone_last4: string;
      phone_masked: string;
      name: string | null;
      email: string | null;
      status: 'active' | 'suspended' | 'deleted';
      risk_tier: number;
      locale: string;
      phone_verified_at: Date | null;
      fraud_flag: boolean;
      created_at: Date;
      updated_at: Date;
      deleted_at: Date | null;
    }>(
      `INSERT INTO users (
        phone_hash, phone_last4, phone_masked, name, email, 
        status, risk_tier, locale, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'active', 1, $6, now(), now())
      RETURNING *`,
      [
        phoneHash,
        phoneHash.slice(-4),
        'Google User',
        googleUser.name,
        googleUser.email,
        googleUser.locale || 'en-IN',
      ],
    );

    const user = newUser.rows[0]!;
    
    // Add default sender role
    await tx.query(
      `INSERT INTO user_roles (user_id, role, granted_at) 
       VALUES ($1, 'sender', now())`,
      [user.id],
    );

    log.info({ userId: user.id, email: googleUser.email }, 'New user created via Google OAuth');
    return user;
  });
}