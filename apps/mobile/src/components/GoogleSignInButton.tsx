import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';

import { ApiError } from '../api/http.ts';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../lib/google.ts';
import { GoogleButtonShell } from './GoogleButtonShell.tsx';

export interface GoogleSignInButtonProps {
  busy: boolean;
  onToken: (idToken: string) => void;
  onError: (error: unknown) => void;
}

/**
 * Web flow: authorization code + PKCE via backend /auth/google/authorize endpoint.
 * This ensures the session cookie is set correctly on the backend.
 *
 * Native flow: ID token directly to /auth/google/token (mobile clients obtain their own token).
 */
export function GoogleSignInButton({ busy, onToken, onError }: GoogleSignInButtonProps) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params.id_token ?? response.authentication?.idToken;
      if (idToken) onToken(idToken);
      else onError(new ApiError('GOOGLE_AUTH_FAILED', 'Google did not return an identity token.', 400));
    } else if (response?.type === 'error') {
      onError(
        new ApiError('GOOGLE_AUTH_FAILED', response.error?.message ?? 'Google sign-in did not complete.', 400),
      );
    }
  }, [response, onToken, onError]);

  async function prompt() {
    try {
      // Web: Use backend OAuth flow for proper session establishment
      if (Platform.OS === 'web') {
        await webOAuthFlow();
      } else {
        // Native: Use expo-auth-session to get ID token
        await new Promise(resolve => setTimeout(resolve, 100));
        await promptAsync();
      }
    } catch (err) {
      onError(
        new ApiError(
          'GOOGLE_AUTH_FAILED',
          err instanceof Error ? err.message : 'Google sign-in could not start.',
          400,
        ),
      );
    }
  }

  /**
   * Web-only OAuth flow using backend authorization endpoint.
   * This establishes a session cookie properly across same-origin requests.
   */
  async function webOAuthFlow() {
    try {
      // Step 1: Get authorization URL from backend
      const authorizeRes = await fetch('/v1/auth/google/authorize', { credentials: 'include' });
      if (!authorizeRes.ok) throw new Error('Failed to get authorization URL');
      const { authorization_url, state, handshake_binding } = (await authorizeRes.json()) as {
        authorization_url: string;
        state: string;
        handshake_binding: string;
      };

      // Step 2: Open Google authorization in popup
      const popup = window.open(authorization_url, 'google_signin', 'width=500,height=600');
      if (!popup) throw new Error('Failed to open authorization window');

      // Step 3: Wait for redirect back to /auth/google/callback with code
      // The callback will POST to /auth/google/callback with the code
      // For now, we'll store state in sessionStorage for the callback handler
      sessionStorage.setItem('py_oauth_state', state);
      sessionStorage.setItem('py_oauth_binding', handshake_binding);

      // Step 4: Wait for popup to close or message
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          // Check if session was established (try fetching user data)
          verifySession();
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(() => clearInterval(checkPopup), 5 * 60 * 1000);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Verify session was established after OAuth redirect
   */
  async function verifySession() {
    try {
      const res = await fetch('/v1/auth/whoami', { credentials: 'include' });
      if (res.ok) {
        // Session established! User is now signed in
        // Trigger a refresh to update app state
        window.location.reload();
      }
    } catch (err) {
      // Session not established
      onError(new ApiError('GOOGLE_AUTH_FAILED', 'Failed to establish session', 400));
    }
  }

  return <GoogleButtonShell busy={busy} disabled={!request || busy} onPress={() => void prompt()} />;
}
