/**
 * Driver-side GPS filtering and adaptive sampling engine.
 * Ensures high fidelity, low battery drain (<5%/hr), and noise elimination.
 */

import { GpsKalmanFilter, type KalmanPoint } from './KalmanFilter.ts';

export interface RawGpsPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface CompactTransmissionPacket {
  b: string;       // bookingId
  lat: number;
  lng: number;
  s?: number;      // speed in m/s (omitted if delta small)
  h?: number;      // heading in degrees (omitted if delta small)
  a?: number;      // accuracy in meters
  t: number;       // epoch ms
}

const EARTH_RADIUS_METERS = 6371000;
const TO_RAD = Math.PI / 180;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLon = (lon2 - lon1) * TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * TO_RAD) * Math.cos(lat2 * TO_RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class GpsFilterPipeline {
  private kalman = new GpsKalmanFilter();
  private lastTransmittedPoint: KalmanPoint | null = null;
  private lastTransmissionTime: number = 0;

  /**
   * Evaluates and filters raw GPS readings. Returns a compact transmission packet if eligible,
   * or null if the point is filtered out (stationary, jitter, bad accuracy, or teleport).
   */
  process(raw: RawGpsPoint, bookingId: string): CompactTransmissionPacket | null {
    // 1. Accuracy Filter: discard points with accuracy > 50m
    if (raw.accuracy > 50) {
      return null;
    }

    // 2. Outlier / Teleport Rejection: check implied speed against max 150 km/h (41.67 m/s)
    if (this.lastTransmittedPoint) {
      const dtSeconds = (raw.timestamp - this.lastTransmittedPoint.timestamp) / 1000;
      if (dtSeconds > 0) {
        const dist = haversineMeters(
          this.lastTransmittedPoint.lat,
          this.lastTransmittedPoint.lng,
          raw.latitude,
          raw.longitude,
        );
        const impliedSpeed = dist / dtSeconds;
        if (impliedSpeed > 41.667) {
          // Unrealistic jump -> ignore
          return null;
        }
      }
    }

    // 3. Kalman Filter: smooth coordinate and stabilize velocity/bearing
    const smoothed = this.kalman.filter(raw.latitude, raw.longitude, raw.accuracy, raw.timestamp);

    // 4. Adaptive Sampling and Distance Filtering
    const speedMps = raw.speed !== null && raw.speed >= 0 ? raw.speed : smoothed.speedMps;
    const now = raw.timestamp;
    const elapsedMs = now - this.lastTransmissionTime;

    let targetIntervalMs = 5000; // Default 5s
    if (speedMps > 5.556) {
      targetIntervalMs = 2500;   // High speed (> 20 km/h): 2.5s
    } else if (speedMps < 0.5) {
      targetIntervalMs = 20000;  // Stationary (< 1.8 km/h): 20s heartbeat
    }

    // Check distance filter: must have moved >= 10m UNLESS max interval has elapsed (heartbeat)
    let movedDistance = 0;
    if (this.lastTransmittedPoint) {
      movedDistance = haversineMeters(
        this.lastTransmittedPoint.lat,
        this.lastTransmittedPoint.lng,
        smoothed.lat,
        smoothed.lng,
      );
    } else {
      movedDistance = 100; // Force first point through
    }

    const shouldTransmit =
      movedDistance >= 10 ||
      elapsedMs >= targetIntervalMs ||
      !this.lastTransmittedPoint;

    if (!shouldTransmit) {
      return null;
    }

    // 5. Delta Compression: only send changed fields
    const packet: CompactTransmissionPacket = {
      b: bookingId,
      lat: smoothed.lat,
      lng: smoothed.lng,
      t: smoothed.timestamp,
      a: Number(raw.accuracy.toFixed(1)),
    };

    // If speed or heading changed noticeably, include them
    const heading = raw.heading !== null && raw.heading >= 0 ? raw.heading : smoothed.bearingDeg;
    if (
      !this.lastTransmittedPoint ||
      Math.abs(speedMps - this.lastTransmittedPoint.speedMps) > 1.0
    ) {
      packet.s = Number(speedMps.toFixed(1));
    }

    if (
      !this.lastTransmittedPoint ||
      Math.abs(heading - this.lastTransmittedPoint.bearingDeg) > 5.0
    ) {
      packet.h = Number(heading.toFixed(1));
    }

    this.lastTransmittedPoint = {
      ...smoothed,
      speedMps,
      bearingDeg: heading,
    };
    this.lastTransmissionTime = now;

    return packet;
  }

  reset(): void {
    this.kalman.reset();
    this.lastTransmittedPoint = null;
    this.lastTransmissionTime = 0;
  }
}

