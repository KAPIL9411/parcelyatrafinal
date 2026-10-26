import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config.ts';

/**
 * The refresh token and the OAuth handshake live in HttpOnly cookies, never in JavaScript-readable
 * storage. A stolen access token expires on its own; a stolen refresh token in `localStorage` is a
 * permanent session an XSS payload can exfiltrate.
 *
 * `SameSite=None; Secure` is what makes this work in production, where the web app
 * (parcelyatra.vercel.app) and the API (onrender.com) are different registrable domains. A Lax
 * cookie would not be sent cross-site at all. Local development is same-origin through the Vite
 * proxy, so it keeps Lax and drops Secure for plain http.
 */

export interface CookieAttributes {
  path: string;
  maxAgeSeconds: number;
  httpOnly?: boolean;
  sameSite: 'lax' | 'none' | 'strict';
  secure: boolean;
}

const base: CookieAttributes = {
  path: '/',
  maxAgeSeconds: 0,
  sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
  secure: config.NODE_ENV === 'production',
};

export const REFRESH_COOKIE = 'py_refresh';
export const OAUTH_COOKIE = 'py_oauth';
/** Scoped to the auth endpoints only; the browser never attaches it to business calls. */
export const AUTH_COOKIE_PATH = '/v1/auth';

function serialize(name: string, value: string, attrs: CookieAttributes): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${attrs.path}`,
    'HttpOnly',
    `SameSite=${attrs.sameSite === 'lax' ? 'Lax' : attrs.sameSite === 'none' ? 'None' : 'Strict'}`,
  ];
  if (attrs.secure) parts.push('Secure');
  if (attrs.maxAgeSeconds > 0) parts.push(`Max-Age=${Math.floor(attrs.maxAgeSeconds)}`);
  return parts.join('; ');
}

export function setCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; path?: string },
): void {
  reply.header('set-cookie', serialize(name, value, { ...base, path: opts.path ?? AUTH_COOKIE_PATH, maxAgeSeconds: opts.maxAgeSeconds }));
}

export function deleteCookie(reply: FastifyReply, name: string, path = AUTH_COOKIE_PATH): void {
  reply.header('set-cookie', serialize(name, '', { ...base, path, maxAgeSeconds: 0 }));
}

export function readCookie(req: FastifyRequest, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

export function setRefreshCookie(reply: FastifyReply, refreshToken: string): void {
  setCookie(reply, REFRESH_COOKIE, refreshToken, { maxAgeSeconds: config.JWT_REFRESH_TTL_SECONDS });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  deleteCookie(reply, REFRESH_COOKIE);
}

export function readRefreshCookie(req: FastifyRequest): string | null {
  return readCookie(req, REFRESH_COOKIE);
}
