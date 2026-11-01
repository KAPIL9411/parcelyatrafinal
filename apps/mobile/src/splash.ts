/**
 * Single source of truth for the launch screen geometry, shared by the native splash
 * (app.json -> expo-splash-screen) and the JS splash that covers font/session boot.
 *
 * The native plugin composites this wordmark at `SPLASH_IMAGE_WIDTH_DP` inside a 288 dp
 * icon, and Android draws that icon at its intrinsic size, so the wordmark reaches the
 * screen at exactly this width. The JS splash must use the same number or the hand-off
 * crossfade shows the logo changing size.
 */
export const SPLASH_BLUE = '#005DFD';
export const SPLASH_IMAGE_WIDTH_DP = 180;

/** assets/brand-wordmark-white.png is 1024x170, so the drawn height follows the width. */
export const SPLASH_WORDMARK_ASPECT = 170 / 1024;
export const SPLASH_WORDMARK_HEIGHT_DP = SPLASH_IMAGE_WIDTH_DP * SPLASH_WORDMARK_ASPECT;
