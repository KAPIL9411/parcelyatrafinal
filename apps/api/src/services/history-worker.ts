import type { Db } from '../db/client.ts';
import { haversineDistance } from '../lib/geo.ts';
import { TRACKING_CONFIG } from '../lib/tracking-config.ts';

export interface LocationHistoryItem {
  bookingId: string;
  parcelId: string;
  travellerId: string;
  lat: number;
  lng: number;
  bearing: number | null;
  speed: number | null;
  accuracy: number | null;
  recordedAt: Date;
}

interface LastSaved {
  lat: number;
  lng: number;
  savedAt: number;
}

class HistoryWorker {
  private queue: LocationHistoryItem[] = [];
  private lastSavedMap = new Map<string, LastSaved>();
  private timer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private db: Db | null = null;

  init(db: Db): void {
    this.db = db;
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), TRACKING_CONFIG.HISTORY_BATCH_INTERVAL_MS);
      this.timer.unref();
    }
  }

  /**
   * Evaluates if a point should be sampled for historical audit storage.
   * NEVER blocks: purely synchronous in-memory operation.
   */
  enqueueIfEligible(item: LocationHistoryItem): void {
    const now = item.recordedAt.getTime();
    const last = this.lastSavedMap.get(item.bookingId);

    let shouldSave = false;

    if (!last) {
      shouldSave = true;
    } else {
      const distance = haversineDistance(last.lat, last.lng, item.lat, item.lng);
      const elapsed = now - last.savedAt;

      // Save if moved >= 50m OR elapsed >= 20s
      if (
        distance >= TRACKING_CONFIG.HISTORY_MIN_DISPLACEMENT_METERS ||
        elapsed >= TRACKING_CONFIG.HISTORY_BATCH_INTERVAL_MS
      ) {
        shouldSave = true;
      }
    }

    if (shouldSave) {
      this.lastSavedMap.set(item.bookingId, {
        lat: item.lat,
        lng: item.lng,
        savedAt: now,
      });

      // Avoid unbounded queue growth under abnormal spikes
      if (this.queue.length < TRACKING_CONFIG.HISTORY_BATCH_MAX_SIZE) {
        this.queue.push(item);
      }
    }
  }

  /**
   * Asynchronously writes batched location history to the database.
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0 || !this.db) {
      return;
    }

    this.isFlushing = true;
    const batch = this.queue.splice(0, 100); // Process up to 100 points per batch

    try {
      const values: unknown[] = [];
      const rows: string[] = [];

      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        if (!item) continue;
        const offset = rows.length * 9;
        rows.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`,
        );
        values.push(
          item.bookingId,
          item.parcelId,
          item.travellerId,
          item.lat,
          item.lng,
          item.bearing,
          item.speed,
          item.accuracy,
          item.recordedAt,
        );
      }

      await this.db.query(
        `INSERT INTO location_history (
          booking_id, parcel_id, traveller_id, lat, lng, bearing, speed, accuracy, recorded_at
        ) VALUES ${rows.join(', ')}`,
        values,
      );
    } catch (err) {
      console.error('[HistoryWorker Flush Error] Failed to write batch:', (err as Error).message);
      // On failure, re-queue up to half the batch to avoid perpetual drop
      if (this.queue.length < TRACKING_CONFIG.HISTORY_BATCH_MAX_SIZE / 2) {
        this.queue.unshift(...batch);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  clearBooking(bookingId: string): void {
    this.lastSavedMap.delete(bookingId);
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    this.queue = [];
    this.lastSavedMap.clear();
  }
}

export const historyWorker = new HistoryWorker();

