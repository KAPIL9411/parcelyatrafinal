import { z } from 'zod';

import { config } from '../config.ts';
import { AppError } from './errors.ts';

/**
 * Current weather for a city, from Open-Meteo.
 *
 * The provider is keyless and answers a single `current` block, so the browser and the phone never
 * see a provider URL or an API key: the server resolves the city's coordinates from its own table
 * and hands back a small, stable snapshot.
 *
 * Two rules shape this module:
 *
 *  - **WMO codes are mapped, never forwarded.** The provider's `weather_code` is a meteorological
 *    code; the client needs a condition it can draw and a label a person can read. The mapping is
 *    total: an unknown code is still a cloud, so a new code in the feed cannot blank the sky.
 *  - **A failure is a failure.** If the provider does not answer, the route says so with
 *    `WEATHER_UNAVAILABLE`; it never invents a temperature. The one concession is a *stale* copy:
 *    a reading this server already received less than six hours ago is still real, so it is served
 *    with `stale: true` rather than dropped.
 */

export type WeatherCondition =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunderstorm';

export interface WeatherSnapshot {
  condition: WeatherCondition;
  label: string;
  is_day: boolean;
  temperature_c: number;
  apparent_c: number;
  humidity_pct: number;
  wind_kph: number;
  precipitation_mm: number;
  cloud_cover_pct: number;
  weather_code: number;
  /** Provider observation time, ISO 8601 UTC. */
  observed_at: string;
}

export interface CityWeather extends WeatherSnapshot {
  /** `observed_at` is older than the cache window and the provider could not be reached. */
  stale: boolean;
  /** When this server received the reading (ISO 8601 UTC). */
  fetched_at: string;
}

interface MappedCode {
  condition: WeatherCondition;
  label: string;
}

/**
 * WMO 4677 present-weather codes as Open-Meteo reports them. Codes 0–3 describe cloud amount,
 * 45/48 visibility, 51–67 and 80–82 liquid precipitation, 71–77 and 85/86 frozen precipitation,
 * 95–99 convective storms.
 */
export function wmoToWeather(code: number): MappedCode {
  switch (code) {
    case 0:
      return { condition: 'clear', label: 'Clear sky' };
    case 1:
      return { condition: 'partly_cloudy', label: 'Mostly clear' };
    case 2:
      return { condition: 'partly_cloudy', label: 'Partly cloudy' };
    case 3:
      return { condition: 'cloudy', label: 'Overcast' };
    case 45:
      return { condition: 'fog', label: 'Fog' };
    case 48:
      return { condition: 'fog', label: 'Freezing fog' };
    case 51:
      return { condition: 'drizzle', label: 'Light drizzle' };
    case 53:
    case 55:
      return { condition: 'drizzle', label: 'Drizzle' };
    case 56:
    case 57:
      return { condition: 'drizzle', label: 'Freezing drizzle' };
    case 61:
      return { condition: 'rain', label: 'Light rain' };
    case 63:
      return { condition: 'rain', label: 'Rain' };
    case 65:
      return { condition: 'rain', label: 'Heavy rain' };
    case 66:
    case 67:
      return { condition: 'rain', label: 'Freezing rain' };
    case 71:
      return { condition: 'snow', label: 'Light snow' };
    case 73:
    case 75:
      return { condition: 'snow', label: 'Snow' };
    case 77:
      return { condition: 'snow', label: 'Snow grains' };
    case 80:
      return { condition: 'rain', label: 'Light showers' };
    case 81:
    case 82:
      return { condition: 'rain', label: 'Rain showers' };
    case 85:
    case 86:
      return { condition: 'snow', label: 'Snow showers' };
    case 95:
      return { condition: 'thunderstorm', label: 'Thunderstorm' };
    case 96:
    case 99:
      return { condition: 'thunderstorm', label: 'Thunderstorm with hail' };
    default:
      // A code we do not know is still reported weather; overcast is the least surprising reading.
      return { condition: 'cloudy', label: 'Cloudy' };
  }
}

const providerSchema = z.object({
  current: z.object({
    time: z.string().min(10),
    temperature_2m: z.number(),
    apparent_temperature: z.number().optional(),
    relative_humidity_2m: z.number().optional(),
    wind_speed_10m: z.number().optional(),
    precipitation: z.number().optional(),
    cloud_cover: z.number().optional(),
    is_day: z.number().int().optional(),
    weather_code: z.number().int(),
  }),
});

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;
const twoDecimals = (value: number): number => Math.round(value * 100) / 100;
const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

function isoUtc(time: string): string {
  // `timezone=UTC` makes the provider echo `YYYY-MM-DDTHH:MM` without an offset.
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(time) ? time : `${time}Z`;
}

export interface FetchWeatherOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => number;
}

/** One provider round-trip. Throws `WEATHER_UNAVAILABLE` when the provider cannot be used. */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  options: FetchWeatherOptions = {},
): Promise<WeatherSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? config.OPEN_METEO_BASE_URL;
  const timeoutMs = options.timeoutMs ?? config.WEATHER_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  const url = new URL(baseUrl);
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'is_day',
      'precipitation',
      'weather_code',
      'cloud_cover',
      'wind_speed_10m',
    ].join(','),
  );
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('forecast_days', '1');

  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new AppError('WEATHER_UNAVAILABLE', {
      reason: 'provider_unreachable',
      at: new Date(now()).toISOString(),
    });
  }

  if (!response.ok) {
    throw new AppError('WEATHER_UNAVAILABLE', {
      reason: `provider_http_${response.status}`,
      at: new Date(now()).toISOString(),
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AppError('WEATHER_UNAVAILABLE', { reason: 'provider_malformed' });
  }

  const parsed = providerSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('WEATHER_UNAVAILABLE', { reason: 'provider_malformed' });
  }

  const current = parsed.data.current;
  const mapped = wmoToWeather(current.weather_code);

  return {
    condition: mapped.condition,
    label: mapped.label,
    is_day: (current.is_day ?? 1) === 1,
    temperature_c: oneDecimal(current.temperature_2m),
    apparent_c: oneDecimal(current.apparent_temperature ?? current.temperature_2m),
    humidity_pct: clampPercent(current.relative_humidity_2m ?? 0),
    wind_kph: oneDecimal(current.wind_speed_10m ?? 0),
    precipitation_mm: twoDecimals(current.precipitation ?? 0),
    cloud_cover_pct: clampPercent(current.cloud_cover ?? 0),
    weather_code: current.weather_code,
    observed_at: isoUtc(current.time),
  };
}

interface CacheEntry {
  snapshot: WeatherSnapshot;
  fetchedAt: number;
}

/** Readings this process has received, keyed by city id. Eight cities; no eviction pressure. */
const cache = new Map<string, CacheEntry>();
/** Concurrent requests for the same city share one provider call. */
const inflight = new Map<string, Promise<WeatherSnapshot>>();

const STALE_LIMIT_MS = 6 * 60 * 60_000;

/** Test hook: the cache is process-wide, so a test needs to start from a known state. */
export function resetWeatherCache(): void {
  cache.clear();
  inflight.clear();
}

export interface LoadWeatherOptions extends FetchWeatherOptions {
  /** Cache lifetime override; the route passes `config.WEATHER_CACHE_SECONDS`. */
  ttlMs?: number;
}

/**
 * A city's current weather, cached in-process.
 *
 * The provider updates its `current` block every 15 minutes, so a ten-minute cache costs nothing in
 * freshness and keeps a popular screen from becoming a fan-out. If the refresh fails while an older
 * reading is still inside the six-hour honesty window, that reading is returned with `stale: true`.
 */
export async function loadCityWeather(
  cityId: string,
  latitude: number,
  longitude: number,
  options: LoadWeatherOptions = {},
): Promise<CityWeather> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? config.WEATHER_CACHE_SECONDS * 1_000;
  const entry = cache.get(cityId);
  const at = now();

  if (entry && at - entry.fetchedAt < ttlMs) {
    return { ...entry.snapshot, stale: false, fetched_at: new Date(entry.fetchedAt).toISOString() };
  }

  let pending = inflight.get(cityId);
  if (!pending) {
    pending = fetchWeather(latitude, longitude, options).finally(() => {
      inflight.delete(cityId);
    });
    inflight.set(cityId, pending);
  }

  try {
    const snapshot = await pending;
    const fetchedAt = now();
    cache.set(cityId, { snapshot, fetchedAt });
    return { ...snapshot, stale: false, fetched_at: new Date(fetchedAt).toISOString() };
  } catch (error) {
    const fallback = cache.get(cityId);
    if (fallback && at - fallback.fetchedAt < STALE_LIMIT_MS) {
      return {
        ...fallback.snapshot,
        stale: true,
        fetched_at: new Date(fallback.fetchedAt).toISOString(),
      };
    }
    throw error;
  }
}
