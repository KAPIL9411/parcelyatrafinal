import { corridorKm, quoteLaunchPrice } from '@py/domain';

import { closeDb, getDb, schemaExists, type Db } from './client.ts';
import { runMigrations } from './migrations.ts';
import { config } from '../config.ts';
import { legacyQuoteColumns } from '../lib/pricing-policy.ts';
import { maskPhone, phoneHash, phoneLast4 } from '../lib/crypto.ts';

/**
 * Deterministic demo data.
 *
 * Every id below is fixed so a screenshot, a bug report or a test can name a row. The data is
 * obviously fictional: the phone numbers are in the reserved-looking 90000000xx range, the names
 * are placeholders, and no real person or address is represented.
 *
 * Seeding is idempotent. Running it twice changes nothing.
 */

export const CITY = {
  bareilly: 'c0000000-0000-4000-8000-000000000001',
  delhi: 'c0000000-0000-4000-8000-000000000002',
  lucknow: 'c0000000-0000-4000-8000-000000000003',
  noida: 'c0000000-0000-4000-8000-000000000004',
  gurugram: 'c0000000-0000-4000-8000-000000000005',
} as const;

export const USER = {
  sender: 'a0000000-0000-4000-8000-000000000001',
  travellerImran: 'a0000000-0000-4000-8000-000000000002',
  travellerNeha: 'a0000000-0000-4000-8000-000000000003',
  admin: 'a0000000-0000-4000-8000-000000000009',
} as const;

export const PHONE = {
  sender: '+919000000001',
  travellerImran: '+919000000002',
  travellerNeha: '+919000000003',
  admin: '+919000000009',
} as const;

const TRIP = {
  imranDelhi: 'b0000000-0000-4000-8000-000000000001',
  nehaLucknow: 'b0000000-0000-4000-8000-000000000002',
  imranDelhiReturn: 'b0000000-0000-4000-8000-000000000003',
} as const;

const PARCEL_DEMO = 'e0000000-0000-4000-8000-000000000001';
const QUOTE_DEMO = 'f0000000-0000-4000-8000-000000000001';
const BOOKING_DEMO = '90000000-0000-4000-8000-000000000001';

const AREAS: Array<[string, string, string[]]> = [
  [CITY.bareilly, 'Bareilly', ['Civil Lines', 'Rajendra Nagar', 'Izatnagar', 'Cantt']],
  [CITY.delhi, 'Delhi', ['Karol Bagh', 'Connaught Place', 'Dwarka', 'Lajpat Nagar']],
  [CITY.lucknow, 'Lucknow', ['Hazratganj', 'Gomti Nagar', 'Aliganj', 'Charbagh']],
  [CITY.noida, 'Noida', ['Sector 18', 'Sector 62', 'Greater Noida']],
  [CITY.gurugram, 'Gurugram', ['DLF Phase 3', 'Sector 29', 'Sohna Road']],
];

const CITIES: Array<{ id: string; name: string; state: string; lat: number; lng: number; serviceable: boolean }> = [
  { id: CITY.bareilly, name: 'Bareilly', state: 'Uttar Pradesh', lat: 28.367, lng: 79.4304, serviceable: true },
  { id: CITY.delhi, name: 'Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209, serviceable: true },
  { id: CITY.lucknow, name: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462, serviceable: true },
  { id: CITY.noida, name: 'Noida', state: 'Uttar Pradesh', lat: 28.5355, lng: 77.391, serviceable: true },
  { id: CITY.gurugram, name: 'Gurugram', state: 'Haryana', lat: 28.4595, lng: 77.0266, serviceable: true },
];

function atHourFromNow(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function insertCities(db: Db): Promise<void> {
  for (const c of CITIES) {
    await db.query(
      `INSERT INTO cities (id, name, state, lat, lng, is_serviceable)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name, c.state, c.lat, c.lng, c.serviceable],
    );
  }
  let n = 0;
  for (const [cityId, , names] of AREAS) {
    for (const name of names) {
      n += 1;
      const id = `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      await db.query(
        `INSERT INTO areas (id, city_id, name) VALUES ($1,$2,$3) ON CONFLICT (city_id, name) DO NOTHING`,
        [id, cityId, name],
      );
    }
  }
}

async function insertUser(
  db: Db,
  id: string,
  phone: string,
  name: string,
  roles: string[],
): Promise<void> {
  await db.query(
    `INSERT INTO users (id, phone_hash, phone_last4, phone_masked, name, phone_verified_at, risk_tier)
     VALUES ($1,$2,$3,$4,$5, now(), 1) ON CONFLICT (id) DO NOTHING`,
    [id, phoneHash(phone), phoneLast4(phone), maskPhone(phone), name],
  );
  for (const role of roles) {
    await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, role]);
  }
}

async function insertVerified(db: Db, userId: string, idType: string): Promise<void> {
  const existing = await db.query(`SELECT 1 FROM verifications WHERE user_id = $1 AND state = 'verified'`, [userId]);
  if (existing.rows.length > 0) return;
  await db.query(
    `INSERT INTO verifications (user_id, state, id_type, reviewer_id, reason_code, decided_at)
     VALUES ($1,'verified',$2,$3,'id_clear', now())`,
    [userId, idType, USER.admin],
  );
}

async function insertTrip(
  db: Db,
  id: string,
  travellerId: string,
  origin: string,
  dest: string,
  mode: 'car',
  departure: Date,
  arrival: Date,
  capacityKg: number,
  remainingKg: number,
): Promise<void> {
  await db.query(
    `INSERT INTO trips
      (id, traveller_id, origin_city_id, dest_city_id, mode, departure_at, arrival_estimate_at,
       capacity_kg, capacity_kg_remaining, status, accepts_documents_only)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published',true) ON CONFLICT (id) DO NOTHING`,
    [id, travellerId, origin, dest, mode, departure, arrival, capacityKg, remainingKg],
  );
}

async function seedDemoBooking(db: Db): Promise<void> {
  const existing = await db.query(`SELECT 1 FROM bookings WHERE id = $1`, [BOOKING_DEMO]);
  if (existing.rows.length > 0) return;

  const bareilly = CITIES[0]!;
  const delhi = CITIES[1]!;
  const km = corridorKm({ lat: bareilly.lat, lng: bareilly.lng }, { lat: delhi.lat, lng: delhi.lng });
  // Demo data is labelled as an estimate: no routing provider ran for these coordinates.
  const priced = quoteLaunchPrice({
    roadDistanceKm: km,
    distanceSource: 'estimated',
    actualWeightKg: 1.5,
    dimsCm: [30, 22, 2],
    category: 'documents',
  });
  const legacy = legacyQuoteColumns(priced);

  const windowStart = atHourFromNow(1, 9);
  // The demo parcel is picked up and delivered on the same day. A window ending the following
  // evening read as a 33-hour window and did not match the trip it is booked against.
  const windowEnd = atHourFromNow(1, 18);

  await db.query(
    `INSERT INTO parcels
      (id, sender_id, origin_city_id, dest_city_id, origin_area, dest_area, category, description,
       weight_kg, dims_cm, declared_value_paise, window_start, window_end,
       receiver_name, receiver_phone_hash, receiver_phone_last4, status, review_required)
     VALUES ($1,$2,$3,$4,$5,$6,'documents',$7,$8,$9,$10,$11,$12,$13,$14,$15,'matched',false)
     ON CONFLICT (id) DO NOTHING`,
    [
      PARCEL_DEMO,
      USER.sender,
      CITY.bareilly,
      CITY.delhi,
      'Civil Lines',
      'Karol Bagh',
      'A4 envelope with a signed property agreement',
      1.5,
      [30, 22, 2],
      250_000,
      windowStart,
      windowEnd,
      'R. Sharma',
      phoneHash('+919000000101'),
      phoneLast4('+919000000101'),
    ],
  );

  await db.query(
    `INSERT INTO quotes
      (id, parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
       total_paise, traveller_paise, breakdown, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
    [
      QUOTE_DEMO,
      PARCEL_DEMO,
      priced.formula_version,
      JSON.stringify({
        formula_version: priced.formula_version,
        policy_version: priced.policy_version,
        road_distance_km: priced.road_distance_km,
        distance_source: priced.distance_source,
        actual_weight_kg: priced.actual_weight_kg,
        volumetric_weight_kg: priced.volumetric_weight_kg,
        billable_weight_kg: priced.billable_weight_kg,
        category: 'documents',
        service_mode: 'hub_to_hub',
        commission_paise: priced.commission_paise,
        traveller_subsidy_paise: priced.traveller_subsidy_paise,
        discount_paise: priced.discount_paise,
        platform_net_paise: priced.platform_net_paise,
        loss_making: priced.loss_making,
        warnings: priced.warnings,
        demo: true,
      }),
      legacy.subtotal_paise,
      legacy.platform_fee_paise,
      priced.tax_paise,
      priced.total_paise,
      priced.traveller_paise,
      JSON.stringify(priced.breakdown),
      new Date(Date.now() + 15 * 60_000),
    ],
  );

  await db.query(
    `INSERT INTO bookings
      (id, parcel_id, trip_id, sender_id, traveller_id, quote_id, status,
       agreed_total_paise, traveller_share_paise, accept_by)
     VALUES ($1,$2,$3,$4,$5,$6,'pending_traveller_acceptance',$7,$8, now() + interval '30 minutes')
     ON CONFLICT (id) DO NOTHING`,
    [
      BOOKING_DEMO,
      PARCEL_DEMO,
      TRIP.imranDelhi,
      USER.sender,
      USER.travellerImran,
      QUOTE_DEMO,
      priced.total_paise,
      priced.traveller_paise,
    ],
  );

  await db.query(`INSERT INTO handovers (booking_id) VALUES ($1) ON CONFLICT (booking_id) DO NOTHING`, [BOOKING_DEMO]);
  await db.query(
    `INSERT INTO payouts (booking_id, state, amount_paise) VALUES ($1,'not_eligible',$2)
     ON CONFLICT (booking_id) DO NOTHING`,
    [BOOKING_DEMO, priced.traveller_paise],
  );
  await db.query(
    `INSERT INTO booking_events (booking_id, from_state, to_state, actor_id, actor_kind, command)
     SELECT $1, NULL, 'pending_traveller_acceptance', $2, 'user', 'create'
     WHERE NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = $1)`,
    [BOOKING_DEMO, USER.sender],
  );
  await db.query(`UPDATE trips SET capacity_kg_remaining = 8.5, status = 'partially_booked' WHERE id = $1`, [
    TRIP.imranDelhi,
  ]);
}

export async function seedDatabase(db: Db): Promise<void> {
  await insertCities(db);

  await insertUser(db, USER.sender, PHONE.sender, 'Aarti Verma', ['sender']);
  await insertUser(db, USER.travellerImran, PHONE.travellerImran, 'Imran Sheikh', ['sender', 'traveller']);
  await insertUser(db, USER.travellerNeha, PHONE.travellerNeha, 'Neha Chauhan', ['sender', 'traveller']);
  await insertUser(db, USER.admin, PHONE.admin, 'Ops Demo', [
    'admin_readonly',
    'support_agent',
    'verification_reviewer',
    'finance',
    'trust_safety',
  ]);

  await insertVerified(db, USER.travellerImran, 'driving_licence');
  await insertVerified(db, USER.travellerNeha, 'voter_id');

  await insertTrip(
    db,
    TRIP.imranDelhi,
    USER.travellerImran,
    CITY.bareilly,
    CITY.delhi,
    'car',
    atHourFromNow(1, 11),
    atHourFromNow(1, 17),
    12,
    8.5,
  );
  await insertTrip(
    db,
    TRIP.nehaLucknow,
    USER.travellerNeha,
    CITY.bareilly,
    CITY.lucknow,
    'car',
    atHourFromNow(2, 7),
    atHourFromNow(2, 13),
    8,
    8,
  );
  await insertTrip(
    db,
    TRIP.imranDelhiReturn,
    USER.travellerImran,
    CITY.delhi,
    CITY.bareilly,
    'car',
    atHourFromNow(3, 8),
    atHourFromNow(3, 14),
    10,
    10,
  );

  await seedDemoBooking(db);
}

async function main() {
  if (config.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data in production. Use the admin console for real records.');
    process.exit(1);
  }
  const db = await getDb();
  if (!(await schemaExists(db))) {
    await runMigrations(db);
    console.log('Schema was missing, so migrations were applied first.');
  }
  await seedDatabase(db);
  console.log('Demo data seeded.');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/seed.ts')) {
  main()
    .then(() => closeDb())
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await closeDb();
      process.exit(1);
    });
}
