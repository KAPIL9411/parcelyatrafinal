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

/** How often `MemoryTrackingStore` is allowed to walk the map for expired entries. */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * High-performance In-Memory Tracking Store with TTL and Pub/Sub.
 * Used automatically when REDIS_URL is not configured (e.g. local dev, testing, single-node).
 *
 * Eviction is lazy rather than timer-driven. A `setInterval` in the constructor is a timer created
 * at module scope, and the Workers runtime rejects that outright — the isolate fails to start
 * before it can answer a single request. Sweeping on write keeps the same 30-second granularity,
 * keeps the map bounded in a long-lived Node process, and has no global-scope side effect.
 */
class MemoryTrackingStore implements ITrackingStore {
  private locations = new Map<string, { data: LiveLocationPacket; expiresAt: number }>();
  private geofences = new Set<string>();
  private emitter = new EventEmitter();
  private nextSweepAt = 0;

  constructor() {
    this.emitter.setMaxListeners(50000);
  }

  /** Drops entries whose TTL has passed, at most once per `SWEEP_INTERVAL_MS`. */
  private sweepExpired(): void {
    const now = Date.now();
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + SWEEP_INTERVAL_MS;
    for (const [key, entry] of this.locations) {
      if (entry.expiresAt <= now) this.locations.delete(key);
    }
  }

  async setLatestLocation(
    parcelId: string,
    data: LiveLocationPacket,
    ttlSeconds = TRACKING_CONFIG.REDIS_LOCATION_TTL_SECONDS,
  ): Promise<void> {
    this.sweepExpired();
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

let store: ITrackingStore | null = null;

/**
 * Built on first use, never at import time.
 *
 * `new RedisTrackingStore()` opens two TCP connections in its constructor, and `ioredis` starts
 * them immediately. At module scope that is asynchronous I/O in the global scope, which the
 * Workers runtime forbids for exactly the same reason it forbids a global `setInterval`. The
 * first request that needs the store builds it inside the request context, where both are legal.
 */
function resolveStore(): ITrackingStore {
  if (store) return store;
  store = config.REDIS_URL ? new RedisTrackingStore(config.REDIS_URL) : new MemoryTrackingStore();
  return store;
}

/**
 * The process-wide tracking store, resolved lazily.
 *
 * The exported value is a thin delegating object rather than the store itself so that importing
 * this module never has a side effect. Call sites keep using `trackingStore.method(...)`.
 */
export const trackingStore: ITrackingStore = {
  setLatestLocation: (parcelId, data, ttlSeconds) =>
    resolveStore().setLatestLocation(parcelId, data, ttlSeconds),
  getLatestLocation: (parcelId) => resolveStore().getLatestLocation(parcelId),
  publishLocation: (parcelId, data) => resolveStore().publishLocation(parcelId, data),
  subscribeToParcel: (parcelId, listener) => resolveStore().subscribeToParcel(parcelId, listener),
  atomicTriggerGeofence: (bookingId, radius) =>
    resolveStore().atomicTriggerGeofence(bookingId, radius),
  close: async () => {
    const current = store;
    // Cleared first so a call after shutdown rebuilds instead of reusing a closed client.
    store = null;
    if (current) await current.close();
  },
};

