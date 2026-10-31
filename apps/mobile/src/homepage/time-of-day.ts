/**
 * The sky the home hero wears at a given hour.
 *
 * The scene is pure data so it can be tested without a renderer: the renderer in
 * components/SkyBackdrop.tsx only turns `SkyScene` into layers. Everything is anchored to the
 * hero's top-left corner — the corner the wordmark and then the weather tile used to sit in — with
 * the disc deliberately larger than its offset so it is clipped by the screen edge, as if the sun
 * or moon were just rising over the corner of the page.
 *
 * Weather (rain, storm, haze) is not part of this spec: the app has no weather source and the city
 * record carries no coordinates, so the scene follows the clock and nothing else.
 */

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export interface SkyScene {
  label: string;
  body: 'sun' | 'moon';
  /** Diameter of the disc, in dp. */
  core: number;
  /** Disc centre: dp from the hero's left edge. */
  x: number;
  /** Disc centre: dp below the safe-area top. */
  y: number;
  /** The hour's light: washes the campaign gradient and colours the glow around the disc. */
  tint: readonly [string, string];
  /** Peak alpha of that wash. */
  tintOpacity: number;
  /** Light shafts fanning into the hero. */
  rays: number;
  stars: number;
}

export function timeOfDay(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 19) return 'evening';
  return 'night';
}

const SCENES: Record<TimeOfDay, SkyScene> = {
  morning: {
    label: 'Morning',
    body: 'sun',
    core: 92,
    x: 10,
    y: 50,
    tint: ['#ffb86b', '#ff8f6b'],
    tintOpacity: 0.14,
    rays: 6,
    stars: 0,
  },
  afternoon: {
    label: 'Afternoon',
    body: 'sun',
    core: 96,
    x: 6,
    y: 48,
    tint: ['#ffd27a', '#ff9d5c'],
    tintOpacity: 0.08,
    rays: 9,
    stars: 0,
  },
  evening: {
    label: 'Sunset',
    body: 'sun',
    core: 104,
    x: 10,
    y: 76,
    tint: ['#ff8f4d', '#c94b86'],
    tintOpacity: 0.5,
    rays: 4,
    stars: 0,
  },
  night: {
    label: 'Night',
    body: 'moon',
    core: 58,
    x: 24,
    y: 44,
    tint: ['#0d1a44', '#2a1c58'],
    tintOpacity: 0.68,
    rays: 0,
    stars: 11,
  },
};

export function skyScene(part: TimeOfDay): SkyScene {
  return SCENES[part];
}
