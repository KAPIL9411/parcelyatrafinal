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
import { Stack, usePathname, useRouter, type ErrorBoundaryProps } from 'expo-router';
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
import { DialogHost } from '../src/lib/dialog';
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
  const router = useRouter();
  const pathname = usePathname();
  const [initialNavigationDone, setInitialNavigationDone] = useState(false);

  // Perform initial navigation once when session is ready
  useEffect(() => {
    if (status === 'booting') return;
    if (initialNavigationDone) return;

    setInitialNavigationDone(true);

    // Check if current route is public (accessible without login)
    const isPublicRoute = 
      pathname === '/sign-in' || 
      pathname.startsWith('/info/') || 
      pathname === '/help';

    if (status === 'signed_out') {
      // User is signed out - always redirect to sign-in unless already there
      if (!isPublicRoute) {
        router.replace('/sign-in');
      }
    } else if (status === 'signed_in') {
      // User is signed in - if on sign-in page, redirect to home
      if (pathname === '/sign-in') {
        router.replace('/(tabs)');
      }
    }
  }, [status, pathname, initialNavigationDone, router]);

  // Only block rendering while booting
  if (status === 'booting') {
    return null;
  }

  // Block one frame after boot to prevent flash
  if (!initialNavigationDone) {
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
      <DialogHost />
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
