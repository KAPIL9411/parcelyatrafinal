/**
 * Tunable values and operational thresholds for Live Tracking.
 * Follows design requirements for latency, battery conservation, and noise rejection.
 */

export const TRACKING_CONFIG = {
  /** Maximum acceptable GPS accuracy in meters. Points with accuracy > 50m are rejected. */
  MAX_ACCURACY_METERS: 50,

  /** Outlier / teleport rejection threshold in km/h. Points implying speed > 150 km/h are dropped. */
  MAX_SPEED_KMH: 150,
  /** Outlier threshold in meters per second (150 km/h = 41.67 m/s). */
  MAX_SPEED_MPS: 41.667,

  /** Stationary speed threshold in m/s below which the vehicle is considered stopped. */
  STATIONARY_SPEED_MPS: 0.5,

  /** High-speed threshold in m/s (20 km/h = 5.56 m/s) triggering tighter sampling. */
  HIGH_SPEED_MPS: 5.556,

  /** Driver client adaptive sampling intervals (milliseconds). */
  SAMPLING_INTERVAL_FAST_MS: 2500,     // Speed > 20 km/h
  SAMPLING_INTERVAL_MODERATE_MS: 5000, // Moving at <= 20 km/h
  SAMPLING_INTERVAL_STATIONARY_MS: 20000, // Stationary (heartbeat)

  /** Minimum displacement (meters) before an update is eligible for transmission. */
  MIN_DISPLACEMENT_METERS: 10,

  /** Server rate limiter: maximum location updates allowed per second per driver. */
  MAX_UPDATES_PER_SECOND_PER_DRIVER: 1,

  /** Geofence radii in meters from destination. */
  GEOFENCE_ARRIVING_OUTER_METERS: 500,
  GEOFENCE_ARRIVING_INNER_METERS: 200,

  /** Route recalculation triggers. */
  REROUTE_DEVIATION_METERS: 100, // Driver deviated > 100m from polyline
  REROUTE_INTERVAL_MS: 60000,    // Force recalculate every 60s
  MIN_REROUTE_INTERVAL_MS: 15000,// Rate-limit protection for OSRM public API

  /** Asynchronous DB batch write triggers for location history. */
  HISTORY_BATCH_INTERVAL_MS: 20000, // Flush batch every 20 seconds
  HISTORY_MIN_DISPLACEMENT_METERS: 50, // Or record if moved >= 50m
  HISTORY_BATCH_MAX_SIZE: 500,

  /** Redis live location store TTL in seconds (auto-expires when driver stops). */
  REDIS_LOCATION_TTL_SECONDS: 300,

  /** Stale client threshold in milliseconds (triggers "Last updated X sec ago"). */
  CLIENT_STALE_THRESHOLD_MS: 15000,

  /** Dead reckoning limit: max seconds client may predict ahead if packet is delayed. */
  CLIENT_DEAD_RECKONING_MAX_SECONDS: 5,
} as const;

