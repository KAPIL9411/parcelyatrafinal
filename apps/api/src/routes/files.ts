import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../lib/auth.ts';
import { toIso } from '../lib/serialize.ts';
import { ensureStorage, getObject, isValidKey, keyBelongsTo, putObject, verifySignedToken } from '../lib/storage.ts';
import { audit } from '../services/audit.ts';

/**
 * Upload authorisation and reads.
 *
 * There is no third-party object store in this build. The endpoint issues an authenticated upload
 * URL under the API origin, stores the bytes on a local volume through `lib/storage.ts`, and returns
 * the same response shape as `api/openapi.yaml`, so an S3 adapter can replace the implementation
 * without touching clients.
 *
 * Reads are never public:
 *  - the uploader (and staff) can read their own object through the authenticated route;
 *  - everyone else, including staff in a browser, gets a short-lived signed URL issued after a role
 *    check. The signed URL is unguessable, expires, and grants exactly one object.
 */

const ALLOWED: Record<string, string[]> = {
  kyc_id: ['image/jpeg', 'image/png'],
  kyc_selfie: ['image/jpeg', 'image/png'],
  parcel_sealed: ['image/jpeg', 'image/png'],
  parcel_delivery: ['image/jpeg', 'image/png'],
  dispute_evidence: ['image/jpeg', 'image/png'],
  // Homepage artwork. Staff-only in practice: the registration endpoint that makes an upload
  // addressable requires a staff role, and an unregistered object is unreachable.
  campaign_art: ['image/jpeg', 'image/png'],
};

const MAX_BYTES = 10_485_760;

const requestSchema = z
  .object({
    purpose: z.enum([
      'kyc_id',
      'kyc_selfie',
      'parcel_sealed',
      'parcel_delivery',
      'dispute_evidence',
      'campaign_art',
    ]),
    content_type: z.enum(['image/jpeg', 'image/png']),
    byte_size: z.number().int().min(1).max(MAX_BYTES),
  })
  .strict();

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  await ensureStorage();

  // Binary image bodies. Fastify ships a JSON parser only, so without this the local sink answers
  // 415 before the handler ever runs. Scoped to this plugin, so JSON routes are unaffected.
  app.addContentTypeParser(
    ['image/jpeg', 'image/png'],
    { parseAs: 'buffer', bodyLimit: MAX_BYTES },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post('/files/upload-url', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = requestSchema.parse(req.body);

    const allowed = ALLOWED[body.purpose] ?? [];
    if (!allowed.includes(body.content_type)) throw new AppError('UPLOAD_INVALID_TYPE');
    if (body.byte_size > MAX_BYTES) throw new AppError('UPLOAD_TOO_LARGE');

    const objectKey = `${body.purpose}/${auth.userId}/${randomUUID()}.${body.content_type === 'image/png' ? 'png' : 'jpg'}`;
    const expiresAt = new Date(Date.now() + 5 * 60_000);

    await audit(app.db, {
      actorId: auth.userId,
      actorKind: 'user',
      action: 'file.upload_authorised',
      resource: 'file',
      resourceId: objectKey,
      after: { purpose: body.purpose, byte_size: body.byte_size },
    });

    // Generate appropriate upload URL based on storage provider
    const uploadUrl = config.STORAGE_PROVIDER === 'cloudinary'
      ? `${config.PUBLIC_API_URL}/files/cloudinary-upload/${encodeURIComponent(objectKey)}`
      : `${config.PUBLIC_API_URL}/files/local-upload/${encodeURIComponent(objectKey)}`;

    return reply.code(201).send({
      object_key: objectKey,
      upload_url: uploadUrl,
      expires_at: toIso(expiresAt),
    });
  });

  app.put<{ Params: { '*': string } }>(
    '/files/local-upload/*',
    { bodyLimit: MAX_BYTES, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const key = decodeURIComponent(req.params['*'] ?? '');
      if (!isValidKey(key)) throw new AppError('VALIDATION_FAILED', { reason: 'object_key' });
      // A caller may only write under their own user id. Anything else is reported as absent.
      if (!keyBelongsTo(key, auth.userId)) throw new AppError('NOT_FOUND');

      const raw = req.body;
      const bytes = raw instanceof Buffer ? raw : typeof raw === 'string' ? Buffer.from(raw) : null;
      if (!bytes) throw new AppError('UPLOAD_INVALID_TYPE');
      if (bytes.byteLength > MAX_BYTES) throw new AppError('UPLOAD_TOO_LARGE');

      try {
        await putObject(key, bytes);
      } catch (err) {
        // A failed write must not look like a crash: the provider error (or errno) goes to the log
        // with the key, and the client gets a retryable 503 instead of a bare 500.
        req.log.error({ err, object_key: key }, 'object write failed');
        throw new AppError('STORAGE_UNAVAILABLE');
      }

      return reply.code(201).send({ object_key: key, byte_size: bytes.byteLength });
    },
  );

  // Cloudinary upload endpoint
  app.put<{ Params: { '*': string } }>(
    '/files/cloudinary-upload/*',
    { bodyLimit: MAX_BYTES, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const key = decodeURIComponent(req.params['*'] ?? '');
      if (!isValidKey(key)) throw new AppError('VALIDATION_FAILED', { reason: 'object_key' });
      // A caller may only write under their own user id. Anything else is reported as absent.
      if (!keyBelongsTo(key, auth.userId)) throw new AppError('NOT_FOUND');

      const raw = req.body;
      const bytes = raw instanceof Buffer ? raw : typeof raw === 'string' ? Buffer.from(raw) : null;
      if (!bytes) throw new AppError('UPLOAD_INVALID_TYPE');
      if (bytes.byteLength > MAX_BYTES) throw new AppError('UPLOAD_TOO_LARGE');

      // Upload to Cloudinary via storage adapter
      try {
        await putObject(key, bytes);
      } catch (err) {
        // A failed write must not look like a crash: the provider error (or errno) goes to the log
        // with the key, and the client gets a retryable 503 instead of a bare 500.
        req.log.error({ err, object_key: key }, 'object write failed');
        throw new AppError('STORAGE_UNAVAILABLE');
      }

      return reply.code(201).send({ object_key: key, byte_size: bytes.byteLength });
    },
  );

  /** Owner or staff read. The response is private and must never be cached by a shared proxy. */
  app.get<{ Params: { '*': string } }>('/files/object/*', async (req, reply) => {
    const auth = requireAuth(req);
    const key = decodeURIComponent(req.params['*'] ?? '');
    if (!isValidKey(key)) throw new AppError('NOT_FOUND');

    const staff = auth.roles.some((r) =>
      ['support_agent', 'verification_reviewer', 'finance', 'trust_safety', 'admin_readonly'].includes(r),
    );
    if (!staff && !keyBelongsTo(key, auth.userId)) throw new AppError('NOT_FOUND');

    const object = await getObject(key);
    if (!object) throw new AppError('NOT_FOUND');

    return reply
      .code(200)
      .header('content-type', object.contentType)
      .header('content-length', String(object.byteSize))
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(object.bytes);
  });
}

/**
 * Signed reads are registered outside the authenticated scope: the token is the credential.
 * Kept in its own plugin so `app.ts` can mount it before the auth hook.
 */
export async function filePublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>(
    '/files/signed/:token',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const key = verifySignedToken(req.params.token);
      if (!key) throw new AppError('NOT_FOUND');

      const object = await getObject(key);
      if (!object) throw new AppError('NOT_FOUND');

      return reply
        .code(200)
        .header('content-type', object.contentType)
        .header('content-length', String(object.byteSize))
        .header('cache-control', 'private, no-store')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', 'inline')
        .send(object.bytes);
    },
  );
}
