import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { config } from '../config.ts';
import { TRACKING_CONFIG } from '../lib/tracking-config.ts';

export interface LiveLocationPacket {
  bookingId: string;
  parcelId: string;
  travellerId: string;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
  accuracy: number;
  timestamp: number;
  etaSeconds?: number;
  remainingDistanceMeters?: number;
  stage?: string;
}

export interface ITrackingStore {
  setLatestLocation(parcelId: string, data: LiveLocationPacket, ttlSeconds?: number): Promise<void>;
  getLatestLocation(parcelId: string): Promise<LiveLocationPacket | null>;
  publishLocation(parcelId: string, data: LiveLocationPacket): Promise<void>;
  subscribeToParcel(parcelId: string, listener: (data: LiveLocationPacket) => void): () => void;
  atomicTriggerGeofence(bookingId: string, radius: 500 | 200): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * High-performance In-Memory Tracking Store with TTL and Pub/Sub.
 * Used automatically when REDIS_URL is not configured (e.g. local dev, testing, single-node).
 */
class MemoryTrackingStore implements ITrackingStore {
  private locations = new Map<string, { data: LiveLocationPacket; expiresAt: number }>();
  private geofences = new Set<string>();
  private emitter = new EventEmitter();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.emitter.setMaxListeners(50000);
    // Periodically sweep expired entries (every 30s)
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.locations.entries()) {
        if (entry.expiresAt <= now) {
          this.locations.delete(key);
        }
      }
    }, 30000);
    this.cleanupInterval.unref();
  }

  async setLatestLocation(
    parcelId: string,
    data: LiveLocationPacket,
    ttlSeconds = TRACKING_CONFIG.REDIS_LOCATION_TTL_SECONDS,
  ): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.locations.set(`parcel:${parcelId}:loc`, { data, expiresAt });
  }

  async getLatestLocation(parcelId: string): Promise<LiveLocationPacket | null> {
    const entry = this.locations.get(`parcel:${parcelId}:loc`);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.locations.delete(`parcel:${parcelId}:loc`);
      return null;
    }
    return entry.data;
  }

  async publishLocation(parcelId: string, data: LiveLocationPacket): Promise<void> {
    this.emitter.emit(`parcel:${parcelId}`, data);
  }

  subscribeToParcel(parcelId: string, listener: (data: LiveLocationPacket) => void): () => void {
    const channel = `parcel:${parcelId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Atomically checks and sets geofence trigger.
   * Returns true ONLY if this was the very first time the geofence triggered.
   */
  async atomicTriggerGeofence(bookingId: string, radius: 500 | 200): Promise<boolean> {
    const key = `geofence:${bookingId}:${radius}`;
    if (this.geofences.has(key)) {
      return false;
    }
    this.geofences.add(key);
    return true;
  }

  async close(): Promise<void> {
    clearInterval(this.cleanupInterval);
    this.emitter.removeAllListeners();
    this.locations.clear();
    this.geofences.clear();
  }
}

/**
 * Production Redis Tracking Store with Redis Pub/Sub and GEO hashing.
 */
class RedisTrackingStore implements ITrackingStore {
  private client: Redis;
  private subClient: Redis;
  private listeners = new Map<string, Set<(data: LiveLocationPacket) => void>>();

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    this.subClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });

    this.subClient.on('message', (channel, message) => {
      const channelListeners = this.listeners.get(channel);
      if (channelListeners && channelListeners.size > 0) {
        try {
          const parsed = JSON.parse(message) as LiveLocationPacket;
          for (const listener of channelListeners) {
            listener(parsed);
          }
        } catch {
          // ignore corrupted packets
        }
      }
    });

    this.client.on('error', (err) => console.error('[Redis Client Error]', err));
    this.subClient.on('error', (err) => console.error('[Redis Sub Error]', err));
  }

  async setLatestLocation(
    parcelId: string,
    data: LiveLocationPacket,
    ttlSeconds = TRACKING_CONFIG.REDIS_LOCATION_TTL_SECONDS,
  ): Promise<void> {
    const key = `parcel:${parcelId}:loc`;
    const serialized = JSON.stringify(data);
    await this.client.set(key, serialized, 'EX', ttlSeconds);

    // Also update Redis GEO index for radius queries
    try {
      await this.client.geoadd('active_couriers', data.lng, data.lat, parcelId);
    } catch {
      // geoadd is non-blocking bonus
    }
  }

  async getLatestLocation(parcelId: string): Promise<LiveLocationPacket | null> {
    const key = `parcel:${parcelId}:loc`;
    const val = await this.client.get(key);
    if (!val) return null;
    try {
      return JSON.parse(val) as LiveLocationPacket;
    } catch {
      return null;
    }
  }

  async publishLocation(parcelId: string, data: LiveLocationPacket): Promise<void> {
    const channel = `parcel:${parcelId}`;
    await this.client.publish(channel, JSON.stringify(data));
  }

  subscribeToParcel(parcelId: string, listener: (data: LiveLocationPacket) => void): () => void {
    const channel = `parcel:${parcelId}`;
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      void this.subClient.subscribe(channel);
    }
    set.add(listener);

    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(channel);
        void this.subClient.unsubscribe(channel);
      }
    };
  }

  async atomicTriggerGeofence(bookingId: string, radius: 500 | 200): Promise<boolean> {
    const key = `geofence:${bookingId}:${radius}`;
    // SET NX returns "OK" if key was set, null if key already exists (atomic 24h TTL)
    const result = await this.client.set(key, '1', 'EX', 86400, 'NX');
    return result === 'OK';
  }

  async close(): Promise<void> {
    await Promise.all([this.client.quit(), this.subClient.quit()]);
    this.listeners.clear();
  }
}

// Export singleton instance based on configuration
export const trackingStore: ITrackingStore = config.REDIS_URL
  ? new RedisTrackingStore(config.REDIS_URL)
  : new MemoryTrackingStore();

