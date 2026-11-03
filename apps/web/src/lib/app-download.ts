/**
 * The one place the public Android download link lives.
 *
 * The APK is served from the web app's public assets so every download control uses the same
 * first-party file and works without an external store or redirect.
 */
const CONFIGURED_URL = '/ParcelYatra.apk';

/** Only a first-party path or HTTPS destination is accepted. */
export const APP_DOWNLOAD_URL =
  CONFIGURED_URL.startsWith('/') || CONFIGURED_URL.startsWith('https://')
    ? CONFIGURED_URL
    : '';

export const APP_DOWNLOAD_READY = APP_DOWNLOAD_URL.length > 0;
