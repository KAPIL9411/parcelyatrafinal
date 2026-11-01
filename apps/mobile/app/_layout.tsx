import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  AppState,
} from 'react-native';
import { Stack, usePathname, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { TitilliumWeb_400Regular } from '@expo-google-fonts/titillium-web/400Regular';
import { TitilliumWeb_600SemiBold } from '@expo-google-fonts/titillium-web/600SemiBold';
import { TitilliumWeb_700Bold } from '@expo-google-fonts/titillium-web/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError } from '../src/api/http.ts';
import { SessionProvider, useSession } from '../src/session.tsx';
import { startKeepAlive, stopKeepAlive, warmupServer } from '../src/lib/keep-alive.ts';

import { SyncBridge } from '../src/sync.tsx';
import { colors, font, radius } from '../src/theme.ts';

// Keep native splash visible until app is ready
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ 
  duration: 300, 
  fade: true 
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
  const [appReady, setAppReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    TitilliumWeb_400Regular,
    TitilliumWeb_600SemiBold,
    TitilliumWeb_700Bold,
  });

  useEffect(() => {
    async function prepare() {
      try {
        // Wait for fonts to load
        if (!fontsLoaded && !fontError) return;
        
        // Warm up the server in parallel with app initialization
        void warmupServer();
        
        // Minimal delay to ensure UI is ready
        await new Promise(resolve => setTimeout(resolve, 50));
        
        setAppReady(true);
      } catch (e) {
        console.warn('Splash preparation error:', e);
        setAppReady(true);
      }
    }

    void prepare();
  }, [fontsLoaded, fontError]);

  // Hide native splash once app is ready
  useEffect(() => {
    if (appReady) {
      void SplashScreen.hideAsync();
    }
  }, [appReady]);

  // Emergency timeout
  useEffect(() => {
    const timer = setTimeout(() => {
      console.warn('[Splash] Emergency dismiss after 3s');
      setAppReady(true);
      void SplashScreen.hideAsync();
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Keep-alive: Start when app is active, stop when backgrounded
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        startKeepAlive();
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        stopKeepAlive();
      }
    });

    // Start immediately if app is currently active
    if (AppState.currentState === 'active') {
      startKeepAlive();
    }

    return () => {
      subscription.remove();
      stopKeepAlive();
    };
  }, []);

  // Show nothing until app is ready - native splash stays visible
  if (!appReady) {
    return null;
  }

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
  const [hasRedirected, setHasRedirected] = useState(false);

  // Signed-out visitors start on sign-in instead of a home screen they cannot act on
  const openWithoutSession = segments[0] === 'sign-in' || segments[0] === 'info' || segments[0] === 'help';
  const needsRedirect = status === 'signed_out' && !openWithoutSession;

  useEffect(() => {
    if (status === 'booting') return;
    
    if (needsRedirect && !hasRedirected) {
      setHasRedirected(true);
      // Use requestAnimationFrame to ensure redirect happens before any render
      requestAnimationFrame(() => {
        router.replace('/sign-in');
      });
    } else if (!needsRedirect && hasRedirected) {
      // Reset redirect flag when no longer needed
      setHasRedirected(false);
    }
  }, [status, needsRedirect, hasRedirected, router]);

  // Critical: Block rendering during all transition states
  // 1. Still booting
  if (status === 'booting') {
    return null;
  }

  // 2. Need to redirect (signed out and trying to access protected route)
  if (needsRedirect) {
    return null;
  }

  // 3. Currently redirecting (transition period)
  if (hasRedirected) {
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
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
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
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
    </View>
  );
}

/**
 * A screen that throws used to leave a blank canvas with only the tab bar on it, which is
 * indistinguishable from a slow network. This renders the failure instead, so a broken build says
 * what broke and stays retryable.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // Dismiss splash if app crashes
  useEffect(() => {
    void SplashScreen.hideAsync();
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
