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

/**
 * The splash-to-home handoff, as fractions of one `Animated.Value` running 0 → 1.
 *
 * The 250–300 ms window is the contract `test/splash.test.ts` enforces: long enough to read as a
 * settle, short enough that the home screen never feels like it is being withheld.
 */
export const REVEAL_DURATION_MS = 280;
export const REVEAL_LOGO_EASED_TO = 0.35;
export const REVEAL_LOGO_SCALE = 0.95;
export const REVEAL_DISC_STARTS_AT = 0.2;
export const REVEAL_DISC_END_SCALE = 1.6;
export const REVEAL_SPLASH_GONE_AT = 0.8;

export function revealCoverageProgress(
  discStartsAt = REVEAL_DISC_STARTS_AT,
  discEndScale = REVEAL_DISC_END_SCALE,
): number {
  return discStartsAt + (1 - discStartsAt) / discEndScale;
}

