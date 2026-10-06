import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createIsolatedTestDb, dropTestSchema } from './test/index.js';
import { createMigratedTestDb } from './test/migrated-db.js';

let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
let profileId: string;
let orderId: string;
let giftId: string;
let productId: string;
beforeAll(async () => {
  db = await createMigratedTestDb();
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('promo-guards','promo-guards@example.test','test-only')"
  );
  profileId = (
    await db.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('promo-guards','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  productId = (
    await db.pool.query(
      `INSERT INTO products(type,title,price) VALUES('hardware','{"en":"Guard fixture"}',9007199254740993) RETURNING id`
    )
  ).rows[0].id;
  orderId = (
    await db.pool.query(
      "INSERT INTO orders(user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES('promo-guards',$1,$2,'hardware','province','city','Street','1234567890') RETURNING id",
      [profileId, productId]
    )
  ).rows[0].id;
  giftId = (
    await db.pool.query(
      "INSERT INTO gift_codes(code,discount_type,discount_value,categories,created_by) VALUES('GUARDS','fixed_irr',9007199254740993,ARRAY['thermal_electricity'],'promo-guards') RETURNING id"
    )
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await db?.close();
});

it('persists UUIDv7, exact amounts, scopes and restoration defaults on the current migration head', async () => {
  expect(giftId[14]).toBe('7');
  expect(
    (
      await db.pool.query(
        'SELECT discount_value,categories,restore_on_cancel,restore_after_payment FROM gift_codes WHERE id=$1',
        [giftId]
      )
    ).rows
  ).toEqual([
    {
      discount_value: '9007199254740993',
      categories: ['thermal_electricity'],
      restore_on_cancel: true,
      restore_after_payment: false,
    },
  ]);
});
it.each([
  { type: 'percentage', value: '100', cap: null },
  { type: 'percentage', value: '10001', cap: '1' },
  { type: 'percentage', value: '100', cap: '0' },
  { type: 'fixed_irr', value: '1', cap: '1' },
  { type: 'fixed_irr', value: '-1', cap: null },
])('rejects invalid raw gift monetary terms $type/$value/$cap', async ({ type, value, cap }) => {
  await expect(
    db.pool.query(
      "INSERT INTO gift_codes(code,discount_type,discount_value,max_cap_irr,created_by) VALUES('INVALID',$1,$2,$3,'promo-guards')",
      [type, value, cap]
    )
  ).rejects.toMatchObject({ code: '23514' });
});
it('enforces normalized code uniqueness and unique valid profile scopes', async () => {
  await expect(
    db.pool.query(
      "INSERT INTO gift_codes(code,discount_type,discount_value,created_by) VALUES('guards','fixed_irr',1,'promo-guards')"
    )
  ).rejects.toMatchObject({ code: '23505' });
  await db.pool.query('INSERT INTO gift_code_profiles(gift_code_id,profile_id) VALUES($1,$2)', [
    giftId,
    profileId,
  ]);
  await expect(
    db.pool.query('INSERT INTO gift_code_profiles(gift_code_id,profile_id) VALUES($1,$2)', [
      giftId,
      profileId,
    ])
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    db.pool.query(
      "INSERT INTO gift_code_profiles(gift_code_id,profile_id) VALUES($1,'00000000-0000-7000-8000-000000000099')",
      [giftId]
    )
  ).rejects.toMatchObject({ code: '23503' });
});
it('retains exact redemption history with one slot per order and restricted parent deletion', async () => {
  const row = (
    await db.pool.query(
      'INSERT INTO gift_code_redemptions(gift_code_id,profile_id,order_id,discount_amount) VALUES($1,$2,$3,9007199254740993) RETURNING id,discount_amount,status,restored_at',
      [giftId, profileId, orderId]
    )
  ).rows[0];
  expect(row).toMatchObject({
    id: expect.any(String),
    discount_amount: '9007199254740993',
    status: 'consumed',
    restored_at: null,
  });
  expect(row.id[14]).toBe('7');
  await expect(
    db.pool.query(
      'INSERT INTO gift_code_redemptions(gift_code_id,profile_id,order_id,discount_amount) VALUES($1,$2,$3,1)',
      [giftId, profileId, orderId]
    )
  ).rejects.toMatchObject({ code: '23505' });
  for (const [table, id] of [
    ['orders', orderId],
    ['gift_codes', giftId],
    ['profiles', profileId],
  ])
    await expect(db.pool.query(`DELETE FROM ${table} WHERE id=$1`, [id])).rejects.toMatchObject({
      code: '23503',
    });
});
it('enforces VAT ranges, non-overlapping half-open windows and override foreign keys', async () => {
  await expect(
    db.pool.query(
      "INSERT INTO vat_configurations(category,rate,effective_from,created_by) VALUES('hardware',10001,'2026-01-01','promo-guards')"
    )
  ).rejects.toMatchObject({ code: '23514' });
  const rateId = (
    await db.pool.query(
      "INSERT INTO vat_configurations(category,rate,effective_from,effective_until,created_by) VALUES('hardware',900,'2026-01-01','2026-02-01','promo-guards') RETURNING id"
    )
  ).rows[0].id;
  await expect(
    db.pool.query(
      "INSERT INTO vat_configurations(category,rate,effective_from,created_by) VALUES('hardware',500,'2026-01-31','promo-guards')"
    )
  ).rejects.toMatchObject({ code: '23P01' });
  await db.pool.query(
    "INSERT INTO vat_configurations(category,rate,effective_from,created_by) VALUES('hardware',500,'2026-02-01','promo-guards')"
  );
  await expect(
    db.pool.query(
      "INSERT INTO product_vat_overrides(product_id,vat_config_id,effective_from,created_by) VALUES($1,'00000000-0000-7000-8000-000000000099','2026-01-01','promo-guards')",
      [productId]
    )
  ).rejects.toMatchObject({ code: '23503' });
  await db.pool.query(
    "INSERT INTO product_vat_overrides(product_id,vat_config_id,effective_from,created_by) VALUES($1,$2,'2026-01-01','promo-guards')",
    [productId, rateId]
  );
  await expect(
    db.pool.query('DELETE FROM vat_configurations WHERE id=$1', [rateId])
  ).rejects.toMatchObject({ code: '23503' });
});

it('rolls back an ambiguous legacy upgrade, preserves identities and retries after explicit reconciliation', async () => {
  const legacy = await createIsolatedTestDb('test_gift_normalization_');
  try {
    await legacy.pool.query(
      'CREATE TABLE gift_codes(id uuid PRIMARY KEY,code text UNIQUE NOT NULL); CREATE TABLE gift_code_profiles(id uuid PRIMARY KEY,gift_code_id uuid NOT NULL,profile_id uuid NOT NULL)'
    );
    const first = randomUUID(),
      second = randomUUID();
    await legacy.pool.query("INSERT INTO gift_codes(id,code) VALUES($1,' SAME '),($2,'same')", [
      first,
      second,
    ]);
    const before = (await legacy.pool.query('SELECT * FROM gift_codes ORDER BY id')).rows;
    const migration = readFileSync(
      resolve(__dirname, '../drizzle/production/0247_gift_code_integrity.sql'),
      'utf8'
    );
    await expect(legacy.pool.query(migration)).rejects.toMatchObject({ code: '23514' });
    expect((await legacy.pool.query('SELECT * FROM gift_codes ORDER BY id')).rows).toEqual(before);
    expect(
      (
        await legacy.pool.query(
          "SELECT tgname FROM pg_trigger WHERE tgrelid='gift_codes'::regclass AND tgname='gift_code_normalized_identity'"
        )
      ).rows
    ).toHaveLength(0);
    // Simulate an explicit decision to assign the second identity a distinct code; retain both IDs.
    await legacy.pool.query("UPDATE gift_codes SET code=' distinct ' WHERE id=$1", [second]);
    const profile = randomUUID(),
      firstScope = randomUUID(),
      duplicateScope = randomUUID();
    await legacy.pool.query(
      'INSERT INTO gift_code_profiles(id,gift_code_id,profile_id) VALUES($1,$2,$3),($4,$2,$3)',
      [firstScope, first, profile, duplicateScope]
    );
    const scopesBefore = (await legacy.pool.query('SELECT * FROM gift_code_profiles ORDER BY id'))
      .rows;
    await expect(legacy.pool.query(migration)).rejects.toMatchObject({ code: '23514' });
    expect((await legacy.pool.query('SELECT * FROM gift_code_profiles ORDER BY id')).rows).toEqual(
      scopesBefore
    );
    expect(
      (await legacy.pool.query('SELECT code FROM gift_codes WHERE id=$1', [second])).rows
    ).toEqual([{ code: ' distinct ' }]);
    await legacy.pool.query('DELETE FROM gift_code_profiles WHERE id=$1', [duplicateScope]);
    await legacy.pool.query(migration);
    expect((await legacy.pool.query('SELECT id FROM gift_code_profiles')).rows).toEqual([
      { id: firstScope },
    ]);
    expect((await legacy.pool.query('SELECT * FROM gift_codes ORDER BY code')).rows).toEqual([
      { id: second, code: 'DISTINCT' },
      { id: first, code: 'SAME' },
    ]);
    await expect(
      legacy.pool.query("INSERT INTO gift_codes(id,code) VALUES($1,' sAmE ')", [randomUUID()])
    ).rejects.toMatchObject({ code: '23505' });
    await legacy.pool.query("UPDATE gift_codes SET code=' changed ' WHERE id=$1", [second]);
    expect(
      (await legacy.pool.query('SELECT code FROM gift_codes WHERE id=$1', [second])).rows
    ).toEqual([{ code: 'CHANGED' }]);
  } finally {
    await legacy.pool.end();
    await dropTestSchema(legacy.schemaName);
  }
});
