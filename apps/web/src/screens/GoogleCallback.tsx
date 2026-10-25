import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../lib/api';
import { writeTokens } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Button } from '../components/ui';

export function GoogleCallback() {
  useDocumentTitle('Google Sign-In');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { reload } = useSession();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function completeGoogleSignIn() {
      const code = params.get('code');
      const state = params.get('state');
      const oauthError = params.get('error');

      if (oauthError) {
        setError(`Google authentication failed: ${oauthError}`);
        setLoading(false);
        return;
      }

      if (!code) {
        setError('Missing authorization code');
        setLoading(false);
        return;
      }

      // Verify state parameter to prevent CSRF
      const storedState = localStorage.getItem('google_oauth_state');
      if (!state || !storedState || state !== storedState) {
        setError('Invalid or missing state parameter. Security check failed.');
        setLoading(false);
        return;
      }

      try {
        // Clear stored state
        localStorage.removeItem('google_oauth_state');

        // Exchange code for tokens
        const response = await api.post<{
          user: any;
          access_token: string;
          refresh_token: string;
          expires_in: number;
        }>('/auth/google/callback', {
          code,
          state,
        }, { auth: false });

        // Store tokens
        writeTokens({
          access_token: response.access_token,
          refresh_token: response.refresh_token,
        });

        // Also store user info in session context
        localStorage.setItem('py.user.v1', JSON.stringify(response.user));
        
        // Reload session to update the session context
        await reload();
        
        setSuccess(true);
        
        // Redirect to home page immediately
        navigate('/bookings', { replace: true });
      } catch (err) {
        console.error('Google OAuth failed:', err);
        setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    void completeGoogleSignIn();
  }, [params, navigate]);

  if (loading) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4"></div>
        <h1 className="text-2xl font-bold text-ink-900 mb-2">Completing Google Sign-In</h1>
        <p className="text-ink-500">Please wait while we sign you in...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-12">
        <div className="rounded-sheet bg-danger-50 p-6 text-center">
          <div className="text-danger-600 mb-4">
            <svg className="h-12 w-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-ink-900 mb-2">Sign-In Failed</h1>
          <p className="text-ink-600 mb-6">{error}</p>
          <Button onClick={() => navigate('/login')} fullWidth size="lg">
            Back to Login
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <div className="text-success-600 mb-4">
          <svg className="h-12 w-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-ink-900 mb-2">Successfully Signed In!</h1>
        <p className="text-ink-500">You'll be redirected to the dashboard shortly...</p>
      </div>
    );
  }

  return null;
}