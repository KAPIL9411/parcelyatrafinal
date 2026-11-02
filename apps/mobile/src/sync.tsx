import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { syncApi } from './api/client.ts';
import { useSession } from './session.tsx';
import { changedScopes, queryKeysForScopes } from './sync-scopes.ts';

/**
 * Keeps the signed-in app in step with the server while it is in the foreground.
 *
 * The refresh bug was not only a missing WebSocket: a booking screen that was already open never
 * learned that the other party had accepted, paid or cancelled. Some screens polled, most did not,
 * and none of them reconciled on foreground. This bridge asks one question — "has anything I can
 * see changed?" — and invalidates only the query families whose revision moved.
 *
 * Why not a socket here: the Socket.IO server in this repository cannot run on Cloudflare Workers
 * (no HTTP upgrade event), and a Durable Object fan-out is not needed to fix list staleness. The
 * live-tracking screen keeps its own socket for position updates, where seconds matter.
 *
 * Android suspends JavaScript when the app leaves the foreground, so the timer is not a guarantee:
 * the AppState listener runs an immediate poll when the app becomes active again, and that poll
 * reconciles anything missed while the device was asleep. Failures back off instead of retrying
 * every interval.
 */

const DEFAULT_POLL_MS = 30_000;
const MAX_POLL_MS = 180_000;

const configured = Number(process.env.EXPO_PUBLIC_SYNC_POLL_MS);
const POLL_MS = Number.isFinite(configured) && configured >= 10_000 ? configured : DEFAULT_POLL_MS;

export function SyncBridge(): null {
  const client = useQueryClient();
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'signed_in') return;

    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let baseline: Record<string, string> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const delay = (): number => Math.min(POLL_MS * 2 ** failures, MAX_POLL_MS);

    const schedule = (ms: number): void => {
      if (stopped) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void tick(), ms);
    };

    const tick = async (): Promise<void> => {
      if (stopped || inFlight) return;
      if (AppState.currentState !== 'active') {
        // No network in the background. The AppState listener resumes with an immediate poll.
        schedule(delay());
        return;
      }
      inFlight = true;
      try {
        const next = await syncApi.state();
        if (stopped) return;
        failures = 0;
        const changed = changedScopes(baseline, next.scopes);
        baseline = next.scopes;
        for (const key of queryKeysForScopes(changed)) {
          void client.invalidateQueries({ queryKey: key });
        }
      } catch {
        if (stopped) return;
        // Background bookkeeping: never surface a poll failure. The screen's own fetch reports
        // its errors where the user can act on them.
        failures = Math.min(failures + 1, 5);
      } finally {
        inFlight = false;
        if (!stopped) schedule(delay());
      }
    };

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') schedule(0);
    });

    void tick();

    return () => {
      stopped = true;
      subscription.remove();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [status, client]);

  return null;
}
