/**
 * Helpers for editing the remote homepage.
 *
 * The console edits a `HomepageConfig` — the same object the API validates and the app renders. Two
 * things live here rather than in the components:
 *
 *  - **time zones.** A campaign window is an instant, not a wall clock. The editor types "8 Nov, 6 pm"
 *    and picks a zone; this module converts that to an ISO string with an offset, using the zone's
 *    real offset at that instant (so IST stays +05:30 and a DST zone does not silently shift).
 *  - **factories.** A new banner or section has to start from something valid, otherwise the first
 *    save is a validation error rather than a starting point.
 */
import type {
  HomeAction,
  HomeHero,
  HomeItem,
  HomeSection,
  HomeSectionType,
  HomepageConfig,
} from '@py/domain';

export const SECTION_TYPE_LABELS: Record<HomeSectionType, string> = {
  campaign_hero: 'Campaign banner',
  category_nav: 'Category strip',
  category_grid: 'Category grid',
  quick_actions: 'Quick actions',
  popular_routes: 'Popular routes',
  promo_cards: 'Promo cards',
  trust: 'Trust points',
  business_promo: 'Business banner',
  carry_promo: 'Carry & earn banner',
  how_it_works: 'How it works',
  announcements: 'Announcements',
};

/** Sections that are meaningless without items. The editor refuses to save them empty. */
export const ITEM_SECTIONS: ReadonlySet<HomeSectionType> = new Set<HomeSectionType>([
  'category_nav',
  'category_grid',
  'quick_actions',
  'popular_routes',
  'promo_cards',
  'trust',
  'how_it_works',
  'announcements',
]);

/**
 * Zones an Indian operations team is likely to schedule in. The value is an IANA name, which is what
 * `Intl` needs; the label is what an editor reads.
 */
export const TIME_ZONES = [
  { value: 'Asia/Kolkata', label: 'India (IST, UTC+05:30)' },
  { value: 'Asia/Dubai', label: 'Dubai (UTC+04:00)' },
  { value: 'Asia/Singapore', label: 'Singapore (UTC+08:00)' },
  { value: 'Europe/London', label: 'London (UTC+00:00 / +01:00)' },
  { value: 'America/New_York', label: 'New York (UTC-05:00 / -04:00)' },
  { value: 'UTC', label: 'UTC' },
] as const;

const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** The zone's offset from UTC, in minutes, at a given instant. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = partsFormatter(timeZone).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * `2026-11-08T18:00` in `Asia/Kolkata` → `2026-11-08T12:30:00.000Z`.
 *
 * The offset is computed twice: once at the naive instant and once at the corrected instant, because
 * a wall-clock time that falls inside a DST transition can land on the wrong side of it. Two passes
 * settle every real zone.
 */
export function zonedToIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const naive = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (Number.isNaN(naive)) return null;

  let instant = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  instant = naive - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant).toISOString();
}

/** The inverse: an ISO instant as `YYYY-MM-DDTHH:mm` in the chosen zone, for `datetime-local`. */
export function isoToZoned(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const parts = partsFormatter(timeZone).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour') === '24' ? '00' : read('hour')}:${read('minute')}`;
}

/** A human string for a stored instant, e.g. `8 Nov 2026, 6:00 pm IST`. */
export function formatInstant(iso: string | null | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(at);
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyHero(): HomeHero {
  return {
    id: newId('hero'),
    eyebrow: '',
    headline: '',
    subtitle: '',
    trust_badges: [],
    cta: { label: 'Send a parcel', action: { kind: 'send' } },
  };
}

export function emptyItem(type: HomeSectionType): HomeItem {
  return {
    id: newId('item'),
    title: '',
    ...(type === 'popular_routes' ? { body: '' } : {}),
  };
}

export function emptySection(type: HomeSectionType, order: number): HomeSection {
  return {
    id: newId(type),
    type,
    enabled: true,
    order,
    title: SECTION_TYPE_LABELS[type],
    ...(ITEM_SECTIONS.has(type) ? { items: [] } : {}),
    ...(type === 'business_promo' ? { action: { kind: 'route', route: '/info/business' } } : {}),
    ...(type === 'carry_promo' ? { action: { kind: 'route', route: '/trips/new' } } : {}),
  };
}

/** Drop undefined/empty keys so the saved JSON stays close to what an editor actually filled in. */
export function cleanAction(action: HomeAction | undefined): HomeAction | undefined {
  if (!action || action.kind === 'none') return undefined;
  if (action.kind === 'send') {
    return {
      kind: 'send',
      ...(action.origin?.trim() ? { origin: action.origin.trim() } : {}),
      ...(action.category?.trim() ? { category: action.category.trim() } : {}),
    };
  }
  return action;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A stable order value for a section at a given index. Gaps of ten leave room to insert between two
 * neighbours without renumbering everything, which is what the up/down buttons do.
 */
export function orderForIndex(index: number): number {
  return (index + 1) * 10;
}

export function reorderSections(sections: HomeSection[], from: number, to: number): HomeSection[] {
  if (to < 0 || to >= sections.length || from === to) return sections;
  const next = sections.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return sections;
  next.splice(to, 0, moved);
  return next.map((section, index) => ({ ...section, order: orderForIndex(index) }));
}

/** Sorted for display, matching what the app will do with `order`. */
export function sortedSections(config: HomepageConfig): HomeSection[] {
  return config.sections
    .slice()
    .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order));
}
