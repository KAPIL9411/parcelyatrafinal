import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { senderApi } from '../api/client.ts';
import { ApiError } from '../api/http.ts';
import type { RoutePreview } from '../api/types.ts';

interface RoutePreviewInput {
  originCityId: string;
  destCityId: string;
  originArea: string;
  destArea: string;
}

/** Areas are typed, so the map waits for the typing to settle before it asks for a route. */
function useDebounced(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * The road between the two chosen cities.
 *
 * The previous route stays on screen while the next one is fetched, which is what makes a city
 * change read as the map moving rather than as the map blanking. A pair that cannot be routed
 * returns a message, never a straight line: `source` on the wire is always `routed`.
 */
export function useRoutePreview({ originCityId, destCityId, originArea, destArea }: RoutePreviewInput): {
  route: RoutePreview | null;
  ready: boolean;
  fetching: boolean;
  error: string | null;
  retry: () => void;
} {
  const origin = useDebounced(originArea.trim(), 450);
  const destination = useDebounced(destArea.trim(), 450);
  const ready = Boolean(originCityId && destCityId && originCityId !== destCityId);

  const query = useQuery({
    queryKey: ['route-preview', originCityId, destCityId, origin, destination],
    queryFn: () =>
      senderApi.routePreview({
        origin_city_id: originCityId,
        dest_city_id: destCityId,
        origin_area: origin || undefined,
        dest_area: destination || undefined,
      }),
    enabled: ready,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  return {
    route: ready ? (query.data ?? null) : null,
    ready,
    fetching: ready && query.isFetching,
    error: ready && query.isError ? describe(query.error) : null,
    retry: () => void query.refetch(),
  };
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    // `ROUTING_UNAVAILABLE` is what the API answers for both a router that cannot be reached and a
    // pair it has no road for, so the copy names the missing data, never a claim about the network.
    if (error.code === 'ROUTING_UNAVAILABLE') return 'The road between these cities could not be fetched.';
    if (error.code === 'CITY_NOT_SERVICED') return 'These two cities cannot be paired.';
    if (error.code === 'NETWORK' || error.code === 'TIMEOUT') return 'You appear to be offline.';
    return error.message;
  }
  return 'The route could not be loaded.';
}
