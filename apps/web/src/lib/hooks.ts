import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api, ApiError, type AppConfig, type Area, type City, type DevOtp } from './api';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} — Parcel Yatra` : 'Parcel Yatra';
  }, [title]);
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<AppConfig>('/config', { auth: false }),
    staleTime: 10 * 60_000,
  });
}

export function useCities() {
  return useQuery({
    queryKey: ['cities'],
    queryFn: () => api.get<{ items: City[] }>('/cities', { auth: false }),
    staleTime: 10 * 60_000,
    select: (data) => data.items,
  });
}

export function useAreas(cityId: string | null) {
  return useQuery({
    queryKey: ['areas', cityId],
    queryFn: () => api.get<{ items: Area[] }>(`/cities/${cityId}/areas`, { auth: false }),
    enabled: Boolean(cityId),
    staleTime: 10 * 60_000,
    select: (data) => data.items,
  });
}

/** Whole seconds until an ISO timestamp, refreshed once a second. Zero once passed. */
export function useCountdown(target: string | null | undefined): number {
  const [remaining, setRemaining] = useState(() =>
    target ? Math.max(0, Math.round((new Date(target).getTime() - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (!target) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.round((new Date(target).getTime() - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  return remaining;
}

/**
 * The sender's handover code, read from the authenticated API. Unlike `useDevCode` this works in
 * production: the receiver has no account and no stored phone number, so the sender reads the code
 * and says it out loud. The traveller's session gets 404 from the same endpoint by design.
 */
export function useHandoverCode(bookingId: string, phase: 'pickup' | 'delivery', enabled = true) {
  return useQuery({
    queryKey: ['handover-code', bookingId, phase],
    queryFn: () => api.get<{ phase: string; code: string; expires_at: string }>(`/bookings/${bookingId}/handover-code/${phase}`),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Development-only OTP peek.
 *
 * The database stores only HMACs, so the code is unreadable by design. When the API runs with
 * ENABLE_DEV_ENDPOINTS the process keeps the code in memory and exposes it here. The hook returns
 * null in every other configuration, and the UI labels anything it finds as test mode.
 */
export function useDevCode(path: string | null, options: { enabled?: boolean; auth?: boolean } = {}): string | null {
  const { enabled = true, auth = false } = options;
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCode(null);
    if (!path || !enabled) return;

    api
      .get<DevOtp>(path, { auth })
      .then((res) => {
        if (!cancelled) setCode(res.code);
      })
      .catch((err: unknown) => {
        // A missing dev endpoint is the normal production case, not an error worth showing.
        if (!cancelled && !(err instanceof ApiError)) setCode(null);
      });

    return () => {
      cancelled = true;
    };
  }, [path, enabled, auth]);

  return code;
}
