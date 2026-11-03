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

/**
 * Keys the browser flow leaves in `sessionStorage` between `/auth/google/authorize` and
 * `/auth-callback`. The binding proves the callback belongs to this browser; `next` remembers the
 * screen the user was heading for, because Google returns to a fixed redirect URI.
 */
export const OAUTH_BINDING_KEY = 'py.oauth';
export const OAUTH_NEXT_KEY = 'py.next';

/** Only an in-app path is ever navigated to after the callback. */
export function safeOAuthNext(raw: string | null | undefined): string {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/(tabs)';
}

/**
 * `sessionStorage`, guarded: it is absent on native and Safari in private mode can throw on access
 * rather than merely failing a write. A missing store is not fatal — the HttpOnly cookie is the
 * second transport for the binding.
 */
function oauthStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function readOAuthValue(key: string): string | null {
  try {
    return oauthStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeOAuthValue(key: string, value: string | null): void {
  try {
    if (value === null) oauthStorage()?.removeItem(key);
    else oauthStorage()?.setItem(key, value);
  } catch {
    // Private mode or quota: the cookie transport still carries the binding.
  }
}
