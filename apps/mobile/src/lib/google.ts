import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = Constants.expoConfig?.extra as
  | { googleWebClientId?: string; googleAndroidClientId?: string; googleIosClientId?: string }
  | undefined;

/**
 * OAuth client IDs from Google Cloud.
 *
 * - Web: used both by the browser flow and as `webClientId` on native, because the ID token the API
 *   verifies is always issued to the web client.
 * - Android: an *Android* OAuth client has no ID the app passes at runtime; Google matches it by
 *   package name + signing certificate. It exists only so the consent screen accepts the request.
 */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? extra?.googleWebClientId;
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? extra?.googleIosClientId;
export const GOOGLE_ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? extra?.googleAndroidClientId;

/** The client ID whose presence decides whether this build can start a Google sign-in. */
export const GOOGLE_PLATFORM_CLIENT_ID =
  Platform.OS === 'android' ? GOOGLE_ANDROID_CLIENT_ID : Platform.OS === 'ios' ? GOOGLE_IOS_CLIENT_ID : GOOGLE_WEB_CLIENT_ID;
