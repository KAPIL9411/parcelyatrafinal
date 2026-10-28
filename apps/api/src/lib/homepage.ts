import type { Db } from '../db/client.ts';
import { config } from '../config.ts';
import {
  defaultHomepageConfig,
  mergeCampaign,
  parseHomepageConfig,
  type HomepageConfig,
  type HomepageDocument,
} from '@py/domain';

import { toIso, toIsoOrNull } from './serialize.ts';

/**
 * Resolution of the published homepage.
 *
 * The read path is intentionally boring: one published base document, at most one live campaign, a
 * deterministic merge, and a freshness hint. Everything a client can be told is computed here so the
 * route stays a thin HTTP shell and the tests can call the resolver directly with a fixed clock.
 */

export const PLATFORMS = ['android', 'ios', 'web'] as const;
export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

export type ReleaseKind = 'homepage' | 'campaign';
export type ReleaseStatus = 'draft' | 'published' | 'archived';

export interface ReleaseRow {
  id: string;
  version: number;
  kind: ReleaseKind;
  status: ReleaseStatus;
  name: string;
  config: unknown;
  priority: number;
  platforms: string[];
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  note: string | null;
  created_by: string | null;
  published_by: string | null;
  published_at: Date | string | null;
  rolled_back_from: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = `id, version, kind, status, name, config, priority, platforms, starts_at, ends_at,
  note, created_by, published_by, published_at, rolled_back_from, created_at, updated_at`;

export function releaseView(row: ReleaseRow) {
  return {
    id: row.id,
    version: Number(row.version),
    kind: row.kind,
    status: row.status,
    name: row.name,
    priority: Number(row.priority),
    platforms: row.platforms,
    starts_at: toIsoOrNull(row.starts_at),
    ends_at: toIsoOrNull(row.ends_at),
    note: row.note,
    published_at: toIsoOrNull(row.published_at),
    rolled_back_from: row.rolled_back_from === null ? null : Number(row.rolled_back_from),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

/**
 * The default page is content, not schema, so it is seeded at boot rather than in a migration: the
 * definition lives in `@py/domain` and the app ships the same object as its offline fallback. A
 * migration would have to duplicate it in SQL and the two would drift.
 */
export async function ensureHomepageSeed(db: Db): Promise<void> {
  const config = defaultHomepageConfig();
  await db.query(
    `INSERT INTO homepage_releases (kind, status, name, config, published_at, note)
     VALUES ('homepage', 'published', 'Default homepage', $1::jsonb, now(), 'Seeded default page')
     ON CONFLICT (kind) WHERE kind = 'homepage' AND status = 'published' DO NOTHING`,
    [JSON.stringify(config)],
  );
}

export async function publishedHomepage(db: Db): Promise<ReleaseRow | null> {
  const res = await db.query<ReleaseRow>(
    `SELECT ${COLUMNS} FROM homepage_releases
      WHERE kind = 'homepage' AND status = 'published'
      ORDER BY version DESC LIMIT 1`,
  );
  return res.rows[0] ?? null;
}

export async function homepageDraft(db: Db): Promise<ReleaseRow | null> {
  const res = await db.query<ReleaseRow>(
    `SELECT ${COLUMNS} FROM homepage_releases
      WHERE kind = 'homepage' AND status = 'draft'
      ORDER BY version DESC LIMIT 1`,
  );
  return res.rows[0] ?? null;
}

/**
 * The campaign that applies right now, for this platform.
 *
 * Priority decides; a tie goes to the release published most recently, then to the highest version.
 * The ordering is total, so two overlapping campaigns of equal priority can never produce two
 * different pages for two identical requests.
 */
export async function activeCampaign(db: Db, platform: Platform, at: Date): Promise<ReleaseRow | null> {
  const res = await db.query<ReleaseRow>(
    `SELECT ${COLUMNS} FROM homepage_releases
      WHERE kind = 'campaign'
        AND status = 'published'
        AND starts_at <= $1
        AND ends_at > $1
        AND $2 = ANY (platforms)
      ORDER BY priority DESC, published_at DESC NULLS LAST, version DESC
      LIMIT 1`,
    [at, platform],
  );
  return res.rows[0] ?? null;
}

/** Validated config of a release. A row that no longer parses is treated as absent, never trusted. */
export function releaseConfig(row: ReleaseRow | null): HomepageConfig | null {
  if (!row) return null;
  const parsed = parseHomepageConfig(row.config);
  return parsed.ok ? parsed.value : null;
}

export interface ResolveOptions {
  platform: Platform;
  at?: Date;
  /** Include a specific campaign regardless of its window — used by the console preview. */
  previewCampaign?: ReleaseRow | null;
  previewBase?: ReleaseRow | null;
}

export interface ResolvedHomepage {
  document: HomepageDocument;
  base: ReleaseRow | null;
  campaign: ReleaseRow | null;
}

function refreshSeconds(campaign: ReleaseRow | null, at: Date): number {
  const fallback = 300;
  if (!campaign || !campaign.ends_at) return fallback;
  const ends = new Date(campaign.ends_at).getTime();
  const remaining = Math.round((ends - at.getTime()) / 1000);
  // A campaign that ends in the next few minutes: ask the client back at the boundary, so the
  // festive artwork disappears on time instead of lingering for a whole refresh window.
  if (remaining > 0 && remaining < fallback) return Math.max(30, remaining);
  return fallback;
}

export async function resolveHomepage(db: Db, options: ResolveOptions): Promise<ResolvedHomepage> {
  const at = options.at ?? new Date();

  const base = options.previewBase ?? (await publishedHomepage(db));
  const baseConfig = releaseConfig(base) ?? defaultHomepageConfig();

  const campaign =
    options.previewCampaign !== undefined
      ? options.previewCampaign
      : await activeCampaign(db, options.platform, at);

  const campaignConfig = releaseConfig(campaign);
  const merged = mergeCampaign(baseConfig, campaignConfig);

  // The visible version must move when *anything* visible changes, not only the base page: a
  // campaign publish is a new configuration even though the base row is untouched.
  const versions = [base ? Number(base.version) : 0, campaignConfig && campaign ? Number(campaign.version) : 0];
  const version = Math.max(...versions);
  const publishedAt =
    campaignConfig && campaign
      ? toIso(campaign.published_at ?? campaign.updated_at)
      : base
        ? toIso(base.published_at ?? base.updated_at)
        : at.toISOString();

  const document: HomepageDocument = {
    schema_version: 1,
    version,
    published_at: publishedAt,
    generated_at: at.toISOString(),
    expires_at: campaign && campaign.ends_at ? toIso(campaign.ends_at) : null,
    campaign:
      campaign && campaignConfig
        ? {
            id: campaign.id,
            name: campaign.name,
            version: Number(campaign.version),
            priority: Number(campaign.priority),
            starts_at: toIso(campaign.starts_at ?? at),
            ends_at: toIso(campaign.ends_at ?? at),
          }
        : null,
    theme: merged.theme,
    hero: merged.hero,
    sections: merged.sections,
    refresh_after_seconds: refreshSeconds(campaignConfig ? campaign : null, at),
  };

  return { document, base, campaign: campaignConfig ? campaign : null };
}

export async function homepageHistory(db: Db, limit = 20): Promise<ReleaseRow[]> {
  const res = await db.query<ReleaseRow>(
    `SELECT ${COLUMNS} FROM homepage_releases
      WHERE kind = 'homepage' AND status <> 'draft'
      ORDER BY version DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 50)],
  );
  return res.rows;
}

export async function campaignReleases(db: Db): Promise<ReleaseRow[]> {
  const res = await db.query<ReleaseRow>(
    `SELECT ${COLUMNS} FROM homepage_releases
      WHERE kind = 'campaign'
      ORDER BY
        CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
        starts_at DESC NULLS LAST,
        version DESC`,
  );
  return res.rows;
}

/** Absolute URL for an uploaded asset. The id is the allowlist; see `homepage_media`. */
export function mediaUrl(id: string): string {
  return `${config.PUBLIC_API_URL.replace(/\/$/, '')}/homepage/media/${id}`;
}
