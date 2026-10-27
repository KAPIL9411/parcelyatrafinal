import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../src/api/http.ts';
import { peekDevOtp } from '../src/api/client.ts';
import { useSession } from '../src/session.tsx';
import { AppText, Button, Card, ErrorNotice, Field, Row, Screen } from '../src/components/ui.tsx';
import { colors, font, radius, spacing } from '../src/theme.ts';
import { maskPhone, normalisePhone } from '../src/lib/format.ts';

const extra = Constants.expoConfig?.extra as { googleWebClientId?: string } | undefined;
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? extra?.googleWebClientId;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? WEB_CLIENT_ID;
const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? WEB_CLIENT_ID;

export default function SignInScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { sendOtp, verifyOtp, googleSignIn } = useSession();
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [phoneMasked, setPhoneMasked] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [showPhone, setShowPhone] = useState(false);
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
    <Screen keyboard contentStyle={{ padding: 0 }}>
      {/* hero */}
      <View
        style={{
          backgroundColor: colors.navy,
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.lg,
          paddingBottom: 64,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: 220,
            height: 220,
            borderRadius: 110,
            backgroundColor: 'rgba(10,87,255,0.32)',
            top: -100,
            right: -60,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: 'rgba(232,179,60,0.10)',
            bottom: -50,
            left: -30,
          }}
        />
        {/* route motif */}
        <View
          style={{
            position: 'absolute',
            right: 24,
            bottom: 26,
            width: 120,
            height: 90,
            opacity: 0.9,
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: 8,
              bottom: 8,
              width: 4,
              height: 44,
              borderRadius: 2,
              backgroundColor: 'rgba(255,255,255,0.35)',
              transform: [{ rotate: '12deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 14,
              bottom: 46,
              width: 70,
              height: 4,
              borderRadius: 2,
              backgroundColor: 'rgba(255,255,255,0.35)',
              transform: [{ rotate: '-18deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 4,
              bottom: 4,
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 4,
              borderColor: colors.accent,
              backgroundColor: colors.navy,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: 2,
              top: 2,
              width: 26,
              height: 26,
              borderRadius: 8,
              backgroundColor: colors.brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="flag" size={12} color={colors.white} />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={10}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: 'rgba(255,255,255,0.12)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="close" size={18} color={colors.white} />
        </Pressable>

        <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="cube" size={20} color={colors.navy} />
          </View>
          <View>
            <AppText variant="heading" tone="white">
              Parcel Yatra
            </AppText>
            <AppText variant="micro" style={{ color: '#9fb0cc', fontFamily: font.regular }}>
              Intercity parcels, carried by people
            </AppText>
          </View>
        </Row>

        <AppText variant="display" tone="white" style={{ marginTop: spacing.lg, maxWidth: 280 }}>
          Send it with someone already going.
        </AppText>
        <AppText variant="small" tone="onDark" style={{ marginTop: spacing.sm, maxWidth: 300 }}>
          Post a parcel, pick an ID-verified traveller on that route, and hand over with a one-time code.
        </AppText>
      </View>

      {/* form */}
      <View style={{ marginTop: -38, paddingHorizontal: spacing.lg }}>
        <Card style={{ borderRadius: radius.xl, padding: spacing.lg }}>
          {challengeId ? (
            <>
              <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: colors.brandSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.brandDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="heading">Enter the code</AppText>
                  <AppText variant="small" tone="muted">
                    Sent to {phoneMasked}
                  </AppText>
                </View>
              </Row>

              {devCode ? (
                <View
                  style={{
                    backgroundColor: colors.accentSoft,
                    borderRadius: radius.md,
                    padding: spacing.sm,
                    marginTop: spacing.md,
                  }}
                >
                  <AppText variant="small" style={{ color: colors.warn }}>
                    Sandbox build: use code {devCode}
                  </AppText>
                </View>
              ) : null}

              <View style={{ marginTop: spacing.lg }}>
                <Field
                  label="Six-digit code"
                  value={code}
                  onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  style={{ fontSize: 26, letterSpacing: 10, fontFamily: font.semibold, textAlign: 'center' }}
                />
              </View>

              {error ? <ErrorNotice error={error} /> : null}

              <Button label="Verify and continue" onPress={verify} loading={busy === 'verify'} style={{ marginTop: spacing.sm }} />

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
                  <AppText
                    variant="small"
                    tone={resendIn > 0 ? 'muted' : 'brand'}
                    style={{ fontFamily: font.semibold }}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code'}
                  </AppText>
                </Pressable>
              </Row>
            </>
          ) : (
            <>
              <AppText variant="heading">Sign in to Parcel Yatra</AppText>
              <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                One tap with Google. No password, no phone number needed.
              </AppText>

              <View style={{ marginTop: spacing.lg }}>
                <GoogleButton busy={busy === 'google'} onToken={google} onError={setError} />
              </View>

              {!showPhone && error ? (
                <View style={{ marginTop: spacing.sm }}>
                  <ErrorNotice error={error} />
                </View>
              ) : null}

              <Row gap={6} style={{ marginTop: spacing.md, alignItems: 'flex-start' }}>
                <Ionicons name="lock-closed-outline" size={13} color={colors.ink500} style={{ marginTop: 2 }} />
                <AppText variant="micro" tone="muted" style={{ flex: 1, fontFamily: font.regular }}>
                  We receive only your name, email and profile photo. Nothing is posted.
                </AppText>
              </Row>

              {showPhone ? (
                <>
                  <Row gap={spacing.md} style={{ marginTop: spacing.lg, marginBottom: spacing.md }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
                    <AppText variant="micro" tone="muted">
                      OR USE A NUMBER
                    </AppText>
                    <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
                  </Row>

                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                    <View style={{ marginBottom: spacing.md }}>
                      <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
                        Code
                      </AppText>
                      <View
                        style={{
                          borderWidth: 1,
                          borderColor: colors.line,
                          borderRadius: radius.md,
                          paddingHorizontal: spacing.md,
                          height: 46,
                          backgroundColor: colors.canvas,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <AppText variant="body">+91</AppText>
                      </View>
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

                  {error ? (
                    <View style={{ marginTop: spacing.md }}>
                      <ErrorNotice error={error} />
                    </View>
                  ) : null}

                  <Button label="Send code" onPress={send} loading={busy === 'send'} style={{ marginTop: spacing.sm }} />

                  <Pressable
                    onPress={() => {
                      setShowPhone(false);
                      setError(null);
                    }}
                    hitSlop={8}
                    style={{ marginTop: spacing.md, alignSelf: 'center' }}
                  >
                    <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                      Use Google instead
                    </AppText>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => {
                    setShowPhone(true);
                    setError(null);
                  }}
                  hitSlop={8}
                  style={{ marginTop: spacing.lg, alignSelf: 'center' }}
                >
                  <AppText variant="small" tone="brand" style={{ fontFamily: font.semibold }}>
                    Use a phone number instead
                  </AppText>
                </Pressable>
              )}
            </>
          )}
        </Card>

        <View
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            marginTop: spacing.md,
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.line,
            padding: spacing.md,
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={17} color={colors.success} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <AppText variant="micro" style={{ fontFamily: font.semibold }}>
              Your number stays private
            </AppText>
            <AppText variant="micro" tone="muted" style={{ fontFamily: font.regular, marginTop: 1 }}>
              The other side sees a masked number. Chat stays inside the booking.
            </AppText>
          </View>
        </View>

        <AppText variant="micro" tone="muted" style={{ marginTop: spacing.lg, textAlign: 'center', fontFamily: font.regular }}>
          By continuing you agree to our{' '}
          <AppText variant="micro" tone="brand" onPress={() => router.push('/info/terms')}>
            terms
          </AppText>{' '}
          and{' '}
          <AppText variant="micro" tone="brand" onPress={() => router.push('/info/privacy')}>
            privacy policy
          </AppText>
          .
        </AppText>
      </View>
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

  const disabled = busy || !request;

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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={() => void prompt()}
      style={({ pressed }) => ({
        minHeight: 52,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        opacity: disabled ? 0.5 : pressed ? 0.82 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <Ionicons name="logo-google" size={18} color={colors.brand} />
      )}
      <AppText variant="button" style={{ color: colors.ink900 }}>
        {busy ? 'Connecting…' : 'Continue with Google'}
      </AppText>
    </Pressable>
  );
}
