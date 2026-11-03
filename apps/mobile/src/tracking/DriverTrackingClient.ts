import { io, type Socket } from 'socket.io-client';
import { API_BASE, ensureAccessToken, refreshAccessToken } from '../api/client.ts';
import { GpsFilterPipeline, type RawGpsPoint } from './GpsFilter.ts';
import { OfflineBuffer } from './OfflineBuffer.ts';

export class DriverTrackingClient {
  private socket: Socket | null = null;
  private filter = new GpsFilterPipeline();
  private offlineBuffer = new OfflineBuffer();
  private bookingId: string | null = null;
  private isConnected: boolean = false;
  private lastReauthAt = 0;
  private getToken: () => string | null;

  constructor(getToken: () => string | null) {
    this.getToken = getToken;
  }

  /**
   * Starts tracking session for an active booking.
   */
  start(bookingId: string): void {
    this.bookingId = bookingId;
    this.filter.reset();
    void this.connectSocket();
  }

  /**
   * Stops tracking session and cleans up resources.
   */
  stop(): void {
    this.bookingId = null;
    this.filter.reset();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
  }

  private async connectSocket(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    // A background task can run in a fresh JS context where no screen has established the session
    // yet, and a 30-minute access token can expire mid-delivery. Ask the API client to restore or
    // renew it instead of silently streaming nothing.
    const token = this.getToken() ?? (await ensureAccessToken());
    if (!token) return;

    // Remove /v1 suffix to reach socket root
    const socketUrl = API_BASE.replace(/\/v1$/, '');

    const socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.isConnected = true;
      void this.flushOfflineBuffer();
    });

    socket.on('disconnect', () => {
      this.isConnected = false;
    });

    socket.on('connect_error', async () => {
      this.isConnected = false;
      const now = Date.now();
      if (now - this.lastReauthAt < 30_000) return;
      this.lastReauthAt = now;
      const fresh = await refreshAccessToken();
      if (fresh && this.socket === socket) {
        socket.auth = { token: fresh };
        socket.connect();
      }
    });
  }

  /** Flushes anything buffered while offline; safe to call when the socket reconnects. */
  async sync(): Promise<void> {
    await this.flushOfflineBuffer();
  }

  /**
   * Receives a raw GPS measurement from the device, filters, smooths, and transmits or buffers it.
   */
  onLocationUpdate(raw: RawGpsPoint): void {
    if (!this.bookingId) return;

    const packet = this.filter.process(raw, this.bookingId);
    if (!packet) {
      // Discarded by noise/accuracy/sampling filter
      return;
    }

    if (this.isConnected && this.socket) {
      this.socket.emit('driver:location', packet, (ack?: { ok: boolean }) => {
        if (!ack?.ok) {
          // If server rejected or unacknowledged, buffer locally
          this.offlineBuffer.enqueue(packet);
        }
      });
    } else {
      // Offline: buffer locally for reconnect sync
      this.offlineBuffer.enqueue(packet);
    }
  }

  /**
   * Bulk-syncs points buffered during offline network outage.
   */
  private async flushOfflineBuffer(): Promise<void> {
    if (!this.offlineBuffer.hasPoints() || !this.bookingId) {
      return;
    }

    const points = this.offlineBuffer.getPoints();
    const token = this.getToken() ?? (await ensureAccessToken());
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/tracking/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          booking_id: this.bookingId,
          points: points.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            speed: p.s,
            bearing: p.h,
            accuracy: p.a,
            timestamp: p.t,
          })),
        }),
      });

      if (res.ok) {
        this.offlineBuffer.clear();
      } else if (res.status === 401) {
        // The buffered points are kept; the next reconnect/flush uses the renewed token.
        await refreshAccessToken();
      }
    } catch {
      // Will retry on next reconnect
    }
  }
}

