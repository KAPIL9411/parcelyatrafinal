/**
 * The homepage contract, shared by the API, the staff console and the mobile app.
 *
 * Why this file exists in the domain package: the server validates what an editor saves, the app
 * validates what the server sends back, and both must agree on the same allowlists. A campaign is
 * remote content rendered by *existing* components — never markup, never code. So every field here
 * is a scalar, a colour, an allowlisted icon, an allowlisted in-app route, or an image URL that
 * points at our own media route.
 *
 * The parser is deliberately hand-written rather than zod: this module is bundled into the React
 * Native app, and a validator that only produces strings costs nothing on a phone. It also returns a
 * *normalised* copy — unknown keys are dropped, not stored — so a future field cannot leak into a
 * client that does not understand it.
 */

export const HOMEPAGE_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------- allowlists

/** Section kinds a configuration may contain. Anything else is ignored by clients. */
export const HOME_SECTION_TYPES = [
  'campaign_hero',
  'category_nav',
  'category_grid',
  'quick_actions',
  'popular_routes',
  'promo_cards',
  'trust',
  'business_promo',
  'carry_promo',
  'how_it_works',
  'announcements',
] as const;
export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

/**
 * Screens a campaign may navigate to. This is the whole point of the allowlist: a compromised or
 * mistaken configuration can point at a real screen, and at nothing else. No URLs, no params other
 * than the two below, no `router.push` of a server-supplied string.
 */
export const HOME_ROUTES = [
  '/send',
  '/bookings',
  '/trips',
  '/trips/new',
  '/help',
  '/notifications',
  '/inbox',
  '/profile',
  '/verification',
  '/info/pricing',
  '/info/prohibited',
  '/info/safety',
  '/info/business',
  '/info/grievance',
] as const;
export type HomeRoute = (typeof HOME_ROUTES)[number];

/** The icon set an editor may choose from. Keeps the homepage visually coherent. */
export const HOME_ICONS = [
  'cube-outline',
  'cube',
  'car-outline',
  'car-sport-outline',
  'navigate-outline',
  'business-outline',
  'shield-checkmark-outline',
  'shield-checkmark',
  'help-circle-outline',
  'pricetag-outline',
  'location-outline',
  'document-text-outline',
  'school-outline',
  'briefcase-outline',
  'construct-outline',
  'sparkles-outline',
  'newspaper-outline',
  'flower-outline',
  'key-outline',
  'headset-outline',
  'time-outline',
  'gift-outline',
  'megaphone-outline',
  'bag-handle-outline',
  'wallet-outline',
  'people-outline',
  'star-outline',
  'checkmark-circle-outline',
  'receipt-outline',
  'flash-outline',
] as const;
export type HomeIcon = (typeof HOME_ICONS)[number];

/** Decorative treatments that ship with the app. `none` is always safe. */
export const HOME_DECORATIONS = ['none', 'route', 'sparkle', 'confetti', 'lamp'] as const;
export type HomeDecoration = (typeof HOME_DECORATIONS)[number];

/**
 * The short vocabulary an editor may write as `theme.decor`. It is a set of *intents* that map onto
 * the drawn decorations, so the console can describe a festive overlay without knowing which
 * primitive the app implements it with.
 */
export const HOME_DECOR = ['none', 'lights', 'confetti'] as const;
export type HomeDecor = (typeof HOME_DECOR)[number];

const DECOR_TO_DECORATION: Record<HomeDecor, HomeDecoration> = {
  none: 'none',
  lights: 'lamp',
  confetti: 'confetti',
};

// ---------------------------------------------------------------------------- types

export type HomeAction =
  | { kind: 'route'; route: HomeRoute }
  | { kind: 'send'; origin?: string; category?: string }
  | { kind: 'none' };

export interface HomeHeroCta {
  label: string;
  action: HomeAction;
}

export interface HomeHero {
  id: string;
  headline: string;
  subtitle?: string;
  /** Short badge above the headline, e.g. "Diwali". */
  eyebrow?: string;
  /** Artwork from our own media route; rendered behind a scrim. */
  image_url?: string;
  /** Two-stop background, used when there is no artwork. */
  gradient?: [string, string];
  text_color?: string;
  trust_badges?: string[];
  cta?: HomeHeroCta;
  /** Renders a countdown chip until this instant (ISO 8601). */
  countdown_to?: string;
  active_from?: string;
  active_until?: string;
}

export type HomeGradient = [string, string, ...string[]];

export interface HomeTheme {
  /** Slug, e.g. `default` or `diwali-2026`. */
  key: string;
  /** Display name shown in the console and nowhere else. */
  name: string;
  brand?: string;
  brand_dark?: string;
  brand_soft?: string;
  navy?: string;
  accent?: string;
  canvas?: string;
  surface?: string;
  partner?: string;
  /** Two to four stops for the themed hero, first stop at the top-left. */
  gradient?: HomeGradient;
  /** Legacy two-stop hero background, still honoured when `gradient` is absent. */
  hero_gradient?: [string, string];
  hero_text?: string;
  hero_muted?: string;
  badge_background?: string;
  badge_text?: string;
  /** What the console writes. Normalised to `decoration` when the config is parsed. */
  decor?: HomeDecor;
  decoration?: HomeDecoration;
}

export interface HomeItem {
  id: string;
  title: string;
  body?: string;
  icon?: HomeIcon;
  badge?: string;
  image_url?: string;
  action?: HomeAction;
  /** `popular_routes`: city names as they appear in `/cities`. */
  origin?: string;
  dest?: string;
  /** `category_nav`: a `/config` category key, pre-selected in the send flow. */
  category?: string;
}

export interface HomeSection {
  id: string;
  type: HomeSectionType;
  enabled: boolean;
  /** Ascending. Sections render in this order, ties broken by id. */
  order: number;
  title?: string;
  subtitle?: string;
  background?: string;
  text_color?: string;
  accent_color?: string;
  image_url?: string;
  action?: HomeAction;
  items?: HomeItem[];
  /** Optional per-section window; outside it the section is skipped. */
  starts_at?: string;
  ends_at?: string;
}

export interface HomepageConfig {
  schema_version: typeof HOMEPAGE_SCHEMA_VERSION;
  theme: HomeTheme;
  hero: HomeHero[];
  sections: HomeSection[];
}

export interface HomepageCampaignMeta {
  id: string;
  name: string;
  version: number;
  priority: number;
  starts_at: string;
  ends_at: string;
}

/** What `GET /v1/homepage` answers with. */
export interface HomepageDocument {
  schema_version: typeof HOMEPAGE_SCHEMA_VERSION;
  /** Monotonic release version. Clients use it only for debugging and cache comparison. */
  version: number;
  published_at: string;
  generated_at: string;
  /** When the active campaign stops applying, so a client can drop stale artwork offline. */
  expires_at: string | null;
  campaign: HomepageCampaignMeta | null;
  theme: HomeTheme;
  hero: HomeHero[];
  sections: HomeSection[];
  refresh_after_seconds: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

// ---------------------------------------------------------------------------- primitives

const MAX_ISSUES = 20;

const HEX = /^#[0-9a-fA-F]{6}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Our own media route, absolute, no query, no fragment, no userinfo. */
const MEDIA_URL = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*\/homepage\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Ctx {
  issues: string[];
  /** Editors get told about a section type this build does not know; readers skip it. */
  strictUnknownSections: boolean;
}

function fail(ctx: Ctx, path: string, message: string): undefined {
  if (ctx.issues.length < MAX_ISSUES) ctx.issues.push(`${path}: ${message}`);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(ctx: Ctx, path: string, value: unknown, max: number, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) return fail(ctx, path, 'is required');
    return undefined;
  }
  if (typeof value !== 'string') return fail(ctx, path, 'must be a string');
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) return fail(ctx, path, 'must not be empty');
    return undefined;
  }
  if (trimmed.length > max) return fail(ctx, path, `must be at most ${max} characters`);
  return trimmed;
}

function hex(ctx: Ctx, path: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !HEX.test(value.trim())) {
    return fail(ctx, path, 'must be a six-digit hex colour such as #0a57ff');
  }
  return value.trim().toLowerCase();
}

function iso(ctx: Ctx, path: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !ISO.test(value.trim())) {
    return fail(ctx, path, 'must be an ISO 8601 timestamp with a timezone');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fail(ctx, path, 'is not a valid date');
  return parsed.toISOString();
}

function mediaUrl(ctx: Ctx, path: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !MEDIA_URL.test(value.trim())) {
    return fail(ctx, path, 'must be an image uploaded to the homepage media library');
  }
  return value.trim();
}

function oneOf<T extends string>(
  ctx: Ctx,
  path: string,
  value: unknown,
  allowed: readonly T[],
  required = false,
): T | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) return fail(ctx, path, 'is required');
    return undefined;
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return fail(ctx, path, `must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function gradient(ctx: Ctx, path: string, value: unknown): [string, string] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(ctx, path, 'must be an array of exactly two colours');
  }
  const first = hex(ctx, `${path}[0]`, value[0]);
  const second = hex(ctx, `${path}[1]`, value[1]);
  if (!first || !second) return undefined;
  return [first, second];
}

/** A themed hero may carry up to four stops; two is the minimum that makes a gradient. */
function gradientStops(ctx: Ctx, path: string, value: unknown): HomeGradient | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    return fail(ctx, path, 'must be an array of two to four colours');
  }
  const stops: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const stop = hex(ctx, `${path}[${index}]`, value[index]);
    if (!stop) return undefined;
    stops.push(stop);
  }
  return stops as HomeGradient;
}

function action(ctx: Ctx, path: string, value: unknown): HomeAction | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return fail(ctx, path, 'must be an object');
  const kind = oneOf(ctx, `${path}.kind`, value.kind, ['route', 'send', 'none'] as const, true);
  if (!kind) return undefined;

  if (kind === 'none') return { kind: 'none' };

  if (kind === 'route') {
    const route = oneOf(ctx, `${path}.route`, value.route, HOME_ROUTES, true);
    return route ? { kind: 'route', route } : undefined;
  }

  const origin = str(ctx, `${path}.origin`, value.origin, 64);
  const category = str(ctx, `${path}.category`, value.category, 64);
  return { kind: 'send', ...(origin ? { origin } : {}), ...(category ? { category } : {}) };
}

// ---------------------------------------------------------------------------- hero

function parseHero(ctx: Ctx, path: string, value: unknown): HomeHero | undefined {
  if (!isRecord(value)) return fail(ctx, path, 'must be an object');
  const id = str(ctx, `${path}.id`, value.id, 64, true);
  const headline = str(ctx, `${path}.headline`, value.headline, 72, true);
  if (!id || !headline) return undefined;

  const badgesRaw = value.trust_badges;
  let trustBadges: string[] | undefined;
  if (badgesRaw !== undefined && badgesRaw !== null) {
    if (!Array.isArray(badgesRaw)) {
      fail(ctx, `${path}.trust_badges`, 'must be an array');
    } else if (badgesRaw.length > 4) {
      fail(ctx, `${path}.trust_badges`, 'may hold at most four badges');
    } else {
      trustBadges = badgesRaw
        .map((badge, index) => str(ctx, `${path}.trust_badges[${index}]`, badge, 40))
        .filter((badge): badge is string => Boolean(badge));
    }
  }

  let cta: HomeHeroCta | undefined;
  if (value.cta !== undefined && value.cta !== null) {
    if (!isRecord(value.cta)) {
      fail(ctx, `${path}.cta`, 'must be an object');
    } else {
      const label = str(ctx, `${path}.cta.label`, value.cta.label, 28, true);
      const ctaAction = action(ctx, `${path}.cta.action`, value.cta.action);
      if (label && ctaAction) cta = { label, action: ctaAction };
    }
  }

  const subtitle = str(ctx, `${path}.subtitle`, value.subtitle, 160);
  const eyebrow = str(ctx, `${path}.eyebrow`, value.eyebrow, 32);
  const image = mediaUrl(ctx, `${path}.image_url`, value.image_url);
  const stops = gradient(ctx, `${path}.gradient`, value.gradient);
  const textColor = hex(ctx, `${path}.text_color`, value.text_color);
  const countdownTo = iso(ctx, `${path}.countdown_to`, value.countdown_to);
  const activeFrom = iso(ctx, `${path}.active_from`, value.active_from);
  const activeUntil = iso(ctx, `${path}.active_until`, value.active_until);
  if (activeFrom && activeUntil && new Date(activeUntil) <= new Date(activeFrom)) {
    fail(ctx, `${path}.active_until`, 'must be after active_from');
  }

  const hero: HomeHero = { id, headline };
  if (subtitle) hero.subtitle = subtitle;
  if (eyebrow) hero.eyebrow = eyebrow;
  if (image) hero.image_url = image;
  if (stops) hero.gradient = stops;
  if (textColor) hero.text_color = textColor;
  if (trustBadges && trustBadges.length) hero.trust_badges = trustBadges;
  if (cta) hero.cta = cta;
  if (countdownTo) hero.countdown_to = countdownTo;
  if (activeFrom) hero.active_from = activeFrom;
  if (activeUntil) hero.active_until = activeUntil;
  return hero;
}

// ---------------------------------------------------------------------------- theme

function parseTheme(ctx: Ctx, path: string, value: unknown): HomeTheme | undefined {
  if (!isRecord(value)) return fail(ctx, path, 'must be an object');
  const key = str(ctx, `${path}.key`, value.key, 64, true);
  const name = str(ctx, `${path}.name`, value.name, 48, true);
  if (!key || !name) return undefined;
  if (!SLUG.test(key)) return fail(ctx, `${path}.key`, 'must be a lowercase slug');

  const theme: HomeTheme = { key, name };
  const colours = [
    'brand',
    'brand_dark',
    'brand_soft',
    'navy',
    'accent',
    'canvas',
    'surface',
    'partner',
    'hero_text',
    'hero_muted',
    'badge_background',
    'badge_text',
  ] as const;
  for (const field of colours) {
    const parsed = hex(ctx, `${path}.${field}`, value[field]);
    if (parsed) theme[field] = parsed;
  }

  const stops = gradientStops(ctx, `${path}.gradient`, value.gradient);
  if (stops) theme.gradient = stops;

  const legacyStops = gradient(ctx, `${path}.hero_gradient`, value.hero_gradient);
  if (legacyStops) theme.hero_gradient = legacyStops;

  // `decor` is the short editor vocabulary; `decoration` is the drawn primitive it selects.
  const decor = oneOf(ctx, `${path}.decor`, value.decor, HOME_DECOR);
  const decoration = oneOf(ctx, `${path}.decoration`, value.decoration, HOME_DECORATIONS);
  const resolved = decoration ?? (decor ? DECOR_TO_DECORATION[decor] : undefined);
  if (resolved) theme.decoration = resolved;

  return theme;
}

// ---------------------------------------------------------------------------- items & sections

function parseItem(ctx: Ctx, path: string, value: unknown): HomeItem | undefined {
  if (!isRecord(value)) return fail(ctx, path, 'must be an object');
  const id = str(ctx, `${path}.id`, value.id, 64, true);
  const title = str(ctx, `${path}.title`, value.title, 56, true);
  if (!id || !title) return undefined;

  const item: HomeItem = { id, title };
  const body = str(ctx, `${path}.body`, value.body, 160);
  if (body) item.body = body;
  const icon = oneOf(ctx, `${path}.icon`, value.icon, HOME_ICONS);
  if (icon) item.icon = icon;
  const badge = str(ctx, `${path}.badge`, value.badge, 24);
  if (badge) item.badge = badge;
  const image = mediaUrl(ctx, `${path}.image_url`, value.image_url);
  if (image) item.image_url = image;
  const itemAction = action(ctx, `${path}.action`, value.action);
  if (itemAction) item.action = itemAction;
  const origin = str(ctx, `${path}.origin`, value.origin, 64);
  if (origin) item.origin = origin;
  const dest = str(ctx, `${path}.dest`, value.dest, 64);
  if (dest) item.dest = dest;
  const category = str(ctx, `${path}.category`, value.category, 64);
  if (category) item.category = category;
  return item;
}

function parseSection(ctx: Ctx, path: string, value: unknown): HomeSection | undefined {
  if (!isRecord(value)) return fail(ctx, path, 'must be an object');

  // An unknown type is not an error for a *reader*: an app that predates a section kind must keep
  // rendering the rest of the page, so the section is skipped. An *editor* is told, because saving a
  // section this build cannot draw is a mistake worth catching before publication.
  const rawType = value.type;
  const type =
    typeof rawType === 'string' && (HOME_SECTION_TYPES as readonly string[]).includes(rawType)
      ? (rawType as HomeSectionType)
      : undefined;
  if (!type) {
    if (ctx.strictUnknownSections) {
      const received = typeof rawType === 'string' ? `; got "${rawType.slice(0, 40)}"` : '';
      fail(ctx, `${path}.type`, `must be one of ${HOME_SECTION_TYPES.join(', ')}${received}`);
    }
    return undefined;
  }

  const id = str(ctx, `${path}.id`, value.id, 64, true);
  if (!id) return undefined;

  const orderRaw = value.order;
  let order = 0;
  if (orderRaw !== undefined && orderRaw !== null) {
    if (typeof orderRaw !== 'number' || !Number.isFinite(orderRaw)) {
      fail(ctx, `${path}.order`, 'must be a number');
    } else {
      order = Math.max(0, Math.min(10_000, Math.round(orderRaw)));
    }
  }

  let enabled = true;
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') fail(ctx, `${path}.enabled`, 'must be true or false');
    else enabled = value.enabled;
  }

  const startsAt = iso(ctx, `${path}.starts_at`, value.starts_at);
  const endsAt = iso(ctx, `${path}.ends_at`, value.ends_at);
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    fail(ctx, `${path}.ends_at`, 'must be after starts_at');
  }

  let items: HomeItem[] | undefined;
  if (value.items !== undefined && value.items !== null) {
    if (!Array.isArray(value.items)) {
      fail(ctx, `${path}.items`, 'must be an array');
    } else if (value.items.length > 12) {
      fail(ctx, `${path}.items`, 'may hold at most twelve entries');
    } else {
      items = value.items
        .map((item, index) => parseItem(ctx, `${path}.items[${index}]`, item))
        .filter((item): item is HomeItem => Boolean(item));
    }
  }

  const section: HomeSection = { id, type, enabled, order };
  const title = str(ctx, `${path}.title`, value.title, 56);
  if (title) section.title = title;
  const subtitle = str(ctx, `${path}.subtitle`, value.subtitle, 160);
  if (subtitle) section.subtitle = subtitle;
  const background = hex(ctx, `${path}.background`, value.background);
  if (background) section.background = background;
  const textColor = hex(ctx, `${path}.text_color`, value.text_color);
  if (textColor) section.text_color = textColor;
  const accentColor = hex(ctx, `${path}.accent_color`, value.accent_color);
  if (accentColor) section.accent_color = accentColor;
  const image = mediaUrl(ctx, `${path}.image_url`, value.image_url);
  if (image) section.image_url = image;
  const sectionAction = action(ctx, `${path}.action`, value.action);
  if (sectionAction) section.action = sectionAction;
  if (items && items.length) section.items = items;
  if (startsAt) section.starts_at = startsAt;
  if (endsAt) section.ends_at = endsAt;
  return section;
}

// ---------------------------------------------------------------------------- config

export interface ParseOptions {
  /**
   * Reject a section type this build does not know instead of dropping it. The staff console sets
   * this so an editor cannot save a section nobody can render; the app and the public API never do.
   */
  strictUnknownSections?: boolean;
}

/**
 * Validate and normalise a configuration.
 *
 * Unknown section types are *dropped*, not fatal — that is what lets a new server-side section ship
 * to an old app without breaking it. Everything else that is malformed is an issue, because a
 * silently empty homepage is worse than a refused save.
 */
export function parseHomepageConfig(input: unknown, options: ParseOptions = {}): ParseResult<HomepageConfig> {
  const ctx: Ctx = { issues: [], strictUnknownSections: options.strictUnknownSections === true };
  if (!isRecord(input)) return { ok: false, issues: ['config: must be an object'] };

  const schemaVersion = input.schema_version;
  if (schemaVersion !== undefined && schemaVersion !== HOMEPAGE_SCHEMA_VERSION) {
    return { ok: false, issues: [`schema_version: this build understands version ${HOMEPAGE_SCHEMA_VERSION}`] };
  }

  const theme = parseTheme(ctx, 'theme', input.theme);
  if (!theme && ctx.issues.length === 0) ctx.issues.push('theme: is required');

  let hero: HomeHero[] = [];
  if (input.hero !== undefined && input.hero !== null) {
    if (!Array.isArray(input.hero)) {
      fail(ctx, 'hero', 'must be an array');
    } else if (input.hero.length > 6) {
      fail(ctx, 'hero', 'may hold at most six banners');
    } else {
      hero = input.hero
        .map((banner, index) => parseHero(ctx, `hero[${index}]`, banner))
        .filter((banner): banner is HomeHero => Boolean(banner));
    }
  }

  let sections: HomeSection[] = [];
  if (input.sections !== undefined && input.sections !== null) {
    if (!Array.isArray(input.sections)) {
      fail(ctx, 'sections', 'must be an array');
    } else if (input.sections.length > 24) {
      fail(ctx, 'sections', 'may hold at most twenty-four sections');
    } else {
      sections = input.sections
        .map((section, index) => parseSection(ctx, `sections[${index}]`, section))
        .filter((section): section is HomeSection => Boolean(section));
    }
  }

  if (ctx.issues.length > 0) return { ok: false, issues: ctx.issues };

  // Duplicate ids would make the merge-by-id story ambiguous, and a duplicate section id would
  // make React reuse the wrong subtree. Refuse both.
  const sectionIds = new Set<string>();
  for (const section of sections) {
    if (sectionIds.has(section.id)) return { ok: false, issues: [`sections: duplicate id "${section.id}"`] };
    sectionIds.add(section.id);
  }
  const heroIds = new Set<string>();
  for (const banner of hero) {
    if (heroIds.has(banner.id)) return { ok: false, issues: [`hero: duplicate id "${banner.id}"`] };
    heroIds.add(banner.id);
  }

  return {
    ok: true,
    value: {
      schema_version: HOMEPAGE_SCHEMA_VERSION,
      theme: theme!,
      hero,
      sections,
    },
  };
}

/** Validate a `GET /v1/homepage` response. The app calls this before applying anything. */
export function parseHomepageDocument(input: unknown): ParseResult<HomepageDocument> {
  if (!isRecord(input)) return { ok: false, issues: ['document: must be an object'] };

  const version = input.version;
  // Version 0 is legitimate: it is the bundled default page, which has never been published. Any
  // published release starts at 1, so a document claiming 0 can only have come from the app itself.
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { ok: false, issues: ['version: must be a non-negative integer'] };
  }

  const publishedAt = typeof input.published_at === 'string' ? new Date(input.published_at) : null;
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) {
    return { ok: false, issues: ['published_at: must be a timestamp'] };
  }

  const config = parseHomepageConfig(input);
  if (!config.ok) return config;

  let campaign: HomepageCampaignMeta | null = null;
  if (input.campaign !== undefined && input.campaign !== null) {
    const raw = input.campaign;
    if (!isRecord(raw)) return { ok: false, issues: ['campaign: must be an object or null'] };
    const id = typeof raw.id === 'string' && UUID.test(raw.id) ? raw.id : null;
    const name = typeof raw.name === 'string' ? raw.name.slice(0, 64) : null;
    const startsAt = typeof raw.starts_at === 'string' ? new Date(raw.starts_at) : null;
    const endsAt = typeof raw.ends_at === 'string' ? new Date(raw.ends_at) : null;
    if (!id || !name || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return { ok: false, issues: ['campaign: is missing id, name or its window'] };
    }
    campaign = {
      id,
      name,
      version: typeof raw.version === 'number' ? raw.version : 0,
      priority: typeof raw.priority === 'number' ? raw.priority : 0,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    };
  }

  const refresh =
    typeof input.refresh_after_seconds === 'number' && input.refresh_after_seconds >= 30
      ? Math.min(input.refresh_after_seconds, 86_400)
      : 300;

  return {
    ok: true,
    value: {
      schema_version: HOMEPAGE_SCHEMA_VERSION,
      version,
      published_at: publishedAt.toISOString(),
      generated_at:
        typeof input.generated_at === 'string' && !Number.isNaN(new Date(input.generated_at).getTime())
          ? new Date(input.generated_at).toISOString()
          : new Date().toISOString(),
      expires_at: campaign ? campaign.ends_at : null,
      campaign,
      theme: config.value.theme,
      hero: config.value.hero,
      sections: config.value.sections,
      refresh_after_seconds: refresh,
    },
  };
}

// ---------------------------------------------------------------------------- resolution

function isWithinWindow(startsAt: string | undefined, endsAt: string | undefined, now: Date): boolean {
  if (startsAt && now < new Date(startsAt)) return false;
  if (endsAt && now >= new Date(endsAt)) return false;
  return true;
}

/** Sections that should render right now: enabled, inside their own window, in order. */
export function visibleSections(config: HomepageConfig, now: Date = new Date()): HomeSection[] {
  return config.sections
    .filter((section) => section.enabled && isWithinWindow(section.starts_at, section.ends_at, now))
    .slice()
    .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order));
}

/** Hero banners that should render right now. */
export function visibleHeroes(config: HomepageConfig, now: Date = new Date()): HomeHero[] {
  return config.hero.filter((banner) => isWithinWindow(banner.active_from, banner.active_until, now));
}

/**
 * Apply a campaign over the base homepage.
 *
 * Rules, in order:
 *  - theme keys are merged, campaign wins where it sets one;
 *  - a non-empty campaign hero list replaces the base carousel entirely;
 *  - a non-empty campaign section list replaces the base list entirely (the console seeds the
 *    editor from the current base, so an editor always sees the whole page, never a puzzle).
 */
export function mergeCampaign(base: HomepageConfig, campaign: HomepageConfig | null | undefined): HomepageConfig {
  if (!campaign) return base;

  const theme: HomeTheme = { ...base.theme };
  for (const [key, value] of Object.entries(campaign.theme)) {
    if (value !== undefined && value !== null) {
      (theme as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return {
    schema_version: HOMEPAGE_SCHEMA_VERSION,
    theme,
    hero: campaign.hero.length > 0 ? campaign.hero : base.hero,
    sections: campaign.sections.length > 0 ? campaign.sections : base.sections,
  };
}

/** True when a published campaign window contains `now`. */
export function isCampaignLive(
  campaign: { starts_at: string; ends_at: string },
  now: Date = new Date(),
): boolean {
  const start = new Date(campaign.starts_at);
  const end = new Date(campaign.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return now >= start && now < end;
}

/**
 * Has a cached document outlived its campaign?
 *
 * A phone that has been offline for a week must not keep showing Diwali. The grace period absorbs
 * clock skew and the moment between the campaign ending and the next successful refresh.
 */
export function isStaleCampaign(doc: HomepageDocument, now: Date = new Date(), graceMs = 6 * 60 * 60 * 1000): boolean {
  if (!doc.campaign) return false;
  const end = new Date(doc.campaign.ends_at);
  if (Number.isNaN(end.getTime())) return true;
  return now.getTime() > end.getTime() + graceMs;
}

// ---------------------------------------------------------------------------- default page

/**
 * The page the app ships with and the page a fresh database is seeded with.
 *
 * This is the *only* definition of the default homepage. The API seeds it on boot when the CMS has
 * never been published, and the app renders it when the network and the cache both fail — so the
 * two can never drift apart.
 */
export function defaultHomepageConfig(): HomepageConfig {
  return {
    schema_version: HOMEPAGE_SCHEMA_VERSION,
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
    hero: [
      {
        id: 'default-hero',
        eyebrow: 'PARCEL YATRA',
        headline: 'Your parcel. Their journey.',
        subtitle: 'Send it with someone already going your way.',
        trust_badges: ['ID-verified travellers', 'Up to 5 kg'],
        cta: { label: 'Send a parcel', action: { kind: 'send' } },
      },
    ],
    sections: [
      {
        id: 'parcel-categories',
        type: 'category_grid',
        enabled: true,
        order: 10,
        // The grid is the most-used control on the page, so it opens without a heading.
        items: [
          {
            id: 'grid-documents',
            title: 'Documents',
            category: 'documents',
            icon: 'document-text-outline',
            action: { kind: 'send', category: 'documents' },
          },
          {
            id: 'grid-certificates',
            title: 'Certificates',
            category: 'educational_certificates',
            icon: 'school-outline',
            action: { kind: 'send', category: 'educational_certificates' },
          },
          {
            id: 'grid-samples',
            title: 'Samples',
            category: 'business_samples',
            icon: 'briefcase-outline',
            action: { kind: 'send', category: 'business_samples' },
          },
          {
            id: 'grid-cosmetics',
            title: 'Cosmetics',
            category: 'cosmetics_sealed',
            icon: 'sparkles-outline',
            action: { kind: 'send', category: 'cosmetics_sealed' },
          },
          {
            id: 'grid-printed',
            title: 'Printed',
            category: 'printed_material',
            icon: 'newspaper-outline',
            action: { kind: 'send', category: 'printed_material' },
          },
          {
            id: 'grid-puja',
            title: 'Puja items',
            category: 'religious_items',
            icon: 'flower-outline',
            action: { kind: 'send', category: 'religious_items' },
          },
        ],
      },
      {
        id: 'offers',
        type: 'promo_cards',
        enabled: true,
        order: 20,
        title: 'Send something that matters',
        subtitle: 'Hand to hand, code verified at both ends.',
        items: [
          {
            id: 'offer-documents',
            title: 'Documents, hand to hand',
            body: 'Sealed, tracked and confirmed with a code at pickup and delivery.',
            badge: 'POPULAR',
            action: { kind: 'send', category: 'documents' },
          },
          {
            id: 'offer-carry',
            title: 'Going that way?',
            body: 'Carry a parcel on your next trip and earn from the space you already have.',
            badge: 'EARN',
            action: { kind: 'route', route: '/trips/new' },
          },
          {
            id: 'offer-business',
            title: 'Samples between cities',
            body: 'Sell-side samples and printed material, carried by verified travellers.',
            badge: 'BUSINESS',
            action: { kind: 'route', route: '/info/business' },
          },
          {
            id: 'offer-track',
            title: 'Already booked?',
            body: 'Every handover, message and code stays in one place.',
            badge: 'TRACK',
            action: { kind: 'route', route: '/bookings' },
          },
          {
            id: 'offer-help',
            title: 'Help and safety',
            body: 'What can be sent, how handovers work and how to reach a person.',
            badge: 'SUPPORT',
            action: { kind: 'route', route: '/info/safety' },
          },
        ],
      },
      {
        id: 'popular-routes',
        type: 'popular_routes',
        enabled: true,
        order: 30,
        title: 'Popular inter-city routes',
        subtitle: 'Compare verified travellers already driving these corridors.',
        items: [
          {
            id: 'route-blr-del',
            title: 'Bareilly to Delhi',
            origin: 'Bareilly',
            dest: 'Delhi',
            body: 'Compare verified travellers on this route.',
            icon: 'navigate-outline',
          },
          {
            id: 'route-del-blr',
            title: 'Delhi to Bareilly',
            origin: 'Delhi',
            dest: 'Bareilly',
            body: 'Compare verified travellers on this route.',
            icon: 'navigate-outline',
          },
          {
            id: 'route-blr-lko',
            title: 'Bareilly to Lucknow',
            origin: 'Bareilly',
            dest: 'Lucknow',
            body: 'Compare verified travellers on this route.',
            icon: 'navigate-outline',
          },
        ],
      },
      {
        id: 'how-it-works',
        type: 'how_it_works',
        enabled: true,
        order: 50,
        title: 'Three steps, both sides protected',
        items: [
          {
            id: 'step-1',
            title: 'Post the parcel',
            body: 'Route, pickup window and what is inside. Your price is fixed before you choose.',
          },
          {
            id: 'step-2',
            title: 'Pick a traveller',
            body: 'See who is already going, their ID status and completed trips.',
          },
          {
            id: 'step-3',
            title: 'Hand over with a code',
            body: 'One code at pickup, another at delivery. Chat stays attached to the booking.',
          },
        ],
      },
      {
        id: 'trust',
        type: 'trust',
        enabled: true,
        order: 60,
        title: 'Built so neither side is guessing',
        items: [
          { id: 'trust-id', title: 'ID-verified travellers', body: 'One photo ID and a selfie, checked by a person.', icon: 'shield-checkmark-outline' },
          { id: 'trust-codes', title: 'A code at each end', body: 'Nothing changes hands without a handover code.', icon: 'key-outline' },
          { id: 'trust-photo', title: 'Seal photographed', body: 'Both sides keep a record of how it left.', icon: 'checkmark-circle-outline' },
        ],
      },
      {
        id: 'carry-promo',
        type: 'carry_promo',
        enabled: true,
        order: 70,
        title: 'Going that way anyway?',
        subtitle: 'Publish your drive and earn from the space in your boot.',
        action: { kind: 'route', route: '/trips/new' },
      },
      {
        id: 'business-promo',
        type: 'business_promo',
        enabled: true,
        order: 80,
        title: 'Shipping for your shop',
        subtitle: 'Documents, samples and printed material between cities, carried by people already going.',
        action: { kind: 'route', route: '/info/business' },
      },
      {
        id: 'announcements',
        type: 'announcements',
        enabled: true,
        order: 90,
        items: [],
      },
    ],
  };
}

/** A document wrapper for the bundled default, so the app can use one code path for both sources. */
export function defaultHomepageDocument(now: Date = new Date()): HomepageDocument {
  const config = defaultHomepageConfig();
  return {
    schema_version: HOMEPAGE_SCHEMA_VERSION,
    version: 0,
    published_at: now.toISOString(),
    generated_at: now.toISOString(),
    expires_at: null,
    campaign: null,
    theme: config.theme,
    hero: config.hero,
    sections: config.sections,
    refresh_after_seconds: 300,
  };
}

/** Build the absolute URL for an uploaded homepage asset. */
export function homepageMediaUrl(apiBase: string, mediaId: string): string {
  if (!UUID.test(mediaId)) throw new Error('invalid media id');
  return `${apiBase.replace(/\/$/, '')}/homepage/media/${mediaId}`;
}
