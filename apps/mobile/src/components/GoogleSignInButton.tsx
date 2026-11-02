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
 * Backend builds the Google auth URL with correct redirect_uri (/auth-callback),
 * Google redirects there, auth-callback page POSTs code to backend to establish session.
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
      // Small delay for iOS Safari to ensure button press is registered
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (Platform.OS === 'web') {
        // Web: Use backend OAuth flow for proper session establishment
        await webOAuthFlow();
      } else {
        // Native: Use expo-auth-session to get ID token
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
   *
   * Flow:
   * 1. GET /v1/auth/google/authorize -> backend returns Google auth URL with correct redirect_uri
   * 2. Open popup to that URL
   * 3. User authorizes on Google
   * 4. Google redirects to /auth-callback with authorization code
   * 5. /auth-callback page POSTs code to /v1/auth/google/callback
   * 6. Backend sets session cookie
   * 7. App boots and shows home screen
   */
  async function webOAuthFlow() {
    try {
      // Step 1: Get authorization URL from backend (with correct redirect_uri)
      const apiUrl = 'https://parcel-yatra-api.parcelyatra.workers.dev/v1';
      console.log('[OAuth] Getting authorization URL from:', `${apiUrl}/auth/google/authorize`);
      
      const authorizeRes = await fetch(`${apiUrl}/auth/google/authorize`, { 
        credentials: 'include',
        method: 'GET',
      });
      if (!authorizeRes.ok) {
        const error = await authorizeRes.text();
        throw new Error(`Failed to get authorization URL: ${error}`);
      }
      
      const authData = (await authorizeRes.json()) as {
        authorization_url: string;
        state: string;
        handshake_binding: string;
      };

      // Step 2: Open Google authorization in popup
      const popup = window.open(authData.authorization_url, 'google_signin', 'width=500,height=600');
      if (!popup) throw new Error('Failed to open authorization popup. Please check if popups are blocked.');

      // Step 3: Store binding for the callback page to use
      sessionStorage.setItem('py_oauth_binding', authData.handshake_binding);

      // Step 4: Wait for popup to close or redirect to happen
      // The redirect goes to /auth-callback, which will POST the code to backend
      // and the session will be established
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          // Give app a moment to restore session after /auth-callback completes
          setTimeout(() => {
            // Check if session was established by trying to fetch user data
            // Use full URL since we're using cross-origin API
            const apiUrl = 'https://parcel-yatra-api.parcelyatra.workers.dev/v1';
            console.log('[OAuth] Checking session at:', `${apiUrl}/auth/whoami`);
            
            fetch(`${apiUrl}/auth/whoami`, { credentials: 'include' })
              .then(res => {
                console.log('[OAuth] Session check response:', res.status, res.statusText);
                if (res.ok) {
                  console.log('[OAuth] Session established! Reloading...');
                  // Session established! Reload to update app state
                  window.location.reload();
                } else {
                  console.log('[OAuth] Session not established (status:', res.status, ')');
                  // Try to redirect to auth-callback page if it didn't load
                  const binding = sessionStorage.getItem('py_oauth_binding');
                  if (binding) {
                    console.log('[OAuth] Redirecting to /auth-callback with binding...');
                    window.location.href = '/auth-callback';
                  } else {
                    onError(new ApiError('GOOGLE_AUTH_FAILED', 'Session was not established', 401));
                  }
                }
              })
              .catch((err) => {
                console.error('[OAuth] Session check failed:', err);
                onError(new ApiError('GOOGLE_AUTH_FAILED', 'Failed to verify session', 400));
              });
          }, 2000); // Longer wait for /auth-callback to complete
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(checkPopup);
        if (!popup.closed) {
          popup.close();
          onError(new ApiError('GOOGLE_AUTH_FAILED', 'Sign-in took too long', 408));
        }
      }, 5 * 60 * 1000);
    } catch (err) {
      throw err;
    }
  }

  return <GoogleButtonShell busy={busy} disabled={!request || busy} onPress={() => void prompt()} />;
}
