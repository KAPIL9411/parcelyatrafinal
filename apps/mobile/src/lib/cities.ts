import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { senderApi } from '../api/client.ts';
import type { City } from '../api/types.ts';

/** City reference data, cached for the life of the app session. */
export function useCities() {
  const query = useQuery({
    queryKey: ['cities'],
    queryFn: senderApi.cities,
    staleTime: 60 * 60_000,
  });

  const cities = useMemo(() => query.data?.items ?? [], [query.data]);
  const byId = useMemo(() => new Map(cities.map((city) => [city.id, city])), [cities]);

  return {
    ...query,
    cities,
    serviceable: cities.filter((city) => city.is_serviceable),
    name: (id: string): string => byId.get(id)?.name ?? 'Unknown city',
    city: (id: string): City | undefined => byId.get(id),
  };
}
