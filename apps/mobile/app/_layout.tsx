import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack } from 'expo-router';
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
import { colors, font } from '../src/theme.ts';

void SplashScreen.preventAutoHideAsync();

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

  if (status === 'booting') {
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
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="send" options={{ title: 'Send a parcel' }} />
        <Stack.Screen name="parcels/[id]" options={{ title: 'Parcel' }} />
        <Stack.Screen name="bookings/[id]" options={{ title: 'Booking' }} />
        <Stack.Screen name="trips/new" options={{ title: 'Publish a trip' }} />
        <Stack.Screen name="trips/[id]" options={{ title: 'My trip' }} />
        <Stack.Screen name="verification" options={{ title: 'Verify your ID' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="help" options={{ title: 'Help and support' }} />
        <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
      </Stack>
    </>
  );
}
