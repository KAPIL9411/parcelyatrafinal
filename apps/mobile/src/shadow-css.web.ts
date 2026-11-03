/**
 * The browser translation of `src/shadow-css.ts`.
 *
 * Each string is the same shadow the native token describes: the same navy `#0a1730` at the same
 * offset and opacity, with the blur radius doubled because CSS measures blur as a diameter while
 * iOS `shadowRadius` measures it as a Gaussian sigma. Without this, cards, the floating tab bar and
 * every bottom sheet render flat and the PWA reads as a website rather than as this app.
 */

import type { ShadowExtras } from './shadow-css.ts';

export const shadowCss: ShadowExtras = {
  card: { boxShadow: '0 4px 24px rgba(10,23,48,0.06)' },
  soft: { boxShadow: '0 2px 12px rgba(10,23,48,0.04)' },
  floating: { boxShadow: '0 10px 44px rgba(10,23,48,0.14)' },
  sheet: { boxShadow: '0 -6px 56px rgba(10,23,48,0.18)' },
};
