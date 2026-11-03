import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { AppError } from '../lib/errors.ts';
import { getObject } from '../lib/storage.ts';
import { resolveHomepage, type Platform } from '../lib/homepage.ts';

/**
 * The public homepage.
 *
 * Three routes, all cacheable, none authenticated:
 *
 *  - `GET /v1/homepage` answers with the resolved page for one platform. The response is derived
 *    from published rows only; drafts are excluded by the query, not by a filter the route might
 *    forget.
 *  - `GET /v1/home` is the same response under the shorter name the mobile app reads. It is an
 *    alias, not a second source, so the two can never drift.
 *  - `GET /v1/homepage/media/:id` serves campaign artwork by opaque id. The media table *is* the
 *    allowlist: a URL that does not name one of its rows cannot be resolved, and the id is a random
 *    uuid, so an unpublished draft's artwork is not discoverable by guessing.
 */

const querySchema = z
  .object({
    platform: z.enum(['android', 'ios', 'web']).default('android'),
  })
  .strict();

function etagFor(payload: string): string {
  return `"${createHash('sha256').update(payload).digest('base64url').slice(0, 27)}"`;
}

async function resolveAndSend(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply) {
  const query = querySchema.parse(req.query);
  const platform: Platform = query.platform;

  const { document } = await resolveHomepage(app.db, { platform });

  // `generated_at` changes on every request by design, so it must not take part in the ETag —
  // otherwise no two responses would ever match and the cache headers would be decorative.
  const etag = etagFor(JSON.stringify({ ...document, generated_at: undefined }));
  const payload = JSON.stringify(document);

  // A campaign boundary inside the next few minutes is already expressed by
  // `refresh_after_seconds`; the HTTP cache window stays short so a publish is visible quickly.
  const maxAge = Math.min(60, Math.max(15, Math.round(document.refresh_after_seconds / 5)));

  reply
    .header('cache-control', `public, max-age=${maxAge}, stale-while-revalidate=240`)
    .header('etag', etag)
    .header('vary', 'accept-encoding')
    .header('x-homepage-version', String(document.version));

  if (req.headers['if-none-match'] === etag) return reply.code(304).send();

  return reply.code(200).type('application/json; charset=utf-8').send(payload);
}

export async function homepageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/homepage', (req, reply) => resolveAndSend(app, req, reply));
  app.get('/home', (req, reply) => resolveAndSend(app, req, reply));

  app.get<{ Params: { id: string } }>(
    '/homepage/media/:id',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const id = req.params.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new AppError('NOT_FOUND');
      }

      const media = await app.db.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM homepage_media WHERE id = $1`,
        [id],
      );
      const row = media.rows[0];
      if (!row) throw new AppError('NOT_FOUND');

      const object = await getObject(row.object_key);
      if (!object) throw new AppError('NOT_FOUND');

      return reply
        .code(200)
        .header('content-type', row.content_type)
        .header('content-length', String(object.byteSize))
        // Immutable: a media row is never rewritten. Replacing artwork means a new upload, so a
        // CDN or the phone may keep this forever.
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(object.bytes);
    },
  );
}
