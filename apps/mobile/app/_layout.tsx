import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  TitilliumWeb_400Regular,
  TitilliumWeb_600SemiBold,
  TitilliumWeb_700Bold,
  useFonts,
} from '@expo-google-fonts/titillium-web';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError } from '../src/api/http.ts';
import { SessionProvider, useSession } from '../src/session.tsx';
import { colors, font, radius } from '../src/theme.ts';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 250, fade: true });

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

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
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

  // While the redirect above is in flight, keep the boot screen up. Rendering the tab navigator
  // first would flash a home screen the visitor cannot use and then replace it.
  if (status === 'booting' || (status === 'signed_out' && !openWithoutSession)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <StatusBar style="light" />
        <Text style={{ fontFamily: font.bold, fontSize: 30, color: colors.white, letterSpacing: 0.4 }}>Parcel Yatra</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 14, color: '#9fb0cc' }}>Send it with someone already going.</Text>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} />
      </View>
    );
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
        <Stack.Screen name="sign-in" options={{ headerShown: false, presentation: 'modal' }} />
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
