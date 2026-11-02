/**
 * The one place the public Android download link lives.
 *
 * Paste the public EAS artifact / Drive / hosted APK URL here. While this is empty every download
 * control on the site shows an honest "soon" state instead of a dead link — the app is the product,
 * so a broken store link would be the worst possible first impression.
 */
const CONFIGURED_URL = '';

/** Only HTTPS destinations are accepted; anything else is treated as not configured yet. */
export const APP_DOWNLOAD_URL = CONFIGURED_URL.startsWith('https://') ? CONFIGURED_URL : '';

export const APP_DOWNLOAD_READY = APP_DOWNLOAD_URL.length > 0;
