import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { syncApi } from './api';
import { useSession } from './session';
import { changedScopes, queryKeysForScopes } from './sync-scopes';

/**
 * Keeps the signed-in web session in step with the server.
 *
 * Why polling, and why this endpoint: the previous build relied on each screen to remember to
 * refetch. A screen that was already open never learned that the other party had accepted, paid or
 * cancelled — the user had to reload. A WebSocket would need a second always-on service, and the
 * socket server in this repository cannot run on the Workers runtime at all.
 *
 * One small request every `POLL_MS` asks "has anything I can see changed?". The answer is opaque
 * revisions computed from the authoritative tables, so a missed poll can never leave the page
 * permanently wrong: the next poll compares against the current rows, not against an event log.
 * Only the query families whose revision moved are invalidated, and React Query refetches just the
 * ones that are mounted.
 *
 * The loop stops when the tab is hidden, runs immediately when it becomes visible again, and backs
 * off on failure instead of hammering an unreachable API.
 */

const DEFAULT_POLL_MS = 25_000;
const MAX_POLL_MS = 120_000;

const configuredPoll = Number(import.meta.env.VITE_SYNC_POLL_MS);
const POLL_MS = Number.isFinite(configuredPoll) && configuredPoll >= 5_000 ? configuredPoll : DEFAULT_POLL_MS;

export function SyncBridge(): null {
  const client = useQueryClient();
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;

    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let baseline: Record<string, string> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const delay = (): number => Math.min(POLL_MS * 2 ** failures, MAX_POLL_MS);

    const schedule = (ms: number): void => {
      if (stopped) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void tick(), ms);
    };

    const tick = async (): Promise<void> => {
      if (stopped || inFlight) return;
      if (document.visibilityState === 'hidden') {
        // No network while the tab is hidden. The visibility listener below resumes immediately.
        schedule(delay());
        return;
      }
      inFlight = true;
      try {
        const next = await syncApi.state(controller.signal);
        if (stopped) return;
        failures = 0;
        const changed = changedScopes(baseline, next.scopes);
        baseline = next.scopes;
        for (const key of queryKeysForScopes(changed)) {
          void client.invalidateQueries({ queryKey: key });
        }
      } catch {
        if (stopped) return;
        // A poll is background bookkeeping: it must never raise a toast or an error panel. The next
        // attempt is later, and the authoritative fetch behind every screen still surfaces its own
        // failures where the user can see them.
        failures = Math.min(failures + 1, 5);
      } finally {
        inFlight = false;
        if (!stopped) schedule(delay());
      }
    };

    const onWake = (): void => {
      if (document.visibilityState === 'visible') schedule(0);
    };

    void tick();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);

    return () => {
      stopped = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [status, client]);

  return null;
}
