/**
 * Turning a remote theme into something the components can use.
 *
 * A campaign may set any subset of the palette, so every value falls back to the brand token it
 * replaces. Two rules are enforced here rather than trusted from the console:
 *
 *  - a colour that cannot be read on its background is replaced with one that can — a festive
 *    palette is allowed to be loud, not illegible;
 *  - an unknown decoration renders nothing, so a newer server cannot draw outside the component
 *    design system.
 */
import type { HomeSection, HomeTheme } from '@py/domain';

import { colors } from '../theme.ts';

export interface HomePalette {
  key: string;
  name: string;
  brand: string;
  brandDark: string;
  brandSoft: string;
  navy: string;
  accent: string;
  canvas: string;
  surface: string;
  partner: string;
  /** Two to four stops, drawn top-left to bottom-right. */
  heroGradient: string[];
  heroText: string;
  heroMuted: string;
  badgeBackground: string;
  badgeText: string;
  decoration: HomeTheme['decoration'];
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  const int = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(int)) return { r: 0, g: 0, b: 0 };
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** `#0a57ff` + 0.4 → `rgba(10,87,255,0.4)`. Used for scrims and tinted surfaces. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

/** Blend two colours in sRGB. `weight` is how much of `to` lands in the result. */
export function mixHex(from: string, to: string, weight: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const amount = Math.max(0, Math.min(1, weight));
  const channel = (first: number, second: number): string =>
    Math.round(first * (1 - amount) + second * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

/** WCAG relative luminance. */export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Return `preferred` when it is legible on `background`, otherwise the safer of white and ink.
 *
 * The threshold is 3:1, the WCAG floor for large text, because every use of this helper is display
 * type or a badge. Small body copy sits on surfaces we control.
 */
export function readableOn(preferred: string | undefined, background: string, fallback?: string): string {
  if (preferred && contrastRatio(preferred, background) >= 3) return preferred;
  if (fallback && contrastRatio(fallback, background) >= 3) return fallback;
  return luminance(background) > 0.45 ? colors.navy : '#ffffff';
}

export function homePalette(theme: HomeTheme): HomePalette {
  const brand = theme.brand ?? colors.brand;
  const navy = theme.navy ?? colors.navy;
  const accent = theme.accent ?? colors.accent;
  const heroGradient: string[] = theme.gradient ?? theme.hero_gradient ?? [navy, brand];
  const lastStop = heroGradient[heroGradient.length - 1] ?? brand;
  const heroText = readableOn(theme.hero_text, lastStop, '#ffffff');
  const badgeBackground = theme.badge_background ?? accent;
  const heroMuted =
    theme.hero_muted && contrastRatio(theme.hero_muted, lastStop) >= 3
      ? theme.hero_muted
      : withAlpha(heroText === '#ffffff' ? '#ffffff' : colors.navy, 0.82);

  // The parser normalises `decor` to `decoration`, but the bundled default and a config typed by
  // hand in the console preview reach this function unparsed. Both spellings are safe here.
  const decoration =
    theme.decoration ?? (theme.decor === 'lights' ? 'lamp' : (theme.decor ?? 'none'));

  return {
    key: theme.key,
    name: theme.name,
    brand,
    brandDark: theme.brand_dark ?? (brand === colors.brand ? colors.brandDark : brand),
    brandSoft: theme.brand_soft ?? colors.brandSoft,
    navy,
    accent,
    canvas: theme.canvas ?? colors.canvas,
    surface: theme.surface ?? colors.surface,
    partner: theme.partner ?? colors.partner,
    heroGradient,
    heroText,
    heroMuted,
    badgeBackground,
    badgeText: readableOn(theme.badge_text, badgeBackground, colors.navy),
    decoration,
  };
}

export interface SectionSurface {
  background: string;
  text: string;
  muted: string;
  accent: string;
}

/**
 * A section may tint itself. When it does, the text has to be legible on that tint — the console
 * cannot be trusted to have checked, and an unreadable section is worse than an untinted one.
 */
export function sectionSurface(section: HomeSection, palette: HomePalette): SectionSurface {
  const background = section.background ?? palette.surface;
  const text = readableOn(section.text_color, background, palette.navy);
  const accent = readableOn(section.accent_color, background, palette.brand);
  return {
    background,
    text,
    muted: contrastRatio(text, background) > 8 ? withAlpha(text, 0.72) : text,
    accent,
  };
}

/**
 * Opacity ramp for the faux gradient: the destination colour laid over the origin colour in even
 * steps. Six bands read as a smooth wash at phone sizes and cost nothing native.
 */
export function gradientBands(to: string, steps = 6): string[] {
  return Array.from({ length: steps }, (_, index) => withAlpha(to, (index + 1) / steps));
}
