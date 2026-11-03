/**
 * Web-only extras merged into the `shadow` tokens in `src/theme.ts`.
 *
 * react-native-web implements neither the iOS `shadow*` props nor Android `elevation`, so every
 * card, the floating tab bar and the bottom sheet arrive flat in a browser. This module is the
 * translation, expressed once: the native build gets an empty object and its existing shadow props
 * are untouched, so Android and iOS render exactly as they do today.
 */

export interface ShadowExtras {
  card: { boxShadow?: string };
  soft: { boxShadow?: string };
  floating: { boxShadow?: string };
  sheet: { boxShadow?: string };
}

export const shadowCss: ShadowExtras = {
  card: {},
  soft: {},
  floating: {},
  sheet: {},
};
