import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseHomepageConfig } from '@py/domain';

import { AppError } from '../lib/errors.ts';
import { makeAuthenticate, requireRole } from '../lib/auth.ts';
import { audit } from '../services/audit.ts';
import { getObject, keyBelongsTo } from '../lib/storage.ts';
import {
  activeCampaign,
  campaignReleases,
  homepageDraft,
  homepageHistory,
  mediaUrl,
  publishedHomepage,
  releaseView,
  resolveHomepage,
  type ReleaseRow,
} from '../lib/homepage.ts';

/**
 * Homepage and campaign management for the staff console.
 *
 * The shape of the rules:
 *
 *  - reading is open to any staff role; publishing is not. A support agent can look at the page an
 *    editor is building, but only a trust-and-safety operator or the console owner can change what
 *    every user sees;
 *  - a draft is a row, and the public route cannot select it — privacy is structural;
 *  - every publish, rollback and unpublish writes an audit entry with the before/after version, so
 *    "who changed the Diwali banner" has an answer that is not a guess.
 */

const configSchema = z.unknown();

const draftSchema = z
  .object({
    config: configSchema,
    note: z.string().max(500).optional(),
  })
  .strict();

const publishSchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .strict();

const rollbackSchema = z
  .object({
    version: z.coerce.number().int().min(1),
    note: z.string().max(500).optional(),
  })
  .strict();

const campaignSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    config: configSchema,
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
    platforms: z.array(z.enum(['android', 'ios', 'web'])).min(1).max(3).default(['android', 'ios', 'web']),
    note: z.string().max(500).optional(),
  })
  .strict();

const previewQuery = z
  .object({
    platform: z.enum(['android', 'ios', 'web']).default('android'),
    at: z.string().datetime({ offset: true }).optional(),
    campaign_id: z.string().uuid().optional(),
    draft: z.enum(['0', '1']).default('0'),
  })
  .strict();

const mediaSchema = z
  .object({
    object_key: z.string().min(1).max(256),
  })
  .strict();

// Publishing changes what every user sees, so it is limited to the role the configured owner holds.
// `admin_readonly` is deliberately absent: whatever its history, its name promises that it cannot
// change anything, and a role that publishes under that name is a trap for the next reader.
const WRITE_ROLES = ['trust_safety'] as const;
const READ_ROLES = ['support_agent', 'verification_reviewer', 'trust_safety', 'finance', 'admin_readonly'] as const;

/**
 * Normalise a configuration on the way in.
 *
 * `strict` is used for anything an editor submits, so a section type this build cannot render is
 * refused at save time rather than silently disappearing between preview and publication. Publish
 * and rollback use the permissive parse: they re-validate content that was already accepted, and an
 * older release may legitimately carry a section a newer editor added.
 */
function validatedConfig(raw: unknown, strict = false) {
  const parsed = parseHomepageConfig(raw, { strictUnknownSections: strict });
  if (!parsed.ok) {
    throw new AppError('VALIDATION_FAILED', { issues: parsed.issues });
  }
  return parsed.value;
}

function campaignWindow(startsAt: string, endsAt: string): { starts: Date; ends: Date } {
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    throw new AppError('VALIDATION_FAILED', { issues: ['campaign: the window is not a valid date'] });
  }
  if (ends <= starts) {
    throw new AppError('VALIDATION_FAILED', { issues: ['campaign: ends_at must be after starts_at'] });
  }
  return { starts, ends };
}

async function findRelease(app: FastifyInstance, id: string, kind?: 'homepage' | 'campaign'): Promise<ReleaseRow> {
  const res = await app.db.query<ReleaseRow>(
    `SELECT * FROM homepage_releases WHERE id = $1 ${kind ? 'AND kind = $2' : ''} LIMIT 1`,
    kind ? [id, kind] : [id],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

export async function adminHomepageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', makeAuthenticate(app.db));

  // ---------------------------------------------------------------- read

  app.get('/admin/homepage', async (req) => {
    requireRole(req, ...READ_ROLES);
    const [published, draft, history, campaigns] = await Promise.all([
      publishedHomepage(app.db),
      homepageDraft(app.db),
      homepageHistory(app.db),
      campaignReleases(app.db),
    ]);
    const live = await activeCampaign(app.db, 'android', new Date());

    return {
      published: published ? { ...releaseView(published), config: published.config } : null,
      draft: draft ? { ...releaseView(draft), config: draft.config } : null,
      history: history.map(releaseView),
      campaigns: campaigns.map((row) => ({ ...releaseView(row), config: row.config })),
      live_campaign_id: live?.id ?? null,
      schema_version: 1,
    };
  });

  app.get('/admin/homepage/draft', async (req) => {
    requireRole(req, ...READ_ROLES);
    const draft = await homepageDraft(app.db);
    return { draft: draft ? { ...releaseView(draft), config: draft.config } : null };
  });

  app.get('/admin/homepage/preview', async (req) => {
    requireRole(req, ...READ_ROLES);
    const query = previewQuery.parse(req.query);

    const base = query.draft === '1' ? await homepageDraft(app.db) : await publishedHomepage(app.db);
    const campaign = query.campaign_id ? await findRelease(app, query.campaign_id, 'campaign') : undefined;

    const { document } = await resolveHomepage(app.db, {
      platform: query.platform,
      ...(query.at ? { at: new Date(query.at) } : {}),
      previewBase: base,
      ...(campaign ? { previewCampaign: campaign } : {}),
    });

    return { document, base_version: base ? Number(base.version) : null, draft: query.draft === '1' };
  });

  // ---------------------------------------------------------------- base homepage draft

  app.put('/admin/homepage/draft', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const body = draftSchema.parse(req.body);
    const config = validatedConfig(body.config, true);

    const existing = await homepageDraft(app.db);
    if (existing) {
      await app.db.query(
        `UPDATE homepage_releases SET config = $1::jsonb, note = $2, updated_at = now() WHERE id = $3`,
        [JSON.stringify(config), body.note ?? existing.note, existing.id],
      );
    } else {
      await app.db.query(
        `INSERT INTO homepage_releases (kind, status, name, config, note, created_by)
         VALUES ('homepage', 'draft', 'Homepage draft', $1::jsonb, $2, $3)`,
        [JSON.stringify(config), body.note ?? null, auth.userId],
      );
    }

    const draft = await homepageDraft(app.db);
    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.draft_saved',
      resource: 'homepage_release',
      resourceId: draft?.id ?? null,
      after: { version: draft ? Number(draft.version) : null },
    });

    return { draft: draft ? { ...releaseView(draft), config: draft.config } : null };
  });

  app.delete('/admin/homepage/draft', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const draft = await homepageDraft(app.db);
    if (!draft) throw new AppError('NOT_FOUND');

    await app.db.query(`DELETE FROM homepage_releases WHERE id = $1`, [draft.id]);
    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.draft_discarded',
      resource: 'homepage_release',
      resourceId: draft.id,
      before: { version: Number(draft.version) },
    });
    return { discarded: true };
  });

  // ---------------------------------------------------------------- publish / rollback

  app.post('/admin/homepage/publish', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const body = publishSchema.parse(req.body ?? {});
    const draft = await homepageDraft(app.db);
    if (!draft) throw new AppError('CONFLICT', { reason: 'no_draft' });

    // The draft's config was validated on the way in; validate again on the way out, because a
    // publish is the moment it becomes visible to everybody.
    const config = validatedConfig(draft.config);
    const previous = await publishedHomepage(app.db);

    const published = await app.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE homepage_releases SET status = 'archived', updated_at = now()
          WHERE kind = 'homepage' AND status = 'published'`,
      );
      const res = await tx.query<ReleaseRow>(
        `UPDATE homepage_releases
            SET status = 'published', config = $1::jsonb, note = COALESCE($2, note),
                published_at = now(), published_by = $3, updated_at = now()
          WHERE id = $4
          RETURNING *`,
        [JSON.stringify(config), body.note ?? null, auth.userId, draft.id],
      );
      return res.rows[0]!;
    });

    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.published',
      resource: 'homepage_release',
      resourceId: published.id,
      before: previous ? { version: Number(previous.version) } : null,
      after: { version: Number(published.version) },
    });

    return { published: releaseView(published) };
  });

  /**
   * Roll back by copying an older release into a *new* published row.
   *
   * Nothing is un-archived and no version number is reused: the history reads as a straight line, so
   * "what was live on the 12th" is answerable from the table alone.
   */
  app.post('/admin/homepage/rollback', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const body = rollbackSchema.parse(req.body ?? {});

    const target = await app.db.query<ReleaseRow>(
      `SELECT * FROM homepage_releases WHERE kind = 'homepage' AND version = $1 AND status <> 'draft' LIMIT 1`,
      [body.version],
    );
    const source = target.rows[0];
    if (!source) throw new AppError('NOT_FOUND');

    const config = validatedConfig(source.config);

    const published = await app.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE homepage_releases SET status = 'archived', updated_at = now()
          WHERE kind = 'homepage' AND status = 'published'`,
      );
      const res = await tx.query<ReleaseRow>(
        `INSERT INTO homepage_releases
           (kind, status, name, config, note, published_at, published_by, created_by, rolled_back_from)
         VALUES ('homepage', 'published', $1, $2::jsonb, $3, now(), $4, $4, $5)
         RETURNING *`,
        [
          source.name,
          JSON.stringify(config),
          body.note ?? `Rolled back to version ${body.version}`,
          auth.userId,
          Number(source.version),
        ],
      );
      return res.rows[0]!;
    });

    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.rolled_back',
      resource: 'homepage_release',
      resourceId: published.id,
      before: { version: Number(source.version) },
      after: { version: Number(published.version), rolled_back_from: Number(source.version) },
    });

    return { published: releaseView(published) };
  });

  // ---------------------------------------------------------------- campaigns

  app.post('/admin/homepage/campaigns', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const body = campaignSchema.parse(req.body);
    const config = validatedConfig(body.config, true);
    const { starts, ends } = campaignWindow(body.starts_at, body.ends_at);

    const res = await app.db.query<ReleaseRow>(
      `INSERT INTO homepage_releases
         (kind, status, name, config, priority, platforms, starts_at, ends_at, note, created_by)
       VALUES ('campaign', 'draft', $1, $2::jsonb, $3, $4::text[], $5, $6, $7, $8)
       RETURNING *`,
      [
        body.name,
        JSON.stringify(config),
        body.priority,
        body.platforms,
        starts,
        ends,
        body.note ?? null,
        auth.userId,
      ],
    );

    const row = res.rows[0]!;
    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.campaign_created',
      resource: 'homepage_release',
      resourceId: row.id,
      after: { name: row.name, starts_at: starts.toISOString(), ends_at: ends.toISOString() },
    });

    return { campaign: { ...releaseView(row), config: row.config } };
  });

  app.put<{ Params: { id: string } }>('/admin/homepage/campaigns/:id', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const body = campaignSchema.parse(req.body);
    const existing = await findRelease(app, req.params.id, 'campaign');
    if (existing.status !== 'draft') {
      // A published campaign is a historical fact. Editing it in place would silently rewrite what
      // ran last week, so the console asks the editor to duplicate it instead.
      throw new AppError('CONFLICT', { reason: 'campaign_not_draft' });
    }

    const config = validatedConfig(body.config, true);
    const { starts, ends } = campaignWindow(body.starts_at, body.ends_at);

    const res = await app.db.query<ReleaseRow>(
      `UPDATE homepage_releases
          SET name = $1, config = $2::jsonb, priority = $3, platforms = $4::text[],
              starts_at = $5, ends_at = $6, note = $7, updated_at = now()
        WHERE id = $8
        RETURNING *`,
      [
        body.name,
        JSON.stringify(config),
        body.priority,
        body.platforms,
        starts,
        ends,
        body.note ?? null,
        existing.id,
      ],
    );

    const row = res.rows[0]!;
    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.campaign_updated',
      resource: 'homepage_release',
      resourceId: row.id,
      after: { name: row.name },
    });

    return { campaign: { ...releaseView(row), config: row.config } };
  });

  app.post<{ Params: { id: string } }>('/admin/homepage/campaigns/:id/duplicate', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const source = await findRelease(app, req.params.id, 'campaign');

    const res = await app.db.query<ReleaseRow>(
      `INSERT INTO homepage_releases
         (kind, status, name, config, priority, platforms, starts_at, ends_at, note, created_by)
       VALUES ('campaign', 'draft', $1, $2::jsonb, $3, $4::text[], $5, $6, $7, $8)
       RETURNING *`,
      [
        `${source.name} (copy)`.slice(0, 80),
        JSON.stringify(source.config),
        source.priority,
        source.platforms,
        source.starts_at,
        source.ends_at,
        source.note,
        auth.userId,
      ],
    );

    const row = res.rows[0]!;
    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.campaign_duplicated',
      resource: 'homepage_release',
      resourceId: row.id,
      before: { version: Number(source.version) },
      after: { version: Number(row.version) },
    });

    return { campaign: { ...releaseView(row), config: row.config } };
  });

  app.delete<{ Params: { id: string } }>('/admin/homepage/campaigns/:id', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const existing = await findRelease(app, req.params.id, 'campaign');
    if (existing.status !== 'draft') throw new AppError('CONFLICT', { reason: 'campaign_not_draft' });

    await app.db.query(`DELETE FROM homepage_releases WHERE id = $1`, [existing.id]);
    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.campaign_deleted',
      resource: 'homepage_release',
      resourceId: existing.id,
      before: { name: existing.name },
    });
    return { deleted: true };
  });

  app.post<{ Params: { id: string } }>('/admin/homepage/campaigns/:id/publish', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const existing = await findRelease(app, req.params.id, 'campaign');
    if (existing.status === 'published') return { campaign: { ...releaseView(existing), config: existing.config } };

    const config = validatedConfig(existing.config);
    if (!existing.starts_at || !existing.ends_at) {
      throw new AppError('VALIDATION_FAILED', { issues: ['campaign: a window is required before publishing'] });
    }
    const { starts, ends } = campaignWindow(new Date(existing.starts_at).toISOString(), new Date(existing.ends_at).toISOString());
    if (ends.getTime() <= Date.now()) {
      // Publishing something that is already over would look like a successful action and change
      // nothing on any phone.
      throw new AppError('VALIDATION_FAILED', { issues: ['campaign: ends_at is in the past'] });
    }

    const res = await app.db.query<ReleaseRow>(
      `UPDATE homepage_releases
          SET status = 'published', config = $1::jsonb, starts_at = $2, ends_at = $3,
              published_at = now(), published_by = $4, updated_at = now()
        WHERE id = $5
        RETURNING *`,
      [JSON.stringify(config), starts, ends, auth.userId, existing.id],
    );

    const row = res.rows[0]!;
    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.campaign_published',
      resource: 'homepage_release',
      resourceId: row.id,
      after: { name: row.name, starts_at: starts.toISOString(), ends_at: ends.toISOString() },
    });

    return { campaign: { ...releaseView(row), config: row.config } };
  });

  app.post<{ Params: { id: string } }>('/admin/homepage/campaigns/:id/unpublish', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const existing = await findRelease(app, req.params.id, 'campaign');
    if (existing.status !== 'published') throw new AppError('CONFLICT', { reason: 'campaign_not_published' });

    const res = await app.db.query<ReleaseRow>(
      `UPDATE homepage_releases SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING *`,
      [existing.id],
    );

    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.campaign_unpublished',
      resource: 'homepage_release',
      resourceId: existing.id,
      before: { name: existing.name },
    });

    return { campaign: { ...releaseView(res.rows[0]!), config: res.rows[0]!.config } };
  });

  // ---------------------------------------------------------------- media

  /**
   * Register artwork that was uploaded through `POST /files/upload-url` with purpose
   * `campaign_art`. The bytes are read once so a missing object is caught here rather than showing
   * up as a broken banner on somebody's phone.
   */
  app.post('/admin/homepage/media', async (req) => {
    const auth = requireRole(req, ...WRITE_ROLES);
    const body = mediaSchema.parse(req.body);

    if (!keyBelongsTo(body.object_key, auth.userId)) {
      throw new AppError('NOT_FOUND');
    }
    if (!body.object_key.startsWith('campaign_art/')) {
      throw new AppError('VALIDATION_FAILED', { issues: ['object_key: must be a campaign_art upload'] });
    }

    const contentType = body.object_key.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const object = await getObject(body.object_key);
    if (!object) throw new AppError('NOT_FOUND');

    const res = await app.db.query<{ id: string }>(
      `INSERT INTO homepage_media (object_key, content_type, byte_size, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (object_key) DO UPDATE SET object_key = EXCLUDED.object_key
       RETURNING id`,
      [body.object_key, contentType, object.byteSize, auth.userId],
    );

    const id = res.rows[0]!.id;
    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'support',
      action: 'homepage.media_registered',
      resource: 'homepage_media',
      resourceId: id,
      after: { object_key: body.object_key, byte_size: object.byteSize },
    });

    return { id, url: mediaUrl(id), content_type: contentType, byte_size: object.byteSize };
  });

  app.get('/admin/homepage/media', async (req) => {
    requireRole(req, ...READ_ROLES);
    const res = await app.db.query<{
      id: string;
      object_key: string;
      content_type: string;
      byte_size: number;
      created_at: Date | string;
    }>(
      `SELECT id, object_key, content_type, byte_size, created_at
         FROM homepage_media ORDER BY created_at DESC LIMIT 60`,
    );
    return {
      items: res.rows.map((row) => ({
        id: row.id,
        url: mediaUrl(row.id),
        object_key: row.object_key,
        content_type: row.content_type,
        byte_size: Number(row.byte_size),
      })),
    };
  });
}
