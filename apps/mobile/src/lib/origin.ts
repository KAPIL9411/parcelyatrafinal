/**
 * The pickup city the user chose on the homepage.
 *
 * It is a preference, not a setting: it pre-fills the booking flow and labels the header chip, and it
 * is remembered so the next launch does not ask again. The stored value is only a `{id, name}` pair
 * and is always re-checked against the live city list before it is used, because a city can be taken
 * out of service between releases.
 */
import { useCallback, useEffect, useState } from 'react';

import { readPreference, writePreference } from './preferences.ts';

const KEY = 'py.origin_city';

export interface OriginCity {
  id: string;
  name: string;
}

function parse(raw: string | null): OriginCity | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return null;
    return { id: record.id, name: record.name };
  } catch {
    return null;
  }
}

export function useOriginCity(): {
  origin: OriginCity | null;
  setOrigin: (city: OriginCity | null) => void;
  /** False until the stored value has been read, so the header does not flash "Pickup city". */
  ready: boolean;
} {
  const [origin, setOriginState] = useState<OriginCity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = parse(await readPreference(KEY));
      if (cancelled) return;
      if (stored) setOriginState(stored);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setOrigin = useCallback((city: OriginCity | null) => {
    setOriginState(city);
    void writePreference(KEY, city ? JSON.stringify(city) : null);
  }, []);

  return { origin, setOrigin, ready };
}
