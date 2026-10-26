import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { createPkce, googleAuthService, type GoogleUserInfo } from '../lib/google-auth.ts';
import { createSession } from '../lib/auth.ts';
import { OAUTH_COOKIE, deleteCookie, readCookie, setCookie, setRefreshCookie } from '../lib/cookies.ts';
import { syncAdminRoles } from '../lib/admin-access.ts';
import { audit } from '../services/audit.ts';
import { loadProfile } from './auth.ts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';

const googleAuthSchema = z
  .object({
    code: z.string().min(1).max(4096),
    state: z.string().min(1).max(512),
    device_id: z.string().max(128).optional(),
  })
  .strict();

const googleLoginSchema = z
  .object({
    id_token: z.string().min(1).max(8192),
    device_id: z.string().max(128).optional(),
  })
  .strict();

const HANDSHAKE_TTL_MS = 10 * 60 * 1000;

interface Handshake {
  codeVerifier: string;
  nonce: string;
  expiresAt: number;
}

/**
 * In-flight OAuth handshakes, keyed by `state`.
 *
 * Each record is bound to the browser that started it by an HttpOnly cookie, so a leaked `state`
 * arriving from a different browser cannot complete the flow. Entries are single-use and expire.
 */
const handshakes = new Map<string, Handshake>();

setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of handshakes) {
    if (entry.expiresAt < now) handshakes.delete(state);
  }
}, HANDSHAKE_TTL_MS).unref();

export async function googleAuthRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  // GET /auth/google/authorize
  app.get('/auth/google/authorize', async (req, reply) => {
    if (!config.GOOGLE_OAUTH_ENABLED) {
      throw new AppError('GOOGLE_OAUTH_DISABLED');
    }

    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const pkce = createPkce();

    handshakes.set(state, { codeVerifier: pkce.verifier, nonce, expiresAt: Date.now() + HANDSHAKE_TTL_MS });

    const authUrl = googleAuthService.buildAuthorizationUrl({ state, nonce, codeChallenge: pkce.challenge });

    setCookie(reply, OAUTH_COOKIE, state, { maxAgeSeconds: HANDSHAKE_TTL_MS / 1000 });

    return reply.send({ authorization_url: authUrl, state });
  });

  // POST /auth/google/callback
  app.post(
    '/auth/google/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!config.GOOGLE_OAUTH_ENABLED) {
        throw new AppError('GOOGLE_OAUTH_DISABLED');
      }

      const body = googleAuthSchema.parse(req.body);

      const cookieState = readCookie(req, OAUTH_COOKIE);
      deleteCookie(reply, OAUTH_COOKIE);

      const handshake = handshakes.get(body.state);
      handshakes.delete(body.state);

      if (!handshake || handshake.expiresAt < Date.now()) throw new AppError('INVALID_STATE');
      // The state has to come from the same browser that started the flow, not from the request body
      // alone; otherwise an attacker can sign a victim into an account the attacker controls.
      if (!cookieState || cookieState !== body.state) throw new AppError('INVALID_STATE');

      const googleUser = await googleAuthService.completeOAuthFlow(body.code, {
        codeVerifier: handshake.codeVerifier,
        nonce: handshake.nonce,
        log: req.log,
      });

      return await finishSignIn(db, req, reply, googleUser, body.device_id, 'google_signin');
    },
  );

  // POST /auth/google/token
  // Direct ID-token sign-in for a client that obtained the token itself (mobile, Google button).
  app.post(
    '/auth/google/token',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!config.GOOGLE_OAUTH_ENABLED) {
        throw new AppError('GOOGLE_OAUTH_DISABLED');
      }

      const body = googleLoginSchema.parse(req.body);
      const googleUser = await googleAuthService.verifyIdToken(body.id_token);

      return await finishSignIn(db, req, reply, googleUser, body.device_id, 'google_signin_token');
    },
  );
}

/**
 * Shared tail of both Google entry points: resolve or create the account, apply the staff policy,
 * open a session and answer with the access token only. The refresh token goes into an HttpOnly
 * cookie, so it never passes through script-readable storage.
 */
async function finishSignIn(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  googleUser: GoogleUserInfo,
  deviceId: string | undefined,
  action: string,
) {
  if (!googleUser.email_verified) {
    throw new AppError('GOOGLE_AUTH_FAILED', undefined, 'Google did not confirm this address is verified.');
  }

  const user = await upsertUserFromGoogle(db, googleUser);
  const isAdmin = await syncAdminRoles(db, user.id, googleUser.email);

  const session = await createSession(db, user.id, {
    deviceId: deviceId ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });

  setRefreshCookie(reply, session.refreshToken);

  await audit(db, {
    actorId: user.id,
    actorKind: 'user',
    action,
    resource: 'user',
    resourceId: user.id,
    after: { google_sub: googleUser.sub, admin: isAdmin },
  });

  return {
    user: await loadProfile(req.server, user.id),
    access_token: session.accessToken,
    expires_in: session.expiresIn,
    phone_verification_required: config.PHONE_VERIFICATION_REQUIRED,
  };
}

interface UserRecord {
  id: string;
  name: string | null;
  email: string | null;
  phone_last4: string | null;
  status: 'active' | 'suspended' | 'deleted';
  risk_tier: number;
  locale: string;
  created_at: Date;
}

const USER_COLUMNS = `id, name, email, phone_last4, status, risk_tier, locale, created_at`;

async function findUserByEmail(db: Db, email: string): Promise<string | null> {
  const res = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`,
    [email],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Resolve the local account for a verified Google identity.
 *
 * Order matters: the Google subject is the authoritative link. Email is only used to attach a
 * subject to an account that predates it (a phone-OTP signup that later signs in with Google), and
 * that path requires Google to have confirmed the address is verified.
 */
export async function upsertUserFromGoogle(db: Db, googleUser: GoogleUserInfo): Promise<UserRecord> {
  return await db.transaction(async (tx) => {
    const bySub = await tx.query<UserRecord & { google_sub: string | null }>(
      `SELECT ${USER_COLUMNS}, google_sub FROM users WHERE google_sub = $1 AND deleted_at IS NULL LIMIT 1`,
      [googleUser.sub],
    );

    if (bySub.rows[0]) {
      const user = bySub.rows[0];
      await tx.query(
        `UPDATE users
         SET name = COALESCE($1, name), locale = COALESCE($2, locale),
             email = $3, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
         WHERE id = $4`,
        [googleUser.name, googleUser.locale ?? null, googleUser.email, user.id],
      );
      return user;
    }

    const emailId = await findUserByEmail(tx, googleUser.email);
    if (emailId) {
      // Link only when no other Google subject already owns the row; the partial unique index on
      // google_sub makes a competing link a constraint violation rather than a silent merge.
      const linked = await tx.query<UserRecord & { google_sub: string | null }>(
        `UPDATE users
         SET google_sub = $2, email_verified_at = now(),
             name = COALESCE(name, $3), locale = COALESCE($4, locale), updated_at = now()
         WHERE id = $1 AND google_sub IS NULL
         RETURNING ${USER_COLUMNS}, google_sub`,
        [emailId, googleUser.sub, googleUser.name, googleUser.locale ?? null],
      );
      const row = linked.rows[0];
      if (!row) throw new AppError('GOOGLE_AUTH_FAILED', { reason: 'account_already_linked' });

      await audit(tx, {
        actorId: row.id,
        actorKind: 'system',
        action: 'auth.google_linked_by_email',
        resource: 'user',
        resourceId: row.id,
        after: { google_sub: googleUser.sub },
      });

      // An address typed into `PATCH /me` proves nothing about who owns it, so this match is not
      // proof that whoever holds an existing session is the person Google just verified. The
      // verified identity takes the account over and every session on it is dropped; the previous
      // holder has to sign in again and finds nothing waiting for them.
      await tx.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.id]);

      return row;
    }

    const created = await tx.query<UserRecord & { google_sub: string | null }>(
      `INSERT INTO users (google_sub, email, email_verified_at, name, locale, status, risk_tier, created_at, updated_at)
       VALUES ($1, $2, now(), $3, COALESCE($4,'en-IN'), 'active', 1, now(), now())
       RETURNING ${USER_COLUMNS}, google_sub`,
      [googleUser.sub, googleUser.email, googleUser.name, googleUser.locale ?? null],
    );
    const user = created.rows[0]!;

    await tx.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'sender') ON CONFLICT DO NOTHING`, [user.id]);

    return user;
  });
}
