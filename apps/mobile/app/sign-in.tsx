import { useEffect, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { peekDevOtp } from '../src/api/client.ts';
import { useSession } from '../src/session.tsx';
import { AppText, Button, Card, ErrorNotice, Field, Row } from '../src/components/ui.tsx';
import { AnimatedProductGallery } from '../src/components/AnimatedProductGallery.tsx';
import { GoogleSignInButton } from '../src/components/GoogleSignInButton';
import { colors, font, radius, spacing } from '../src/theme.ts';
import { maskPhone, normalisePhone } from '../src/lib/format.ts';
import { GOOGLE_PLATFORM_CLIENT_ID } from '../src/lib/google.ts';

export default function SignInScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { sendOtp, verifyOtp, googleSignIn } = useSession();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [phoneMasked, setPhoneMasked] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [showPhone, setShowPhone] = useState(false);
  const [busy, setBusy] = useState<'send' | 'verify' | 'google' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [resendIn, setResendIn] = useState(0);

  const [logoAnim] = useState(() => new Animated.Value(0));

  // Gallery occupies exactly ~61% of screen height as measured from the Blinkit reference
  const galleryHeight = Math.round(screenHeight * 0.61);

  useEffect(() => {
    Animated.spring(logoAnim, {
      toValue: 1,
      friction: 6,
      tension: 40,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [logoAnim]);

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
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.keyboardContainer}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Top Section: Straight Horizontal Product Gallery with exact Blinkit height (~61%) */}
          <AnimatedProductGallery galleryHeight={galleryHeight} />

          {/* Middle Section: Official Parcel Yatra Squircle Logo positioned exactly where Blinkit logo starts */}
          <Animated.View
            style={[
              styles.logoWrapper,
              {
                opacity: logoAnim,
                transform: [
                  {
                    scale: logoAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.85, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Animated.Image
              source={require('../assets/parcel-yatra-logo.png')}
              style={styles.officialLogo}
              resizeMode="contain"
            />
          </Animated.View>

          {/* Bottom Content Area: Tightly organized without excessive stretching */}
          <View style={styles.contentSection}>
            {challengeId ? (
              /* Verification Screen for Phone OTP */
              <Card style={styles.phoneCard}>
                <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
                  <View style={styles.otpIconBadge}>
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
                  <View style={styles.devCodeBadge}>
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

                <Button
                  label="Verify and continue"
                  onPress={verify}
                  loading={busy === 'verify'}
                  style={{ marginTop: spacing.sm }}
                />

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
              </Card>
            ) : showPhone ? (
              /* Phone number entry alternative */
              <Card style={styles.phoneCard}>
                <AppText variant="heading">Sign in with phone</AppText>
                <AppText variant="small" tone="muted" style={{ marginTop: 2 }}>
                  We’ll text you a six-digit verification code.
                </AppText>

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.md }}>
                  <View style={{ marginBottom: spacing.md }}>
                    <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
                      Code
                    </AppText>
                    <View style={styles.countryCodeBadge}>
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
                  <View style={{ marginTop: spacing.sm }}>
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
                    Back to Google Sign-In
                  </AppText>
                </Pressable>
              </Card>
            ) : (
              /* Standard Production View: Matching Blinkit layout exactly */
              <>
                {/* Headline & Subtitle */}
                <View style={styles.textContainer}>
                  <AppText style={styles.headline}>
                    Every parcel has a way.
                  </AppText>
                  <AppText style={styles.subtitle}>
                    Fast, trusted intercity deliveries.
                  </AppText>
                </View>

                {/* Primary Google Auth Button */}
                <View style={styles.authActionWrapper}>
                  {GOOGLE_PLATFORM_CLIENT_ID ? (
                    <GoogleSignInButton
                      busy={busy === 'google'}
                      onToken={google}
                      onError={setError}
                    />
                  ) : (
                    <View style={styles.missingConfigBadge}>
                      <AppText variant="small" style={{ color: colors.warn, textAlign: 'center' }}>
                        Google sign-in is not configured in this build
                        {Platform.OS === 'android' ? ' (missing Android OAuth client ID).' : '.'}
                      </AppText>
                    </View>
                  )}

                  {error ? (
                    <View style={{ marginTop: spacing.sm, width: '100%' }}>
                      <ErrorNotice error={error} />
                    </View>
                  ) : null}

                  {/* Security Assurance text */}
                  <AppText style={styles.securePrompt}>
                    Sign in securely with your Google account
                  </AppText>

                  {/* Optional phone fallback */}
                  <Pressable
                    onPress={() => {
                      setShowPhone(true);
                      setError(null);
                    }}
                    hitSlop={8}
                    style={styles.phoneFallbackButton}
                  >
                    <AppText style={styles.phoneFallbackText}>
                      Or sign in with a phone number
                    </AppText>
                  </Pressable>
                </View>

                {/* Terms of Service & Privacy Policy matching Blinkit footer */}
                <View style={[styles.legalSection, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                  <View style={styles.legalLinksRow}>
                    <AppText style={styles.legalNotice}>
                      By continuing, you agree to our:
                    </AppText>
                    <Pressable
                      onPress={() => router.push('/info/terms')}
                      hitSlop={8}
                      accessibilityRole="link"
                      accessibilityLabel="Terms of Service"
                    >
                      <AppText style={styles.legalLink}>Terms of Service</AppText>
                    </Pressable>
                    <AppText style={styles.legalSeparator}> & </AppText>
                    <Pressable
                      onPress={() => router.push('/info/privacy')}
                      hitSlop={8}
                      accessibilityRole="link"
                      accessibilityLabel="Privacy Policy"
                    >
                      <AppText style={styles.legalLink}>Privacy policy</AppText>
                    </Pressable>
                  </View>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
  },
  logoWrapper: {
    alignSelf: 'center',
    marginTop: -30,
    zIndex: 10,
    shadowColor: '#0a57ff',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  officialLogo: {
    width: 62,
    height: 62,
    borderRadius: 16,
  },
  contentSection: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  headline: {
    fontSize: 23,
    fontFamily: font.bold,
    color: '#111827',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14.5,
    fontFamily: font.regular,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 4,
  },
  authActionWrapper: {
    width: '100%',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 12,
  },
  missingConfigBadge: {
    backgroundColor: colors.warnBg,
    borderRadius: radius.md,
    padding: spacing.md,
    width: '100%',
  },
  securePrompt: {
    fontSize: 13,
    fontFamily: font.regular,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 10,
  },
  phoneFallbackButton: {
    marginTop: 10,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  phoneFallbackText: {
    fontSize: 12,
    fontFamily: font.semibold,
    color: '#0a57ff',
  },
  legalSection: {
    alignItems: 'center',
    marginTop: 16,
  },
  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  legalNotice: {
    fontSize: 11.5,
    fontFamily: font.regular,
    color: '#9CA3AF',
    marginRight: 4,
  },
  legalLink: {
    fontSize: 11.5,
    fontFamily: font.regular,
    color: '#6B7280',
    textDecorationLine: 'underline',
  },
  legalSeparator: {
    fontSize: 11.5,
    fontFamily: font.regular,
    color: '#9CA3AF',
  },
  phoneCard: {
    width: '100%',
    borderRadius: radius.xl,
    padding: spacing.lg,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
  },
  otpIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devCodeBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  countryCodeBadge: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
