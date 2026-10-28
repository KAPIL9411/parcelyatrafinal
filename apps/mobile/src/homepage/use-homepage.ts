/**
 * The homepage as the screen sees it: a document that is always renderable.
 *
 * The order of operations is the whole design:
 *
 *   1. start with the bundled default, so the first frame is never empty;
 *   2. paint the cached document as soon as it is read (no spinner, no layout shift);
 *   3. ask the server in the background and swap only after the response validates;
 *   4. on any failure keep what is on screen — unless the campaign on screen has expired, in which
 *      case fall back to the default rather than keep showing last month's festival.
 *
 * Re-render avoidance: a document identical to the one already applied is discarded. That matters
 * because a refresh runs on a timer and on every foreground, and re-setting state with a new object
 * would re-render the whole page and restart image loads for no reason.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  defaultHomepageDocument,
  isStaleCampaign,
  type HomepageDocument,
} from '@py/domain';

import { fetchHomepage, HomepageFetchError } from './api.ts';
import { readCachedHomepage, writeCachedHomepage } from './cache.ts';
import { homePalette, type HomePalette } from './theme.ts';

export type HomepageSource = 'default' | 'cache' | 'network';

export interface HomepageState {
  document: HomepageDocument;
  palette: HomePalette;
  source: HomepageSource;
  /** True until the first cache read and network attempt have both settled. Never blocks paint. */
  settling: boolean;
  refreshing: boolean;
  error: HomepageFetchError | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  dismissError: () => void;
}

function signature(document: HomepageDocument): string {
  return JSON.stringify({
    version: document.version,
    published_at: document.published_at,
    theme: document.theme,
    hero: document.hero,
    sections: document.sections,
  });
}

export function useHomepage(): HomepageState {
  const [document, setDocument] = useState<HomepageDocument>(() => defaultHomepageDocument());
  const [source, setSource] = useState<HomepageSource>('default');
  const [settling, setSettling] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<HomepageFetchError | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const etag = useRef<string | null>(null);
  const current = useRef<HomepageDocument>(document);
  // Filled on the first render only; `signature()` walks the whole document and must not run on
  // every render of the screen.
  const signatureRef = useRef<string | undefined>(undefined);
  if (signatureRef.current === undefined) signatureRef.current = signature(document);
  const lastAttempt = useRef(0);

  const apply = useCallback((next: HomepageDocument, from: HomepageSource, nextEtag: string | null): void => {
    etag.current = nextEtag;
    const nextSignature = signature(next);
    if (nextSignature === signatureRef.current) {
      // Same content: keep the object identity so nothing downstream re-renders.
      setSource(from);
      setLastUpdated(new Date());
      return;
    }
    signatureRef.current = nextSignature;
    current.current = next;
    setDocument(next);
    setSource(from);
    setLastUpdated(new Date());
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastAttempt.current = Date.now();
    if (mounted.current) setRefreshing(true);

    try {
      const result = await fetchHomepage({ etag: etag.current });
      if (!mounted.current) return;

      if (result.notModified) {
        setError(null);
        setLastUpdated(new Date());
        return;
      }
      if (!result.document) return;

      apply(result.document, 'network', result.etag);
      setError(null);
      void writeCachedHomepage(result.document, result.etag);
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        caught instanceof HomepageFetchError
          ? caught
          : new HomepageFetchError('network', 'The homepage could not be refreshed.'),
      );

      // The refresh failed. If what we are showing is a campaign that has since expired, the
      // default page is the honest answer.
      if (isStaleCampaign(current.current)) {
        const fallback = defaultHomepageDocument();
        signatureRef.current = signature(fallback);
        current.current = fallback;
        setDocument(fallback);
        setSource('default');
        etag.current = null;
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setRefreshing(false);
        setSettling(false);
      }
    }
  }, [apply]);

  // First paint from the cache, then a background refresh. Runs once.
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;

    void (async () => {
      const cached = await readCachedHomepage();
      if (cancelled) return;
      if (cached) apply(cached.document, 'cache', cached.etag);
      await refresh();
    })();

    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [apply, refresh]);

  // Keep the page current for as long as it is on screen. The server tells us how soon it wants to
  // be asked again; a campaign ending in two minutes asks sooner than a static page.
  useEffect(() => {
    const seconds = Math.max(60, document.refresh_after_seconds);
    const timer = setInterval(() => void refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [document.refresh_after_seconds, refresh]);

  // A phone that was backgrounded through a publish should not need a pull-to-refresh.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastAttempt.current > 60_000) {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  const palette = useMemo(() => homePalette(document.theme), [document.theme]);

  return {
    document,
    palette,
    source,
    settling,
    refreshing,
    error,
    lastUpdated,
    refresh,
    dismissError: () => setError(null),
  };
}
