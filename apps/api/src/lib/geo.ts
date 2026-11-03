/**
 * High-performance geospatial mathematics utilities.
 * All functions use the WGS84 Earth radius (mean radius = 6371000 meters).
 */

const EARTH_RADIUS_METERS = 6371000;
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Calculates great-circle distance between two points in meters using the Haversine formula.
 * Numerically stable for small and large distances.
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLon = (lon2 - lon1) * TO_RAD;
  const rLat1 = lat1 * TO_RAD;
  const rLat2 = lat2 * TO_RAD;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculates initial forward compass bearing (heading) from point 1 to point 2 in degrees (0..360).
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rLat1 = lat1 * TO_RAD;
  const rLat2 = lat2 * TO_RAD;
  const dLon = (lon2 - lon1) * TO_RAD;

  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);

  const initialBearing = Math.atan2(y, x) * TO_DEG;
  return (initialBearing + 360) % 360;
}

/**
 * Computes shortest distance from point P to line segment A-B using vector projection on a local tangent plane.
 */
export function pointToSegmentDistance(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): { distance: number; snappedLat: number; snappedLng: number } {
  // Convert spherical coordinates to planar Cartesian relative to A for local sub-kilometer accuracy
  const cosLat = Math.cos(((aLat + bLat) / 2) * TO_RAD);
  const ax = 0;
  const ay = 0;
  const bx = (bLng - aLng) * TO_RAD * EARTH_RADIUS_METERS * cosLat;
  const by = (bLat - aLat) * TO_RAD * EARTH_RADIUS_METERS;
  const px = (pLng - aLng) * TO_RAD * EARTH_RADIUS_METERS * cosLat;
  const py = (pLat - aLat) * TO_RAD * EARTH_RADIUS_METERS;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const abLenSq = abx * abx + aby * aby;
  let t = abLenSq > 0 ? (apx * abx + apy * aby) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t)); // clamp to segment bounds

  const projX = ax + t * abx;
  const projY = ay + t * aby;

  const dx = px - projX;
  const dy = py - projY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Convert back to coordinates
  const snappedLat = aLat + (projY / EARTH_RADIUS_METERS) * TO_DEG;
  const snappedLng = aLng + (projX / (EARTH_RADIUS_METERS * cosLat)) * TO_DEG;

  return { distance: dist, snappedLat, snappedLng };
}

/**
 * Finds the nearest point on a polyline, returning the cross-track distance, segment index, and snapped point.
 */
export function distanceToPolyline(
  lat: number,
  lng: number,
  polyline: Array<[number, number]>, // Array of [lat, lng]
): { minDistance: number; segmentIndex: number; snapped: [number, number] } {
  if (polyline.length < 2) {
    const first = polyline[0];
    if (first) {
      return {
        minDistance: haversineDistance(lat, lng, first[0], first[1]),
        segmentIndex: 0,
        snapped: [first[0], first[1]],
      };
    }
    return { minDistance: Infinity, segmentIndex: -1, snapped: [lat, lng] };
  }

  let minDistance = Infinity;
  let bestSegment = 0;
  let bestSnapped: [number, number] = [lat, lng];

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    if (!a || !b) continue;

    const { distance, snappedLat, snappedLng } = pointToSegmentDistance(
      lat,
      lng,
      a[0],
      a[1],
      b[0],
      b[1],
    );

    if (distance < minDistance) {
      minDistance = distance;
      bestSegment = i;
      bestSnapped = [snappedLat, snappedLng];
    }
  }

  return { minDistance, segmentIndex: bestSegment, snapped: bestSnapped };
}

/**
 * Calculates remaining road distance along a polyline starting from a given snapped position on segmentIndex.
 */
export function calculateRemainingPolylineDistance(
  polyline: Array<[number, number]>,
  segmentIndex: number,
  snappedPoint: [number, number],
): number {
  if (polyline.length < 2 || segmentIndex < 0 || segmentIndex >= polyline.length - 1) {
    return 0;
  }

  const nextPoint = polyline[segmentIndex + 1];
  if (!nextPoint) return 0;

  // Distance from snapped position to the end of the current segment
  let totalDistance = haversineDistance(
    snappedPoint[0],
    snappedPoint[1],
    nextPoint[0],
    nextPoint[1],
  );

  // Add all subsequent segments up to destination
  for (let i = segmentIndex + 1; i < polyline.length - 1; i++) {
    const p1 = polyline[i];
    const p2 = polyline[i + 1];
    if (p1 && p2) {
      totalDistance += haversineDistance(p1[0], p1[1], p2[0], p2[1]);
    }
  }

  return Math.round(totalDistance);
}

/**
 * Projects a new coordinate using dead-reckoning given an initial position, bearing, speed (m/s), and elapsed time.
 */
export function deadReckon(
  lat: number,
  lng: number,
  bearingDeg: number,
  speedMps: number,
  elapsedSeconds: number,
): [number, number] {
  const distanceMeters = speedMps * elapsedSeconds;
  if (distanceMeters <= 0) return [lat, lng];

  const distRatio = distanceMeters / EARTH_RADIUS_METERS;
  const bearingRad = bearingDeg * TO_RAD;
  const latRad = lat * TO_RAD;
  const lngRad = lng * TO_RAD;

  const targetLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(distRatio) +
      Math.cos(latRad) * Math.sin(distRatio) * Math.cos(bearingRad),
  );

  const targetLngRad =
    lngRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(distRatio) * Math.cos(latRad),
      Math.cos(distRatio) - Math.sin(latRad) * Math.sin(targetLatRad),
    );

  return [targetLatRad * TO_DEG, targetLngRad * TO_DEG];
}

/**
 * Decodes standard Google / OSRM encoded polyline format string into [lat, lng] array.
 */
export function decodePolyline(encoded: string): Array<[number, number]> {  const points: Array<[number, number]> = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/**
 * Encodes `[lat, lng]` points into the standard Google / OSRM polyline format.
 *
 * The inverse of `decodePolyline`, and it lives next to it so the two can be tested against each
 * other. Trip geometry is stored encoded rather than as JSON: a 400-point route is ~4 KB encoded and
 * ~9 KB as a JSON array, and this column is read on every match request for the corridor.
 */
export function encodePolyline(points: ReadonlyArray<readonly [number, number]>): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';

  for (const point of points) {
    const lat = Math.round(point[0] * 1e5);
    const lng = Math.round(point[1] * 1e5);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    out += encodeSignedNumber(lat - lastLat);
    out += encodeSignedNumber(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }

  return out;
}

function encodeSignedNumber(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

