import { config } from '../config.ts';
import { decodePolyline, haversineDistance } from '../lib/geo.ts';
import { TRACKING_CONFIG } from '../lib/tracking-config.ts';

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline: Array<[number, number]>; // Array of [lat, lng]
  /**
   * Where the numbers came from. `estimated` is the straight-line fallback, not a road, and callers
   * that promise road distance (matching, ETA) must say so rather than present it as measured.
   */
  source: 'routed' | 'estimated';
  fetchedAt: number;
}

interface CachedRoute {
  route: RouteResult;
  destLat: number;
  destLng: number;
  lastFetchedAt: number;
}

const routeCache = new Map<string, CachedRoute>();

/**
 * Fetches road route from origin to destination using Open Source Routing Machine (OSRM).
 * Uses public OSRM router with strict caching and local fallbacks.
 */
export async function getOsrmRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  bookingId?: string,
): Promise<RouteResult> {
  const cacheKey = bookingId ?? `${originLat.toFixed(4)},${originLng.toFixed(4)}->${destLat.toFixed(4)},${destLng.toFixed(4)}`;
  const cached = routeCache.get(cacheKey);
  const now = Date.now();

  // Return cached route if less than MIN_REROUTE_INTERVAL_MS has elapsed
  if (cached && now - cached.lastFetchedAt < TRACKING_CONFIG.MIN_REROUTE_INTERVAL_MS) {
    return cached.route;
  }

  // Coordinates for OSRM URL are formatted as {longitude},{latitude}
  const url = `${config.OSRM_ROUTER_URL}/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=polyline`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4-second timeout to prevent lag

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ParcelYatra-LiveTracking/1.0' },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as {
        code: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: string;
        }>;
      };

      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const primary = data.routes[0];
        if (primary) {
          const decodedPoints = decodePolyline(primary.geometry);

          const routeResult: RouteResult = {
            distanceMeters: Math.round(primary.distance),
            durationSeconds: Math.round(primary.duration),
            polyline: decodedPoints,
            source: 'routed',
            fetchedAt: now,
          };

          routeCache.set(cacheKey, {
            route: routeResult,
            destLat,
            destLng,
            lastFetchedAt: now,
          });

          return routeResult;
        }
      }
    }
  } catch (err) {
    // If OSRM is unreachable or timed out, gracefully fallback
    console.warn('[OSRM Route Warning] Fallback to direct geodesic line:', (err as Error).message);
  }

  // Graceful fallback: create direct straight line if OSRM is unavailable
  const directDistance = haversineDistance(originLat, originLng, destLat, destLng);
  // Estimate driving distance as ~1.25x straight-line, average city/highway speed 30 km/h (8.33 m/s)
  const estDistance = Math.round(directDistance * 1.25);
  const estDuration = Math.round(estDistance / 8.33);

  const fallbackResult: RouteResult = {
    distanceMeters: estDistance,
    durationSeconds: estDuration,
    polyline: [
      [originLat, originLng],
      [destLat, destLng],
    ],
    source: 'estimated',
    fetchedAt: now,
  };

  routeCache.set(cacheKey, {
    route: fallbackResult,
    destLat,
    destLng,
    lastFetchedAt: now,
  });

  return fallbackResult;
}

/**
 * Snaps a raw GPS point to the nearest road network using OSRM /nearest API.
 */
export async function snapToNearestRoad(
  lat: number,
  lng: number,
): Promise<{ snappedLat: number; snappedLng: number; distance: number }> {
  const url = `${config.OSRM_ROUTER_URL}/nearest/v1/driving/${lng},${lat}?number=1`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as {
        code: string;
        waypoints?: Array<{
          location: [number, number]; // [lng, lat]
          distance: number;
        }>;
      };

      if (data.code === 'Ok' && data.waypoints && data.waypoints.length > 0) {
        const wp = data.waypoints[0];
        if (wp && wp.location) {
          return {
            snappedLat: wp.location[1],
            snappedLng: wp.location[0],
            distance: wp.distance,
          };
        }
      }
    }
  } catch {
    // Fallback: return raw coordinate
  }

  return { snappedLat: lat, snappedLng: lng, distance: 0 };
}

/**
 * Invalidates cached route for a booking (e.g. when completed or rerouting).
 */
export function invalidateRouteCache(bookingId: string): void {
  routeCache.delete(bookingId);
}

