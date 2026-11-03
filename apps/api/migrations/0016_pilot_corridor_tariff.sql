-- 0016 — Finalized launch corridor and pilot slab tariff.
--
-- Bareilly → Baheri → Kichha → Rudrapur → Haldwani → Nainital, fixed segment distances
-- 50/18/19/40/45 km (172 km end to end), the pilot tariff policy, tightened parcel limits
-- (3 kg, 30 × 25 × 20 cm), and an operator-editable prohibited-item keyword list.
-- Every figure here comes from the finalized business plan, not from a routing provider.

-- ---------------------------------------------------------------- corridor stops

-- Kichha and Nainital complete the corridor; the other four stops already exist.
INSERT INTO cities (id, name, state, lat, lng, is_serviceable, status, coordinate_source) VALUES
  ('c10e0000-0000-4000-8000-000000000006', 'Kichha',   'Uttarakhand', 28.9786, 79.4146, true, 'active', 'manual_reference'),
  ('c10e0000-0000-4000-8000-000000000007', 'Nainital', 'Uttarakhand', 29.3912, 79.4319, true, 'active', 'manual_reference')
ON CONFLICT (name, state) DO NOTHING;

-- The 0010 state backfill ran before these rows existed; link them the same way.
UPDATE cities c SET state_id = s.id
FROM states s
WHERE c.state_id IS NULL AND s.name = c.state AND c.name IN ('Kichha', 'Nainital');

INSERT INTO zones (city_id, name)
SELECT c.id, z.name
FROM cities c
CROSS JOIN (VALUES ('Central'), ('Transport hubs'), ('Residential catchments'), ('Corridors')) AS z(name)
WHERE c.name IN ('Kichha', 'Nainital')
ON CONFLICT (city_id, name) DO NOTHING;

-- Meeting-point candidates, unverified by convention: an operator must geocode and verify each
-- before any pickup or drop-off is enabled. Fixed-meeting-point handovers are a pilot rule.
INSERT INTO hotspots (city_id, zone_id, name, address)
SELECT c.id, z.id, h.name, h.address
FROM (VALUES
  ('Kichha', 'Railway station vicinity', 'Kichha railway station, Udham Singh Nagar, Uttarakhand'),
  ('Kichha', 'Bus stand vicinity', 'Kichha Roadways bus stand, Uttarakhand'),
  ('Kichha', 'Central market', 'Central market, Kichha, Uttarakhand'),
  ('Nainital', 'Nainital Lake / Tallital', 'Tallital bus stand, Nainital, Uttarakhand'),
  ('Nainital', 'Mall Road entrance', 'Mall Road, Nainital, Uttarakhand'),
  ('Nainital', 'Cheena peak catchment', 'Cheena Peak road, Nainital, Uttarakhand')
) AS h(city_name, name, address)
JOIN cities c ON c.name = h.city_name
LEFT JOIN zones z ON z.city_id = c.id AND z.name = 'Transport hubs'
ON CONFLICT (city_id, name) DO NOTHING;

-- ---------------------------------------------------------------- fixed segment distances

-- Cumulative km from Bareilly per the finalized plan. Every directed corridor pair gets the exact
-- sum of the segments between them, marked operational: these are the plan's published distances,
-- not provider measurements.
WITH stops(name, cum_km) AS (VALUES
  ('Bareilly', 0), ('Baheri', 50), ('Kichha', 68), ('Rudrapur', 87), ('Haldwani', 127), ('Nainital', 172)
), pairs AS (
  SELECT a.name AS origin_name, b.name AS dest_name, ABS(b.cum_km - a.cum_km) AS km
  FROM stops a JOIN stops b ON a.name <> b.name
)
INSERT INTO route_edges (origin_city_id, dest_city_id, distance_m, provider, status, calculated_at, notes)
SELECT oc.id, dc.id, (p.km * 1000)::integer, 'pilot_plan_fixed', 'operational', now(),
       'Fixed corridor distance from the finalized launch plan (0016)'
FROM pairs p
JOIN cities oc ON oc.name = p.origin_name
JOIN cities dc ON dc.name = p.dest_name
ON CONFLICT (origin_city_id, dest_city_id) DO UPDATE
SET distance_m = EXCLUDED.distance_m,
    provider   = EXCLUDED.provider,
    status     = 'operational',
    calculated_at = now(),
    notes      = EXCLUDED.notes,
    updated_at = now();

-- ---------------------------------------------------------------- parcel limits (pilot)

-- Max parcel weight is now 3 kg. The provisional 30 × 25 × 20 cm cap is admin-configurable in the
-- pricing policy and enforced order-insensitively by the eligibility engine, so the DB only keeps
-- structural invariants here: exactly three positive sides.
ALTER TABLE parcels DROP CONSTRAINT parcels_weight_kg_check;
ALTER TABLE parcels ADD CONSTRAINT parcels_weight_kg_check
  CHECK (weight_kg > 0 AND weight_kg <= 3);
ALTER TABLE parcels ADD CONSTRAINT parcels_dims_cm_ck
  CHECK (array_length(dims_cm, 1) = 3
         AND dims_cm[1] BETWEEN 1 AND 100
         AND dims_cm[2] BETWEEN 1 AND 100
         AND dims_cm[3] BETWEEN 1 AND 100);

-- ---------------------------------------------------------------- pilot tariff policy

-- Retire whatever is active and install the finalized pilot tariff. Params shape is validated on
-- read by packages/domain/src/pilot-tariff.ts; admins can clone-and-edit from the admin panel.
UPDATE pricing_policies SET status = 'retired' WHERE status = 'active';

INSERT INTO pricing_policies (version, name, params, status, notes, activated_at) VALUES (
  'pilot-2026-11',
  'Pilot slab tariff — Bareilly–Nainital corridor',
  '{
    "model": "pilot_slab",
    "corridorStops": [
      { "cityId": "c0000000-0000-4000-8000-000000000001", "name": "Bareilly", "segmentKmToNext": 50 },
      { "cityId": "c10e0000-0000-4000-8000-000000000001", "name": "Baheri",   "segmentKmToNext": 18 },
      { "cityId": "c10e0000-0000-4000-8000-000000000006", "name": "Kichha",   "segmentKmToNext": 19 },
      { "cityId": "c10e0000-0000-4000-8000-000000000003", "name": "Rudrapur", "segmentKmToNext": 40 },
      { "cityId": "c10e0000-0000-4000-8000-000000000004", "name": "Haldwani", "segmentKmToNext": 45, "hillSegmentToNext": true },
      { "cityId": "c10e0000-0000-4000-8000-000000000007", "name": "Nainital", "segmentKmToNext": null }
    ],
    "senderBasePaise": 1900,
    "senderRatePaisePerKm": 35,
    "senderMinFarePaise": 3900,
    "travellerBasePaise": 1800,
    "travellerRatePaisePerKm": 20,
    "travellerMinPayoutPaise": 2500,
    "weightSlabs": [
      { "maxGrams": 500,  "senderSurchargePaise": 0,    "travellerBonusPaise": 0 },
      { "maxGrams": 1000, "senderSurchargePaise": 1000, "travellerBonusPaise": 800 },
      { "maxGrams": 2000, "senderSurchargePaise": 2000, "travellerBonusPaise": 1500 },
      { "maxGrams": 3000, "senderSurchargePaise": 3500, "travellerBonusPaise": 2200 }
    ],
    "maxWeightKg": 3,
    "maxDimsCm": [30, 25, 20],
    "hillSenderSurchargePaise": 1500,
    "hillTravellerSurchargePaise": 1000,
    "gatewayFeeRate": 0,
    "minCommissionPaise": 0
  }'::jsonb,
  'active',
  'Finalized pilot tariff. Fares are all-in rupee figures; GST treatment is NOT self-assessed and awaits professional advice. Gateway fee stays 0 until an approved payment provider is integrated.',
  now()
)
ON CONFLICT (version) DO NOTHING;

-- If a row for this version already existed (e.g. an admin drafted it), activate it instead of
-- silently leaving the platform without an active policy.
UPDATE pricing_policies SET status = 'active', activated_at = now()
WHERE version = 'pilot-2026-11' AND status = 'draft';

-- ---------------------------------------------------------------- prohibited items (operator-editable)

-- The compiled regex list in the domain remains the safety baseline; this table layers the
-- operator's vocabulary on top and is editable from the admin panel without a deploy.
CREATE TABLE prohibited_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword     text NOT NULL UNIQUE,
  reason      text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO prohibited_items (keyword, reason) VALUES
  ('cash', 'cash or currency'),
  ('currency', 'cash or currency'),
  ('gold', 'jewellery or precious metal'),
  ('silver', 'jewellery or precious metal'),
  ('jewellery', 'jewellery or precious metal'),
  ('passport', 'identity documents that are not permitted to travel this way'),
  ('aadhaar', 'identity documents that are not permitted to travel this way'),
  ('medicine', 'medicines'),
  ('laptop', 'high-value electronics'),
  ('mobile phone', 'high-value electronics'),
  ('battery', 'batteries or hazardous material'),
  ('lithium', 'batteries or hazardous material'),
  ('perfume', 'flammable material'),
  ('aerosol', 'flammable material'),
  ('alcohol', 'alcohol'),
  ('tobacco', 'tobacco'),
  ('firearm', 'weapons'),
  ('ammunition', 'weapons'),
  ('live animal', 'live animals'),
  ('explosive', 'hazardous chemicals'),
  ('firework', 'hazardous chemicals')
ON CONFLICT (keyword) DO NOTHING;
