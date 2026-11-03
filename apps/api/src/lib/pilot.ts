import type { FastifyInstance } from 'fastify';

import {
  corridorLegOf,
  quotePilotParcel,
  type Category,
  type GeoPoint,
  type MatchInput,
  type PilotTariffPolicy,
} from '@py/domain';

import { AppError } from './errors.ts';

/**
 * Server-side helpers for the finalized pilot tariff: corridor stop resolution, refusal of
 * off-corridor parcels, and the extra gates the matching engine needs so a corridor parcel only
 * matches a trip that actually passes the intermediate stops, in order.
 */

export function pilotStopNameFor(policy: PilotTariffPolicy, cityId: string, cityName: string): string | null {
  const byId = policy.corridorStops.find((s) => s.cityId === cityId);
  if (byId) return byId.name;
  const lower = cityName.trim().toLowerCase();
  return policy.corridorStops.find((s) => s.name.trim().toLowerCase() === lower)?.name ?? null;
}

/** Quote a corridor parcel, or refuse it: the pilot tariff covers only the launch corridor. */
export function pilotCorridorQuote(
  policy: PilotTariffPolicy,
  originCityId: string,
  originCityName: string,
  destCityId: string,
  destCityName: string,
  parcel: { weightKg: number; dimsCm: readonly number[]; category: Category },
) {
  const originStop = pilotStopNameFor(policy, originCityId, originCityName);
  const destStop = pilotStopNameFor(policy, destCityId, destCityName);
  const leg = originStop && destStop ? corridorLegOf(policy, originStop, destStop) : null;
  if (!originStop || !destStop || !leg) {
    throw new AppError(
      'CITY_NOT_SERVICED',
      { reason: 'outside_launch_corridor', origin_city_id: originCityId, dest_city_id: destCityId },
      'The pilot serves the Bareilly–Nainital launch corridor. Pick both ends from the corridor stops.',
    );
  }
  const priced = quotePilotParcel({
    originStop,
    destStop,
    actualWeightKg: parcel.weightKg,
    dimsCm: parcel.dimsCm,
    category: parcel.category,
    policy,
  });
  return { priced, leg, originStop, destStop };
}

/**
 * Fields the matching engine needs under the pilot tariff: the policy caps (3 kg, 30×25×20), the
 * corridor intermediates gate, and the real tariff as the match-card indicative price. Off-corridor
 * parcels only inherit the caps — legacy pairs keep working under the matching defaults.
 */
export async function pilotMatchFields(
  app: FastifyInstance,
  policy: PilotTariffPolicy,
  parcel: {
    origin_city_id: string;
    dest_city_id: string;
    weightKg: number;
    dimsCm: readonly number[];
    category: Category;
  },
  cityNames: { origin: string; dest: string },
): Promise<Partial<MatchInput>> {
  const fields: Partial<MatchInput> = {
    limits: { maxWeightKg: policy.maxWeightKg, maxDimsCm: policy.maxDimsCm },
  };

  const originStop = pilotStopNameFor(policy, parcel.origin_city_id, cityNames.origin);
  const destStop = pilotStopNameFor(policy, parcel.dest_city_id, cityNames.dest);
  const leg = originStop && destStop ? corridorLegOf(policy, originStop, destStop) : null;
  if (!leg) return fields;

  if (leg.intermediateStops.length > 0) {
    const res = await app.db.query<{ name: string; lat: string | number; lng: string | number }>(
      `SELECT name, lat, lng FROM cities WHERE name = ANY($1::text[])`,
      [leg.intermediateStops],
    );
    const byName = new Map(res.rows.map((r) => [r.name.trim().toLowerCase(), r]));
    const points: GeoPoint[] = [];
    for (const stop of leg.intermediateStops) {
      const city = byName.get(stop.trim().toLowerCase());
      if (city) points.push({ lat: Number(city.lat), lng: Number(city.lng) });
    }
    if (points.length > 0) fields.corridorIntermediates = points;
  }

  try {
    fields.indicativePricePaise = quotePilotParcel({
      originStop: originStop as string,
      destStop: destStop as string,
      actualWeightKg: parcel.weightKg,
      dimsCm: parcel.dimsCm,
      category: parcel.category,
      policy,
    }).total_paise;
  } catch {
    // A parcel the tariff cannot price (over-limit weight) gets no indicative; the launch fallback
    // in the engine is wrong for the corridor, so an omitted figure is the honest answer.
  }
  return fields;
}

/** Operator-editable prohibited keywords layered on the compiled pattern list. */
export async function loadProhibitedKeywords(app: FastifyInstance): Promise<string[]> {
  const res = await app.db.query<{ keyword: string }>(
    `SELECT keyword FROM prohibited_items WHERE enabled`,
  );
  return res.rows.map((r) => r.keyword);
}
