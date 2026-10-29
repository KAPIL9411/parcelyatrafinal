import { io, type Socket } from 'socket.io-client';
import { API_BASE } from '../api/client.ts';
import { GpsFilterPipeline, type RawGpsPoint } from './GpsFilter.ts';
import { OfflineBuffer } from './OfflineBuffer.ts';

export class DriverTrackingClient {
  private socket: Socket | null = null;
  private filter = new GpsFilterPipeline();
  private offlineBuffer = new OfflineBuffer();
  private bookingId: string | null = null;
  private isConnected: boolean = false;
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
    this.connectSocket();
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

  private connectSocket(): void {
    if (this.socket) {
      this.socket.disconnect();
    }

    const token = this.getToken();
    if (!token) return;

    // Remove /v1 suffix to reach socket root
    const socketUrl = API_BASE.replace(/\/v1$/, '');

    this.socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      void this.flushOfflineBuffer();
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
    });

    this.socket.on('connect_error', () => {
      this.isConnected = false;
    });
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
    const token = this.getToken();
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
      }
    } catch {
      // Will retry on next reconnect
    }
  }
}

