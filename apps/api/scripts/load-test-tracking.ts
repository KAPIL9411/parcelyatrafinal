/**
 * High-scale WebSocket Load Test Script for Parcel Yatra Live Tracking.
 * Simulates 1,000 concurrent driver streams emitting GPS updates to the backend.
 *
 * Usage:
 *   npx tsx scripts/load-test-tracking.ts --drivers 1000 --duration 30 --url http://127.0.0.1:3000
 */

import { io, type Socket } from 'socket.io-client';
import { signAccessToken } from '../src/lib/auth.ts';

interface LoadTestStats {
  connectedDrivers: number;
  packetsSent: number;
  packetsAcked: number;
  packetsDroppedOrFailed: number;
  latenciesMs: number[];
}

const stats: LoadTestStats = {
  connectedDrivers: 0,
  packetsSent: 0,
  packetsAcked: 0,
  packetsDroppedOrFailed: 0,
  latenciesMs: [],
};

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string, fallback: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? (args[idx + 1] ?? fallback) : fallback;
  };

  const driverCount = Number(getArg('--drivers', '1000'));
  const durationSeconds = Number(getArg('--duration', '30'));
  const targetUrl = getArg('--url', 'http://127.0.0.1:3000');

  console.log(`
======================================================
  Parcel Yatra Live Tracking Load Test
  Simulating: ${driverCount} concurrent active drivers
  Duration:   ${durationSeconds} seconds
  Target:     ${targetUrl}
======================================================
`);

  // Generate valid test JWT token with staff role so all test bookings pass authorization
  const token = await signAccessToken({
    sub: '00000000-0000-0000-0000-000000000001',
    roles: ['staff', 'verified'],
    sid: 'load-test-session',
  });

  const sockets: Socket[] = [];
  const intervals: NodeJS.Timeout[] = [];

  // Base coordinates around Delhi NCR
  const baseLat = 28.6139;
  const baseLng = 77.2090;

  console.log(`Connecting ${driverCount} driver sockets in batches...`);

  const batchSize = 100;
  for (let b = 0; b < driverCount; b += batchSize) {
    const end = Math.min(b + batchSize, driverCount);
    for (let i = b; i < end; i++) {
      const driverId = `driver-${i + 1}`;
      const bookingId = `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`;

      const socket = io(targetUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        timeout: 10000,
      });

      socket.on('connect', () => {
        stats.connectedDrivers++;
      });

      socket.on('connect_error', () => {
        stats.packetsDroppedOrFailed++;
      });

      // Drift slightly per driver to simulate movement along road
      let currentLat = baseLat + (i * 0.0001);
      let currentLng = baseLng + (i * 0.0001);
      let heading = (i * 30) % 360;

      // Each driver emits according to adaptive sampling interval (2.5s)
      const timer = setInterval(() => {
        if (!socket.connected) return;

        currentLat += 0.00005; // ~5.5m movement North
        currentLng += 0.00003;
        heading = (heading + 2) % 360;

        const payload = {
          b: bookingId,
          lat: Number(currentLat.toFixed(6)),
          lng: Number(currentLng.toFixed(6)),
          s: 11.5, // ~41 km/h
          h: heading,
          a: 8.0,  // 8m accuracy
          t: Date.now(),
        };

        const sendTime = performance.now();
        stats.packetsSent++;

        socket.emit('driver:location', payload, (res: { ok: boolean }) => {
          const latency = performance.now() - sendTime;
          stats.latenciesMs.push(latency);

          if (res?.ok) {
            stats.packetsAcked++;
          } else {
            stats.packetsDroppedOrFailed++;
          }
        });
      }, 2500);

      sockets.push(socket);
      intervals.push(timer);
    }
    // Pause 50ms between connection batches to prevent TCP port exhaustion
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`Connected drivers: ${stats.connectedDrivers}. Streaming for ${durationSeconds} seconds...`);

  // Progress monitoring every 5 seconds
  const monitorTimer = setInterval(() => {
    console.log(
      `[Stats] Connected: ${stats.connectedDrivers} | Sent: ${stats.packetsSent} | Acked: ${stats.packetsAcked} | Latency avg: ${
        stats.latenciesMs.length > 0
          ? (stats.latenciesMs.reduce((a, b) => a + b, 0) / stats.latenciesMs.length).toFixed(1)
          : '0'
      } ms`,
    );
  }, 5000);

  // Stop test after duration
  await new Promise((r) => setTimeout(r, durationSeconds * 1000));

  clearInterval(monitorTimer);
  for (const t of intervals) clearInterval(t);
  for (const s of sockets) s.disconnect();

  // Print Percentiles
  stats.latenciesMs.sort((a, b) => a - b);
  const count = stats.latenciesMs.length;
  const p50 = count > 0 ? stats.latenciesMs[Math.floor(count * 0.5)]?.toFixed(1) : 'N/A';
  const p95 = count > 0 ? stats.latenciesMs[Math.floor(count * 0.95)]?.toFixed(1) : 'N/A';
  const p99 = count > 0 ? stats.latenciesMs[Math.floor(count * 0.99)]?.toFixed(1) : 'N/A';

  console.log(`
======================================================
  Load Test Complete Results
======================================================
  Total Packets Sent:      ${stats.packetsSent}
  Total Packets Acked:     ${stats.packetsAcked}
  Failed / Dropped:        ${stats.packetsDroppedOrFailed}
  Throughput:              ${(stats.packetsSent / durationSeconds).toFixed(1)} updates/sec
  Latency p50:             ${p50} ms
  Latency p95:             ${p95} ms (Target: < 1500 ms)
  Latency p99:             ${p99} ms
======================================================
`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Load test failure:', err);
  process.exit(1);
});

