import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { API_BASE, getAccessToken } from '../api/client.ts';
import { font, radius } from '../theme.ts';
// Extensionless: the browser build swaps the WebView for a same-origin iframe of the same document.
import TrackingMapFrame, { type TrackingMapFrameHandle } from './TrackingMapFrame';
import { TRACKING_MAP_HTML } from './tracking-map-html.ts';

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
  polyline: [number, number][];
}

interface LiveTrackingViewProps {
  parcelId: string;
  bookingId?: string;
  height?: number;
}


export function LiveTrackingView({ parcelId, height = 340 }: LiveTrackingViewProps) {
  const mapRef = useRef<TrackingMapFrameHandle>(null);
  const [eta, setEta] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [stage, setStage] = useState<string>('in_transit');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [secondsAgo, setSecondsAgo] = useState<number>(0);
  const lastPacketTime = useRef<number>(0);

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

  useEffect(() => {
    const timer = setInterval(() => {
      if (lastPacketTime.current === 0) return;
      setSecondsAgo(Math.round((Date.now() - lastPacketTime.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !parcelId) return;

    const socketUrl = API_BASE.replace(/\/v1$/, '');
    const socket: Socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('customer:subscribe', { parcelId });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('tracker:init', (data: InitPacket) => {
      if (data.polyline && data.polyline.length > 0) {
        const js = `window.setPolyline(${JSON.stringify(data.polyline)}); true;`;
        mapRef.current?.run(js);
      }

      if (data.latest) {
        lastPacketTime.current = Date.now();
        const js = `window.updatePosition(${data.latest.lat}, ${data.latest.lng}, ${data.latest.h ?? 0}); true;`;
        mapRef.current?.run(js);

        if (data.latest.eta !== undefined) setEta(data.latest.eta);
        if (data.latest.dist !== undefined) setDistance(data.latest.dist);
        if (data.latest.stage) setStage(data.latest.stage);
      }
    });

    socket.on('tracker:update', (packet: LivePacket) => {
      lastPacketTime.current = Date.now();
      const js = `window.updatePosition(${packet.lat}, ${packet.lng}, ${packet.h ?? 0}); true;`;
      mapRef.current?.run(js);

      if (packet.eta !== undefined) setEta(packet.eta);
      if (packet.dist !== undefined) setDistance(packet.dist);
      if (packet.stage) setStage(packet.stage);
    });

    return () => {
      socket.emit('customer:unsubscribe', { parcelId });
      socket.disconnect();
    };
  }, [parcelId]);

  return (
    <View style={[styles.container, { height }]}>
      {/* Top Floating ETA Card */}
      <View style={styles.topOverlay}>
        <View style={styles.etaBadge}>
          <View style={styles.pulseDot} />
          <View>
            <Text style={styles.etaTitle}>Estimated Arrival</Text>
            <Text style={styles.etaValue}>{formatEta(eta)}</Text>
          </View>
          <View style={styles.vDivider} />
          <View>
            <Text style={styles.etaTitle}>Remaining</Text>
            <Text style={styles.distanceValue}>{formatDistance(distance)}</Text>
          </View>
        </View>

        <View style={styles.liveIndicator}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? '#10B981' : '#F59E0B' }]} />
          <Text style={styles.liveText}>{isConnected ? 'LIVE' : 'Connecting'}</Text>
          {secondsAgo >= 15 && <Text style={styles.staleText}> • {secondsAgo}s ago</Text>}
        </View>
      </View>

      {/* Live map: a WebView on native, the same document in an iframe on web. */}
      <TrackingMapFrame ref={mapRef} html={TRACKING_MAP_HTML} style={styles.webView} />

      {/* Bottom Timeline Progress Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.stageRow}>
          <Text style={styles.stageActive}>1. Picked Up</Text>
          <Text style={stage !== 'picked_up' ? styles.stageActive : styles.stageInactive}>2. In Transit</Text>
          <Text style={stage === 'out_for_delivery' || stage === 'delivered' ? styles.stageActive : styles.stageInactive}>
            3. Out for Delivery
          </Text>
          <Text style={stage === 'delivered' ? styles.stageActive : styles.stageInactive}>4. Delivered</Text>
        </View>
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              {
                width:
                  stage === 'delivered'
                    ? '100%'
                    : stage === 'out_for_delivery'
                    ? '75%'
                    : stage === 'in_transit'
                    ? '50%'
                    : '25%',
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    position: 'relative',
  },
  topOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  etaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  etaTitle: {
    fontSize: 10,
    color: '#64748B',
    fontFamily: font.semibold,
  },
  etaValue: {
    fontSize: 14,
    color: '#0F172A',
    fontFamily: font.bold,
  },
  vDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#E2E8F0',
  },
  distanceValue: {
    fontSize: 13,
    color: '#1E293B',
    fontFamily: font.bold,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontFamily: font.bold,
  },
  staleText: {
    fontSize: 10,
    color: '#FCD34D',
  },
  webView: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  bottomBar: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 8,
  },
  stageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stageActive: {
    fontSize: 10,
    color: '#059669',
    fontFamily: font.bold,
  },
  stageInactive: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: font.regular,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#005DFD',
    borderRadius: 3,
  },
});

