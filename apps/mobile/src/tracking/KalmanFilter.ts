/**
 * 2-Axis Constant-Velocity Kalman Filter for Realtime GPS Smoothing.
 *
 * Smooths high-frequency GPS jitter (multipath reflection in urban canyons),
 * estimates true velocity vectors, and prevents marker shaking.
 */

export interface KalmanPoint {
  lat: number;
  lng: number;
  speedMps: number;
  bearingDeg: number;
  accuracy: number;
  timestamp: number;
}

export class GpsKalmanFilter {
  // Process noise covariance (Q): how fast true state is assumed to change
  private processNoise: number;
  // State: [lat, lng, vLat, vLng]
  private lat: number = 0;
  private lng: number = 0;
  private vLat: number = 0;
  private vLng: number = 0;
  // Variance estimate (P)
  private variance: number = -1;
  private lastTimestamp: number = 0;

  constructor(processNoise = 3.0) {
    this.processNoise = processNoise;
  }

  /**
   * Resets filter state (e.g. when starting a new trip or after long gap).
   */
  reset(): void {
    this.variance = -1;
    this.lastTimestamp = 0;
    this.vLat = 0;
    this.vLng = 0;
  }

  /**
   * Ingests a raw GPS measurement and outputs the optimal Bayesian-filtered coordinate.
   */
  filter(
    measuredLat: number,
    measuredLng: number,
    accuracyMeters: number,
    timestampMs: number,
  ): KalmanPoint {
    // Measurement noise covariance (R): square of accuracy in meters
    const measurementNoise = Math.max(accuracyMeters, 1) ** 2;

    if (this.variance < 0) {
      // First measurement: initialize filter
      this.lat = measuredLat;
      this.lng = measuredLng;
      this.variance = measurementNoise;
      this.lastTimestamp = timestampMs;

      return {
        lat: measuredLat,
        lng: measuredLng,
        speedMps: 0,
        bearingDeg: 0,
        accuracy: accuracyMeters,
        timestamp: timestampMs,
      };
    }

    const dtSeconds = Math.max(0.1, (timestampMs - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestampMs;

    // 1. Prediction Step: project state ahead
    this.lat += this.vLat * dtSeconds;
    this.lng += this.vLng * dtSeconds;
    this.variance += this.processNoise * dtSeconds;

    // 2. Kalman Gain (K): K = P / (P + R)
    const kalmanGain = this.variance / (this.variance + measurementNoise);

    // 3. Update Step: blend prediction with new measurement
    const dLat = measuredLat - this.lat;
    const dLng = measuredLng - this.lng;

    this.lat += kalmanGain * dLat;
    this.lng += kalmanGain * dLng;

    // Update velocity estimation
    this.vLat = (kalmanGain * dLat) / dtSeconds;
    this.vLng = (kalmanGain * dLng) / dtSeconds;

    // Update error covariance
    this.variance *= 1 - kalmanGain;

    // 4. Calculate smoothed speed (m/s) and bearing (degrees)
    const latMeters = this.vLat * 111139; // ~111,139 meters per degree latitude
    const lngMeters = this.vLng * 111139 * Math.cos((this.lat * Math.PI) / 180);
    const speedMps = Math.sqrt(latMeters * latMeters + lngMeters * lngMeters);

    let bearingDeg = (Math.atan2(lngMeters, latMeters) * 180) / Math.PI;
    if (bearingDeg < 0) bearingDeg += 360;

    return {
      lat: Number(this.lat.toFixed(6)),
      lng: Number(this.lng.toFixed(6)),
      speedMps: Number(speedMps.toFixed(2)),
      bearingDeg: Number(bearingDeg.toFixed(1)),
      accuracy: Math.sqrt(this.variance),
      timestamp: timestampMs,
    };
  }
}

