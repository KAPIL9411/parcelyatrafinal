/**
 * Google OAuth callback handler for web.
 * 
 * After Google redirects back with a code, this page:
 * 1. Extracts the code from URL
 * 2. POSTs to backend /auth/google/callback with the code
 * 3. Backend sets session cookie
 * 4. Redirects to home screen
 */

import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AppText } from '../src/components/ui';
import { colors } from '../src/theme';

export default function AuthCallbackScreen() {
  const { code, state, error, error_description } = useLocalSearchParams<{
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }>();
  const [processing, setProcessing] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      // Handle error response from Google
      if (error) {
        setErrorMsg(error_description || error);
        setProcessing(false);
        // Redirect to sign-in after 2 seconds
        setTimeout(() => router.replace('/sign-in'), 2000);
        return;
      }

      // Validate we have the authorization code
      if (!code) {
        setErrorMsg('No authorization code received from Google');
        setProcessing(false);
        setTimeout(() => router.replace('/sign-in'), 2000);
        return;
      }

      try {
        // POST the code to backend /auth/google/callback
        // Note: Must use full URL since it's cross-origin
        const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://parcel-yatra-api.parcelyatra.workers.dev/v1';
        const response = await fetch(`${apiBase}/auth/google/callback`, {
          method: 'POST',
          credentials: 'include', // Send/receive cookies
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            state,
            // binding will be read from cookie by backend if available
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error?.message || errorData.message || `Backend returned ${response.status}`
          );
        }

        // Callback succeeded - backend set session cookie
        // Redirect to home, which will boot the session
        router.replace('/(tabs)');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error processing OAuth callback';
        console.error('[OAuth Callback]', msg);
        setErrorMsg(msg);
        setProcessing(false);
        // Redirect to sign-in after 2 seconds
        setTimeout(() => router.replace('/sign-in'), 2000);
      }
    };

    void handleCallback();
  }, [code, state, error, error_description]);

  if (processing && !errorMsg) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color={colors.brand} />
        <AppText style={{ marginTop: 16, textAlign: 'center' }}>Signing you in...</AppText>
      </View>
    );
  }

  if (errorMsg) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 16 }}>
        <AppText style={{ color: colors.warn, textAlign: 'center', marginBottom: 8 }}>
          Sign-in error
        </AppText>
        <AppText style={{ textAlign: 'center', color: '#666' }}>
          {errorMsg}
        </AppText>
        <AppText style={{ marginTop: 16, color: '#999', fontSize: 12, textAlign: 'center' }}>
          Redirecting...
        </AppText>
      </View>
    );
  }

  return null;
}
