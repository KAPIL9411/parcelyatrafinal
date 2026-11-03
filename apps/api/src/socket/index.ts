import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Db } from '../db/client.ts';
import { verifyAccessToken } from '../lib/auth.ts';
import { corsOrigins } from '../config.ts';
import { TRACKING_CONFIG } from '../lib/tracking-config.ts';
import { trackingService, type RawDriverUpdate } from '../services/tracking-service.ts';
import { trackingStore } from '../services/redis.ts';
import { getOsrmRoute } from '../services/osrm.ts';

interface SocketAuthData {
  userId: string;
  roles: string[];
  sessionId: string;
  lastDriverPacketAt?: number;
}

export function initSocketServer(httpServer: HttpServer, db: Db): Server {
  trackingService.init(db);

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow mobile clients with no origin and allowed web origins
        if (!origin || corsOrigins.includes(origin) || corsOrigins.includes('*')) {
          callback(null, true);
        } else {
          callback(null, true); // Dev & mobile friendly
        }
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'], // WebSocket first, fallback to polling
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  // 1. Authentication Middleware for Handshake
  io.use(async (socket: Socket, next) => {
    try {
      const authHeader = socket.handshake.auth?.token || socket.handshake.headers.authorization;
      if (!authHeader) {
        return next(new Error('AUTH_REQUIRED'));
      }

      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      const claims = await verifyAccessToken(token);

      socket.data = {
        userId: claims.sub,
        roles: claims.roles,
        sessionId: claims.sid,
      } as SocketAuthData;

      next();
    } catch {
      next(new Error('AUTH_TOKEN_INVALID'));
    }
  });

  // 2. Connection and Event Handling
  io.on('connection', (socket: Socket) => {
    const authData = socket.data as SocketAuthData;

    /**
     * Driver streams GPS updates.
     */
    socket.on('driver:location', async (payload: RawDriverUpdate, ack?: (res: unknown) => void) => {
      try {
        const now = Date.now();

        // Security rule: Rate limit to max 1 update per second per driver
        const lastAt = authData.lastDriverPacketAt ?? 0;
        if (now - lastAt < 1000 / TRACKING_CONFIG.MAX_UPDATES_PER_SECOND_PER_DRIVER) {
          if (ack) ack({ ok: false, error: 'RATE_LIMITED' });
          return;
        }
        authData.lastDriverPacketAt = now;

        // Security rule: Verify driver is assigned traveller on this booking
        const session = await trackingService.getOrLoadSession(payload.b);
        if (!session) {
          if (ack) ack({ ok: false, error: 'BOOKING_NOT_FOUND' });
          return;
        }

        if (session.travellerId !== authData.userId && !authData.roles.includes('staff')) {
          if (ack) ack({ ok: false, error: 'FORBIDDEN_NOT_ASSIGNED_TRAVELLER' });
          return;
        }

        // Process location through filtering, smoothing, geofencing, and ETA pipeline
        const livePacket = await trackingService.processDriverLocation(payload);

        if (livePacket) {
          // Compact broadcast payload to customer room (< 100 bytes)
          const broadcastPayload = {
            lat: livePacket.lat,
            lng: livePacket.lng,
            h: livePacket.bearing,
            s: livePacket.speed,
            t: livePacket.timestamp,
            eta: livePacket.etaSeconds,
            dist: livePacket.remainingDistanceMeters,
            stage: livePacket.stage,
          };

          io.to(`parcel:${session.parcelId}`).emit('tracker:update', broadcastPayload);

          if (ack) ack({ ok: true, t: livePacket.timestamp });
        } else {
          if (ack) ack({ ok: false, error: 'DROPPED_BY_FILTER' });
        }
      } catch (err) {
        if (ack) ack({ ok: false, error: (err as Error).message });
      }
    });

    /**
     * Customer or Driver subscribes to a parcel tracking room.
     */
    socket.on('customer:subscribe', async (data: { parcelId: string; bookingId?: string }, ack?: (res: unknown) => void) => {
      try {
        const { parcelId } = data;
        if (!parcelId) {
          if (ack) ack({ ok: false, error: 'PARCEL_ID_REQUIRED' });
          return;
        }

        // Verify viewer has access to this parcel (sender, receiver, traveller, or staff)
        const check = await db.query<{ id: string }>(
          `SELECT b.id FROM bookings b
           JOIN parcels p ON p.id = b.parcel_id
           WHERE b.parcel_id = $1 
             AND (b.sender_id = $2 OR b.traveller_id = $2 OR p.sender_id = $2)`,
          [parcelId, authData.userId],
        );

        const isAuthorized = check.rows.length > 0 || authData.roles.includes('staff');
        if (!isAuthorized) {
          if (ack) ack({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const room = `parcel:${parcelId}`;
        await socket.join(room);

        // Fetch latest known location from fast store
        const latest = await trackingStore.getLatestLocation(parcelId);

        // Return initial snapshot to the customer immediately
        const bookingId = check.rows[0]?.id;
        let routePolyline: Array<[number, number]> = [];

        if (latest && bookingId) {
          const session = await trackingService.getOrLoadSession(bookingId);
          if (session && session.destLat !== 0) {
            const route = await getOsrmRoute(latest.lat, latest.lng, session.destLat, session.destLng, bookingId);
            routePolyline = route.polyline;
          }
        }

        const initialSnapshot = {
          latest,
          polyline: routePolyline,
          subscribedRoom: room,
        };

        socket.emit('tracker:init', initialSnapshot);
        if (ack) ack({ ok: true, snapshot: initialSnapshot });
      } catch (err) {
        if (ack) ack({ ok: false, error: (err as Error).message });
      }
    });

    socket.on('customer:unsubscribe', async (data: { parcelId: string }) => {
      if (data?.parcelId) {
        await socket.leave(`parcel:${data.parcelId}`);
      }
    });
  });

  return io;
}

