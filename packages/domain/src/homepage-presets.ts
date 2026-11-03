/**
 * Festival starting points for the staff console.
 *
 * A preset is deliberately not a whole page: it restyles the hero and palette over the current
 * layout. An editor who has already scheduled a route carousel should not lose it by picking Diwali.
 * Every preset is a valid `HomeTheme` + hero, so applying one and publishing without further edits is
 * always a legal configuration.
 */
import {
  defaultHomepageConfig,
  type HomeHero,
  type HomepageConfig,
  type HomeTheme,
} from './homepage.ts';

export interface HomepagePreset {
  id: string;
  name: string;
  description: string;
  theme: HomeTheme;
  hero: Omit<HomeHero, 'id'>;
}

export const HOMEPAGE_PRESETS: readonly HomepagePreset[] = [
  {
    id: 'default',
    name: 'Parcel Yatra',
    description: 'Deep blue hero, yellow action. The everyday page.',
    theme: {
      key: 'default',
      name: 'Parcel Yatra',
      brand: '#0b3bff',
      brand_dark: '#0039b8',
      brand_soft: '#eaf1ff',
      navy: '#061a7a',
      accent: '#f2b33d',
      canvas: '#f6f7fb',
      surface: '#ffffff',
      partner: '#0f7a5c',
      gradient: ['#0b3bff', '#1230c8', '#061a7a'],
      hero_text: '#ffffff',
      hero_muted: '#dbe4ff',
      badge_background: '#f2b33d',
      badge_text: '#061a7a',
      decoration: 'none',
    },
    hero: {
      eyebrow: 'PARCEL YATRA',
      headline: 'Your parcel. Their journey.',
      subtitle: 'Send it with someone already going your way.',
      trust_badges: ['ID-verified travellers', 'Up to 5 kg'],
      cta: { label: 'Send a parcel', action: { kind: 'send' } },
    },
  },
  {
    id: 'normal',
    name: 'Everyday',
    description: 'The same blue palette with no seasonal decoration.',
    theme: {
      key: 'normal',
      name: 'Everyday',
      brand: '#0b3bff',
      brand_dark: '#0039b8',
      brand_soft: '#eaf1ff',
      navy: '#061a7a',
      accent: '#f2b33d',
      canvas: '#f6f7fb',
      surface: '#ffffff',
      partner: '#0f7a5c',
      gradient: ['#0b3bff', '#1230c8', '#061a7a'],
      hero_text: '#ffffff',
      hero_muted: '#dbe4ff',
      badge_background: '#f2b33d',
      badge_text: '#061a7a',
      decoration: 'none',
    },
    hero: {
      eyebrow: 'PARCEL YATRA',
      headline: 'Your parcel. Their journey.',
      subtitle: 'Send it with someone already going your way.',
      trust_badges: ['ID-verified travellers', 'Up to 5 kg'],
      cta: { label: 'Send a parcel', action: { kind: 'send' } },
    },
  },
  {
    id: 'diwali-2026',
    name: 'Diwali 2026',
    description: 'Maroon and saffron wash, gold accent, lamps along the hero.',
    theme: {
      key: 'diwali-2026',
      name: 'Diwali 2026',
      brand: '#b91c1c',
      brand_dark: '#7f1d1d',
      brand_soft: '#fdecec',
      navy: '#4a0f0f',
      accent: '#f5b301',
      canvas: '#fdf8f2',
      surface: '#ffffff',
      partner: '#a16207',
      gradient: ['#8a1c1c', '#c2410c', '#4a0f0f'],
      hero_text: '#ffffff',
      hero_muted: '#ffe7c2',
      badge_background: '#f5b301',
      badge_text: '#4a0f0f',
      decoration: 'lamp',
    },
    hero: {
      eyebrow: 'DIWALI',
      headline: 'Send light home.',
      subtitle: 'Festive parcels carried hand to hand by verified travellers.',
      trust_badges: ['Sealed with care', 'ID-verified'],
      cta: { label: 'Send a festive parcel', action: { kind: 'send' } },
    },
  },
  {
    id: 'holi-2027',
    name: 'Holi 2027',
    description: 'Pink to indigo wash with confetti and a lemon accent.',
    theme: {
      key: 'holi-2027',
      name: 'Holi 2027',
      brand: '#c026d3',
      brand_dark: '#86198f',
      brand_soft: '#fdf4ff',
      navy: '#1e1b4b',
      accent: '#fde047',
      canvas: '#fbf7ff',
      surface: '#ffffff',
      partner: '#0f766e',
      gradient: ['#e4007c', '#7c3aed', '#1e3a8a'],
      hero_text: '#ffffff',
      hero_muted: '#ede9fe',
      badge_background: '#fde047',
      badge_text: '#1e1b4b',
      decoration: 'confetti',
    },
    hero: {
      eyebrow: 'HOLI',
      headline: 'Colour their day.',
      subtitle: 'A parcel that arrives in time for the celebration.',
      trust_badges: ['Sealed and photographed', 'Code at both ends'],
      cta: { label: 'Send a gift', action: { kind: 'send' } },
    },
  },
  {
    id: 'raksha-bandhan-2027',
    name: 'Raksha Bandhan 2027',
    description: 'Teal wash with a warm gold accent. Quiet, not loud.',
    theme: {
      key: 'raksha-bandhan-2027',
      name: 'Raksha Bandhan 2027',
      brand: '#0d9488',
      brand_dark: '#0f766e',
      brand_soft: '#f0fdfa',
      navy: '#134e4a',
      accent: '#fbbf24',
      canvas: '#f7fbfa',
      surface: '#ffffff',
      partner: '#b45309',
      gradient: ['#0f766e', '#115e59'],
      hero_text: '#ffffff',
      hero_muted: '#ccfbf1',
      badge_background: '#fbbf24',
      badge_text: '#134e4a',
      decoration: 'route',
    },
    hero: {
      eyebrow: 'RAKSHA BANDHAN',
      headline: 'Distance is no excuse.',
      subtitle: 'Send the rakhi with someone already travelling that way.',
      trust_badges: ['ID-verified travellers', 'Hand to hand'],
      cta: { label: 'Send a rakhi', action: { kind: 'send' } },
    },
  },
  {
    id: 'christmas-2026',
    name: 'Christmas 2026',
    description: 'Evergreen wash, brass accent, warm lights.',
    theme: {
      key: 'christmas-2026',
      name: 'Christmas 2026',
      brand: '#15803d',
      brand_dark: '#166534',
      brand_soft: '#f0fdf4',
      navy: '#052e16',
      accent: '#d4af37',
      canvas: '#f7faf8',
      surface: '#ffffff',
      partner: '#9a3412',
      gradient: ['#0b6b3a', '#064e2b'],
      hero_text: '#ffffff',
      hero_muted: '#dcfce7',
      badge_background: '#d4af37',
      badge_text: '#052e16',
      decoration: 'lamp',
    },
    hero: {
      eyebrow: 'CHRISTMAS',
      headline: 'A gift, hand delivered.',
      subtitle: 'Send it with a verified traveller already heading there.',
      trust_badges: ['ID-verified travellers', 'Up to 5 kg'],
      cta: { label: 'Send a gift', action: { kind: 'send' } },
    },
  },
];

/** Apply a preset over a base layout, keeping its sections and order untouched. */
export function applyHomepagePreset(
  preset: HomepagePreset,
  base: HomepageConfig = defaultHomepageConfig(),
): HomepageConfig {
  return {
    ...base,
    theme: { ...base.theme, ...preset.theme },
    hero: [{ id: `${preset.id}-hero`, ...preset.hero }],
  };
}
