import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';

import { config } from '../config.ts';

/**
 * Object storage — dual-mode adapter.
 *
 * STORAGE_PROVIDER=local  (development default)
 *   Stores uploads on local disk. Zero cost, zero setup. Backups are the operator's job.
 *
 * STORAGE_PROVIDER=cloudinary  (production)
 *   Uploads to Cloudinary via their REST API (no SDK dependency).
 *   Free tier: 25 GB storage + 25 GB bandwidth/month.
 *   https://cloudinary.com/pricing
 *
 * The interface is deliberately object-store shaped — opaque keys, a signed read URL, no public
 * bucket — so callers are unaffected by the switch.
 */

// ─────────────────────────────────────────────── key validation (shared)

const KEY_PATTERN = /^[a-z_]+(\/[A-Za-z0-9_-]+){1,3}\.[a-z0-9]{2,5}$/;

export function isValidKey(key: string): boolean {
  if (!KEY_PATTERN.test(key)) return false;
  if (key.includes('..')) return false;
  return true;
}

/**
 * `<purpose>/<userId>/<uuid>.<ext>`, exactly as `POST /files/upload-url` issues it. A reference to
 * somebody else's object is not merely invalid, it is somebody's ID document or parcel photo, so
 * every route that stores a client-supplied key has to check this.
 */
const OWNED_KEY_PATTERN = /^[a-z_]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export function keyBelongsTo(key: string, userId: string): boolean {
  if (!isValidKey(key)) return false;
  return OWNED_KEY_PATTERN.exec(key)?.[1] === userId;
}

// ─────────────────────────────────────────────── local disk (dev)

export function storageRoot(): string {
  return config.UPLOAD_DIR;
}

function resolveKey(key: string): string {
  if (!isValidKey(key)) throw new Error('invalid object key');
  const root = normalize(storageRoot());
  const path = normalize(join(root, key));
  if (path !== root && !path.startsWith(root + sep)) throw new Error('object key escapes the storage root');
  return path;
}

export async function ensureStorage(): Promise<void> {
  if (config.STORAGE_PROVIDER === 'local') {
    await mkdir(storageRoot(), { recursive: true });
  }
}

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
  byteSize: number;
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

// ─────────────────────────────────────────────── Cloudinary helpers

/**
 * Derive the Cloudinary public_id from an object key.
 * e.g.  "kyc_id/user123/uuid.jpg"  =>  "parcel_yatra/kyc_id/user123/uuid"
 */
function toPublicId(key: string): string {
  const withoutExt = key.replace(/\.[^.]+$/, '');
  return `parcel_yatra/${withoutExt}`;
}

/**
 * Generate a Cloudinary API authentication signature for upload.
 * https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
 */
function cloudinarySignature(params: Record<string, string | number>, apiSecret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha256')
    .update(sorted + apiSecret)
    .digest('hex');
}

/**
 * Upload a buffer to Cloudinary via the REST upload API.
 * Uses authenticated (signed) upload — never exposes credentials to clients.
 */
async function cloudinaryPut(key: string, bytes: Buffer): Promise<void> {
  const cloudName = config.CLOUDINARY_CLOUD_NAME!;
  const apiKey = config.CLOUDINARY_API_KEY!;
  const apiSecret = config.CLOUDINARY_API_SECRET!;

  const publicId = toPublicId(key);
  const timestamp = Math.floor(Date.now() / 1000);

  const params: Record<string, string | number> = {
    // The full path goes in public_id (slashes create nested folders). Cloudinary's `folder`
    // parameter does not accept path separators, so splitting the key across both fields makes
    // every signed upload answer 400 and every sink PUT surface as a 500.
    public_id: publicId,
    timestamp,
    type: 'authenticated', // private — requires signed URL to view
    // Cloudinary defaults to SHA-1 signatures. Naming the algorithm keeps an account that still
    // uses the default from rejecting the SHA-256 digest this adapter computes.
    signature_algorithm: 'sha256',
  };

  const signature = cloudinarySignature(params, apiSecret);

  // Build multipart form — use global FormData (Node 22+)
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)]), key.split('/').pop());
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  for (const [k, v] of Object.entries(params)) {
    form.append(k, String(v));
  }

  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cloudinary upload failed (${res.status}): ${body}`);
  }
}

/**
 * Fetch a Cloudinary authenticated asset.
 * Staff/owner reads go through this path; we download the bytes and proxy them
 * so the client never needs Cloudinary credentials.
 */
async function cloudinaryGet(key: string): Promise<StoredObject | null> {
  const cloudName = config.CLOUDINARY_CLOUD_NAME!;
  const apiKey = config.CLOUDINARY_API_KEY!;
  const apiSecret = config.CLOUDINARY_API_SECRET!;

  const publicId = toPublicId(key);
  const ext = key.split('.').pop()?.toLowerCase() ?? 'jpg';
  const timestamp = Math.floor(Date.now() / 1000);

  // The asset is stored as `type=authenticated`, and the download endpoint defaults to
  // `type=upload`. Without this parameter Cloudinary answers for an asset that does not exist,
  // which read as a missing upload and made every verification submission fail.
  const params: Record<string, string | number> = {
    public_id: publicId,
    timestamp,
    type: 'authenticated',
    signature_algorithm: 'sha256',
  };
  const signature = cloudinarySignature(params, apiSecret);
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    api_key: apiKey,
    signature,
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/download?${query}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;

  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    bytes,
    contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
    byteSize: bytes.byteLength,
  };
}

// ─────────────────────────────────────────────── public interface

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  if (config.STORAGE_PROVIDER === 'cloudinary') {
    return cloudinaryPut(key, bytes);
  }
  // local
  const path = resolveKey(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { mode: 0o600 });
}

export async function getObject(key: string): Promise<StoredObject | null> {
  if (config.STORAGE_PROVIDER === 'cloudinary') {
    return cloudinaryGet(key);
  }
  // local
  try {
    const path = resolveKey(key);
    const info = await stat(path);
    if (!info.isFile()) return null;
    const ext = key.split('.').pop()!.toLowerCase();
    return {
      bytes: await readFile(path),
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
      byteSize: info.size,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────── signed read URLs

interface SignedPayload {
  /** object key */
  k: string;
  /** expiry, unix seconds */
  e: number;
}

function sign(body: string): string {
  return createHmac('sha256', config.FILE_SIGNING_SECRET).update(body).digest('base64url');
}

/**
 * Build a short-lived, single-purpose read URL.
 *
 * Both providers return an API URL: the signed token is verified here and the bytes are proxied
 * from `getObject`. Cloudinary's own delivery URLs need a CDN-signature format that this adapter
 * does not reproduce, and a URL that silently 404s for a reviewer is worse than one extra hop.
 */
export function signObjectKey(key: string, ttlSeconds = config.FILE_URL_TTL_SECONDS): { url: string; expiresAt: Date } {
  if (!isValidKey(key)) throw new Error('invalid object key');

  const payload: SignedPayload = { k: key, e: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${body}.${sign(body)}`;
  return {
    url: `${config.PUBLIC_API_URL}/files/signed/${token}`,
    expiresAt: new Date(payload.e * 1000),
  };
}

export function verifySignedToken(token: string): string | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
    if (typeof payload.k !== 'string' || typeof payload.e !== 'number') return null;
    if (payload.e * 1000 < Date.now()) return null;
    if (!isValidKey(payload.k)) return null;
    return payload.k;
  } catch {
    return null;
  }
}
