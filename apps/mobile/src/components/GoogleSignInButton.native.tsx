import { Platform } from 'react-native';
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { ApiError } from '../api/http.ts';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../lib/google.ts';
import { GoogleButtonShell } from './GoogleButtonShell.tsx';
import type { GoogleSignInButtonProps } from './GoogleSignInButton.tsx';

/**
 * Android/iOS never open a browser redirect: Google Play Services / the Google Sign-In SDK resolves
 * the Android (or iOS) OAuth client from the package name and signing certificate and returns an ID
 * token directly. `webClientId` only sets the token audience, which must be the Web client the API
 * verifies.
 */
GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
  offlineAccess: false,
});

export function GoogleSignInButton({ busy, onToken, onError }: GoogleSignInButtonProps) {
  async function prompt() {
    if (!GOOGLE_WEB_CLIENT_ID) {
      onError(new ApiError('GOOGLE_AUTH_FAILED', 'Google sign-in is not configured in this build.', 400));
      return;
    }

    try {
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }

      const response = await GoogleSignin.signIn();
      if (response.type === 'cancelled') return;

      const idToken = response.data.idToken;
      if (!idToken) {
        onError(new ApiError('GOOGLE_AUTH_FAILED', 'Google did not return an identity token.', 400));
        return;
      }
      onToken(idToken);
    } catch (err) {
      if (
        isErrorWithCode(err) &&
        (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS)
      ) {
        return;
      }

      const code = isErrorWithCode(err) ? String(err.code) : '';
      let message = 'Google sign-in did not complete.';

      if (isErrorWithCode(err) && err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        message = 'Google Play Services is missing or out of date on this device.';
      } else if (code === '10' || code === 'DEVELOPER_ERROR') {
        message =
          'Google configuration mismatch (Developer Error 10). The APK signing certificate SHA-1 fingerprint must match the Android OAuth Client in Google Cloud Console.';
      } else if (code === '7' || code === 'NETWORK_ERROR') {
        message = 'Network error during Google sign-in. Please check your internet connection.';
      } else if (err instanceof Error && err.message) {
        message = err.message;
      }
      onError(new ApiError('GOOGLE_AUTH_FAILED', message, 400));
    }
  }

  return <GoogleButtonShell busy={busy} onPress={() => void prompt()} />;
}
