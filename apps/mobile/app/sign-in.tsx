import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import { ResponseType } from 'expo-auth-session';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from '../src/api/http.ts';
import { peekDevOtp } from '../src/api/client.ts';
import { useSession } from '../src/session.tsx';
import { AppText, Button, Card, ErrorNotice, Field, Row, Screen } from '../src/components/ui.tsx';
import { colors, font, radius, spacing } from '../src/theme.ts';
import { maskPhone, normalisePhone } from '../src/lib/format.ts';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? WEB_CLIENT_ID;
const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? WEB_CLIENT_ID;

export default function SignInScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { sendOtp, verifyOtp, googleSignIn } = useSession();

  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [phoneMasked, setPhoneMasked] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'verify' | 'google' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  function finish() {
    const target = typeof next === 'string' && next.startsWith('/') ? next : '/(tabs)';
    router.replace(target);
  }

  async function send() {
    const normalized = normalisePhone(phone);
    if (!normalized) {
      setError(new Error('Enter a 10-digit Indian mobile number.'));
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const result = await sendOtp(normalized);
      setChallengeId(result.challenge_id);
      setPhoneMasked(result.phone_masked || maskPhone(normalized));
      setResendIn(result.resend_after_seconds ?? 30);
      setCode('');
      setDevCode(await peekDevOtp(result.challenge_id));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    if (!challengeId || !/^\d{6}$/.test(code)) {
      setError(new Error('Enter the six-digit code.'));
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      await verifyOtp(challengeId, code);
      finish();
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(null);
    }
  }

  async function google(idToken: string) {
    setBusy('google');
    setError(null);
    try {
      await googleSignIn(idToken);
      finish();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen keyboard>
      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: radius.xl,
          padding: spacing.xl,
          marginBottom: spacing.lg,
        }}
      >
        <Row gap={spacing.md}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="cube" size={22} color={colors.navy} />
          </View>
          <View>
            <AppText variant="title" tone="white">
              Parcel Yatra
            </AppText>
            <AppText variant="small" tone="onDark">
              Intercity parcels, carried by travellers.
            </AppText>
          </View>
        </Row>
      </View>

      <Card>
        {challengeId ? (
          <>
            <AppText variant="heading">Enter the code</AppText>
            <AppText variant="small" tone="muted" style={{ marginTop: 4, marginBottom: spacing.lg }}>
              Sent to {phoneMasked}. It is valid for a few minutes.
            </AppText>
            {devCode ? (
              <AppText variant="small" tone="brand" style={{ marginBottom: spacing.md }}>
                Sandbox build: fill {devCode} and continue.
              </AppText>
            ) : null}
            <Field
              label="Six-digit code"
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoFocus
              maxLength={6}
              placeholder="000000"
              style={{ fontSize: 22, letterSpacing: 6, fontFamily: font.semibold }}
            />
            {error ? <ErrorNotice error={error} /> : null}
            <Button label="Continue" onPress={verify} loading={busy === 'verify'} style={{ marginTop: spacing.md }} />
            <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
              <Pressable
                onPress={() => {
                  setChallengeId(null);
                  setCode('');
                  setDevCode(null);
                  setError(null);
                }}
                hitSlop={8}
              >
                <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                  Change number
                </AppText>
              </Pressable>
              <Pressable onPress={resendIn > 0 ? undefined : send} hitSlop={8}>
                <AppText variant="small" tone={resendIn > 0 ? 'muted' : 'brand'} style={{ fontFamily: font.semibold }}>
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code'}
                </AppText>
              </Pressable>
            </Row>
          </>
        ) : (
          <>
            <AppText variant="heading">Sign in with your phone</AppText>
            <AppText variant="small" tone="muted" style={{ marginTop: 4, marginBottom: spacing.lg }}>
              We text a six-digit code. No password to remember.
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: 12,
                  backgroundColor: colors.canvas,
                }}
              >
                <AppText variant="body">+91</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Mobile number"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  placeholder="98765 43210"
                  maxLength={14}
                />
              </View>
            </View>
            {error ? <ErrorNotice error={error} /> : null}
            <Button label="Send code" onPress={send} loading={busy === 'send'} style={{ marginTop: spacing.sm }} />
          </>
        )}
      </Card>

      {WEB_CLIENT_ID ? (
        <View style={{ marginTop: spacing.lg }}>
          <Row gap={spacing.md} style={{ marginBottom: spacing.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
            <AppText variant="small" tone="muted">
              or
            </AppText>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
          </Row>
          <GoogleButton busy={busy === 'google'} onToken={google} onError={setError} />
        </View>
      ) : (
        <AppText variant="small" tone="muted" style={{ marginTop: spacing.lg, textAlign: 'center' }}>
          Google sign-in is not configured in this build. Use the phone code above.
        </AppText>
      )}

      <AppText variant="small" tone="muted" style={{ marginTop: spacing.xl, textAlign: 'center' }}>
        By continuing you agree to the terms and privacy policy published on parcelyatra.vercel.app.
      </AppText>
    </Screen>
  );
}

function GoogleButton({
  busy,
  onToken,
  onError,
}: {
  busy: boolean;
  onToken: (idToken: string) => void;
  onError: (error: unknown) => void;
}) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
    androidClientId: ANDROID_CLIENT_ID,
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

  return (
    <Button
      label="Continue with Google"
      variant="secondary"
      loading={busy}
      disabled={!request}
      onPress={() => void promptAsync()}
    />
  );
}
