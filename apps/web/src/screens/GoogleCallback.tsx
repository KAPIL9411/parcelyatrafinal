import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api, type AuthResponse } from '../lib/api';
import { safeNext } from '../lib/nav';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Button } from '../components/ui';

/**
 * Lands here after Google redirects back with `?code=...&state=...`.
 *
 * The browser sends the OAuth cookie set at /auth/google/authorize alongside the body, and the API
 * refuses the exchange unless both match and the state is still outstanding.
 */
export function GoogleCallback() {
  useDocumentTitle('Google Sign-In');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { adoptSession } = useSession();

  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // React StrictMode runs effects twice in development; a one-time code must not be spent twice.
    if (started.current) return;
    started.current = true;

    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error');
    // Google sends the browser to the fixed redirect URI, so the page the user was heading for is
    // read back from where Login parked it. A destination is never taken from the query string here:
    // anything an attacker can put in the URL has already been through `safeNext` at most once.
    const next = safeNext(sessionStorage.getItem('py.next'));
    sessionStorage.removeItem('py.next');

    if (oauthError) {
      setError(oauthError === 'access_denied' ? 'Sign-in was cancelled.' : 'Google reported an error.');
      return;
    }
    if (!code || !state) {
      setError('The sign-in response was incomplete. Please try again.');
      return;
    }

    void api
      .post<AuthResponse>('/auth/google/callback', { code, state }, { auth: false })
      .then((res) => {
        adoptSession(res);
        navigate(next, { replace: true });
      })
      .catch(() => {
        setError('We could not complete the sign-in. Please try again.');
      });
  }, [params, navigate, adoptSession]);

  if (error) {
    return (
      <div className="mx-auto max-w-md py-12">
        <div className="rounded-sheet bg-danger-50 p-6 text-center">
          <h1 className="text-2xl font-bold text-ink-900 mb-2">Sign-in failed</h1>
          <p className="text-ink-600 mb-6">{error}</p>
          <Button onClick={() => navigate('/login')} fullWidth size="lg">
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      <h1 className="text-2xl font-bold text-ink-900 mb-2">Completing sign-in</h1>
      <p className="text-ink-500">This should only take a moment.</p>
    </div>
  );
}
