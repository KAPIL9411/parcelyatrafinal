import React, { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

interface LivePacket {
  lat: number;
  lng: number;
  h: number;     // bearing
  s: number;     // speed
  t: number;     // timestamp
  eta?: number;  // seconds
  dist?: number; // meters
  stage?: string;
}

interface InitPacket {
  latest: LivePacket | null;
  polyline: Array<[number, number]>;
}

interface LiveTrackingProps {
  parcelId: string;
  bookingId?: string;
  token?: string | null;
  apiBaseUrl?: string;
}

export const LiveTrackingMap: React.FC<LiveTrackingProps> = ({
  parcelId,
  token,
  apiBaseUrl,
}) => {
  const resolvedBaseUrl =
    apiBaseUrl ||
    (typeof window !== 'undefined'
      ? (import.meta.env?.VITE_API_BASE?.startsWith('http')
          ? import.meta.env.VITE_API_BASE
          : window.location.origin)
      : 'https://parcelyatrafinal.onrender.com');
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);

  const [eta, setEta] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [stage, setStage] = useState<string>('in_transit');
  const [secondsAgo, setSecondsAgo] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  // Animation & interpolation refs
  const currentPos = useRef<{ lat: number; lng: number; bearing: number }>({ lat: 0, lng: 0, bearing: 0 });
  const targetPos = useRef<{ lat: number; lng: number; bearing: number; timestamp: number }>({ lat: 0, lng: 0, bearing: 0, timestamp: 0 });
  const animFrameId = useRef<number | null>(null);
  const lastPacketTime = useRef<number>(Date.now());

  // Format ETA into human friendly string (e.g. "14 mins" or "1 hr 10 mins")
  const formatEta = (seconds: number | null) => {
    if (!seconds || seconds <= 0) return 'Arriving now';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} mins`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs} hr ${remMins} mins`;
  };

  const formatDistance = (meters: number | null) => {
    if (!meters || meters <= 0) return 'Nearby';
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  // 1. Initialize Leaflet Map
  useEffect(() => {
    let isMounted = true;

    const loadLeaflet = async () => {
      // Dynamically load Leaflet if not present
      if (!(window as any).L) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);

        await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = resolve;
          document.head.appendChild(script);
        });
      }

      if (!isMounted || !containerRef.current || mapRef.current) return;
      const L = (window as any).L;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([28.6139, 77.2090], 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Create Custom SVG Driver Marker with rotating car/vehicle icon
      const driverIcon = L.divIcon({
        className: 'driver-marker-container',
        html: `
          <div id="driver-marker-pin" style="
            width: 44px; height: 44px;
            background: #005DFD;
            border-radius: 50%;
            border: 3px solid #ffffff;
            box-shadow: 0 4px 14px rgba(0, 93, 253, 0.45);
            display: flex; align-items: center; justify-content: center;
            transform-origin: center;
            transition: transform 0.2s linear;
          ">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
            </svg>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });

      const marker = L.marker([28.6139, 77.2090], { icon: driverIcon }).addTo(map);
      const polyline = L.polyline([], { color: '#005DFD', weight: 5, opacity: 0.85 }).addTo(map);

      mapRef.current = map;
      markerRef.current = marker;
      polylineRef.current = polyline;
    };

    void loadLeaflet();

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. 60fps RequestAnimationFrame Interpolation Loop
  useEffect(() => {
    let running = true;

    const animate = () => {
      if (!running) return;

      const now = Date.now();
      const elapsedSincePacket = (now - targetPos.current.timestamp) / 1000;

      // Easing interpolation factor (smooth exponential smoothing)
      const lerp = 0.08;

      let nextLat = currentPos.current.lat + (targetPos.current.lat - currentPos.current.lat) * lerp;
      let nextLng = currentPos.current.lng + (targetPos.current.lng - currentPos.current.lng) * lerp;

      // Dead-reckoning: if packet is slightly late (>2.5s) and not stale (>6s), project forward smoothly
      if (elapsedSincePacket > 2.5 && elapsedSincePacket < 6.0 && currentPos.current.bearing) {
        const rad = (currentPos.current.bearing * Math.PI) / 180;
        const driftMps = 8.0; // Assume ~30 km/h baseline
        const dt = 1 / 60;
        nextLat += (Math.cos(rad) * (driftMps * dt)) / 111139;
        nextLng += (Math.sin(rad) * (driftMps * dt)) / (111139 * Math.cos((nextLat * Math.PI) / 180));
      }

      // Smooth shortest-path angular rotation for bearing
      let currentB = currentPos.current.bearing;
      const targetB = targetPos.current.bearing;
      let diffB = (targetB - currentB + 360) % 360;
      if (diffB > 180) diffB -= 360;
      const nextBearing = (currentB + diffB * 0.15 + 360) % 360;

      currentPos.current = { lat: nextLat, lng: nextLng, bearing: nextBearing };

      if (markerRef.current && (nextLat !== 0 || nextLng !== 0)) {
        markerRef.current.setLatLng([nextLat, nextLng]);

        const pinEl = document.getElementById('driver-marker-pin');
        if (pinEl) {
          pinEl.style.transform = `rotate(${Math.round(nextBearing)}deg)`;
        }
      }

      animFrameId.current = requestAnimationFrame(animate);
    };

    animFrameId.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, []);

  // 3. Stale packet ticker ("Last updated X sec ago")
  useEffect(() => {
    const timer = setInterval(() => {
      const diffSeconds = Math.round((Date.now() - lastPacketTime.current) / 1000);
      setSecondsAgo(diffSeconds);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // 4. Socket.IO Realtime Connection
  useEffect(() => {
    if (!token || !parcelId) return;

    const socketUrl = resolvedBaseUrl.replace(/\/v1$/, '');
    const socket: Socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      // Subscribe strictly to this parcel's channel
      socket.emit('customer:subscribe', { parcelId });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    // Initial snapshot sent by server on subscribe
    socket.on('tracker:init', (data: InitPacket) => {
      if (data.polyline && data.polyline.length > 0 && polylineRef.current) {
        polylineRef.current.setLatLngs(data.polyline);
        if (mapRef.current) {
          mapRef.current.fitBounds(polylineRef.current.getBounds(), { padding: [40, 40] });
        }
      }

      if (data.latest) {
        lastPacketTime.current = Date.now();
        currentPos.current = {
          lat: data.latest.lat,
          lng: data.latest.lng,
          bearing: data.latest.h ?? 0,
        };
        targetPos.current = {
          lat: data.latest.lat,
          lng: data.latest.lng,
          bearing: data.latest.h ?? 0,
          timestamp: Date.now(),
        };

        if (data.latest.eta !== undefined) setEta(data.latest.eta);
        if (data.latest.dist !== undefined) setDistance(data.latest.dist);
        if (data.latest.stage) setStage(data.latest.stage);
      }
    });

    // Live driver position broadcasts
    socket.on('tracker:update', (packet: LivePacket) => {
      lastPacketTime.current = Date.now();
      targetPos.current = {
        lat: packet.lat,
        lng: packet.lng,
        bearing: packet.h ?? 0,
        timestamp: Date.now(),
      };

      if (packet.eta !== undefined) setEta(packet.eta);
      if (packet.dist !== undefined) setDistance(packet.dist);
      if (packet.stage) setStage(packet.stage);
    });

    return () => {
      socket.emit('customer:unsubscribe', { parcelId });
      socket.disconnect();
    };
  }, [parcelId, token, apiBaseUrl]);

  return (
    <div className="relative w-full h-full flex flex-col bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-800">
      {/* Top Floating Status Overlay */}
      <div className="absolute top-4 left-4 right-4 z-[1000] flex items-center justify-between pointer-events-none">
        <div className="bg-white/95 backdrop-blur-md px-4 py-2.5 rounded-xl shadow-lg border border-slate-100 flex items-center space-x-3 pointer-events-auto">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <div className="text-xs text-slate-500 font-medium">Estimated Arrival</div>
            <div className="text-base font-bold text-slate-900">{formatEta(eta)}</div>
          </div>
          <div className="h-6 w-px bg-slate-200 mx-1" />
          <div>
            <div className="text-xs text-slate-500 font-medium">Remaining</div>
            <div className="text-sm font-semibold text-slate-800">{formatDistance(distance)}</div>
          </div>
        </div>

        {/* Live Status Pill */}
        <div className="bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-medium text-white shadow-md flex items-center space-x-2 pointer-events-auto">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span>{isConnected ? 'LIVE' : 'Connecting...'}</span>
          {secondsAgo >= 15 && (
            <span className="text-amber-300 font-normal pl-1 border-l border-slate-700">
              Updated {secondsAgo}s ago
            </span>
          )}
        </div>
      </div>

      {/* Map Canvas */}
      <div ref={containerRef} className="w-full flex-1 z-0 min-h-[380px]" />

      {/* Bottom Milestone Progress Card */}
      <div className="bg-white border-t border-slate-100 p-4 z-10 flex flex-col space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span className="text-emerald-600">● 1. Picked Up</span>
          <span className={stage !== 'picked_up' ? 'text-emerald-600' : 'text-slate-400'}>
            ● 2. In Transit
          </span>
          <span className={stage === 'out_for_delivery' || stage === 'delivered' ? 'text-emerald-600' : 'text-slate-400'}>
            ● 3. Out for Delivery
          </span>
          <span className={stage === 'delivered' ? 'text-emerald-600' : 'text-slate-400'}>
            ● 4. Delivered
          </span>
        </div>

        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
          <div
            className="bg-brand h-full rounded-full transition-all duration-500"
            style={{
              width:
                stage === 'delivered'
                  ? '100%'
                  : stage === 'out_for_delivery'
                  ? '75%'
                  : stage === 'in_transit'
                  ? '50%'
                  : '25%',
              backgroundColor: '#005DFD',
            }}
          />
        </div>
      </div>
    </div>
  );
};
