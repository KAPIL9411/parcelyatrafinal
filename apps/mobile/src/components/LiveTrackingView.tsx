import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { io, type Socket } from 'socket.io-client';
import { API_BASE, getAccessToken } from '../api/client.ts';
import { font, radius } from '../theme.ts';

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

const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f8fafc; overflow: hidden; }
    .driver-pin {
      width: 42px; height: 42px; background: #005DFD; border-radius: 50%;
      border: 3px solid #ffffff; box-shadow: 0 4px 12px rgba(0,93,253,0.45);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.15s linear;
    }
    .driver-pin svg { width: 20px; height: 20px; fill: none; stroke: #ffffff; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([28.6139, 77.2090], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    var driverIcon = L.divIcon({
      className: 'driver-container',
      html: '<div id="pin" class="driver-pin"><svg viewBox="0 0 24 24"><polygon points="12 2 19 21 12 17 5 21 12 2"></polygon></svg></div>',
      iconSize: [42, 42],
      iconAnchor: [21, 21]
    });

    var marker = L.marker([28.6139, 77.2090], { icon: driverIcon }).addTo(map);
    var polyline = L.polyline([], { color: '#005DFD', weight: 5, opacity: 0.85 }).addTo(map);

    var currentLat = 0, currentLng = 0, currentBearing = 0;
    var targetLat = 0, targetLng = 0, targetBearing = 0;

    function animate() {
      if (targetLat !== 0 && targetLng !== 0) {
        currentLat += (targetLat - currentLat) * 0.1;
        currentLng += (targetLng - currentLng) * 0.1;
        
        var diffB = (targetBearing - currentBearing + 360) % 360;
        if (diffB > 180) diffB -= 360;
        currentBearing = (currentBearing + diffB * 0.15 + 360) % 360;

        marker.setLatLng([currentLat, currentLng]);
        var el = document.getElementById('pin');
        if (el) el.style.transform = 'rotate(' + Math.round(currentBearing) + 'deg)';
      }
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    window.updatePosition = function(lat, lng, bearing) {
      if (currentLat === 0 && currentLng === 0) {
        currentLat = lat; currentLng = lng; currentBearing = bearing;
        map.setView([lat, lng], 15);
      }
      targetLat = lat; targetLng = lng; targetBearing = bearing;
    };

    window.setPolyline = function(points) {
      if (points && points.length > 0) {
        polyline.setLatLngs(points);
        map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
      }
    };
  </script>
</body>
</html>
`;

export function LiveTrackingView({ parcelId, height = 340 }: LiveTrackingViewProps) {
  const webViewRef = useRef<any>(null);
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
        webViewRef.current?.injectJavaScript(js);
      }

      if (data.latest) {
        lastPacketTime.current = Date.now();
        const js = `window.updatePosition(${data.latest.lat}, ${data.latest.lng}, ${data.latest.h ?? 0}); true;`;
        webViewRef.current?.injectJavaScript(js);

        if (data.latest.eta !== undefined) setEta(data.latest.eta);
        if (data.latest.dist !== undefined) setDistance(data.latest.dist);
        if (data.latest.stage) setStage(data.latest.stage);
      }
    });

    socket.on('tracker:update', (packet: LivePacket) => {
      lastPacketTime.current = Date.now();
      const js = `window.updatePosition(${packet.lat}, ${packet.lng}, ${packet.h ?? 0}); true;`;
      webViewRef.current?.injectJavaScript(js);

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

      {/* Map WebView */}
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: LEAFLET_HTML }}
        style={styles.webView}
        scrollEnabled={false}
      />

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

