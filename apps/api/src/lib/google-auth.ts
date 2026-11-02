import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

import { config } from '../config.ts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from './errors.ts';

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Every call to Google is bounded; a hung identity provider must not pin a request slot open. */
const GOOGLE_FETCH_TIMEOUT_MS = 10_000;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet(): ReturnType<typeof createRemoteJWKSet> {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function createPkce(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Google OAuth 2.0 (authorization code + PKCE).
 *
 * 1. Frontend asks /auth/google/authorize, which returns the Google URL and sets an HttpOnly
 *    cookie binding the browser to the `state`, `nonce` and PKCE verifier held by the API.
 * 2. Google redirects back with `code` + `state`.
 * 3. The API exchanges the code, proves the redirect target is ours by checking the nonce, and
 *    verifies the ID token's signature, issuer and audience locally against Google's JWKS.
 */
export class GoogleAuthService {
  private readonly clientId: string;
  /** Web client plus the native Android/iOS clients; a token is valid if it targets any of them. */
  private readonly audiences: string[];
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly enabled: boolean;

  constructor() {
    // Credentials are validated lazily when the flow is actually used, so an API that has Google
    // OAuth disabled still boots even without Client ID/Secret configured.
    this.clientId = config.GOOGLE_CLIENT_ID ?? '';
    this.audiences = [
      this.clientId,
      ...config.GOOGLE_ADDITIONAL_CLIENT_IDS.split(',').map((id) => id.trim()),
    ].filter(Boolean);
    this.clientSecret = config.GOOGLE_CLIENT_SECRET ?? '';
    this.redirectUri = config.GOOGLE_REDIRECT_URI ?? '';
    this.enabled = config.GOOGLE_OAUTH_ENABLED;
  }

  private requireConfigured(): void {
    if (!this.enabled) throw new AppError('GOOGLE_OAUTH_DISABLED');
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new AppError(
        'GOOGLE_OAUTH_DISABLED',
        undefined,
        'Google OAuth is not enabled or not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.',
      );
    }
  }

  /** Google OAuth authorization URL for this browser session. */
  buildAuthorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): string {
    this.requireConfigured();

    const query = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      // `consent` is deliberately not requested: it asks the user for offline access the app never
      // uses and makes every sign-in look like a permission grant.
      prompt: 'select_account',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForToken(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
    this.requireConfigured();

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw new AppError('GOOGLE_AUTH_FAILED', { cause: String(err) }, 'Google did not respond in time.');
    });

    if (!response.ok) {
      // The provider's description can echo request data back; it stays in the log, never in the response.
      const error = (await response.json().catch(() => ({}))) as { error?: string };
      throw new AppError('GOOGLE_AUTH_FAILED', { provider_error: error.error }, 'Google rejected the sign-in.');
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  /**
   * Fetch user info from Google using access token
   */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
    }).catch(() => {
      throw new AppError('GOOGLE_AUTH_FAILED', undefined, 'Google did not respond in time.');
    });

    if (!response.ok) {
      throw new AppError('GOOGLE_AUTH_FAILED');
    }

    return this.normalize((await response.json()) as GoogleUserInfo, null);
  }

  /**
   * Verify a Google ID token: signature (RS256 via JWKS), issuer, audience, expiry and nonce.
   *
   * The previous implementation called Google's `tokeninfo` endpoint, which answers "is this a real
   * Google token?" but not "was this token issued for *this* client?" — a token minted for any other
   * Google OAuth app for the same address would have signed the user into this one.
   */
  async verifyIdToken(idToken: string, expectedNonce?: string | null): Promise<GoogleUserInfo> {
    this.requireConfigured();

    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, keySet(), {
        issuer: GOOGLE_ISSUERS,
        // One token, several legitimate audiences: the web client for the browser flow and the
        // Android/iOS clients for `POST /auth/google/token`.
        audience: this.audiences,
        algorithms: ['RS256'],
        clockTolerance: 30,
      });
      payload = verified.payload as Record<string, unknown>;
    } catch (err) {
      throw new AppError('GOOGLE_AUTH_FAILED', { reason: (err as Error).name }, 'Google ID token rejected.');
    }

    if (expectedNonce && typeof payload.nonce === 'string' && payload.nonce !== expectedNonce) {
      // A token that is valid but was not requested by this browser session: replay or mix-up.
      throw new AppError('GOOGLE_AUTH_FAILED', { reason: 'nonce_mismatch' }, 'Google ID token rejected.');
    }

    return this.normalize(payload as unknown as GoogleUserInfo, payload);
  }

  private normalize(data: GoogleUserInfo, payload: Record<string, unknown> | null): GoogleUserInfo {
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!data.sub || !email) throw new AppError('GOOGLE_AUTH_FAILED');

    // Google sends `email_verified` as a JSON boolean from userinfo and a string from some ID
    // tokens; both mean the same thing, and anything else means unverified.
    const rawVerified = payload?.email_verified ?? data.email_verified;

    return {
      sub: String(data.sub),
      email,
      email_verified: rawVerified === true || rawVerified === 'true',
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : email.split('@')[0]!,
      picture: data.picture,
      given_name: data.given_name,
      family_name: data.family_name,
      locale: data.locale,
    };
  }

  /**
   * Complete OAuth flow: exchange code, verify the ID token, return the identity.
   */
  async completeOAuthFlow(
    code: string,
    opts: { codeVerifier: string; nonce: string; log: FastifyBaseLogger },
  ): Promise<GoogleUserInfo> {
    const tokens = await this.exchangeCodeForToken(code, opts.codeVerifier);

    if (!tokens.id_token) {
      throw new AppError('GOOGLE_AUTH_FAILED', { reason: 'no_id_token' });
    }

    const userInfo = await this.verifyIdToken(tokens.id_token, opts.nonce);
    opts.log.info({ googleUserId: userInfo.sub }, 'Google OAuth successful');

    return userInfo;
  }
}

// Singleton instance
export const googleAuthService = new GoogleAuthService();
