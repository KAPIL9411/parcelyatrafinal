/**
 * Driver location streaming for the browser build.
 *
 * The native service pairs `expo-location` with `expo-task-manager`: iOS and Android keep feeding
 * positions to the app after it is closed, which is what lets a courier's route survive a locked
 * screen. A browser has no equivalent. `navigator.geolocation.watchPosition` is the same GPS
 * pipeline, but the instant the tab is backgrounded or the PWA is swiped away, updates stop. There
 * is no way to register a background location task from web content — no permission string, no
 * service-worker trick — so this build streams while the app is open and says so rather than
 * pretending otherwise.
 *
 * What carries over unchanged: the access token, the socket, the GPS filter and the server's
 * `driver:location` contract. A courier who keeps the PWA open on their screen moves the live map
 * exactly as the Android app does.
 */

import { getAccessToken } from '../api/client.ts';
import { DriverTrackingClient } from './DriverTrackingClient.ts';

let client: DriverTrackingClient | null = null;
let bookingId: string | null = null;
let watchId: number | null = null;

/** Positions reach the server on roughly the native cadence; the browser is asked faster and filtered. */
const UPDATE_INTERVAL_MS = 2500;

function activeClient(): DriverTrackingClient {
  if (!client) client = new DriverTrackingClient(getAccessToken);
  return client;
}

/**
 * Resolves once Safari has answered the location prompt, which only happens when something actually
 * asks for a position. `permissions.query` reports the stored answer without triggering a prompt, so
 * it is checked first and a one-shot fix is used to raise the dialog when the state is still `prompt`.
 */
async function requestLocationPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return false;

  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    if (status.state === 'granted') return true;
    if (status.state === 'denied') return false;
  } catch {
    // Safari before 16 has no geolocation entry in the permissions API; the fix below is the prompt.
  }

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { maximumAge: 0, timeout: 15_000, enableHighAccuracy: true },
    );
  });
}

export async function startDriverLocationService(id: string): Promise<boolean> {
  if (bookingId === id && watchId !== null) return true;
  if (bookingId && bookingId !== id) await stopDriverLocationService();

  if (!(await requestLocationPermission())) return false;

  bookingId = id;
  const sink = activeClient();
  sink.start(id);

  let lastSentAt = 0;
  watchId = navigator.geolocation.watchPosition(
    position => {
      const now = position.timestamp || Date.now();
      // The browser samples as fast as it can; the server expects roughly one point every 2.5 s and
      // the filter downstream assumes that rate.
      if (now - lastSentAt < UPDATE_INTERVAL_MS) return;
      lastSentAt = now;
      const { latitude, longitude, accuracy, speed, heading } = position.coords;
      sink.onLocationUpdate({
        latitude,
        longitude,
        accuracy: accuracy ?? 10,
        speed: speed !== null && speed >= 0 ? speed : 0,
        heading: heading !== null && heading >= 0 ? heading : 0,
        timestamp: now,
      });
    },
    error => {
      // Code 1 is a revoked permission, 2 is GPS unavailable, 3 is the browser giving up on the fix.
      console.warn('[LocationService.web] Location stream stopped:', error.message);
      void stopDriverLocationService(id);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
  );

  return true;
}

export async function stopDriverLocationService(id?: string): Promise<void> {
  if (id && bookingId && bookingId !== id) return;
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  client?.stop();
  bookingId = null;
}

export function getCurrentTrackingBookingId(): string | null {
  return bookingId;
}
