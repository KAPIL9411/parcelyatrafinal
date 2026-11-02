import type { FastifyInstance } from 'fastify';

/**
 * Public reference data.
 *
 * NOTE: `GET /v1/cities` is not in api/openapi.yaml. The sender wizard cannot work without a city
 * list, so this is an additive, documented extension (see docs/BUILD_NOTES.md, DEFECT-005). It
 * returns no personal data. The contract should gain this endpoint before the API is frozen.
 */
export async function catalogueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/cities', async () => {
    const res = await app.db.query<{
      id: string;
      name: string;
      state: string;
      is_serviceable: boolean;
    }>(`SELECT id, name, state, is_serviceable FROM cities ORDER BY is_serviceable DESC, name ASC`);

    return {
      items: res.rows.map((c) => ({
        id: c.id,
        name: c.name,
        state: c.state,
        is_serviceable: c.is_serviceable,
      })),
    };
  });

  app.get<{ Params: { cityId: string } }>('/cities/:cityId/areas', async (req) => {
    const res = await app.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM areas WHERE city_id = $1 ORDER BY name ASC`,
      [req.params.cityId],
    );
    return { items: res.rows };
  });

  app.get('/config', async () => {
    // Safe, public runtime configuration for the client. No secrets, no limits that are not
    // already printed in the UI copy.
    return {
      modes: ['car'],
      categories: [
        'documents',
        'educational_certificates',
        'business_samples',
        'spare_parts_dry',
        'cosmetics_sealed',
        'printed_material',
        'religious_items',
        'keys',
        'electronics_accessories_low_value',
      ],
      limits: {
        max_weight_kg: 5,
        max_dimension_cm: 45,
        max_declared_value_paise: 500_000,
        max_window_days: 7,
      },
      payments: { sandbox: true, live: false },
    };
  });
}
