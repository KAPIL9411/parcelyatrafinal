import { useEffect } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { TitilliumWeb_400Regular } from '@expo-google-fonts/titillium-web/400Regular';
import { TitilliumWeb_600SemiBold } from '@expo-google-fonts/titillium-web/600SemiBold';
import { TitilliumWeb_700Bold } from '@expo-google-fonts/titillium-web/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError } from '../src/api/http.ts';
import { SessionProvider, useSession } from '../src/session.tsx';
import { SPLASH_BLUE, SPLASH_IMAGE_WIDTH_DP, SPLASH_WORDMARK_HEIGHT_DP } from '../src/splash.ts';
import { SyncBridge } from '../src/sync.tsx';
import { colors, font, radius } from '../src/theme.ts';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 250, fade: true });

let nativeSplashDismissed = false;

/**
 * Drops the OS splash only once the JS splash has been laid out, so the fade always reveals a
 * painted, identical frame. Hiding on mount instead lets slower devices show the empty window
 * behind the root view for a moment.
 */
function dismissNativeSplash() {
  if (nativeSplashDismissed) return;
  nativeSplashDismissed = true;
  void SplashScreen.hideAsync();
}

/**
 * The branded launch screen, used while fonts and the session are loading.
 *
 * The native splash already shows this wordmark on the same blue at the same width; this is the JS
 * half of that one screen, so the crossfade from the OS splash is a no-op rather than a resize.
 */
function BrandSplash() {
  return (
    <View style={styles.splash} onLayout={dismissNativeSplash}>
      <StatusBar style="light" />
      <Image
        source={require('../assets/brand-wordmark-white.png')}
        style={{ width: SPLASH_IMAGE_WIDTH_DP, height: SPLASH_WORDMARK_HEIGHT_DP }}
        resizeMode="contain"
        fadeDuration={0}
      />
      <ActivityIndicator color="rgba(255,255,255,0.85)" style={styles.splashSpinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: SPLASH_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashSpinner: {
    position: 'absolute',
    bottom: '16%',
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // A rejected request is not retried; a server fault or a dropped connection is, twice.
      retry: (count, error) =>
        error instanceof ApiError && error.status >= 400 && error.status < 500 ? false : count < 2,
    },
    mutations: { retry: false },
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    TitilliumWeb_400Regular,
    TitilliumWeb_600SemiBold,
    TitilliumWeb_700Bold,
  });

  // The JS splash below is the branded one, so the OS splash is dropped once that splash has
  // painted (see BrandSplash). This covers the case where fonts are ready on the first commit and
  // nothing else would trigger the layout callback: by now the first screen (or the identical
  // BrandSplash) is committed, so the fade reveals a painted frame either way.
  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    const frame = requestAnimationFrame(dismissNativeSplash);
    return () => cancelAnimationFrame(frame);
  }, [fontsLoaded, fontError]);

  // Last resort so a boot that never settles cannot leave the OS splash covering the app forever.
  useEffect(() => {
    const timer = setTimeout(dismissNativeSplash, 8000);
    return () => clearTimeout(timer);
  }, []);

  if (!fontsLoaded && !fontError) return <BrandSplash />;

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <SyncBridge />
        <Shell />
      </SessionProvider>
    </QueryClientProvider>
  );
}

function Shell() {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  // Signed-out visitors start on sign-in instead of a home screen they cannot act on. Legal pages
  // and help stay reachable, otherwise the terms/privacy links on the sign-in screen bounce back.
  const openWithoutSession = segments[0] === 'sign-in' || segments[0] === 'info' || segments[0] === 'help';

  // Runs after the first commit, so the navigator this layout renders is already mounted.
  useEffect(() => {
    if (status === 'booting') return;
    if (status === 'signed_out' && !openWithoutSession) router.replace('/sign-in');
  }, [status, openWithoutSession, router]);

  // While the redirect above is in flight, keep the splash up. Rendering the tab navigator first
  // would flash a home screen the visitor cannot use and then replace it.
  if (status === 'booting' || (status === 'signed_out' && !openWithoutSession)) {
    return <BrandSplash />;
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { fontFamily: font.semibold, fontSize: 18, color: colors.ink900 },
          headerTintColor: colors.brandDark,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Not a modal: when signed out this is the first screen in the stack, and a modal
            presentation there makes the navigator warn and start with a card underneath. */}
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        {/* Own chrome, not a titled card: it is the continuation of signing in, and the first thing
            a new Google account sees. */}
        <Stack.Screen name="setup-profile" options={{ headerShown: false }} />
        <Stack.Screen name="send" options={{ title: 'Send a parcel' }} />
        <Stack.Screen name="parcels/[id]" options={{ title: 'Parcel' }} />
        <Stack.Screen name="bookings/[id]" options={{ title: 'Booking' }} />
        <Stack.Screen name="trips/new" options={{ title: 'Publish a trip' }} />
        <Stack.Screen name="trips/[id]" options={{ title: 'My trip' }} />
        <Stack.Screen name="verification" options={{ title: 'Verify your ID' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="help" options={{ title: 'Help and support' }} />
        <Stack.Screen name="info/[topic]" options={{ title: 'Information' }} />
        <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
      </Stack>
    </>
  );
}

/**
 * A screen that throws used to leave a blank canvas with only the tab bar on it, which is
 * indistinguishable from a slow network. This renders the failure instead, so a broken build says
 * what broke and stays retryable.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // A crash before the splash was laid out would otherwise leave the OS splash covering the error.
  useEffect(() => {
    dismissNativeSplash();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 12,
      }}
    >
      <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.ink900, textAlign: 'center' }}>
        This screen could not load
      </Text>
      <Text selectable style={{ fontFamily: font.regular, fontSize: 13, color: colors.ink700, textAlign: 'center' }}>
        {error.message || 'Unknown error'}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{
          marginTop: 8,
          paddingHorizontal: 20,
          minHeight: 44,
          borderRadius: radius.md,
          backgroundColor: colors.brand,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.white }}>Try again</Text>
      </Pressable>
    </View>
  );
}
