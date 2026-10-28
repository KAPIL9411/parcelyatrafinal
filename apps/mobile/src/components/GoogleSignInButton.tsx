import { useEffect } from 'react';
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
 * Web flow: browser authorization code + PKCE against the *Web* OAuth client, whose authorized
 * redirect URI is the web origin. The ID token comes back in the redirect fragment.
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
      await promptAsync();
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

  return <GoogleButtonShell busy={busy} disabled={!request} onPress={() => void prompt()} />;
}
