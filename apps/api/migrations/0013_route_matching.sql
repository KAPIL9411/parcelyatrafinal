-- 0013_route_matching.sql
--
-- Route-corridor matching: a trip's actual road geometry, stored on the trip row.
--
-- Why: matching used to require the parcel's destination city to equal the trip's destination city,
-- and its origin city to be within 10 km of the trip's origin. That is the wrong question. A
-- Bareilly → Delhi traveller drives through Moradabad and Ghaziabad, so a Moradabad → Ghaziabad parcel
-- is on the way even though neither city matches an endpoint.
--
-- What this adds:
--   * the encoded road polyline plus the numbers a quote and an ETA need (distance, duration);
--   * a bounding box, so Stage A can narrow the scan with plain btree comparisons instead of loading
--     every live trip into Node (no PostGIS dependency: Neon may or may not have it, and this schema
--     does not need it for a bounding-box prefilter);
--   * an explicit provenance and status, because a straight line is not a road and the product must
--     be able to say which one it used;
--   * a refresh deadline, so a route measured once does not stay authoritative forever.
--
-- Reversibility: every column is nullable and additive. `trips` rows that predate this migration keep
-- working exactly as before — an exact city pair still matches, and a non-exact pair is refused with
-- ROUTE_NOT_EVALUABLE rather than guessed. The runner applies files forward only, so rolling back means
-- running the DOWN block at the bottom by hand (or restoring the pre-deploy backup).

ALTER TABLE trips
  ADD COLUMN route_geometry     text,
  ADD COLUMN route_distance_m   integer,
  ADD COLUMN route_duration_s   integer,
  ADD COLUMN route_provider     text,
  ADD COLUMN route_source       text,
  ADD COLUMN route_status       text NOT NULL DEFAULT 'pending',
  ADD COLUMN route_computed_at  timestamptz,
  ADD COLUMN route_expires_at   timestamptz,
  ADD COLUMN route_min_lat      numeric(9, 6),
  ADD COLUMN route_max_lat      numeric(9, 6),
  ADD COLUMN route_min_lng      numeric(9, 6),
  ADD COLUMN route_max_lng      numeric(9, 6);

-- 'pending'    — never measured; exact-endpoint matching only.
-- 'ready'      — geometry present and usable.
-- 'estimated'  — straight-line fallback, labelled as such; usable only when the deployment allows it.
-- 'unavailable'— the provider failed and no fallback was stored; exact-endpoint matching only.
ALTER TABLE trips
  ADD CONSTRAINT trips_route_status_ck
  CHECK (route_status IN ('pending', 'ready', 'estimated', 'unavailable'));

ALTER TABLE trips
  ADD CONSTRAINT trips_route_source_ck
  CHECK (route_source IS NULL OR route_source IN ('routed', 'estimated'));

ALTER TABLE trips
  ADD CONSTRAINT trips_route_geometry_ck
  CHECK (route_status NOT IN ('ready', 'estimated') OR route_geometry IS NOT NULL);

-- Stage A: live trips that have not departed, scanned in departure order. This is the index the
-- candidate query leans on; the old (origin_city_id, dest_city_id, departure_at) index cannot serve a
-- corridor scan because the corridor deliberately does not constrain either city.
CREATE INDEX trips_active_departure_idx
  ON trips(departure_at)
  WHERE status IN ('published', 'partially_booked');

-- The background backfill's work queue: trips that are live, leave in the future, and have no usable
-- geometry yet. Partial, so it stays small however many finished trips accumulate.
CREATE INDEX trips_route_pending_idx
  ON trips(departure_at)
  WHERE status IN ('published', 'partially_booked')
    AND route_status IN ('pending', 'unavailable');

-- Expiry sweep: a route measured before this timestamp is due for re-measurement.
CREATE INDEX trips_route_expiry_idx
  ON trips(route_expires_at)
  WHERE route_status IN ('ready', 'estimated');

-- DOWN (kept as a comment because the migration runner applies files forward only):
--
-- DROP INDEX IF EXISTS trips_route_expiry_idx;
-- DROP INDEX IF EXISTS trips_route_pending_idx;
-- DROP INDEX IF EXISTS trips_active_departure_idx;
-- ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_route_geometry_ck;
-- ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_route_source_ck;
-- ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_route_status_ck;
-- ALTER TABLE trips
--   DROP COLUMN IF EXISTS route_geometry,
--   DROP COLUMN IF EXISTS route_distance_m,
--   DROP COLUMN IF EXISTS route_duration_s,
--   DROP COLUMN IF EXISTS route_provider,
--   DROP COLUMN IF EXISTS route_source,
--   DROP COLUMN IF EXISTS route_status,
--   DROP COLUMN IF EXISTS route_computed_at,
--   DROP COLUMN IF EXISTS route_expires_at,
--   DROP COLUMN IF EXISTS route_min_lat,
--   DROP COLUMN IF EXISTS route_max_lat,
--   DROP COLUMN IF EXISTS route_min_lng,
--   DROP COLUMN IF EXISTS route_max_lng;
