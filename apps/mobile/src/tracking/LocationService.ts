import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getAccessToken } from '../api/client.ts';
import { DriverTrackingClient } from './DriverTrackingClient.ts';

export const TRACKING_TASK_NAME = 'PARCEL_YATRA_LOCATION_TASK';

// Global tracking client singleton
let activeTrackingClient: DriverTrackingClient | null = null;
let currentTrackingBookingId: string | null = null;

export function getActiveDriverClient(): DriverTrackingClient {
  if (!activeTrackingClient) {
    activeTrackingClient = new DriverTrackingClient(getAccessToken);
  }
  return activeTrackingClient;
}

// Register background task with Expo TaskManager
TaskManager.defineTask(TRACKING_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.warn('[LocationService] Background tracking error:', error.message);
    return;
  }

  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (!locations || locations.length === 0) return;

    const client = getActiveDriverClient();
    for (const loc of locations) {
      client.onLocationUpdate({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? 10,
        speed: loc.coords.speed !== null && loc.coords.speed !== undefined && loc.coords.speed >= 0 ? loc.coords.speed : 0,
        heading: loc.coords.heading !== null && loc.coords.heading !== undefined && loc.coords.heading >= 0 ? loc.coords.heading : 0,
        timestamp: loc.timestamp,
      });
    }
  }
});

/**
 * Request necessary location permissions (Foreground and Background).
 */
export async function requestLocationPermissions(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    return false;
  }

  try {
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    return bgStatus === 'granted';
  } catch {
    // If background permission is denied or unsupported, foreground still functions
    return true;
  }
}

/**
 * Start foreground + background driver GPS streaming service for active booking.
 */
export async function startDriverLocationService(bookingId: string): Promise<boolean> {
  currentTrackingBookingId = bookingId;
  const permitted = await requestLocationPermissions();
  if (!permitted) {
    if (currentTrackingBookingId === bookingId) currentTrackingBookingId = null;
    console.warn('[LocationService] Location permissions not granted');
    return false;
  }

  const client = getActiveDriverClient();
  client.start(bookingId);

  // Always (re)start the updates: a task can be registered while its foreground service was never
  // started (for example the first delivery arrived while the app was backgrounded), and skipping
  // on `isTaskRegisteredAsync` left the courier streaming nothing for the rest of the trip.
  await Location.startLocationUpdatesAsync(TRACKING_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 2500, // 2.5s base interval
    distanceInterval: 10, // 10 meters minimum movement
    deferredUpdatesInterval: 2500,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Parcel Yatra Live Delivery',
      notificationBody: 'Sharing live location with customer for active parcel',
      notificationColor: '#005DFD',
    },
    pausesUpdatesAutomatically: false,
  });

  return true;
}

/**
 * Stop driver GPS streaming service and clear background task.
 *
 * Pass the booking that is finishing so a different active delivery is never stopped by a stale
 * screen (e.g. the previous booking's detail unmounting after a new one started).
 */
export async function stopDriverLocationService(bookingId?: string): Promise<void> {
  if (bookingId && currentTrackingBookingId && currentTrackingBookingId !== bookingId) return;

  if (activeTrackingClient) {
    activeTrackingClient.stop();
  }
  currentTrackingBookingId = null;

  const isRegistered = await TaskManager.isTaskRegisteredAsync(TRACKING_TASK_NAME);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK_NAME);
  }
}

export function getCurrentTrackingBookingId(): string | null {
  return currentTrackingBookingId;
}
