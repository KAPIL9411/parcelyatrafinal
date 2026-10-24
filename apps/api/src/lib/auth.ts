import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { AppError } from './errors.ts';
import { randomToken, sha256 } from './crypto.ts';

const accessKey = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

export interface AccessClaims {
  sub: string;
  roles: string[];
  sid: string;
}

export interface AuthContext {
  userId: string;
  roles: string[];
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ roles: claims.roles })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('parcel-yatra')
    .setAudience('parcel-yatra-api')
    .setExpirationTime(`${config.JWT_ACCESS_TTL_SECONDS}s`)
    .setJti(claims.sid)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: 'parcel-yatra',
      audience: 'parcel-yatra-api',
      algorithms: ['HS256'],
    });
    if (!payload.sub || typeof payload.jti !== 'string') throw new AppError('AUTH_TOKEN_INVALID');
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    return { sub: payload.sub, roles, sid: payload.jti };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw new AppError('AUTH_TOKEN_EXPIRED');
    if (err instanceof AppError) throw err;
    throw new AppError('AUTH_TOKEN_INVALID');
  }
}

export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value;
}

/**
 * Populates `request.auth`. Missing credentials are rejected with AUTH_REQUIRED; a bad token with
 * AUTH_TOKEN_INVALID. Resource-level authorisation is handled per route and always returns 404 for
 * resources the caller is not party to (resource non-disclosure).
 */
export function makeAuthenticate(db: Db) {
  return async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = bearerToken(req);
    if (!token) throw new AppError('AUTH_REQUIRED');
    const claims = await verifyAccessToken(token);

    const session = await db.query<{ id: string; revoked_at: Date | null; expires_at: Date }>(
      `SELECT id, revoked_at, expires_at FROM sessions WHERE id = $1`,
      [claims.sid],
    );
    const row = session.rows[0];
    if (!row || row.revoked_at) throw new AppError('AUTH_SESSION_REVOKED');
    if (new Date(row.expires_at).getTime() < Date.now()) throw new AppError('AUTH_TOKEN_EXPIRED');

    const roles = await db.query<{ role: string }>(`SELECT role FROM user_roles WHERE user_id = $1`, [claims.sub]);
    req.auth = {
      userId: claims.sub,
      roles: roles.rows.map((r) => r.role),
      sessionId: claims.sid,
    };
  };
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError('AUTH_REQUIRED');
  return req.auth;
}

export function requireRole(req: FastifyRequest, ...roles: string[]): AuthContext {
  const auth = requireAuth(req);
  if (!auth.roles.some((r) => roles.includes(r))) throw new AppError('ROLE_REQUIRED');
  return auth;
}

export async function createSession(
  db: Db,
  userId: string,
  opts: { deviceId?: string | null; userAgent?: string | null; familyId?: string } = {},
): Promise<{ accessToken: string; refreshToken: string; sessionId: string; familyId: string; expiresIn: number }> {
  const refreshToken = randomToken(32);
  const familyId = opts.familyId ?? crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SECONDS * 1000);

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO sessions (user_id, refresh_hash, family_id, device_id, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, sha256(refreshToken), familyId, opts.deviceId ?? null, opts.userAgent ?? null, expiresAt],
  );
  const sessionId = inserted.rows[0]!.id;

  const roles = await db.query<{ role: string }>(`SELECT role FROM user_roles WHERE user_id = $1`, [userId]);
  const accessToken = await signAccessToken({
    sub: userId,
    roles: roles.rows.map((r) => r.role),
    sid: sessionId,
  });

  return { accessToken, refreshToken, sessionId, familyId, expiresIn: config.JWT_ACCESS_TTL_SECONDS };
}
