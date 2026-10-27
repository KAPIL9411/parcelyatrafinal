-- Geographic network, routing cache, and database-backed launch pricing.
--
-- Hierarchy: country → state → city → zone → hotspot (an approved hotspot is the authorised
-- pickup/drop-off point; per-hotspot pickup and drop-off availability is carried on the row).
--
-- Reference data is seeded here, not only in the dev seeder, because production never runs
-- AUTO_SEED. Hotspots are inserted as candidates with NULL coordinates: they must be geocoded and
-- approved before they can accept a parcel, and no coordinate is invented for them.

CREATE TABLE countries (
  code      char(2) PRIMARY KEY,
  name      text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE states (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code char(2) NOT NULL REFERENCES countries(code),
  name         text NOT NULL,
  code         text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  UNIQUE (country_code, name)
);

ALTER TABLE cities ADD COLUMN state_id uuid REFERENCES states(id);
ALTER TABLE cities ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('candidate', 'active', 'paused', 'retired'));
ALTER TABLE cities ADD COLUMN coordinate_source text;
ALTER TABLE cities ADD COLUMN coordinate_verified_at timestamptz;

CREATE TABLE zones (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name    text NOT NULL,
  status  text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'paused')),
  UNIQUE (city_id, name)
);

CREATE TABLE hotspots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  zone_id             uuid REFERENCES zones(id) ON DELETE SET NULL,
  name                text NOT NULL,
  address             text,
  lat                 numeric(9, 6),
  lng                 numeric(9, 6),
  service_radius_m    integer CHECK (service_radius_m > 0),
  pickup_enabled      boolean NOT NULL DEFAULT false,
  dropoff_enabled     boolean NOT NULL DEFAULT false,
  operating_hours     jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'rejected', 'suspended')),
  verification_notes  text,
  verified_by         uuid REFERENCES users(id),
  verified_at         timestamptz,
  max_weight_kg       numeric(5, 2),
  max_dimension_cm    integer,
  service_modes       text[] NOT NULL DEFAULT '{hub_to_hub}',
  status              text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'active', 'paused', 'retired')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotspots_coords_ck CHECK ((lat IS NULL) = (lng IS NULL)),
  -- Nothing can accept a parcel without coordinates and a human verification.
  CONSTRAINT hotspots_active_ck CHECK (
    status <> 'active' OR (lat IS NOT NULL AND lng IS NOT NULL AND verification_status = 'verified')
  ),
  UNIQUE (city_id, name)
);
CREATE INDEX hotspots_city_idx ON hotspots(city_id, status);

-- One directed row per origin→destination. The status ladder is deliberately separate:
-- candidate < calculated < approved < operational. Only `operational` may serve a booking when the
-- deployment requires an operational route.
CREATE TABLE route_edges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_city_id uuid NOT NULL REFERENCES cities(id),
  dest_city_id   uuid NOT NULL REFERENCES cities(id),
  distance_m     integer CHECK (distance_m > 0),
  duration_s     integer CHECK (duration_s > 0),
  route_geometry text,
  provider       text,
  status         text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'calculated', 'approved', 'operational', 'failed', 'retired')),
  calculated_at  timestamptz,
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_edges_distinct_ck CHECK (origin_city_id <> dest_city_id),
  CONSTRAINT route_edges_operational_ck CHECK (status <> 'operational' OR distance_m IS NOT NULL),
  UNIQUE (origin_city_id, dest_city_id)
);
CREATE INDEX route_edges_origin_idx ON route_edges(origin_city_id, status);

-- Provider responses, including failures. A failed attempt is recorded so a missing credential or
-- a quota error is visible instead of being mistaken for an untried pair.
CREATE TABLE distance_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_kind   text NOT NULL CHECK (from_kind IN ('city', 'hotspot')),
  from_id     uuid NOT NULL,
  to_kind     text NOT NULL CHECK (to_kind IN ('city', 'hotspot')),
  to_id       uuid NOT NULL,
  provider    text NOT NULL,
  status      text NOT NULL CHECK (status IN ('ok', 'failed')),
  distance_m  integer CHECK (distance_m IS NULL OR distance_m > 0),
  duration_s  integer CHECK (duration_s IS NULL OR duration_s > 0),
  error       text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  UNIQUE (from_kind, from_id, to_kind, to_id, provider)
);
CREATE INDEX distance_cache_expiry_idx ON distance_cache(expires_at);

-- Versioned, centrally managed pricing. Exactly one active policy may exist.
CREATE TABLE pricing_policies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version      text NOT NULL UNIQUE,
  name         text NOT NULL,
  params       jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  notes        text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);
CREATE UNIQUE INDEX pricing_policies_one_active ON pricing_policies (status) WHERE status = 'active';

-- Official third-party tariffs, stored separately from our own prices and never copied into them.
CREATE TABLE postal_benchmarks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text NOT NULL,
  service        text NOT NULL,
  category       text NOT NULL,
  weight_band    text NOT NULL,
  amount_paise   integer NOT NULL CHECK (amount_paise >= 0),
  source_url     text NOT NULL,
  retrieved_at   timestamptz NOT NULL,
  effective_from date,
  notes          text,
  UNIQUE (provider, service, category, weight_band, effective_from)
);

-- ------------------------------------------------------------------ reference data

INSERT INTO countries (code, name) VALUES ('IN', 'India')
ON CONFLICT (code) DO NOTHING;

INSERT INTO states (id, country_code, name, code) VALUES
  ('f10e0000-0000-4000-8000-000000000001', 'IN', 'Uttar Pradesh', 'UP'),
  ('f10e0000-0000-4000-8000-000000000002', 'IN', 'National Capital Territory of Delhi', 'DL'),
  ('f10e0000-0000-4000-8000-000000000003', 'IN', 'Uttarakhand', 'UK')
ON CONFLICT (country_code, name) DO NOTHING;

-- The NCT name is the official one; renaming in place keeps the existing Delhi row (and its id).
UPDATE cities SET state = 'National Capital Territory of Delhi'
WHERE name = 'Delhi' AND state = 'Delhi';

-- City centres below are published reference points, not geocoded confirmations: they are marked
-- unverified until a geocoding call stores a provider result. Existing rows keep their ids.
--
-- The three original cities are repeated here because production runs migrations but never the demo
-- seeder: without them a fresh database would have the new five cities and no network to connect.
-- Their ids match the demo seeder, so a seeded database takes the (name, state) conflict instead.
INSERT INTO cities (id, name, state, lat, lng, is_serviceable, status, coordinate_source) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Bareilly', 'Uttar Pradesh', 28.3670, 79.4304, true, 'active', 'manual_reference'),
  ('c0000000-0000-4000-8000-000000000002', 'Delhi',    'National Capital Territory of Delhi', 28.6139, 77.2090, true, 'active', 'manual_reference'),
  ('c0000000-0000-4000-8000-000000000003', 'Lucknow',  'Uttar Pradesh', 26.8467, 80.9462, true, 'active', 'manual_reference'),
  ('c10e0000-0000-4000-8000-000000000001', 'Baheri',   'Uttar Pradesh', 28.4736, 79.4553, true, 'active', 'manual_reference'),
  ('c10e0000-0000-4000-8000-000000000002', 'Ghaziabad','Uttar Pradesh', 28.6692, 77.4538, true, 'active', 'manual_reference'),
  ('c10e0000-0000-4000-8000-000000000003', 'Rudrapur', 'Uttarakhand',   28.9845, 79.4072, true, 'active', 'manual_reference'),
  ('c10e0000-0000-4000-8000-000000000004', 'Haldwani', 'Uttarakhand',   29.2183, 79.5130, true, 'active', 'manual_reference'),
  ('c10e0000-0000-4000-8000-000000000005', 'Pilibhit', 'Uttar Pradesh', 28.6315, 79.8040, true, 'active', 'manual_reference')
ON CONFLICT (name, state) DO NOTHING;

UPDATE cities c SET state_id = s.id
FROM states s
WHERE c.state_id IS NULL AND s.name = c.state;

-- Zones per city. These are operational groupings, not approved service areas.
INSERT INTO zones (city_id, name)
SELECT c.id, z.name
FROM cities c
CROSS JOIN (VALUES ('Central'), ('Transport hubs'), ('Residential catchments'), ('Corridors')) AS z(name)
WHERE c.name IN ('Baheri', 'Bareilly', 'Delhi', 'Ghaziabad', 'Rudrapur', 'Haldwani', 'Pilibhit', 'Lucknow')
ON CONFLICT (city_id, name) DO NOTHING;

INSERT INTO zones (city_id, name)
SELECT c.id, 'Industrial'
FROM cities c
WHERE c.name IN ('Rudrapur', 'Ghaziabad')
ON CONFLICT (city_id, name) DO NOTHING;

-- Hotspot candidates named in the launch brief. Coordinates are intentionally NULL: each must be
-- geocoded and verified by an operator before it is activated. No pickup or drop-off is enabled.
INSERT INTO hotspots (city_id, zone_id, name, address)
SELECT c.id, z.id, h.name, h.address
FROM (VALUES
  ('Baheri', 'Main market / central commercial area', 'Main market, Baheri, Bareilly district, Uttar Pradesh'),
  ('Baheri', 'Bus stand vicinity', 'Roadways bus stand, Baheri, Uttar Pradesh'),
  ('Baheri', 'Railway station vicinity (subject to verification)', 'Baheri railway station, Uttar Pradesh'),
  ('Baheri', 'Bareilly road corridor', 'Bareilly Road, Baheri, Uttar Pradesh'),
  ('Bareilly', 'Bareilly Junction vicinity', 'Bareilly Junction, Civil Lines, Bareilly, Uttar Pradesh'),
  ('Bareilly', 'Satellite Bus Stand vicinity', 'Satellite Bus Stand, Bareilly, Uttar Pradesh'),
  ('Bareilly', 'Izzatnagar', 'Izzatnagar, Bareilly, Uttar Pradesh'),
  ('Bareilly', 'DD Puram', 'DD Puram, Bareilly, Uttar Pradesh'),
  ('Bareilly', 'Pilibhit Bypass', 'Pilibhit Bypass, Bareilly, Uttar Pradesh'),
  ('Bareilly', 'City Station / central market area', 'City Station and central market, Bareilly, Uttar Pradesh'),
  ('Pilibhit', 'Railway station vicinity', 'Pilibhit Junction railway station, Uttar Pradesh'),
  ('Pilibhit', 'Bus stand vicinity', 'Roadways bus stand, Pilibhit, Uttar Pradesh'),
  ('Pilibhit', 'Main market', 'Main market, Pilibhit, Uttar Pradesh'),
  ('Pilibhit', 'Bareilly road corridor', 'Bareilly Road, Pilibhit, Uttar Pradesh'),
  ('Rudrapur', 'Railway station vicinity', 'Rudrapur City railway station, Uttarakhand'),
  ('Rudrapur', 'Bus station vicinity', 'Roadways bus station, Rudrapur, Uttarakhand'),
  ('Rudrapur', 'Central market', 'Central market, Rudrapur, Uttarakhand'),
  ('Rudrapur', 'SIDCUL industrial catchment', 'SIDCUL industrial area, Rudrapur, Uttarakhand'),
  ('Rudrapur', 'Kichha Road corridor', 'Kichha Road, Rudrapur, Uttarakhand'),
  ('Haldwani', 'Railway station vicinity', 'Haldwani railway station, Uttarakhand'),
  ('Haldwani', 'Roadways bus station vicinity', 'Roadways bus station, Haldwani, Uttarakhand'),
  ('Haldwani', 'Mukhani', 'Mukhani, Haldwani, Uttarakhand'),
  ('Haldwani', 'Kaladhungi Road catchment', 'Kaladhungi Road, Haldwani, Uttarakhand'),
  ('Haldwani', 'Kathgodam connection area', 'Kathgodam, Haldwani, Uttarakhand'),
  ('Delhi', 'Anand Vihar transport-terminal vicinity', 'Anand Vihar ISBT and railway terminal, Delhi'),
  ('Delhi', 'Kashmere Gate ISBT vicinity', 'Kashmere Gate ISBT, Delhi'),
  ('Delhi', 'Sarai Kale Khan vicinity', 'Sarai Kale Khan ISBT, Delhi'),
  ('Delhi', 'New Delhi Railway Station vicinity', 'New Delhi Railway Station, Delhi'),
  ('Delhi', 'Selected commercial catchments', 'Commercial catchment areas, Delhi'),
  ('Ghaziabad', 'Ghaziabad Junction vicinity', 'Ghaziabad Junction, Uttar Pradesh'),
  ('Ghaziabad', 'Kaushambi bus terminal vicinity', 'Kaushambi bus terminal, Ghaziabad, Uttar Pradesh'),
  ('Ghaziabad', 'Vaishali', 'Vaishali, Ghaziabad, Uttar Pradesh'),
  ('Ghaziabad', 'Indirapuram', 'Indirapuram, Ghaziabad, Uttar Pradesh'),
  ('Ghaziabad', 'Raj Nagar', 'Raj Nagar, Ghaziabad, Uttar Pradesh'),
  ('Ghaziabad', 'Sahibabad corridor', 'Sahibabad, Ghaziabad, Uttar Pradesh'),
  ('Lucknow', 'Charbagh railway station vicinity', 'Charbagh railway station, Lucknow, Uttar Pradesh'),
  ('Lucknow', 'Alambagh bus terminal vicinity', 'Alambagh bus terminal, Lucknow, Uttar Pradesh'),
  ('Lucknow', 'Hazratganj', 'Hazratganj, Lucknow, Uttar Pradesh'),
  ('Lucknow', 'Gomti Nagar', 'Gomti Nagar, Lucknow, Uttar Pradesh'),
  ('Lucknow', 'Transport Nagar', 'Transport Nagar, Lucknow, Uttar Pradesh'),
  ('Lucknow', 'Aliganj', 'Aliganj, Lucknow, Uttar Pradesh')
) AS h(city_name, name, address)
JOIN cities c ON c.name = h.city_name
LEFT JOIN zones z ON z.city_id = c.id AND z.name = 'Transport hubs'
ON CONFLICT (city_id, name) DO NOTHING;

-- Every directed pair among the eight launch cities exists as a candidate. A candidate with no
-- distance is not bookable under an operational-route deployment; it is a slot to be filled by the
-- routing matrix, never an advertised connection.
INSERT INTO route_edges (origin_city_id, dest_city_id, status)
SELECT a.id, b.id, 'candidate'
FROM cities a
JOIN cities b ON b.id <> a.id
WHERE a.name = ANY (ARRAY['Baheri', 'Bareilly', 'Delhi', 'Ghaziabad', 'Rudrapur', 'Haldwani', 'Pilibhit', 'Lucknow'])
  AND b.name = ANY (ARRAY['Baheri', 'Bareilly', 'Delhi', 'Ghaziabad', 'Rudrapur', 'Haldwani', 'Pilibhit', 'Lucknow'])
ON CONFLICT (origin_city_id, dest_city_id) DO NOTHING;

-- The compiled launch policy, activated so it is visible and editable from day one. Values mirror
-- packages/domain/src/launch-pricing.ts DEFAULT_LAUNCH_POLICY and are experiments, not market data.
INSERT INTO pricing_policies (version, name, params, status, notes, activated_at) VALUES (
  'launch-2026-10-experiment',
  'Launch hub-to-hub policy',
  '{
    "baseFarePaise": 1200,
    "routeRatePaisePerKm": 18,
    "weightRatePaisePerKg": 400,
    "handlingFeePaise": 0,
    "commissionRate": 0.06,
    "minCommissionPaise": 0,
    "taxRate": 0.18,
    "minTotalPaise": 3900,
    "maxTotalPaise": 250000,
    "maxSurgeMultiplier": 1.5,
    "maxDiscountRate": 0.5,
    "minTravellerPayoutPaise": 5000,
    "maxSubsidyPaise": 3000,
    "maxWeightKg": 5,
    "maxDimensionCm": 45,
    "volumetricDivisor": 5000
  }'::jsonb,
  'active',
  'Introductory rates from the launch brief. Validate against operating cost and traveller acceptance before production.',
  now()
)
ON CONFLICT (version) DO NOTHING;
