/**
 * Fetching the published homepage.
 *
 * Deliberately not part of `api/client.ts`: that module exists to carry a session, refresh tokens and
 * idempotency keys, and the homepage needs none of them. It is a public, cacheable document that must
 * still work while the session is being restored or the user is signed out.
 *
 * Three rules matter more than the request itself:
 *
 *  - a timeout is short enough that the cached page is shown instead of a spinner;
 *  - an ETag round-trip keeps a warm start to a 304 with no body;
 *  - the response is validated with the shared contract *before* it can reach the UI, so a server
 *    bug becomes a stale-but-working page rather than a crash.
 */
import { Platform } from 'react-native';
import { parseHomepageDocument, type HomepageDocument } from '@py/domain';

import { API_BASE } from '../api/client.ts';

export type HomepagePlatform = 'android' | 'ios' | 'web';

export type HomepageFetchFailure = 'timeout' | 'network' | 'http' | 'invalid';

export class HomepageFetchError extends Error {
  readonly kind: HomepageFetchFailure;
  readonly issues: string[];

  constructor(kind: HomepageFetchFailure, message: string, issues: string[] = []) {
    super(message);
    this.name = 'HomepageFetchError';
    this.kind = kind;
    this.issues = issues;
  }
}

export interface HomepageFetchResult {
  notModified: boolean;
  document: HomepageDocument | null;
  etag: string | null;
}

export function homepagePlatform(): HomepagePlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'web') return 'web';
  return 'android';
}

const TIMEOUT_MS = 8_000;

export async function fetchHomepage(options: {
  etag?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<HomepageFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort);

  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.etag) headers['if-none-match'] = options.etag;

    // `/home` is the alias for the same document; `/homepage` stays for older clients and the web.
    const response = await fetch(`${API_BASE}/home?platform=${homepagePlatform()}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (response.status === 304) {
      return { notModified: true, document: null, etag: options.etag ?? null };
    }
    if (!response.ok) {
      throw new HomepageFetchError('http', `The homepage request failed with ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new HomepageFetchError('invalid', 'The homepage response was not JSON.');
    }

    const parsed = parseHomepageDocument(payload);
    if (!parsed.ok) {
      throw new HomepageFetchError('invalid', 'The homepage response did not match the contract.', parsed.issues);
    }

    return { notModified: false, document: parsed.value, etag: response.headers.get('etag') };
  } catch (error) {
    if (error instanceof HomepageFetchError) throw error;
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new HomepageFetchError('timeout', 'The homepage request timed out.');
    }
    throw new HomepageFetchError('network', 'The homepage could not be reached.');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
