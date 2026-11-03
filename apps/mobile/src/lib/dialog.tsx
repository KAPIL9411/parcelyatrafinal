/**
 * One entry point for the app's confirmations.
 *
 * `Alert.alert` is a native-only module. On Android and iOS it opens the platform dialog; in a
 * browser it resolves to a function that logs to the console and calls nothing, so a screen that
 * asks "Discard this parcel?" silently discards it instead. Screens therefore go through this
 * module, whose web sibling (`dialog.web.tsx`) renders the same question with the app's own
 * components.
 *
 * The signature is `Alert.alert`'s, unchanged, so the native path below is the behaviour the Android
 * app has today and no call site has to know which platform it is on.
 */

import { Alert, type AlertButton } from 'react-native';

export type { AlertButton };

export interface DialogAction {
  text: string;
  style?: AlertButton['style'];
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, actions: readonly DialogAction[] = []): void {
  Alert.alert(title, message, actions.length ? [...actions] : [{ text: 'OK' }]);
}

/** Renders nothing here: the platform dialog needs no host, only the browser one does. */
export function DialogHost(): null {
  return null;
}
