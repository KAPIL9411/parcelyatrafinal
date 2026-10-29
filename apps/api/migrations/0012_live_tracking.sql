-- 0012_live_tracking.sql
-- Live tracking module: real-time location history, status logs, and tracking sessions.

CREATE TABLE location_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  parcel_id    uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  traveller_id uuid NOT NULL REFERENCES users(id),
  lat          numeric(9, 6) NOT NULL,
  lng          numeric(9, 6) NOT NULL,
  bearing      numeric(5, 2),
  speed        numeric(6, 2),
  accuracy     numeric(6, 2),
  recorded_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX location_history_booking_idx ON location_history(booking_id, recorded_at DESC);
CREATE INDEX location_history_parcel_idx ON location_history(parcel_id, recorded_at DESC);

CREATE TABLE parcel_status_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id  uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  stage      text NOT NULL CHECK (stage IN ('picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'arrived_500m', 'arrived_200m')),
  actor_id   uuid REFERENCES users(id),
  lat        numeric(9, 6),
  lng        numeric(9, 6),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX parcel_status_log_parcel_idx ON parcel_status_log(parcel_id, created_at DESC);
CREATE INDEX parcel_status_log_booking_idx ON parcel_status_log(booking_id, created_at DESC);

CREATE TABLE tracking_sessions (
  booking_id              uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  parcel_id               uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  traveller_id            uuid NOT NULL REFERENCES users(id),
  is_active               boolean NOT NULL DEFAULT true,
  dest_lat                numeric(9, 6),
  dest_lng                numeric(9, 6),
  geofence_500m_triggered boolean NOT NULL DEFAULT false,
  geofence_200m_triggered boolean NOT NULL DEFAULT false,
  last_lat                numeric(9, 6),
  last_lng                numeric(9, 6),
  last_bearing            numeric(5, 2),
  last_speed              numeric(6, 2),
  last_eta_seconds        integer,
  last_distance_meters    integer,
  last_point_at           timestamptz,
  started_at              timestamptz NOT NULL DEFAULT now(),
  ended_at                timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tracking_sessions_active_idx ON tracking_sessions(is_active) WHERE is_active = true;
CREATE INDEX tracking_sessions_parcel_idx ON tracking_sessions(parcel_id);

