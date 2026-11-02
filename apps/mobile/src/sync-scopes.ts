/**
 * Which query families a change-feed scope invalidates on the device.
 *
 * Every entry is a React Query key prefix, so invalidating `['bookings']` also reaches
 * `['bookings','all']` and `['bookings','recent']`. Kept free of React Native imports so it can be
 * tested with plain node.
 */
export const SYNC_SCOPE_QUERY_KEYS: Record<string, readonly (readonly unknown[])[]> = {
  bookings: [['bookings'], ['booking']],
  parcels: [['parcels'], ['parcel'], ['parcel-offers']],
  trips: [['trips'], ['trip'], ['trip-opportunities']],
  notifications: [['notifications']],
  messages: [['conversations'], ['thread'], ['inbox']],
  verification: [['verification']],
  interests: [['trip-opportunities'], ['parcel-offers']],
};

/**
 * Scopes whose revision moved since the previous poll.
 *
 * `previous === null` is the first poll after sign-in: that is the baseline, not a change. The
 * screens mounting at that moment already fetch, so invalidating everything would double the load.
 */
export function changedScopes(
  previous: Record<string, string> | null,
  next: Record<string, string>,
): string[] {
  if (!previous) return [];
  return Object.keys(next)
    .filter((scope) => previous[scope] !== next[scope])
    .sort();
}

/** Flatten changed scopes into the query-key prefixes that should be invalidated. */
export function queryKeysForScopes(scopes: readonly string[]): readonly (readonly unknown[])[] {
  const seen = new Set<string>();
  const keys: (readonly unknown[])[] = [];
  for (const scope of scopes) {
    for (const key of SYNC_SCOPE_QUERY_KEYS[scope] ?? []) {
      const id = JSON.stringify(key);
      if (seen.has(id)) continue;
      seen.add(id);
      keys.push(key);
    }
  }
  return keys;
}
