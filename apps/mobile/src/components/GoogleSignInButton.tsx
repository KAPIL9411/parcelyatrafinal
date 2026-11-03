import { useState } from 'react';

import { API_BASE } from '../api/client.ts';
import { ApiError } from '../api/http.ts';
import { OAUTH_BINDING_KEY, OAUTH_NEXT_KEY, writeOAuthValue } from '../lib/google.ts';
import { GoogleButtonShell } from './GoogleButtonShell.tsx';

export interface GoogleSignInButtonProps {
  busy: boolean;
  /**
   * Where to go after the callback. Kept in `sessionStorage` because Google always returns to the
   * fixed redirect URI, not to the screen that started the flow.
   */
  next?: string;
  /** Native-only: the ID token the Google SDK returned. The web flow never produces one here. */
  onToken: (idToken: string) => void;
  onError: (error: unknown) => void;
}

interface AuthorizeResponse {
  authorization_url: string;
  state: string;
  handshake_binding: string;
}

/**
 * Web Google sign-in.
 *
 * The API starts the handshake, Google returns a one-time code to `/auth-callback`, and that screen
 * exchanges it for a session. The redirect is a full-page navigation on purpose: iOS Safari — and
 * especially an installed PWA — blocks `window.open`, and a popup would have its own storage, so
 * the binding stored below would not be visible to the callback.
 *
 * The API also sets the binding as an HttpOnly cookie. Sending it in the callback body as well is
 * what keeps the flow working when Safari's tracking prevention discards cookies.
 */
export function GoogleSignInButton({ busy, next, onError }: GoogleSignInButtonProps) {
  const [starting, setStarting] = useState(false);
  const blocked = busy || starting;

  async function prompt() {
    if (blocked) return;
    setStarting(true);

    try {
      // Use the same API root as every other call in the app. A hard-coded host here would send
      // `/authorize` to one origin and `/callback` to another, which no cookie can survive.
      const response = await fetch(`${API_BASE}/auth/google/authorize`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new ApiError(
          'GOOGLE_AUTH_FAILED',
          `Google sign-in could not start (${response.status}).`,
          response.status,
        );
      }

      const data = (await response.json()) as Partial<AuthorizeResponse>;
      if (typeof data.authorization_url !== 'string' || !data.authorization_url) {
        throw new ApiError('GOOGLE_AUTH_FAILED', 'The server did not return a Google sign-in URL.', 500);
      }

      // Both are read back by /auth-callback. sessionStorage is per-tab and survives the round trip
      // to accounts.google.com, but not a closed tab — which is exactly the lifetime we want.
      writeOAuthValue(
        OAUTH_BINDING_KEY,
        typeof data.handshake_binding === 'string' && data.handshake_binding ? data.handshake_binding : null,
      );
      writeOAuthValue(
        OAUTH_NEXT_KEY,
        typeof next === 'string' && next.startsWith('/') ? next : null,
      );

      // Full-page redirect, not a popup: iOS Safari inside the installed PWA blocks popups, and a
      // popup owns a different sessionStorage, so the callback could not prove the handshake.
      window.location.assign(data.authorization_url);
    } catch (err) {
      setStarting(false);
      onError(
        err instanceof ApiError
          ? err
          : new ApiError(
              'GOOGLE_AUTH_FAILED',
              err instanceof Error ? err.message : 'Google sign-in could not start.',
              400,
            ),
      );
    }
  }

  return <GoogleButtonShell busy={blocked} onPress={() => void prompt()} />;
}
