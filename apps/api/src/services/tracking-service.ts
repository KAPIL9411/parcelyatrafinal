import type { Db } from '../db/client.ts';
import {
  distanceToPolyline,
  calculateRemainingPolylineDistance,
  haversineDistance,
} from '../lib/geo.ts';
import { TRACKING_CONFIG } from '../lib/tracking-config.ts';
import { getOsrmRoute, type RouteResult, invalidateRouteCache } from './osrm.ts';
import { trackingStore, type LiveLocationPacket } from './redis.ts';
import { historyWorker } from './history-worker.ts';
import { queueNotification } from './audit.ts';

export interface RawDriverUpdate {
  b: string;       // bookingId
  lat: number;
  lng: number;
  s?: number;      // speed in m/s
  h?: number;      // heading/bearing in degrees
  a?: number;      // accuracy in meters
  t: number;       // timestamp in epoch ms
}

interface ActiveSessionCache {
  parcelId: string;
  senderId: string;
  travellerId: string;
  destLat: number;
  destLng: number;
  lastTimestamp: number;
  lastLat: number;
  lastLng: number;
  recentSpeeds: number[]; // circular buffer of last 10 speeds
  route?: RouteResult;
  lastRerouteAt: number;
  isActive: boolean;
}

const sessionCache = new Map<string, ActiveSessionCache>();

export class TrackingService {
  private db: Db | null = null;

  init(db: Db): void {
    this.db = db;
    historyWorker.init(db);
  }

  /**
   * Loads or gets active session state for a booking.
   */
  async getOrLoadSession(bookingId: string): Promise<ActiveSessionCache | null> {
    const cached = sessionCache.get(bookingId);
    if (cached) return cached;
    if (!this.db) return null;

    // Load booking, parcel destination city coordinates, sender and traveller
    const query = await this.db.query<{
      booking_id: string;
      parcel_id: string;
      sender_id: string;
      traveller_id: string;
      status: string;
      dest_lat: string | null;
      dest_lng: string | null;
    }>(
      `SELECT 
        b.id AS booking_id, 
        b.parcel_id, 
        b.sender_id, 
        b.traveller_id, 
        b.status,
        c.lat AS dest_lat,
        c.lng AS dest_lng
       FROM bookings b
       JOIN parcels p ON p.id = b.parcel_id
       LEFT JOIN cities c ON c.id = p.dest_city_id
       WHERE b.id = $1`,
      [bookingId],
    );

    const row = query.rows[0];
    if (!row) return null;

    // Tracking is only active for in-transit or pickup-ready/arrived bookings
    const validStatuses = ['pickup_ready', 'picked_up', 'in_transit', 'arrived'];
    const isActive = validStatuses.includes(row.status);

    const session: ActiveSessionCache = {
      parcelId: row.parcel_id,
      senderId: row.sender_id,
      travellerId: row.traveller_id,
      destLat: row.dest_lat ? Number(row.dest_lat) : 0,
      destLng: row.dest_lng ? Number(row.dest_lng) : 0,
      lastTimestamp: 0,
      lastLat: 0,
      lastLng: 0,
      recentSpeeds: [],
      lastRerouteAt: 0,
      isActive,
    };

    sessionCache.set(bookingId, session);
    return session;
  }

  /**
   * High-throughput ingest of a driver location packet.
   * Runs under 1 millisecond on the hot path (zero blocking DB calls).
   */
  async processDriverLocation(update: RawDriverUpdate): Promise<LiveLocationPacket | null> {
    const session = await this.getOrLoadSession(update.b);
    if (!session || !session.isActive) {
      return null;
    }

    // 1. Accuracy Filter: discard points with accuracy > 50m
    const accuracy = update.a ?? 10;
    if (accuracy > TRACKING_CONFIG.MAX_ACCURACY_METERS) {
      return null;
    }

    // 2. Validate Timestamp Ordering: ignore out-of-order packets
    const timestamp = Number(update.t);
    if (session.lastTimestamp > 0 && timestamp <= session.lastTimestamp) {
      return null;
    }

    // 3. Outlier / Teleport Rejection: check implied speed against MAX_SPEED (150 km/h)
    if (session.lastTimestamp > 0 && session.lastLat !== 0) {
      const distanceMoved = haversineDistance(session.lastLat, session.lastLng, update.lat, update.lng);
      const timeElapsedSeconds = (timestamp - session.lastTimestamp) / 1000;

      if (timeElapsedSeconds > 0) {
        const impliedSpeedMps = distanceMoved / timeElapsedSeconds;
        if (impliedSpeedMps > TRACKING_CONFIG.MAX_SPEED_MPS) {
          // Unrealistic jump / GPS teleport -> reject point
          return null;
        }
      }
    }

    // 4. Smooth speed tracking (EWMA of up to last 10 readings)
    const rawSpeed = update.s ?? 0;
    if (rawSpeed > 0) {
      session.recentSpeeds.push(rawSpeed);
      if (session.recentSpeeds.length > 10) session.recentSpeeds.shift();
    }
    const avgSpeedMps =
      session.recentSpeeds.length > 0
        ? session.recentSpeeds.reduce((sum, s) => sum + s, 0) / session.recentSpeeds.length
        : 8.33; // Default ~30 km/h if starting stationary

    // 5. Route & ETA Engine
    let remainingDistance = 0;
    let etaSeconds = 0;

    if (session.destLat !== 0 && session.destLng !== 0) {
      const now = Date.now();
      const distanceToDest = haversineDistance(update.lat, update.lng, session.destLat, session.destLng);

      // Check if we need initial route or rerouting
      let needsReroute = !session.route || now - session.lastRerouteAt >= TRACKING_CONFIG.REROUTE_INTERVAL_MS;

      if (session.route && !needsReroute) {
        const { minDistance } = distanceToPolyline(update.lat, update.lng, session.route.polyline);
        if (minDistance > TRACKING_CONFIG.REROUTE_DEVIATION_METERS) {
          needsReroute = true;
        }
      }

      if (needsReroute) {
        session.lastRerouteAt = now;
        // Asynchronously fetch/update OSRM route in background without stalling
        void getOsrmRoute(update.lat, update.lng, session.destLat, session.destLng, update.b)
          .then((newRoute) => {
            session.route = newRoute;
          })
          .catch(() => {});
      }

      // Compute remaining distance & ETA locally along current polyline
      if (session.route && session.route.polyline.length > 1) {
        const { segmentIndex, snapped } = distanceToPolyline(update.lat, update.lng, session.route.polyline);
        remainingDistance = calculateRemainingPolylineDistance(session.route.polyline, segmentIndex, snapped);
      } else {
        remainingDistance = Math.round(distanceToDest * 1.25);
      }

      const effectiveSpeed = Math.max(avgSpeedMps, 3.0); // Minimum 10 km/h baseline for ETA math
      etaSeconds = Math.round(remainingDistance / effectiveSpeed);

      // 6. Geofence checks (500m and 200m)
      if (distanceToDest <= TRACKING_CONFIG.GEOFENCE_ARRIVING_OUTER_METERS) {
        void this.handleGeofenceTrigger(session, update.b, 500, distanceToDest);
      }
      if (distanceToDest <= TRACKING_CONFIG.GEOFENCE_ARRIVING_INNER_METERS) {
        void this.handleGeofenceTrigger(session, update.b, 200, distanceToDest);
      }
    }

    // 7. Update Session State
    session.lastTimestamp = timestamp;
    session.lastLat = update.lat;
    session.lastLng = update.lng;

    const livePacket: LiveLocationPacket = {
      bookingId: update.b,
      parcelId: session.parcelId,
      travellerId: session.travellerId,
      lat: update.lat,
      lng: update.lng,
      bearing: update.h ?? 0,
      speed: rawSpeed,
      accuracy,
      timestamp,
      etaSeconds,
      remainingDistanceMeters: remainingDistance,
      stage: 'in_transit',
    };

    // 8. Hot Path: write to Redis & publish to subscribers
    void trackingStore.setLatestLocation(session.parcelId, livePacket);
    void trackingStore.publishLocation(session.parcelId, livePacket);

    // 9. Asynchronously queue to History Worker for dispute audit sampling
    historyWorker.enqueueIfEligible({
      bookingId: update.b,
      parcelId: session.parcelId,
      travellerId: session.travellerId,
      lat: update.lat,
      lng: update.lng,
      bearing: update.h ?? null,
      speed: update.s ?? null,
      accuracy: update.a ?? null,
      recordedAt: new Date(timestamp),
    });

    return livePacket;
  }

  /**
   * Triggers geofence alert exactly once per booking per radius threshold.
   */
  private async handleGeofenceTrigger(
    session: ActiveSessionCache,
    bookingId: string,
    radius: 500 | 200,
    currentDistance: number,
  ): Promise<void> {
    const isFirstTrigger = await trackingStore.atomicTriggerGeofence(bookingId, radius);
    if (!isFirstTrigger) return;

    const stageName = radius === 500 ? 'arrived_500m' : 'arrived_200m';
    const message =
      radius === 500
        ? 'Your parcel is arriving! The traveller is within 500 metres.'
        : 'Your traveller is reaching now (within 200 metres). Please be ready for delivery.';

    if (this.db) {
      // Record in parcel_status_log
      void this.db.query(
        `INSERT INTO parcel_status_log (parcel_id, booking_id, stage, lat, lng, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [session.parcelId, bookingId, stageName, session.lastLat, session.lastLng, message],
      ).catch(() => {});

      // Queue push notification to customer
      void queueNotification(this.db, {
        userId: session.senderId,
        bookingId,
        channel: 'in_app',
        templateId: radius === 500 ? 'traveller_arriving_500m' : 'traveller_arriving_200m',
      }).catch(() => {});
    }
  }

  /**
   * Stop tracking automatically when delivery is confirmed.
   */
  async stopTracking(bookingId: string): Promise<void> {
    const session = sessionCache.get(bookingId);
    if (session) {
      session.isActive = false;
      sessionCache.delete(bookingId);
    }

    invalidateRouteCache(bookingId);
    historyWorker.clearBooking(bookingId);

    if (this.db) {
      await this.db.query(
        `UPDATE tracking_sessions SET is_active = false, ended_at = now(), updated_at = now()
         WHERE booking_id = $1`,
        [bookingId],
      );
    }
  }
}

export const trackingService = new TrackingService();

