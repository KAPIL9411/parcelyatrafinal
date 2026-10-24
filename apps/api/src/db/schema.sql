-- Parcel Yatra — pilot schema (PostgreSQL 16+; runs unmodified on PGlite for local development)
--
-- Derived from database/SCHEMA.md. Two deliberate, documented deviations:
--   DEFECT-002: money columns are `*_paise` integers, not rupee `numeric`, per AGENTS.md §7.
--   DEFECT-003: `trips` carries `origin_area`, plus a reserved nullable `dest_area` that no route
--                writes yet, so the API can return a coarse starting area for a published trip.
-- See docs/BUILD_NOTES.md.

CREATE TYPE user_status         AS ENUM ('active','suspended','deleted');
CREATE TYPE verification_state  AS ENUM ('not_started','pending','verified','rejected','expired');
CREATE TYPE parcel_status       AS ENUM ('draft','posted','matched','ineligible','cancelled','closed');
CREATE TYPE trip_status         AS ENUM ('published','partially_booked','full','in_progress','completed','cancelled','expired');
CREATE TYPE transport_mode      AS ENUM ('car','bike','bus','train','air');
CREATE TYPE booking_status      AS ENUM (
  'draft','pending_traveller_acceptance','payment_pending','confirmed','pickup_ready',
  'picked_up','in_transit','arrived','delivered','payout_eligible','paid_out',
  'cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible','cancelled_safety',
  'expired','disputed','refunded','locked_for_review','incident_open','delivery_attempt_failed');
CREATE TYPE payment_state       AS ENUM ('created','authorised','captured','failed','refunded','partially_refunded','unknown');
CREATE TYPE payout_state        AS ENUM ('not_eligible','eligible','frozen','released','void');
CREATE TYPE dispute_state       AS ENUM ('open','evidence_requested','under_review','resolved','closed','appealed');
CREATE TYPE role_name           AS ENUM ('sender','traveller','support_agent','verification_reviewer','finance','trust_safety','admin_readonly');

-- ---------------------------------------------------------------- identity

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash        text NOT NULL UNIQUE,
  phone_last4       char(4) NOT NULL,
  -- Masked form only: +91XX******YY. The raw number is never stored (AGENTS.md §2.5).
  phone_masked      text NOT NULL DEFAULT '+91** ******',
  name              text,
  email             text,
  status            user_status NOT NULL DEFAULT 'active',
  risk_tier         smallint NOT NULL DEFAULT 1 CHECK (risk_tier BETWEEN 0 AND 3),
  locale            text NOT NULL DEFAULT 'en-IN',
  phone_verified_at timestamptz,
  fraud_flag        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT users_email_ck CHECK (email IS NULL OR position('@' in email) > 1)
);
CREATE INDEX users_status_idx ON users(status) WHERE deleted_at IS NULL;

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       role_name NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL,
  family_id    uuid NOT NULL,
  device_id    text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions(family_id);

CREATE TABLE otp_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash   text NOT NULL,
  phone_last4  char(4) NOT NULL,
  phone_masked text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('login','pickup','delivery','phone_change')),
  code_hash    text NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts smallint NOT NULL DEFAULT 5,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_challenges(phone_hash, purpose, created_at DESC);

CREATE TABLE consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose        text NOT NULL,
  policy_version text NOT NULL,
  granted        boolean NOT NULL,
  method         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- verification

CREATE TABLE verifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state        verification_state NOT NULL DEFAULT 'pending',
  id_type      text CHECK (id_type IN ('driving_licence','voter_id','passport')),
  reviewer_id  uuid REFERENCES users(id),
  reason_code  text,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_user_idx ON verifications(user_id, created_at DESC);

CREATE TABLE verification_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES verifications(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('id_front','id_back','selfie')),
  object_key      text NOT NULL,
  content_sha256  text NOT NULL,
  mime_type       text NOT NULL,
  byte_size       integer NOT NULL CHECK (byte_size <= 10485760),
  created_at      timestamptz NOT NULL DEFAULT now(),
  purge_after     timestamptz NOT NULL
);

CREATE TABLE payout_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_last4 char(4) NOT NULL,
  ifsc_hash     text NOT NULL,
  holder_name   text NOT NULL,
  verified_at   timestamptz,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_last4, ifsc_hash)
);

-- ---------------------------------------------------------------- geography

CREATE TABLE cities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  state          text NOT NULL,
  lat            numeric(9,6) NOT NULL,
  lng            numeric(9,6) NOT NULL,
  is_serviceable boolean NOT NULL DEFAULT false,
  UNIQUE (name, state)
);

CREATE TABLE areas (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name    text NOT NULL,
  UNIQUE (city_id, name)
);

-- ---------------------------------------------------------------- parcels

CREATE TABLE parcels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id          uuid NOT NULL REFERENCES users(id),
  origin_city_id     uuid NOT NULL REFERENCES cities(id),
  dest_city_id       uuid NOT NULL REFERENCES cities(id),
  origin_area        text NOT NULL,
  dest_area          text NOT NULL,
  category           text NOT NULL,
  description        text NOT NULL,
  weight_kg          numeric(5,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 5),
  dims_cm            integer[] NOT NULL,
  declared_value_paise integer NOT NULL CHECK (declared_value_paise > 0 AND declared_value_paise <= 500000),
  window_start       timestamptz NOT NULL,
  window_end         timestamptz NOT NULL,
  receiver_name      text NOT NULL,
  receiver_phone_hash text NOT NULL,
  receiver_phone_last4 char(4) NOT NULL,
  status             parcel_status NOT NULL DEFAULT 'draft',
  review_required    boolean NOT NULL DEFAULT false,
  review_reason      text,
  sealed_photo_key   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parcel_window_ck CHECK (window_end > window_start),
  CONSTRAINT parcel_cities_ck CHECK (origin_city_id <> dest_city_id)
);
CREATE INDEX parcels_sender_idx ON parcels(sender_id, created_at DESC);
CREATE INDEX parcels_route_idx ON parcels(origin_city_id, dest_city_id, window_start);

-- ---------------------------------------------------------------- trips

CREATE TABLE trips (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  traveller_id           uuid NOT NULL REFERENCES users(id),
  origin_city_id         uuid NOT NULL REFERENCES cities(id),
  dest_city_id           uuid NOT NULL REFERENCES cities(id),
  origin_area            text,
  dest_area              text,
  mode                   transport_mode NOT NULL,
  departure_at           timestamptz NOT NULL,
  arrival_estimate_at    timestamptz NOT NULL,
  capacity_kg            numeric(5,2) NOT NULL CHECK (capacity_kg > 0 AND capacity_kg <= 20),
  capacity_kg_remaining  numeric(5,2) NOT NULL CHECK (capacity_kg_remaining >= 0),
  status                 trip_status NOT NULL DEFAULT 'published',
  accepts_documents_only boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_capacity_ck CHECK (capacity_kg_remaining <= capacity_kg),
  CONSTRAINT trip_time_ck CHECK (arrival_estimate_at > departure_at)
);
CREATE INDEX trips_match_idx ON trips(origin_city_id, dest_city_id, departure_at)
  WHERE status IN ('published','partially_booked');
CREATE INDEX trips_traveller_idx ON trips(traveller_id, departure_at DESC);

-- ---------------------------------------------------------------- quotes and bookings

CREATE TABLE quotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id          uuid REFERENCES parcels(id) ON DELETE SET NULL,
  formula_version    text NOT NULL,
  inputs             jsonb NOT NULL,
  subtotal_paise     integer NOT NULL,
  platform_fee_paise integer NOT NULL,
  tax_paise          integer NOT NULL,
  total_paise        integer NOT NULL,
  traveller_paise    integer NOT NULL,
  breakdown          jsonb NOT NULL,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_total_ck CHECK (total_paise = subtotal_paise + platform_fee_paise + tax_paise)
);
CREATE INDEX quotes_parcel_idx ON quotes(parcel_id, created_at DESC);

CREATE TABLE bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id             uuid NOT NULL REFERENCES parcels(id),
  trip_id               uuid NOT NULL REFERENCES trips(id),
  sender_id             uuid NOT NULL REFERENCES users(id),
  traveller_id          uuid NOT NULL REFERENCES users(id),
  quote_id              uuid NOT NULL REFERENCES quotes(id),
  status                booking_status NOT NULL DEFAULT 'draft',
  accept_by             timestamptz,
  agreed_total_paise    integer NOT NULL CHECK (agreed_total_paise > 0),
  traveller_share_paise integer NOT NULL CHECK (traveller_share_paise >= 0),
  cancel_reason         text,
  dispute_deadline      timestamptz,
  delivered_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_parties_ck CHECK (sender_id <> traveller_id)
);
CREATE UNIQUE INDEX bookings_one_active_per_parcel
  ON bookings(parcel_id)
  WHERE status NOT IN ('cancelled_by_sender','cancelled_by_traveller','cancelled_ineligible',
                       'cancelled_safety','expired','refunded','paid_out');
CREATE INDEX bookings_sender_idx ON bookings(sender_id, created_at DESC);
CREATE INDEX bookings_traveller_idx ON bookings(traveller_id, created_at DESC);
CREATE INDEX bookings_status_idx ON bookings(status, updated_at);

CREATE TABLE booking_events (
  id             bigserial PRIMARY KEY,
  booking_id     uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_state     booking_status,
  to_state       booking_status NOT NULL,
  actor_id       uuid REFERENCES users(id),
  actor_kind     text NOT NULL CHECK (actor_kind IN ('user','system','support')),
  command        text,
  reason_code    text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events(booking_id, occurred_at);

-- ---------------------------------------------------------------- handover

CREATE TABLE handovers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  pickup_photo_key   text,
  delivery_photo_key text,
  pickup_at          timestamptz,
  delivered_at       timestamptz,
  override_by        uuid REFERENCES users(id),
  override_reason    text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE handover_otps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  phase        text NOT NULL CHECK (phase IN ('pickup','delivery')),
  code_hash    text NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, phase)
);

-- ---------------------------------------------------------------- money

CREATE TABLE payments (  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id),
  provider          text NOT NULL,
  provider_ref      text,
  provider_event_id text UNIQUE,
  state             payment_state NOT NULL DEFAULT 'created',
  amount_paise      integer NOT NULL CHECK (amount_paise > 0),
  currency          char(3) NOT NULL DEFAULT 'INR',
  sandbox           boolean NOT NULL DEFAULT true,
  client_secret     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments(booking_id);

CREATE TABLE webhook_events (
  event_id    text PRIMARY KEY,
  provider    text NOT NULL,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_ledger (
  id           bigserial PRIMARY KEY,
  booking_id   uuid REFERENCES bookings(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('capture','refund','payout','fee','adjustment','chargeback')),
  amount_paise bigint NOT NULL,
  provider_ref text,
  memo         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_booking_idx ON payment_ledger(booking_id, created_at);

CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments(id),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  reason_code  text NOT NULL,
  state        text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending_approval','pending','processed','failed')),
  requested_by uuid REFERENCES users(id),
  approved_by  uuid REFERENCES users(id),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL UNIQUE REFERENCES bookings(id),
  state         payout_state NOT NULL DEFAULT 'not_eligible',
  amount_paise  integer NOT NULL CHECK (amount_paise >= 0),
  provider_ref  text,
  released_at   timestamptz,
  frozen_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- disputes, reviews

CREATE TABLE disputes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  raised_by    uuid NOT NULL REFERENCES users(id),
  category     text NOT NULL,
  description  text NOT NULL,
  state        dispute_state NOT NULL DEFAULT 'open',
  outcome_code text,
  approved_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE UNIQUE INDEX disputes_one_open ON disputes(booking_id)
  WHERE state IN ('open','evidence_requested','under_review');

CREATE TABLE dispute_evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  object_key  text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  subject_id uuid NOT NULL REFERENCES users(id),
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags       text[] NOT NULL DEFAULT '{}',
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, author_id)
);

-- ---------------------------------------------------------------- platform

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  booking_id   uuid REFERENCES bookings(id) ON DELETE SET NULL,
  channel      text NOT NULL,
  template_id  text NOT NULL,
  status       text NOT NULL DEFAULT 'queued',
  provider_ref text,
  error_code   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  actor_id     uuid REFERENCES users(id),
  actor_kind   text NOT NULL,
  action       text NOT NULL,
  resource     text NOT NULL,
  resource_id  text,
  before_state jsonb,
  after_state  jsonb,
  reason_code  text,
  prev_hash    text,
  entry_hash   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_resource_idx ON audit_log(resource, resource_id, created_at);

CREATE TABLE idempotency_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope        text NOT NULL,
  key          text NOT NULL,
  request_hash text NOT NULL,
  response     jsonb,
  status_code  integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  UNIQUE (user_id, scope, key)
);

CREATE TABLE feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id            bigserial PRIMARY KEY,
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);

CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL,
  payload      jsonb NOT NULL,
  run_at       timestamptz NOT NULL DEFAULT now(),
  attempts     smallint NOT NULL DEFAULT 0,
  locked_at    timestamptz,
  locked_by    text,
  completed_at timestamptz,
  last_error   text
);
CREATE INDEX jobs_due_idx ON jobs(run_at) WHERE completed_at IS NULL;
