/**
 * Which query families a change-feed scope invalidates.
 *
 * Kept separate from the polling component so it can be tested without a DOM or a network. Every
 * entry is a React Query key *prefix*: invalidating `['bookings']` reaches `['bookings','all']`,
 * `['bookings','recent']` and `['bookings', filter]` alike.
 */
export const SYNC_SCOPE_QUERY_KEYS: Record<string, readonly (readonly unknown[])[]> = {
  bookings: [['bookings'], ['booking']],
  parcels: [['parcels'], ['parcel'], ['parcel-offers'], ['parcel-matches']],
  trips: [['trips'], ['trip'], ['trip-opportunities']],
  notifications: [['notifications']],
  messages: [['conversations'], ['chat']],
  verification: [['verification']],
  interests: [['trip-opportunities'], ['parcel-offers'], ['parcel-matches']],
  admin: [['admin']],
};

/**
 * Scopes whose revision differs from the previous poll.
 *
 * `previous === null` means "first poll after sign-in": that is the baseline, not a change. The
 * screens that mount at sign-in fetch for themselves, so invalidating everything here would only
 * double the load.
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
