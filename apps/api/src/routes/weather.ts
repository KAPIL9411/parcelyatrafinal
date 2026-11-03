import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';
import { loadCityWeather } from '../lib/weather.ts';

/**
 * `GET /v1/weather?city_id=…` — current conditions for one city.
 *
 * Public and cacheable: the home screen draws its sky before a session exists. Coordinates are read
 * from the server's own city table, so the endpoint never takes a latitude/longitude pair from the
 * client (which would make it a free geocoding proxy) and never exposes the provider's keyless URL
 * contract beyond this response shape.
 *
 * Not in `api/openapi.yaml`: an additive, documented extension (docs/BUILD_NOTES.md).
 */
export async function weatherRoutes(app: FastifyInstance): Promise<void> {
  app.get('/weather', async (req, reply) => {
    const query = z.object({ city_id: z.string().uuid() }).strict().parse(req.query);

    if (!config.WEATHER_ENABLED) throw new AppError('WEATHER_UNAVAILABLE');

    const city = await app.db.query<{
      id: string;
      name: string;
      lat: number | string;
      lng: number | string;
    }>(`SELECT id, name, lat, lng FROM cities WHERE id = $1 AND status <> 'retired'`, [query.city_id]);

    const row = city.rows[0];
    if (!row) throw new AppError('NOT_FOUND');

    const weather = await loadCityWeather(row.id, Number(row.lat), Number(row.lng));

    reply
      .header('cache-control', 'public, max-age=300, stale-while-revalidate=600')
      .header('vary', 'accept-encoding');

    return {
      city_id: row.id,
      city_name: row.name,
      source: 'open_meteo',
      ...weather,
    };
  });
}
