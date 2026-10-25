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

/**
 * Google OAuth 2.0 authentication service
 * 
 * Flow:
 * 1. Frontend redirects to Google's authorization URL
 * 2. Google redirects back to our callback with authorization code
 * 3. We exchange code for tokens
 * 4. We fetch user info from Google
 * 5. We create or update local user account
 */
export class GoogleAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly enabled: boolean;

  constructor() {
    // Credentials are validated lazily when the flow is actually used, so an API that has Google
    // OAuth disabled still boots even without Client ID/Secret configured.
    this.clientId = config.GOOGLE_CLIENT_ID ?? '';
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

  /**
   * Generate Google OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    this.requireConfigured();

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string; error_description?: string };
      throw new AppError('GOOGLE_AUTH_FAILED', {
        message: `Failed to exchange code for token: ${error.error_description || error.error}`,
      });
    }

    return (await response.json()) as GoogleTokenResponse;
  }

  /**
   * Fetch user info from Google using access token
   */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new AppError('GOOGLE_AUTH_FAILED');
    }

    return (await response.json()) as GoogleUserInfo;
  }

  /**
   * Verify ID token and extract user info
   */
  async verifyIdToken(idToken: string): Promise<GoogleUserInfo> {
    const response = await fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        id_token: idToken,
      }),
    });

    if (!response.ok) {
      throw new AppError('GOOGLE_AUTH_FAILED', {
        message: 'Failed to verify ID token',
      });
    }

    const data = (await response.json()) as GoogleUserInfo;

    return {
      sub: data.sub,
      email: data.email,
      email_verified: data.email_verified === true,
      name: data.name,
      picture: data.picture,
      given_name: data.given_name,
      family_name: data.family_name,
      locale: data.locale,
    };
  }

  /**
   * Complete OAuth flow: exchange code, get user info, create/update local user
   */
  async completeOAuthFlow(code: string, log: FastifyBaseLogger): Promise<GoogleUserInfo> {
    try {
      // Exchange authorization code for tokens
      const tokens = await this.exchangeCodeForToken(code);
      
      // Get user info from Google
      const userInfo = await this.getUserInfo(tokens.access_token);
      
      log.info({ 
        googleUserId: userInfo.sub, 
        email: userInfo.email,
        emailVerified: userInfo.email_verified 
      }, 'Google OAuth successful');
      
      return userInfo;
    } catch (error) {
      log.error({ error }, 'Google OAuth flow failed');
      throw error;
    }
  }
}

// Singleton instance
export const googleAuthService = new GoogleAuthService();