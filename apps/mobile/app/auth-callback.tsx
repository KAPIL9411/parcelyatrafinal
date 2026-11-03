/**
 * Google OAuth callback handler for the web/PWA build.
 *
 * Google redirects here with `?code=…&state=…`. This screen exchanges the code for a Parcel Yatra
 * session, then continues to the screen the user originally asked for.
 *
 * It is a full page — not a popup — because iOS Safari blocks popups, and an installed PWA's
 * popup has separate storage, so neither the handshake binding nor the session would survive.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { ApiError } from '../src/api/http.ts';
import { AppText, Button, Screen } from '../src/components/ui.tsx';
import {
  OAUTH_BINDING_KEY,
  OAUTH_NEXT_KEY,
  readOAuthValue,
  safeOAuthNext,
  writeOAuthValue,
} from '../src/lib/google.ts';
import { useSession } from '../src/session.tsx';
import { needsProfileSetup } from '../src/lib/profile-setup.ts';
import { colors, spacing } from '../src/theme.ts';

export default function AuthCallbackScreen() {
  const { code, state, error, error_description } = useLocalSearchParams<{
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }>();
  const { googleCallback } = useSession();

  // A response Google itself rejected, or one with no code/state, is known before the effect runs.
  // Keeping it in initial state means the effect never has to set state synchronously.
  const paramError: string | null = error
    ? error === 'access_denied'
      ? 'Sign-in was cancelled.'
      : error_description || String(error)
    : !code || !state
      ? 'The sign-in response was incomplete. Please try again.'
      : null;
  const [errorMsg, setErrorMsg] = useState<string | null>(paramError);

  // React StrictMode runs effects twice in development; an authorization code is single-use, so a
  // second POST would always fail and replace a successful sign-in with an error.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const storedNext = readOAuthValue(OAUTH_NEXT_KEY);
    const binding = readOAuthValue(OAUTH_BINDING_KEY);
    writeOAuthValue(OAUTH_NEXT_KEY, null);
    writeOAuthValue(OAUTH_BINDING_KEY, null);

    if (paramError || !code || !state) return;

    void googleCallback(code, state, binding)
      .then((session) => {
        const target = safeOAuthNext(storedNext);
        if (needsProfileSetup(session.user)) {
          router.replace({ pathname: '/setup-profile', params: { next: target } });
        } else {
          router.replace(target);
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Google sign-in did not complete.',
        );
      });
  }, [code, state, paramError, googleCallback]);

  if (errorMsg) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <AppText variant="heading" style={styles.title}>
            Sign-in failed
          </AppText>
          <AppText tone="muted" style={styles.body}>
            {errorMsg}
          </AppText>
          <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} style={styles.button} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
        <AppText style={styles.body}>Signing you in…</AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
});
