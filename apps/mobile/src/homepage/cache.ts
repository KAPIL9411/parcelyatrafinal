/**
 * The last valid homepage, kept on the device.
 *
 * This is what makes a cold start feel instant and what keeps the page alive with no network. The
 * rules:
 *
 *  - nothing is trusted on the way in or out: the file is parsed and validated with the same
 *    contract the server uses, and a corrupt or outdated file is simply ignored;
 *  - the cached campaign is checked against the clock, so a phone that has been in a drawer since
 *    Diwali does not open on Diwali artwork;
 *  - a write failure is never fatal. A cache that cannot be written is a slower app, not a broken one.
 *
 * `expo-file-system` has no web implementation for `File`, so the browser preview (and any web
 * build) keeps the same data in memory. Nothing here is secret, so this is a storage detail rather
 * than a security boundary.
 */
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import {
  isStaleCampaign,
  parseHomepageDocument,
  type HomepageDocument,
} from '@py/domain';

const FOLDER = 'homepage';
const FILE = 'homepage.v1.json';

interface CacheEnvelope {
  etag: string | null;
  saved_at: string;
  document: unknown;
}

export interface CachedHomepage {
  document: HomepageDocument;
  etag: string | null;
  savedAt: Date;
}

let memory: string | null = null;

function cacheFile(): File {
  const directory = new Directory(Paths.document, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return new File(directory, FILE);
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') return memory;
  try {
    const file = cacheFile();
    if (!file.exists) return null;
    return await file.text();
  } catch {
    return null;
  }
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    memory = value;
    return;
  }
  try {
    const file = cacheFile();
    file.create({ intermediates: true, overwrite: true });
    await file.write(value);
  } catch {
    // A read-only or full filesystem must not stop the app from rendering.
  }
}

/**
 * The cached document, or null when there is nothing usable.
 *
 * `now` is injectable so the staleness rule can be tested without waiting for a festival to end.
 */
export async function readCachedHomepage(now: Date = new Date()): Promise<CachedHomepage | null> {
  const raw = await readRaw();
  if (!raw) return null;

  let envelope: CacheEnvelope;
  try {
    envelope = JSON.parse(raw) as CacheEnvelope;
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== 'object') return null;

  const parsed = parseHomepageDocument(envelope.document);
  if (!parsed.ok) return null;

  const document = parsed.value;
  if (isStaleCampaign(document, now)) {
    // The campaign ended long ago and we never refreshed. Better the default page than a stale
    // festival, which would look broken rather than cached.
    return null;
  }

  const savedAt = new Date(envelope.saved_at ?? 0);
  return {
    document,
    etag: typeof envelope.etag === 'string' ? envelope.etag : null,
    savedAt: Number.isNaN(savedAt.getTime()) ? new Date(0) : savedAt,
  };
}

export async function writeCachedHomepage(document: HomepageDocument, etag: string | null): Promise<void> {
  const envelope: CacheEnvelope = {
    etag,
    saved_at: new Date().toISOString(),
    document,
  };
  await writeRaw(JSON.stringify(envelope));
}

export async function clearCachedHomepage(): Promise<void> {
  memory = null;
  if (Platform.OS === 'web') return;
  try {
    const file = cacheFile();
    if (file.exists) file.delete();
  } catch {
    // Nothing to clear is a success.
  }
}
