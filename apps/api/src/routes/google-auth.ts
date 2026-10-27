import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { isUniqueViolation } from '../lib/db-errors.ts';
import { createPkce, googleAuthService, type GoogleUserInfo } from '../lib/google-auth.ts';
import { createSession } from '../lib/auth.ts';
import { OAUTH_COOKIE, deleteCookie, readCookie, setCookie, setRefreshCookie } from '../lib/cookies.ts';
import { open as openSealed, seal } from '../lib/seal.ts';
import { safeEqual, sha256 } from '../lib/crypto.ts';
import { isNativeClient } from '../lib/session-transport.ts';
import { syncAdminRoles } from '../lib/admin-access.ts';
import { audit } from '../services/audit.ts';
import { loadProfile } from './auth.ts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';

const googleAuthSchema = z
  .object({
    code: z.string().min(1).max(4096),
    state: z.string().min(1).max(1024),
    /**
     * The browser's copy of the handshake binding, held in `sessionStorage`. Optional only because
     * the same value also travels as an HttpOnly cookie, and a browser that carries the cookie has
     * already proved who it is.
     */
    binding: z.string().length(32).optional(),
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
  /** `sha256` of the binding, so the value that can complete the flow is never stored in the state. */
  bindingHash: string;
  expiresAt: number;
}

/**
 * The handshake, sealed into the `state` Google carries back to us.
 *
 * It used to be an in-process `Map` keyed by `state`, plus an HttpOnly cookie holding that key. The
 * two refused callbacks in the attached Render log are one of each:
 *
 *  - The map lived in one Node process. A redeploy, a hibernating instance waking up or a second
 *    replica forgets every in-flight handshake, so a callback that follows an authorize served
 *    anywhere else has a `state` with nothing behind it. One of the two arrived from a client that
 *    made no `authorize` request anywhere in the log window at all.
 *  - The cookie had to survive a cross-site round trip to `accounts.google.com` and come back on a
 *    fetch from `parcelyatra.vercel.app` to an API on `onrender.com`. Browsers that refuse
 *    third-party cookies — Safari, Firefox, Chrome in incognito — never send it. The other refused
 *    callback had a successful `authorize` on the same live process 27 seconds earlier, so the
 *    handshake was there and the browser's half was the only thing left to fail; the same client got
 *    `401` on both of its `POST /auth/refresh` calls, which is the same cookie policy applied to the
 *    session.
 *
 * Sealing removes the first failure entirely: nothing is remembered, so nothing can be forgotten.
 * The binding is sent by two transports, which removes the second one — a browser that blocks
 * cookies still has its own `sessionStorage`, and a browser whose OAuth round trip lands in a fresh
 * tab (Android custom tabs) still has the cookie. The state itself is encrypted, so neither the PKCE
 * verifier nor the nonce is ever readable by the browser, an extension or the history entry.
 *
 * What is given up is single-use: nothing on the server says "this state was already spent". PKCE
 * covers it — the verifier is inside the sealed state, so a spent state cannot be turned into a second
 * token exchange, because Google's authorization code is itself single-use and bound to the challenge.
 */
function sealHandshake(handshake: Handshake): string {
  return seal(JSON.stringify(handshake), 'oauth_state');
}

function unsealHandshake(state: string): Handshake | null {
  const raw = openSealed(state, 'oauth_state');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Handshake>;
    if (
      typeof parsed.codeVerifier !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.bindingHash !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    return {
      codeVerifier: parsed.codeVerifier,
      nonce: parsed.nonce,
      bindingHash: parsed.bindingHash,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

type HandshakeRejection = 'state_unreadable' | 'state_expired' | 'binding_missing' | 'binding_mismatch';

/**
 * A rejected callback is the one failure in the product that the user cannot describe and the log
 * could not explain: it answered `400` with no reason recorded. These names are the branches of the
 * check above, and they are safe to log. The `state`, the `code` and the binding are never logged —
 * a live handshake in a log line is a sign-in anyone with log read access can finish.
 */
function rejectHandshake(req: FastifyRequest, reason: HandshakeRejection): never {
  req.log.warn({ reason, path: req.url.split('?')[0] }, 'Google sign-in handshake rejected');
  throw new AppError('INVALID_STATE');
}

export async function googleAuthRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  // GET /auth/google/authorize
  app.get('/auth/google/authorize', async (req, reply) => {
    if (!config.GOOGLE_OAUTH_ENABLED) {
      throw new AppError('GOOGLE_OAUTH_DISABLED');
    }

    const pkce = createPkce();
    const nonce = randomBytes(16).toString('hex');
    // The binding is handed to the browser in plaintext so it can be sent back; the server only keeps
    // its hash, inside the sealed state.
    const binding = randomBytes(16).toString('hex');

    const state = sealHandshake({
      codeVerifier: pkce.verifier,
      nonce,
      bindingHash: sha256(binding),
      expiresAt: Date.now() + HANDSHAKE_TTL_MS,
    });

    const authUrl = googleAuthService.buildAuthorizationUrl({ state, nonce, codeChallenge: pkce.challenge });

    setCookie(reply, OAUTH_COOKIE, binding, { maxAgeSeconds: HANDSHAKE_TTL_MS / 1000 });

    return reply.send({ authorization_url: authUrl, state, handshake_binding: binding });
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

      const handshake = unsealHandshake(body.state);
      if (!handshake) rejectHandshake(req, 'state_unreadable');
      if (handshake.expiresAt < Date.now()) rejectHandshake(req, 'state_expired');

      // The state has to come back with the value we issued to that browser, or it is a link someone
      // else obtained — which would sign the reader of that link into the account it was made for.
      // Either copy counts: two tabs of the same browser share the cookie but not their
      // `sessionStorage`, so the tab that did not start this attempt still carries a valid proof.
      const supplied = [body.binding, readCookie(req, OAUTH_COOKIE)].filter(
        (value): value is string => typeof value === 'string',
      );
      deleteCookie(reply, OAUTH_COOKIE);
      if (supplied.length === 0) rejectHandshake(req, 'binding_missing');
      if (!supplied.some((value) => safeEqual(sha256(value), handshake.bindingHash))) {
        rejectHandshake(req, 'binding_mismatch');
      }

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
  if (user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED');
  if (user.status === 'deleted') throw new AppError('ACCOUNT_DELETED');
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
    // See lib/session-transport.ts: the mobile client keeps this in the platform keystore.
    ...(isNativeClient(req) ? { refresh_token: session.refreshToken } : {}),
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
 *
 * Deleted accounts are tombstones (`deleted_at` set) with their login identifiers freed by the
 * deletion route, so they match neither lookup and the person gets a fresh account, as the deletion
 * asked for. A retry on a unique violation settles the case where two first sign-ins for one
 * identity race each other: the loser reads the winner's row instead of answering 500.
 */
export async function upsertUserFromGoogle(db: Db, googleUser: GoogleUserInfo): Promise<UserRecord> {
  try {
    return await resolveGoogleUser(db, googleUser);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await db.query<UserRecord & { google_sub: string | null }>(
      `SELECT ${USER_COLUMNS}, google_sub FROM users WHERE google_sub = $1 AND deleted_at IS NULL LIMIT 1`,
      [googleUser.sub],
    );
    if (existing.rows[0]) return existing.rows[0];

    // A tombstone from before migration 0009 can still hold the subject. Freeing it is what the
    // migration would have done; the person then gets the fresh account the deletion implies.
    const freed = await db.query(
      `UPDATE users SET google_sub = NULL, updated_at = now()
        WHERE google_sub = $1 AND deleted_at IS NOT NULL`,
      [googleUser.sub],
    );
    if ((freed.rowCount ?? 0) > 0) return await resolveGoogleUser(db, googleUser);

    throw new AppError(
      'GOOGLE_AUTH_FAILED',
      { reason: 'identity_conflict' },
      'This Google account could not be linked to a Parcel Yatra account.',
    );
  }
}

async function resolveGoogleUser(db: Db, googleUser: GoogleUserInfo): Promise<UserRecord> {
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
