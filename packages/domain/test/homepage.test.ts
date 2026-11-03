/**
 * The homepage contract, tested where it is cheapest to test: pure functions, no database.
 *
 * The properties that matter to the app are all here — what a malformed document does (nothing, it is
 * refused), what an unknown section does (nothing, it is dropped), how a campaign composes over the
 * base page, and when cached festive artwork stops being trusted.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  defaultHomepageConfig,
  defaultHomepageDocument,
  homepageMediaUrl,
  isCampaignLive,
  isStaleCampaign,
  mergeCampaign,
  parseHomepageConfig,
  parseHomepageDocument,
  visibleHeroes,
  visibleSections,
  type HomepageConfig,
} from '../src/homepage.ts';
import { applyHomepagePreset, HOMEPAGE_PRESETS } from '../src/homepage-presets.ts';
import { CATEGORIES } from '../src/enums.ts';

const config = (overrides: Partial<HomepageConfig> = {}): HomepageConfig => ({
  ...defaultHomepageConfig(),
  ...overrides,
});

test('the shipped default page is valid, complete and cheap to parse', () => {
  const parsed = parseHomepageConfig(defaultHomepageConfig());
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.issues.join('; '));
  if (!parsed.ok) return;

  assert.equal(parsed.value.theme.key, 'default');
  assert.equal(parsed.value.hero[0]?.headline, 'Your parcel. Their journey.');
  assert.deepEqual(parsed.value.hero[0]?.trust_badges, ['ID-verified travellers', 'Up to 5 kg']);
  assert.ok(parsed.value.sections.length >= 6);

  // Every default item points at a screen that exists.
  const routes = new Set<string>();
  for (const section of parsed.value.sections) {
    for (const item of section.items ?? []) {
      if (item.action?.kind === 'route') routes.add(item.action.route);
    }
    if (section.action?.kind === 'route') routes.add(section.action.route);
  }
  assert.ok(routes.has('/info/business'));
  assert.ok(routes.has('/bookings'));
});

test('the parser normalises instead of storing whatever it was handed', () => {
  const parsed = parseHomepageConfig({
    schema_version: 1,
    theme: { key: 'default', name: 'Parcel Yatra', future_field: 'ignore me', brand: '#0A57FF' },
    hero: [{ id: 'h', headline: '  Trimmed  ', unknown_key: 1 }],
    sections: [{ id: 's', type: 'trust', enabled: true, order: 3, mystery: { deep: true } }],
    extra_top_level: 'ignored',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.theme.brand, '#0a57ff', 'colours are normalised to lowercase hex');
  assert.equal(parsed.value.hero[0]?.headline, 'Trimmed');
  assert.equal('future_field' in parsed.value.theme, false);
  assert.equal('unknown_key' in (parsed.value.hero[0] ?? {}), false);
  assert.equal('mystery' in (parsed.value.sections[0] ?? {}), false);
  assert.equal('extra_top_level' in parsed.value, false);
});

test('malformed input is refused with a path, not silently emptied', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['not an object', 'nope', /must be an object/],
    ['missing theme', { hero: [], sections: [] }, /theme/],
    ['bad colour', { theme: { key: 'x', name: 'X', brand: 'blue' }, hero: [], sections: [] }, /hex/],
    ['bad schema version', { schema_version: 99, theme: { key: 'x', name: 'X' }, hero: [], sections: [] }, /schema_version/],
    [
      'arbitrary route',
      {
        theme: { key: 'x', name: 'X' },
        hero: [{ id: 'h', headline: 'H', cta: { label: 'Go', action: { kind: 'route', route: 'https://evil.example' } } }],
        sections: [],
      },
      /must be one of/,
    ],
    [
      'foreign image',
      { theme: { key: 'x', name: 'X' }, hero: [{ id: 'h', headline: 'H', image_url: 'https://cdn.example/x.png' }], sections: [] },
      /media library/,
    ],
    [
      'duplicate section ids',
      {
        theme: { key: 'x', name: 'X' },
        hero: [],
        sections: [
          { id: 'same', type: 'trust', order: 1 },
          { id: 'same', type: 'announcements', order: 2 },
        ],
      },
      /duplicate id/,
    ],
  ];

  for (const [label, input, pattern] of cases) {
    const parsed = parseHomepageConfig(input);
    assert.equal(parsed.ok, false, label);
    if (parsed.ok) continue;
    assert.match(parsed.issues.join(' | '), pattern, label);
  }
});

test('an unknown section type is skipped for readers and refused for editors', () => {
  const input = {
    theme: { key: 'x', name: 'X' },
    hero: [{ id: 'h', headline: 'H' }],
    sections: [
      { id: 'keep', type: 'trust', order: 1 },
      { id: 'skip', type: 'hologram', order: 2 },
    ],
  };

  const reader = parseHomepageConfig(input);
  assert.equal(reader.ok, true);
  if (reader.ok) assert.deepEqual(reader.value.sections.map((s) => s.id), ['keep']);

  const editor = parseHomepageConfig(input, { strictUnknownSections: true });
  assert.equal(editor.ok, false);
  if (!editor.ok) assert.match(editor.issues.join(' '), /hologram/);
});

test('visible sections are ordered, filtered by their own window, and stable on ties', () => {
  const now = new Date('2026-10-27T10:00:00.000Z');
  const page = config({
    sections: [
      { id: 'b', type: 'trust', enabled: true, order: 20 },
      { id: 'a', type: 'trust', enabled: true, order: 20 },
      { id: 'first', type: 'announcements', enabled: true, order: 5 },
      { id: 'off', type: 'trust', enabled: false, order: 1 },
      { id: 'later', type: 'trust', enabled: true, order: 30, starts_at: '2026-12-01T00:00:00.000Z' },
      { id: 'gone', type: 'trust', enabled: true, order: 40, ends_at: '2026-10-01T00:00:00.000Z' },
    ],
  });

  assert.deepEqual(
    visibleSections(page, now).map((section) => section.id),
    ['first', 'a', 'b'],
  );

  assert.deepEqual(visibleSections(page, new Date('2026-12-02T00:00:00.000Z')).map((s) => s.id), [
    'first',
    'a',
    'b',
    'later',
  ]);
});

test('hero banners honour their own active window', () => {
  const now = new Date('2026-10-27T10:00:00.000Z');
  const page = config({
    hero: [
      { id: 'always', headline: 'Always' },
      { id: 'future', headline: 'Future', active_from: '2026-11-01T00:00:00.000Z' },
      { id: 'past', headline: 'Past', active_until: '2026-10-01T00:00:00.000Z' },
    ],
  });
  assert.deepEqual(visibleHeroes(page, now).map((banner) => banner.id), ['always']);
});

test('a campaign merges its theme over the base and replaces what it defines', () => {
  const base = config();
  const campaign = config({
    theme: { key: 'diwali', name: 'Diwali', accent: '#f0a500', brand: '#7a1f1f' },
    hero: [{ id: 'diwali-hero', headline: 'Bring home the light.' }],
    sections: [{ id: 'diwali-trust', type: 'trust', enabled: true, order: 1 }],
  });

  const merged = mergeCampaign(base, campaign);
  assert.equal(merged.theme.key, 'diwali');
  assert.equal(merged.theme.accent, '#f0a500');
  assert.equal(merged.theme.brand, '#7a1f1f');
  assert.equal(merged.theme.navy, base.theme.navy, 'unset campaign keys keep the brand value');
  assert.deepEqual(merged.hero.map((banner) => banner.id), ['diwali-hero']);
  assert.deepEqual(merged.sections.map((section) => section.id), ['diwali-trust']);
});

test('a campaign that defines no hero or sections inherits the base page', () => {
  const base = config();
  const themeOnly = config({ theme: { key: 'new-year', name: 'New Year', accent: '#c9a227' }, hero: [], sections: [] });
  const merged = mergeCampaign(base, themeOnly);

  assert.equal(merged.theme.key, 'new-year');
  assert.deepEqual(merged.hero, base.hero);
  assert.deepEqual(merged.sections, base.sections);
});

test('merge is a no-op without a campaign and never mutates the base', () => {
  const base = config();
  const snapshot = JSON.stringify(base);

  assert.deepEqual(mergeCampaign(base, null), base);
  assert.deepEqual(mergeCampaign(base, undefined), base);

  const campaign = config({ theme: { key: 'holi', name: 'Holi', accent: '#e4007c' } });
  const merged = mergeCampaign(base, campaign);
  assert.equal(JSON.stringify(base), snapshot, 'the base config must not be mutated');
  assert.notEqual(merged.theme.accent, base.theme.accent);
});

test('campaign liveness is half-open: start inclusive, end exclusive', () => {
  const window = { starts_at: '2026-10-27T00:00:00.000Z', ends_at: '2026-11-01T00:00:00.000Z' };
  assert.equal(isCampaignLive(window, new Date('2026-10-26T23:59:59.999Z')), false);
  assert.equal(isCampaignLive(window, new Date('2026-10-27T00:00:00.000Z')), true);
  assert.equal(isCampaignLive(window, new Date('2026-10-31T23:59:59.999Z')), true);
  assert.equal(isCampaignLive(window, new Date('2026-11-01T00:00:00.000Z')), false);
  assert.equal(isCampaignLive({ starts_at: 'nope', ends_at: 'nope' }), false);
});

test('a cached campaign is dropped after its window plus a grace period', () => {
  const doc = defaultHomepageDocument(new Date('2026-10-27T10:00:00.000Z'));
  assert.equal(isStaleCampaign(doc), false, 'the default page has no campaign to expire');

  const festive = {
    ...doc,
    campaign: {
      id: '8a1f0f9e-0000-4000-8000-000000000001',
      name: 'Diwali',
      version: 2,
      priority: 10,
      starts_at: '2026-10-20T00:00:00.000Z',
      ends_at: '2026-10-25T00:00:00.000Z',
    },
  };

  const graceMs = 6 * 60 * 60 * 1000;
  assert.equal(isStaleCampaign(festive, new Date('2026-10-25T05:00:00.000Z'), graceMs), false);
  assert.equal(isStaleCampaign(festive, new Date('2026-10-25T06:00:01.000Z'), graceMs), true);
});

test('a document must carry a real version and a real publication time', () => {
  const good = defaultHomepageDocument();
  const parsed = parseHomepageDocument(good);
  assert.equal(parsed.ok, true);

  assert.equal(parseHomepageDocument({ ...good, version: -1 }).ok, false);
  assert.equal(parseHomepageDocument({ ...good, version: 'one' }).ok, false);
  assert.equal(parseHomepageDocument({ ...good, version: 0 }).ok, true, 'the bundled default is version 0');
  assert.equal(parseHomepageDocument({ ...good, published_at: 'yesterday' }).ok, false);
  assert.equal(parseHomepageDocument({ ...good, campaign: { id: 'nope' } }).ok, false);
});

test('the document parser clamps the refresh hint to something a phone can live with', () => {
  const good = defaultHomepageDocument();
  const fast = parseHomepageDocument({ ...good, refresh_after_seconds: 1 });
  assert.equal(fast.ok && fast.value.refresh_after_seconds, 300);

  const slow = parseHomepageDocument({ ...good, refresh_after_seconds: 999_999 });
  assert.equal(slow.ok && slow.value.refresh_after_seconds, 86_400);
});

test('media URLs are built only from a uuid, so a caller cannot smuggle a path', () => {
  const url = homepageMediaUrl('https://api.example/v1/', '8a1f0f9e-0000-4000-8000-000000000001');
  assert.equal(url, 'https://api.example/v1/homepage/media/8a1f0f9e-0000-4000-8000-000000000001');
  assert.throws(() => homepageMediaUrl('https://api.example/v1', '../../etc/passwd'));
});

test('the default page ships a six-tile category grid of offerable categories', () => {
  const page = defaultHomepageConfig();
  const grid = page.sections.find((section) => section.type === 'category_grid');
  assert.ok(grid, 'the grid is part of the default composition');
  assert.equal(grid.items?.length, 6, 'two rows of three');

  for (const item of grid.items ?? []) {
    assert.ok(item.category, `${item.id} pre-selects a category`);
    assert.ok(CATEGORIES.includes(item.category as (typeof CATEGORIES)[number]), `${item.category} is offerable`);
    assert.equal(item.action?.kind, 'send', `${item.id} opens the send flow`);
  }

  // The grid must not offer a category the platform refuses to carry.
  const offered = new Set((grid.items ?? []).map((item) => item.category));
  assert.equal(offered.has('food'), false);
  assert.equal(offered.has('medicine'), false);
});

test('a theme accepts a multi-stop gradient and maps the short decor vocabulary', () => {
  const parsed = parseHomepageConfig({
    theme: {
      key: 'festive',
      name: 'Festive',
      gradient: ['#0B3BFF', '#1230C8', '#061A7A'],
      decor: 'lights',
    },
    hero: [{ id: 'h', headline: 'H' }],
    sections: [],
  });
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.issues.join('; '));
  if (!parsed.ok) return;

  assert.deepEqual(parsed.value.theme.gradient, ['#0b3bff', '#1230c8', '#061a7a']);
  assert.equal(parsed.value.theme.decoration, 'lamp', 'lights is drawn with the lamp primitive');
  assert.equal(parsed.value.theme.decor, undefined, 'the short alias is normalised away');

  const tooMany = parseHomepageConfig({
    theme: { key: 'x', name: 'X', gradient: ['#000000', '#111111', '#222222', '#333333', '#444444'] },
    hero: [],
    sections: [],
  });
  assert.equal(tooMany.ok, false);
});

test('every festival preset is a valid configuration and keeps the base layout', () => {
  const base = defaultHomepageConfig();
  for (const preset of HOMEPAGE_PRESETS) {
    const applied = applyHomepagePreset(preset, base);
    const parsed = parseHomepageConfig(applied);
    assert.equal(parsed.ok, true, `${preset.id}: ${parsed.ok ? '' : parsed.issues.join('; ')}`);
    if (!parsed.ok) continue;

    assert.equal(parsed.value.theme.key, preset.theme.key);
    assert.equal(parsed.value.hero.length, 1);
    assert.equal(parsed.value.hero[0]?.id, `${preset.id}-hero`);
    assert.deepEqual(
      parsed.value.sections.map((section) => section.id),
      base.sections.map((section) => section.id),
      `${preset.id} must not drop the layout`,
    );
  }
});
