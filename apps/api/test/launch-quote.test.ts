/**
 * The launch pricing policy as stored, loaded, and written into a quote row.
 *
 * This covers the seam the domain tests cannot: the active database policy, validation on read, and
 * the legacy `total = subtotal + platform_fee + tax` constraint that the launch formula must fit.
 *
 * Run with: npm run test:api
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';

process.env.PGLITE_PATH = './data/pgdata.launchquote';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';

// The second test activates its own policy and retires the seeded one; a rerun against the same
// directory would then have two historical actives to reason about. Start from an empty database.
rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { loadActivePolicy, parsePolicy, legacyQuoteColumns } = await import('../src/lib/pricing-policy.ts');
const { quoteLaunchPrice, DEFAULT_LAUNCH_POLICY, LAUNCH_FORMULA_VERSION } = await import('@py/domain');

test('the seeded active policy is loaded, validated, and matches the compiled default', async () => {
  const db = await getDb();
  await runMigrations(db);

  const policy = await loadActivePolicy(db);
  assert.equal(policy.version, DEFAULT_LAUNCH_POLICY.version);
  assert.equal(policy.commissionRate, DEFAULT_LAUNCH_POLICY.commissionRate);
  assert.equal(policy.volumetricDivisor, 5000);

  await closeDb();
});

test('activating a new policy changes the next quote, and a malformed policy refuses it', async () => {
  const db = await getDb();
  await runMigrations(db);

  await db.query(`UPDATE pricing_policies SET status = 'retired' WHERE status = 'active'`);
  await db.query(
    `INSERT INTO pricing_policies (version, name, params, status, activated_at)
     VALUES ('test-higher-commission', 'Test policy',
       '{"commissionRate": 0.08, "baseFarePaise": 1500}'::jsonb, 'active', now())`,
  );

  const loaded = await loadActivePolicy(db);
  assert.equal(loaded.version, 'test-higher-commission');
  assert.equal(loaded.commissionRate, 0.08, 'the database value wins');
  assert.equal(loaded.baseFarePaise, 1500);
  assert.equal(loaded.taxRate, DEFAULT_LAUNCH_POLICY.taxRate, 'omitted keys fall back to the compiled default');

  // The partial unique index is the guard against two live policies.
  await assert.rejects(
    db.query(
      `INSERT INTO pricing_policies (version, name, params, status) VALUES ('second-active', 'x', '{}'::jsonb, 'active')`,
    ),
    /pricing_policies_one_active/,
  );

  await db.query(
    `UPDATE pricing_policies SET params = '{"taxRate": 1.4}'::jsonb WHERE version = 'test-higher-commission'`,
  );
  await assert.rejects(loadActivePolicy(db), /taxRate/, 'an invalid active policy stops pricing');

  assert.throws(() => parsePolicy('bad', { volumetricDivisor: 0 }), /volumetricDivisor/);
  assert.throws(() => parsePolicy('bad', { maxTotalPaise: 100, minTotalPaise: 200 }), /maxTotalPaise/);

  await db.query(`UPDATE pricing_policies SET status = 'retired' WHERE version = 'test-higher-commission'`);
  await db.query(`UPDATE pricing_policies SET status = 'active' WHERE version = $1`, [DEFAULT_LAUNCH_POLICY.version]);

  await closeDb();
});

test('a v2 quote is stored in the legacy columns without breaking the total constraint', async () => {
  const db = await getDb();
  await runMigrations(db);

  const sender = await db.query<{ id: string }>(
    `INSERT INTO users (phone_hash, phone_last4, name) VALUES ($1, '0042', 'Quote Test')
     RETURNING id`,
    [`launchquote:${crypto.randomUUID()}`],
  );
  const senderId = sender.rows[0]!.id;

  const city = await db.query<{ id: string }>(
    `SELECT id FROM cities WHERE name = 'Baheri'`, 
  );
  const dest = await db.query<{ id: string }>(`SELECT id FROM cities WHERE name = 'Bareilly'`);
  const parcel = await db.query<{ id: string }>(
    `INSERT INTO parcels
       (sender_id, origin_city_id, dest_city_id, origin_area, dest_area, category, description,
        weight_kg, dims_cm, declared_value_paise, window_start, window_end,
        receiver_name, receiver_phone_hash, receiver_phone_last4, status)
     VALUES ($1,$2,$3,'Main market','Civil Lines','documents','A signed document',1.5,'{40,40,30}',250000,
       now() + interval '1 hour', now() + interval '8 hours', 'R. Test', 'hash', '0101', 'posted')
     RETURNING id`,
    [senderId, city.rows[0]!.id, dest.rows[0]!.id],
  );
  const parcelId = parcel.rows[0]!.id;

  const policy = await loadActivePolicy(db);
  const priced = quoteLaunchPrice({
    roadDistanceKm: 58.4,
    distanceSource: 'routed',
    actualWeightKg: 1.5,
    dimsCm: [40, 40, 30],
    category: 'documents',
    policy,
  });
  const legacy = legacyQuoteColumns(priced);

  assert.equal(priced.formula_version, LAUNCH_FORMULA_VERSION);
  assert.equal(priced.volumetric_weight_kg, 9.6);
  assert.equal(priced.billable_weight_kg, 9.6, 'volumetric weight bills above the actual weight');
  assert.equal(priced.warnings.includes('DISTANCE_ESTIMATED'), false);
  assert.ok(priced.total_paise > 0);

  const inserted = await db.query<{
    subtotal_paise: number;
    platform_fee_paise: number;
    tax_paise: number;
    total_paise: number;
    traveller_paise: number;
  }>(
    `INSERT INTO quotes
       (parcel_id, formula_version, inputs, subtotal_paise, platform_fee_paise, tax_paise,
        total_paise, traveller_paise, breakdown, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + interval '15 minutes')
     RETURNING subtotal_paise, platform_fee_paise, tax_paise, total_paise, traveller_paise`,
    [
      parcelId,
      priced.formula_version,
      JSON.stringify({ distance_source: priced.distance_source, policy_version: priced.policy_version }),
      legacy.subtotal_paise,
      legacy.platform_fee_paise,
      priced.tax_paise,
      priced.total_paise,
      priced.traveller_paise,
      JSON.stringify(priced.breakdown),
    ],
  );

  const row = inserted.rows[0]!;
  assert.equal(row.total_paise, priced.total_paise);
  assert.equal(row.total_paise, row.subtotal_paise + row.platform_fee_paise + row.tax_paise);
  assert.equal(row.traveller_paise, priced.traveller_paise);
  // The sender's total is the sum the traveller, platform, tax, and discount reconcile to.
  assert.equal(
    priced.total_paise,
    priced.traveller_paise + priced.commission_paise - priced.traveller_subsidy_paise + priced.tax_paise - priced.discount_paise,
  );

  await db.query(`DELETE FROM quotes WHERE parcel_id = $1`, [parcelId]);
  await db.query(`DELETE FROM parcels WHERE id = $1`, [parcelId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [senderId]);
  await closeDb();
});
