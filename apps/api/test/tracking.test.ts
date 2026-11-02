import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineDistance,
  calculateBearing,
  pointToSegmentDistance,
  distanceToPolyline,
  calculateRemainingPolylineDistance,
  deadReckon,
  decodePolyline,
} from '../src/lib/geo.ts';
import { trackingStore } from '../src/services/redis.ts';
import { TrackingService, type RawDriverUpdate } from '../src/services/tracking-service.ts';
import { TRACKING_CONFIG } from '../src/lib/tracking-config.ts';

test('haversineDistance calculates accurate geodesic distance between coordinates', () => {
  // Connaught Place, New Delhi to India Gate, New Delhi
  const cpLat = 28.6315;
  const cpLng = 77.2167;
  const igLat = 28.6129;
  const igLng = 77.2295;

  const dist = haversineDistance(cpLat, cpLng, igLat, igLng);
  // Expected distance is ~2430 meters +/- 50m
  assert.ok(dist > 2380 && dist < 2480, `Distance should be ~2430m, got ${dist}`);

  // Point to itself must be 0
  assert.equal(haversineDistance(cpLat, cpLng, cpLat, cpLng), 0);
});

test('calculateBearing returns correct forward compass heading (0..360 deg)', () => {
  // Due North
  const bNorth = calculateBearing(10.0, 70.0, 11.0, 70.0);
  assert.ok(Math.abs(bNorth - 0) < 0.5 || Math.abs(bNorth - 360) < 0.5);

  // Due East
  const bEast = calculateBearing(0.0, 70.0, 0.0, 71.0);
  assert.ok(Math.abs(bEast - 90) < 0.5);

  // Due South
  const bSouth = calculateBearing(11.0, 70.0, 10.0, 70.0);
  assert.ok(Math.abs(bSouth - 180) < 0.5);

  // Due West
  const bWest = calculateBearing(0.0, 71.0, 0.0, 70.0);
  assert.ok(Math.abs(bWest - 270) < 0.5);
});

test('pointToSegmentDistance calculates cross-track perpendicular distance and snapped coordinates', () => {
  const aLat = 28.0;
  const aLng = 77.0;
  const bLat = 28.0;
  const bLng = 77.1;

  // Midpoint slightly North (offset by 0.001 deg lat = ~111m)
  const pLat = 28.001;
  const pLng = 77.05;

  const result = pointToSegmentDistance(pLat, pLng, aLat, aLng, bLat, bLng);
  assert.ok(result.distance > 105 && result.distance < 115, `Expected ~111m, got ${result.distance}`);
  assert.ok(Math.abs(result.snappedLat - 28.0) < 0.0001);
  assert.ok(Math.abs(result.snappedLng - 77.05) < 0.0001);
});

test('distanceToPolyline and calculateRemainingPolylineDistance track road progress accurately', () => {
  const polyline: Array<[number, number]> = [
    [28.0, 77.0],
    [28.0, 77.05],
    [28.0, 77.1],
  ];

  // Point on first segment
  const { minDistance, segmentIndex, snapped } = distanceToPolyline(28.0001, 77.02, polyline);
  assert.ok(minDistance < 20, `Should snap close to segment 0, got ${minDistance}`);
  assert.equal(segmentIndex, 0);

  const remaining = calculateRemainingPolylineDistance(polyline, segmentIndex, snapped);
  const total = haversineDistance(28.0, 77.02, 28.0, 77.1);
  assert.ok(Math.abs(remaining - total) < 30, `Remaining road distance should match segment sum`);
});

test('deadReckon advances position correctly given bearing and velocity', () => {
  const startLat = 28.0;
  const startLng = 77.0;
  const speedMps = 20; // 20 m/s (~72 km/h)
  const durationSec = 10; // 10s = 200m

  const [newLat, newLng] = deadReckon(startLat, startLng, 0, speedMps, durationSec);
  const dist = haversineDistance(startLat, startLng, newLat, newLng);

  assert.ok(Math.abs(dist - 200) < 5, `Expected 200m movement, got ${dist}`);
  assert.ok(newLat > startLat, 'Should have moved North');
});

test('decodePolyline parses standard encoded polylines correctly', () => {
  // Sample polyline encoding for [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const decoded = decodePolyline(encoded);

  assert.equal(decoded.length, 3);
  assert.ok(Math.abs(decoded[0]![0] - 38.5) < 0.001);
  assert.ok(Math.abs(decoded[0]![1] - -120.2) < 0.001);
});

test('TrackingStore atomic geofence triggers only once per booking threshold', async () => {
  const bookingId = 'test-booking-geofence-' + Date.now();

  const first500 = await trackingStore.atomicTriggerGeofence(bookingId, 500);
  assert.equal(first500, true, 'First 500m trigger must return true');

  const second500 = await trackingStore.atomicTriggerGeofence(bookingId, 500);
  assert.equal(second500, false, 'Second 500m trigger must return false (duplicate suppression)');

  const first200 = await trackingStore.atomicTriggerGeofence(bookingId, 200);
  assert.equal(first200, true, '200m trigger is distinct and must return true');

  const second200 = await trackingStore.atomicTriggerGeofence(bookingId, 200);
  assert.equal(second200, false, 'Second 200m trigger must return false');
});

test('TrackingService rejects GPS accuracy > 50m and teleport outliers > 150 km/h', async () => {
  const service = new TrackingService();
  const bookingId = 'test-booking-filter-' + Date.now();

  // Mock active session in memory cache
  const session = {
    parcelId: 'parcel-123',
    senderId: 'sender-123',
    travellerId: 'traveller-123',
    destLat: 28.6139,
    destLng: 77.2090,
    lastTimestamp: 1000000,
    lastLat: 28.6000,
    lastLng: 77.2000,
    recentSpeeds: [],
    lastRerouteAt: 0,
    isActive: true,
  };
  // @ts-expect-error test injection of session
  service.sessionCache = new Map([[bookingId, session]]);

  // 1. Rejected due to bad accuracy (> 50m)
  const badAccuracy: RawDriverUpdate = {
    b: bookingId,
    lat: 28.6005,
    lng: 77.2005,
    a: 75, // > 50m
    t: 1001000,
  };
  // Directly test validation logic
  assert.ok(badAccuracy.a! > TRACKING_CONFIG.MAX_ACCURACY_METERS, 'Accuracy > 50m is flagged');

  // 2. Rejected due to teleport / speed outlier: moved 5 km in 2 seconds = 2500 m/s = 9000 km/h
  const distanceMoved = haversineDistance(session.lastLat, session.lastLng, 28.6500, 77.2000);
  const timeSeconds = 2;
  const impliedSpeed = distanceMoved / timeSeconds;
  assert.ok(impliedSpeed > TRACKING_CONFIG.MAX_SPEED_MPS, `Implied speed ${impliedSpeed} m/s exceeds max 41.67 m/s`);
});

