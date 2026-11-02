/**
 * The homepage editor.
 *
 * It edits the same `HomepageConfig` the API validates and the app renders, field by field, with no
 * free-form JSON and no HTML. Every control is bounded by the contract's allowlists — the routes, the
 * icons and the decorations are the ones the app knows how to draw.
 *
 * The editor is deliberately not optimistic: it hands a complete new config to its parent on every
 * change, and the parent decides when to save. That keeps "what am I about to publish" a single
 * object rather than a pile of local state that can disagree with itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  HOMEPAGE_PRESETS,
  HOME_DECOR,
  HOME_ICONS,
  HOME_ROUTES,
  applyHomepagePreset,
  parseHomepageConfig,
  type HomeAction,
  type HomeDecor,
  type HomeGradient,
  type HomeHero,
  type HomeItem,
  type HomeRoute,
  type HomeSection,
  type HomeSectionType,
  type HomeTheme,
  type HomepageConfig,
} from '@py/domain';

import {
  ITEM_SECTIONS,
  SECTION_TYPE_LABELS,
  TIME_ZONES,
  emptyHero,
  emptyItem,
  emptySection,
  isoToZoned,
  newId,
  orderForIndex,
  reorderSections,
  sortedSections,
  zonedToIso,
} from '../lib/homepage';
import { Button, Field, Select, TextArea, TextInput, cn } from './ui';

const ROUTE_LABELS: Partial<Record<HomeRoute, string>> = {
  '/send': 'Send a parcel',
  '/bookings': 'Bookings and tracking',
  '/trips': 'Carry & earn',
  '/trips/new': 'Publish a trip',
  '/help': 'Help & safety',
  '/notifications': 'Notifications',
  '/inbox': 'Inbox',
  '/profile': 'Profile',
  '/verification': 'Verification',
  '/info/pricing': 'Info: pricing',
  '/info/prohibited': 'Info: prohibited items',
  '/info/safety': 'Info: safety',
  '/info/business': 'Info: business shipping',
  '/info/grievance': 'Info: grievance',
};

function routeLabel(route: HomeRoute): string {
  return ROUTE_LABELS[route] ?? route;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

type ThemeColorKey =
  | 'brand'
  | 'brand_dark'
  | 'brand_soft'
  | 'navy'
  | 'accent'
  | 'canvas'
  | 'surface'
  | 'partner'
  | 'hero_text'
  | 'hero_muted'
  | 'badge_background'
  | 'badge_text';

interface EditorProps {
  config: HomepageConfig;
  onChange: (next: HomepageConfig) => void;
  disabled?: boolean;
  /** Uploads bytes to our storage and returns the media URL the API will accept. */
  onUpload: (file: File) => Promise<string>;
  /** The zone used for `datetime-local` fields. */
  timeZone: string;
}

export function HomepageEditor({ config, onChange, disabled = false, onUpload, timeZone }: EditorProps) {
  const sections = useMemo(() => sortedSections(config), [config]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function setTheme(next: HomeTheme): void {
    onChange({ ...config, theme: next });
  }

  function setHeroes(next: HomeHero[]): void {
    onChange({ ...config, hero: next });
  }

  function setSections(next: HomeSection[]): void {
    onChange({ ...config, sections: next });
  }

  return (
    <div className="space-y-4">
      <PresetBar config={config} disabled={disabled} onApply={onChange} />

      <PaletteEditor theme={config.theme} onChange={setTheme} disabled={disabled} />

      <section className="rounded-card border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Hero banners</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              {config.hero.length} banner{config.hero.length === 1 ? '' : 's'} · the first one is what
              everybody sees.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || config.hero.length >= 6}
            onClick={() => setHeroes([...config.hero, emptyHero()])}
          >
            Add banner
          </Button>
        </header>
        <div className="space-y-3 p-4 sm:p-5">
          {config.hero.length === 0 ? (
            <p className="text-sm text-danger-600">
              A page needs at least one banner. Add one before saving.
            </p>
          ) : null}
          {config.hero.map((hero, index) => (
            <HeroCard
              key={hero.id}
              hero={hero}
              index={index}
              count={config.hero.length}
              disabled={disabled}
              timeZone={timeZone}
              onUpload={onUpload}
              onChange={(next) => setHeroes(config.hero.map((item) => (item.id === hero.id ? next : item)))}
              onMove={(direction) => {
                const target = index + direction;
                if (target < 0 || target >= config.hero.length) return;
                const next = config.hero.slice();
                const [moved] = next.splice(index, 1);
                if (!moved) return;
                next.splice(target, 0, moved);
                setHeroes(next);
              }}
              onRemove={() => setHeroes(config.hero.filter((item) => item.id !== hero.id))}
            />
          ))}
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Sections</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              {sections.length} section{sections.length === 1 ? '' : 's'} · rendered in this order, top
              to bottom. The header, hero and search bar are fixed.
            </p>
          </div>
        </header>
        <div className="space-y-2 p-4 sm:p-5">
          {sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              index={index}
              count={sections.length}
              disabled={disabled}
              timeZone={timeZone}
              onUpload={onUpload}
              dragging={dragIndex === index}
              dragActive={dragIndex !== null}
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              onDropBefore={() => {
                if (dragIndex === null || dragIndex === index) return setDragIndex(null);
                setSections(reorderSections(sections, dragIndex, index));
                setDragIndex(null);
              }}
              onChange={(next) =>
                setSections(
                  config.sections.map((item) => (item.id === section.id ? { ...next, order: section.order } : item)),
                )
              }
              onMove={(direction) => {
                const target = index + direction;
                setSections(reorderSections(sections, index, target));
              }}
              onRemove={() => setSections(config.sections.filter((item) => item.id !== section.id))}
            />
          ))}

          <AddSection
            disabled={disabled}
            onAdd={(type) => {
              const next = emptySection(type, orderForIndex(sections.length));
              setSections([...config.sections, next]);
            }}
          />
        </div>
      </section>

      <RawJsonEditor config={config} disabled={disabled} onChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------- presets

function PresetBar({
  config,
  disabled,
  onApply,
}: {
  config: HomepageConfig;
  disabled: boolean;
  onApply: (next: HomepageConfig) => void;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-ink-900">Start from a preset</h3>
      <p className="mt-0.5 text-xs text-ink-500">
        A preset replaces the hero and palette. The section layout and its items stay exactly as they
        are.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {HOMEPAGE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant="secondary"
            size="sm"
            title={preset.description}
            disabled={disabled}
            onClick={() => onApply(applyHomepagePreset(preset, config))}
          >
            {preset.name}
          </Button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- raw JSON

/**
 * The escape hatch for an editor who would rather paste a prepared configuration.
 *
 * It is not a bypass: the text is parsed by the same `parseHomepageConfig` the API applies, with
 * unknown section types refused, so a pasted file that types cleanly in this box cannot fail on
 * publish. The error list is the validator's own paths, not a generic "invalid JSON".
 */
function RawJsonEditor({
  config,
  disabled,
  onChange,
}: {
  config: HomepageConfig;
  disabled: boolean;
  onChange: (next: HomepageConfig) => void;
}) {
  const serialized = useMemo(() => JSON.stringify(config, null, 2), [config]);
  const [text, setText] = useState(serialized);
  const [edited, setEdited] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!edited) setText(serialized);
  }, [serialized, edited]);

  function apply(): void {
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setIssues([`Not valid JSON: ${(error as Error).message}`]);
      return;
    }
    const result = parseHomepageConfig(parsed, { strictUnknownSections: true });
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    setEdited(false);
    setNotice('Applied. Save the draft to keep it.');
    onChange(result.value);
  }

  return (
    <details className="rounded-card border border-line bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 sm:px-5">
        <span className="text-sm font-semibold text-ink-900">Raw JSON</span>
        <span className="mt-0.5 block text-xs text-ink-500">
          Paste or copy the full configuration. Validated against the same contract as the API.
        </span>
      </summary>
      <div className="space-y-2 border-t border-line p-4 sm:p-5">
        <TextArea
          rows={18}
          value={text}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            setEdited(true);
            setNotice(null);
          }}
          className="font-mono text-xs"
        />
        {issues.length ? (
          <ul className="space-y-1 rounded-input bg-danger-50 p-3 text-xs text-danger-700">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        {notice ? <p className="text-xs text-success-700">{notice}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            disabled={disabled || !edited}
            onClick={() => {
              setText(serialized);
              setEdited(false);
              setIssues([]);
              setNotice(null);
            }}
          >
            Revert
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={disabled || !edited} onClick={apply}>
            Apply JSON
          </Button>
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------- palette

const THEME_COLOURS: Array<{ key: ThemeColorKey; label: string; hint?: string }> = [
  { key: 'brand', label: 'Brand', hint: 'Primary action colour' },
  { key: 'brand_dark', label: 'Brand dark', hint: 'Text on soft brand surfaces' },
  { key: 'brand_soft', label: 'Brand soft', hint: 'Tinted background' },
  { key: 'navy', label: 'Ink', hint: 'Headings and icons' },
  { key: 'accent', label: 'Accent', hint: 'Badges and festival highlights' },
  { key: 'canvas', label: 'Page background' },
  { key: 'surface', label: 'Card surface' },
  { key: 'partner', label: 'Partner (Carry & Earn)' },
  { key: 'hero_text', label: 'Hero text' },
  { key: 'hero_muted', label: 'Hero subtitle' },
  { key: 'badge_background', label: 'Badge background' },
  { key: 'badge_text', label: 'Badge text' },
];

function PaletteEditor({
  theme,
  onChange,
  disabled,
}: {
  theme: HomeTheme;
  onChange: (next: HomeTheme) => void;
  disabled: boolean;
}) {
  const stops: string[] = theme.gradient ?? theme.hero_gradient ?? ['#0b3bff', '#1230c8'];
  const from = stops[0] ?? '#0b3bff';
  const to = stops[stops.length - 1] ?? '#061a7a';
  const middle = stops.length >= 3 ? (stops[1] ?? '') : '';
  const decor: HomeDecor =
    theme.decor ?? (theme.decoration === 'lamp' ? 'lights' : theme.decoration === 'confetti' ? 'confetti' : 'none');

  function setGradient(next: string[]): void {
    onChange({ ...theme, gradient: next as HomeGradient, hero_gradient: undefined });
  }

  function setColour(key: ThemeColorKey, value: string): void {
    const next: HomeTheme = { ...theme };
    if (value.trim()) next[key] = value.trim().toLowerCase();
    else delete next[key];
    onChange(next);
  }

  return (
    <details className="rounded-card border border-line bg-surface" open>
      <summary className="cursor-pointer list-none px-4 py-3 sm:px-5">
        <span className="text-sm font-semibold text-ink-900">Theme and palette</span>
        <span className="mt-0.5 block text-xs text-ink-500">
          {theme.name || 'Unnamed'} · {theme.key || 'no key'} · a campaign may override any of these.
        </span>
      </summary>
      <div className="space-y-4 border-t border-line p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Theme key" hint="Stable slug, e.g. diwali-2026. Letters, digits and dashes.">
            <TextInput
              value={theme.key}
              disabled={disabled}
              maxLength={48}
              onChange={(event) => onChange({ ...theme, key: event.target.value.trim().toLowerCase() })}
            />
          </Field>
          <Field label="Display name" hint="Shown in this console only.">
            <TextInput
              value={theme.name}
              disabled={disabled}
              maxLength={80}
              onChange={(event) => onChange({ ...theme, name: event.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEME_COLOURS.map((colour) => (
            <ColourField
              key={colour.key}
              label={colour.label}
              hint={colour.hint}
              value={theme[colour.key] ?? ''}
              disabled={disabled}
              onChange={(value) => setColour(colour.key, value)}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <ColourField
            label="Hero gradient · from"
            value={from}
            disabled={disabled}
            onChange={(value) => setGradient([value || '#0b3bff', ...(middle ? [middle] : []), to])}
          />
          <ColourField
            label="Hero gradient · middle"
            hint="Optional. Leave empty for a two-stop wash."
            value={middle}
            disabled={disabled}
            onChange={(value) =>
              setGradient(value ? [from, value, to] : [from, to])
            }
          />
          <ColourField
            label="Hero gradient · to"
            value={to}
            disabled={disabled}
            onChange={(value) => setGradient([from, ...(middle ? [middle] : []), value || '#061a7a'])}
          />
        </div>

        <Field label="Decoration" hint="Drawn behind the hero copy. Never an image or markup.">
          <Select
            value={decor}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...theme,
                decor: event.target.value as HomeDecor,
                decoration: undefined,
              })
            }
          >
            {HOME_DECOR.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------- hero

function HeroCard({
  hero,
  index,
  count,
  disabled,
  timeZone,
  onChange,
  onMove,
  onRemove,
  onUpload,
}: {
  hero: HomeHero;
  index: number;
  count: number;
  disabled: boolean;
  timeZone: string;
  onChange: (next: HomeHero) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onUpload: (file: File) => Promise<string>;
}) {
  const gradient = hero.gradient ?? ['#0a1730', '#0a57ff'];

  function set<K extends keyof HomeHero>(key: K, value: HomeHero[K] | undefined): void {
    const next: HomeHero = { ...hero };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value as HomeHero[K];
    onChange(next);
  }

  return (
    <details className="rounded-input border border-line bg-canvas/40">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600/10 text-xs font-semibold text-brand-700">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
          {hero.headline || 'Untitled banner'}
        </span>
        <span className="hidden truncate text-xs text-ink-500 sm:block">{hero.eyebrow}</span>
      </summary>

      <div className="space-y-3 border-t border-line p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Headline" hint="Up to three lines on a phone.">
            <TextInput
              value={hero.headline}
              disabled={disabled}
              maxLength={90}
              onChange={(event) => set('headline', event.target.value)}
            />
          </Field>
          <Field label="Eyebrow" optional hint="Small label above the headline.">
            <TextInput
              value={hero.eyebrow ?? ''}
              disabled={disabled}
              maxLength={40}
              onChange={(event) => set('eyebrow', event.target.value)}
            />
          </Field>
        </div>

        <Field label="Subtitle" optional>
          <TextArea
            rows={2}
            value={hero.subtitle ?? ''}
            disabled={disabled}
            maxLength={160}
            onChange={(event) => set('subtitle', event.target.value)}
          />
        </Field>

        <Field label="Trust badges" optional hint="Comma separated, e.g. ID-verified travellers, Up to 5 kg.">
          <TextInput
            value={(hero.trust_badges ?? []).join(', ')}
            disabled={disabled}
            onChange={(event) => {
              const badges = event.target.value
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
                .slice(0, 4);
              set('trust_badges', badges.length ? badges : undefined);
            }}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Button label" optional>
            <TextInput
              value={hero.cta?.label ?? ''}
              disabled={disabled}
              maxLength={30}
              onChange={(event) =>
                onChange({
                  ...hero,
                  ...(event.target.value.trim()
                    ? {
                        cta: {
                          label: event.target.value,
                          action: hero.cta?.action ?? { kind: 'send' },
                        },
                      }
                    : { cta: undefined }),
                })
              }
            />
          </Field>
          <ActionField
            label="Button action"
            value={hero.cta?.action}
            disabled={disabled || !hero.cta}
            onChange={(action) =>
              onChange({
                ...hero,
                cta: { label: hero.cta?.label ?? 'Send a parcel', action: action ?? { kind: 'send' } },
              })
            }
          />
        </div>

        <MediaField
          label="Artwork"
          value={hero.image_url}
          disabled={disabled}
          onUpload={onUpload}
          onChange={(url) => set('image_url', url)}
          hint="Optional. Without artwork the gradient below is used."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <ColourField
            label="Gradient · from"
            value={gradient[0]}
            disabled={disabled || Boolean(hero.image_url)}
            onChange={(value) => onChange({ ...hero, gradient: [value || '#0a1730', gradient[1]] })}
          />
          <ColourField
            label="Gradient · to"
            value={gradient[1]}
            disabled={disabled || Boolean(hero.image_url)}
            onChange={(value) => onChange({ ...hero, gradient: [gradient[0], value || '#0a57ff'] })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <ColourField
            label="Text colour"
            value={hero.text_color ?? ''}
            disabled={disabled}
            onChange={(value) => set('text_color', value || undefined)}
          />
          <InstantField
            label="Countdown to"
            value={hero.countdown_to}
            disabled={disabled}
            timeZone={timeZone}
            onChange={(iso) => set('countdown_to', iso ?? undefined)}
          />
          <div className="grid gap-2 sm:col-span-1">
            <InstantField
              label="Show from"
              value={hero.active_from}
              disabled={disabled}
              timeZone={timeZone}
              onChange={(iso) => set('active_from', iso ?? undefined)}
            />
            <InstantField
              label="Show until"
              value={hero.active_until}
              disabled={disabled}
              timeZone={timeZone}
              onChange={(iso) => set('active_until', iso ?? undefined)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          >
            Move up
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
          >
            Move down
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={disabled || count <= 1}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------- sections

function SectionCard({
  section,
  index,
  count,
  disabled,
  timeZone,
  dragging,
  dragActive,
  onChange,
  onMove,
  onRemove,
  onUpload,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  section: HomeSection;
  index: number;
  count: number;
  disabled: boolean;
  timeZone: string;
  dragging: boolean;
  dragActive: boolean;
  onChange: (next: HomeSection) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onUpload: (file: File) => Promise<string>;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  const usesItems = ITEM_SECTIONS.has(section.type);

  function set<K extends keyof HomeSection>(key: K, value: HomeSection[K] | undefined): void {
    const next: HomeSection = { ...section };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value as HomeSection[K];
    onChange(next);
  }

  return (
    <details
      onDragOver={(event) => {
        if (disabled || !dragActive) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        if (disabled || !dragActive) return;
        event.preventDefault();
        onDropBefore();
      }}
      className={cn(
        'rounded-input border bg-surface',
        section.enabled ? 'border-line' : 'border-dashed border-line-strong opacity-70',
        dragging && 'border-brand-600 ring-2 ring-brand-600/20',
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
        <span
          role="button"
          tabIndex={-1}
          aria-label="Drag to reorder"
          draggable={!disabled}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', section.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="cursor-grab px-1 text-ink-300 select-none active:cursor-grabbing"
        >
          ⋮⋮
        </span>
        <span className="w-6 shrink-0 text-center text-xs font-semibold text-ink-500">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">
            {section.title || SECTION_TYPE_LABELS[section.type]}
          </span>
          <span className="block truncate text-xs text-ink-500">
            {SECTION_TYPE_LABELS[section.type]} · {section.id}
            {section.enabled ? '' : ' · hidden'}
          </span>
        </span>
      </summary>

      <div className="space-y-3 border-t border-line p-3">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={section.enabled}
              disabled={disabled}
              onChange={(event) => onChange({ ...section, enabled: event.target.checked })}
            />
            Visible on the homepage
          </label>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              disabled={disabled || index === 0}
              onClick={() => onMove(-1)}
            >
              Move up
            </Button>
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              disabled={disabled || index === count - 1}
              onClick={() => onMove(1)}
            >
              Move down
            </Button>
            <Button type="button" variant="danger" size="sm" disabled={disabled} onClick={onRemove}>
              Remove
            </Button>
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Heading" optional>
            <TextInput
              value={section.title ?? ''}
              disabled={disabled}
              maxLength={60}
              onChange={(event) => set('title', event.target.value)}
            />
          </Field>
          <Field label="Subheading" optional>
            <TextInput
              value={section.subtitle ?? ''}
              disabled={disabled}
              maxLength={120}
              onChange={(event) => set('subtitle', event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <ColourField
            label="Background"
            value={section.background ?? ''}
            disabled={disabled}
            onChange={(value) => set('background', value || undefined)}
          />
          <ColourField
            label="Text"
            value={section.text_color ?? ''}
            disabled={disabled}
            onChange={(value) => set('text_color', value || undefined)}
          />
          <ColourField
            label="Accent"
            value={section.accent_color ?? ''}
            disabled={disabled}
            onChange={(value) => set('accent_color', value || undefined)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <MediaField
            label="Artwork"
            value={section.image_url}
            disabled={disabled}
            onUpload={onUpload}
            onChange={(url) => set('image_url', url)}
            hint="Used by the campaign banner. Other sections ignore it."
          />
          <ActionField
            label="Section action"
            value={section.action}
            disabled={disabled}
            onChange={(action) => set('action', action)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <InstantField
            label="Show from"
            value={section.starts_at}
            disabled={disabled}
            timeZone={timeZone}
            onChange={(iso) => set('starts_at', iso ?? undefined)}
          />
          <InstantField
            label="Show until"
            value={section.ends_at}
            disabled={disabled}
            timeZone={timeZone}
            onChange={(iso) => set('ends_at', iso ?? undefined)}
          />
        </div>

        {usesItems ? (
          <ItemsEditor
            type={section.type}
            items={section.items ?? []}
            disabled={disabled}
            onUpload={onUpload}
            onChange={(items) => onChange({ ...section, items })}
          />
        ) : null}
      </div>
    </details>
  );
}

function AddSection({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (type: HomeSectionType) => void;
}) {
  const [type, setType] = useState<HomeSectionType>('promo_cards');
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-input border border-dashed border-line-strong p-3">
      <div className="min-w-[200px] flex-1">
        <Field label="Add a section">
          <Select
            value={type}
            disabled={disabled}
            onChange={(event) => setType(event.target.value as HomeSectionType)}
          >
            {(Object.keys(SECTION_TYPE_LABELS) as HomeSectionType[]).map((option) => (
              <option key={option} value={option}>
                {SECTION_TYPE_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => onAdd(type)}>
        Add
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------- items

function ItemsEditor({
  type,
  items,
  disabled,
  onUpload,
  onChange,
}: {
  type: HomeSectionType;
  items: HomeItem[];
  disabled: boolean;
  onUpload: (file: File) => Promise<string>;
  onChange: (next: HomeItem[]) => void;
}) {
  const showsRoutePair = type === 'popular_routes';

  function update(id: string, patch: Partial<HomeItem>): void {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  return (
    <div className="rounded-input bg-canvas/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
          Items ({items.length})
        </span>
        <Button
          type="button"
          variant="tertiary"
          size="sm"
          disabled={disabled || items.length >= 12}
          onClick={() => onChange([...items, emptyItem(type)])}
        >
          Add item
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-ink-500">
          No items yet. A section with no items renders nothing on the phone.
        </p>
      ) : null}

      <div className="space-y-2">
        {items.map((item, index) => (
          <details key={item.id} className="rounded-input border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2">
              <span className="text-xs text-ink-500">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-900">
                {item.title || 'Untitled item'}
              </span>
              {item.badge ? (
                <span className="rounded-full bg-accent-500/20 px-2 py-0.5 text-[10px] font-semibold text-ink-900">
                  {item.badge}
                </span>
              ) : null}
            </summary>
            <div className="space-y-2 border-t border-line p-2.5">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Title">
                  <TextInput
                    value={item.title}
                    disabled={disabled}
                    maxLength={40}
                    onChange={(event) => update(item.id, { title: event.target.value })}
                  />
                </Field>
                <Field label="Badge" optional>
                  <TextInput
                    value={item.badge ?? ''}
                    disabled={disabled}
                    maxLength={16}
                    onChange={(event) =>
                      update(item.id, { badge: event.target.value.trim() || undefined })
                    }
                  />
                </Field>
              </div>

              <Field label="Body" optional>
                <TextArea
                  rows={2}
                  value={item.body ?? ''}
                  disabled={disabled}
                  maxLength={120}
                  onChange={(event) => update(item.id, { body: event.target.value || undefined })}
                />
              </Field>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Icon" optional>
                  <Select
                    value={item.icon ?? ''}
                    disabled={disabled}
                    onChange={(event) =>
                      update(item.id, { icon: (event.target.value || undefined) as HomeItem['icon'] })
                    }
                  >
                    <option value="">No icon</option>
                    {HOME_ICONS.map((icon) => (
                      <option key={icon} value={icon}>
                        {icon}
                      </option>
                    ))}
                  </Select>
                </Field>

                {showsRoutePair ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From city">
                      <TextInput
                        value={item.origin ?? ''}
                        disabled={disabled}
                        maxLength={40}
                        onChange={(event) =>
                          update(item.id, { origin: event.target.value || undefined })
                        }
                      />
                    </Field>
                    <Field label="To city">
                      <TextInput
                        value={item.dest ?? ''}
                        disabled={disabled}
                        maxLength={40}
                        onChange={(event) => update(item.id, { dest: event.target.value || undefined })}
                      />
                    </Field>
                  </div>
                ) : (
                  <ActionField
                    label="Tap action"
                    value={item.action}
                    disabled={disabled}
                    onChange={(action) => update(item.id, { action })}
                  />
                )}
              </div>

              <MediaField
                label="Artwork"
                value={item.image_url}
                disabled={disabled}
                onUpload={onUpload}
                onChange={(url) => update(item.id, { image_url: url })}
              />

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}
                >
                  Remove item
                </Button>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- shared fields

function ActionField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: HomeAction | undefined;
  disabled: boolean;
  onChange: (action: HomeAction | undefined) => void;
}) {
  const kind = value?.kind ?? 'none';

  return (
    <div className="space-y-2">
      <Field label={label}>
        <Select
          value={kind}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value as HomeAction['kind'];
            if (next === 'none') onChange(undefined);
            else if (next === 'send') onChange({ kind: 'send' });
            else onChange({ kind: 'route', route: '/send' });
          }}
        >
          <option value="none">Does nothing</option>
          <option value="send">Open the send flow</option>
          <option value="route">Open a screen</option>
        </Select>
      </Field>

      {value?.kind === 'route' ? (
        <Field label="Screen" hint="Only screens the app ships can be chosen.">
          <Select
            value={value.route}
            disabled={disabled}
            onChange={(event) =>
              onChange({ kind: 'route', route: event.target.value as HomeRoute })
            }
          >
            {HOME_ROUTES.map((route) => (
              <option key={route} value={route}>
                {routeLabel(route)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {value?.kind === 'send' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From city" optional hint="Pre-fills pickup.">
            <TextInput
              value={value.origin ?? ''}
              disabled={disabled}
              maxLength={40}
              onChange={(event) =>
                onChange({ ...value, origin: event.target.value || undefined })
              }
            />
          </Field>
          <Field label="Category" optional hint="e.g. documents">
            <TextInput
              value={value.category ?? ''}
              disabled={disabled}
              maxLength={40}
              onChange={(event) =>
                onChange({ ...value, category: event.target.value || undefined })
              }
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function ColourField({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const valid = value === '' || HEX.test(value);
  const swatch = HEX.test(value) ? value : '#ffffff';

  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-ink-700">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={swatch}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded border border-line bg-surface p-0.5 disabled:opacity-50"
        />
        <TextInput
          value={value}
          disabled={disabled}
          placeholder="inherit"
          maxLength={7}
          onChange={(event) => onChange(event.target.value.trim())}
          className={cn('h-9 font-mono text-xs', !valid && 'border-danger-600')}
        />
        {value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange('')}
            className="shrink-0 text-xs text-ink-500 hover:text-ink-900"
          >
            Reset
          </button>
        ) : null}
      </div>
      {!valid ? (
        <p className="text-xs text-danger-600">Use a six-digit hex colour, e.g. #0a57ff.</p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

function InstantField({
  label,
  value,
  disabled,
  timeZone,
  onChange,
}: {
  label: string;
  value: string | undefined;
  disabled: boolean;
  timeZone: string;
  onChange: (iso: string | null) => void;
}) {
  const local = isoToZoned(value, timeZone);
  const zone = TIME_ZONES.find((entry) => entry.value === timeZone)?.label ?? timeZone;

  return (
    <Field label={label} optional hint={value ? `${zone}` : 'Leave empty for always.'}>
      <div className="flex items-center gap-2">
        <TextInput
          type="datetime-local"
          value={local}
          disabled={disabled}
          onChange={(event) => onChange(zonedToIso(event.target.value, timeZone))}
          className="h-9 text-xs"
        />
        {value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="shrink-0 text-xs text-ink-500 hover:text-ink-900"
          >
            Clear
          </button>
        ) : null}
      </div>
    </Field>
  );
}

function MediaField({
  label,
  hint,
  value,
  disabled,
  onUpload,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string | undefined;
  disabled: boolean;
  onUpload: (file: File) => Promise<string>;
  onChange: (url: string | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await onUpload(file);
      onChange(url);
    } catch {
      setError('That image could not be uploaded. Try a PNG or JPEG under 5 MB.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-ink-700">{label}</span>
      <div className="flex items-center gap-2">
        {value ? (
          <img
            src={value}
            alt=""
            className="h-12 w-20 shrink-0 rounded border border-line object-cover"
          />
        ) : (
          <span className="grid h-12 w-20 shrink-0 place-items-center rounded border border-dashed border-line-strong text-[10px] text-ink-300">
            none
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              disabled={disabled || busy}
              onClick={() => onChange(undefined)}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </div>
      {error ? (
        <p className="text-xs text-danger-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** A fresh banner id, exported so the campaign editor can seed a copy of the base page. */
export function newHeroId(): string {
  return newId('hero');
}
