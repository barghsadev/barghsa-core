import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createIsolatedTestDb, dropTestSchema } from './test/testDb.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedTestDb } from './test/migrated-db.js';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
let hardware: string, plan: string, consultation: string, electricity: string;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('catalogue-fixture','catalogue-fixture@example.test','test-only')"
  );
  const rows = (
    await fixture.pool.query(
      "INSERT INTO products(type,system_key,title,price,status) VALUES ('hardware',NULL,'{\"en\":\"Device\",\"fa\":\"تجهیز\"}',9007199254740993,'inactive'),('saving_plan',NULL,'{\"en\":\"Plan\"}',1000,'inactive'),('consultation',NULL,'{\"en\":\"Advice\"}',NULL,'active'),('electricity','thermal','{\"en\":\"Thermal\"}',NULL,'inactive') RETURNING id,type"
    )
  ).rows;
  hardware = rows.find((r) => r.type === 'hardware').id;
  plan = rows.find((r) => r.type === 'saving_plan').id;
  consultation = rows.find((r) => r.type === 'consultation').id;
  electricity = rows.find((r) => r.type === 'electricity').id;
}, 40000);
afterAll(async () => {
  await fixture?.close();
}, 15000);
it('preserves exact catalogue money and generated UUIDv7 identities and rejects negative prices', async () => {
  expect(hardware).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(
    (await fixture.pool.query('SELECT price::text FROM products WHERE id=$1', [hardware])).rows
  ).toEqual([{ price: '9007199254740993' }]);
  await expect(
    fixture.pool.query('UPDATE products SET price=-1 WHERE id=$1', [hardware])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM products WHERE id=$1', [electricity])
  ).rejects.toMatchObject({ code: 'P0001' });
});
it('requires a real VAT configuration for a price-version override and restricts its deletion', async () => {
  await expect(
    fixture.pool.query(
      "INSERT INTO product_price_versions(product_id,price,effective_from,created_by,vat_category_override) VALUES($1,1000,now(),'catalogue-fixture',$2)",
      [hardware, randomUUID()]
    )
  ).rejects.toMatchObject({ code: '23503' });
  const vat = (
    await fixture.pool.query(
      "INSERT INTO vat_configurations(category,rate,effective_from,created_by) VALUES('product_override',900,now(),'catalogue-fixture') RETURNING id"
    )
  ).rows[0].id;
  await fixture.pool.query(
    "INSERT INTO product_price_versions(product_id,price,effective_from,created_by,vat_category_override) VALUES($1,9007199254740993,now(),'catalogue-fixture',$2)",
    [hardware, vat]
  );
  await expect(
    fixture.pool.query('DELETE FROM vat_configurations WHERE id=$1', [vat])
  ).rejects.toMatchObject({ code: '23503' });
});
it('rejects misclassified category and limit relationships, including parent retyping', async () => {
  await expect(
    fixture.pool.query(
      "INSERT INTO product_categories(product_id,category) VALUES($1,'thermal_electricity')",
      [hardware]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query(
      "INSERT INTO product_categories(product_id,category) VALUES($1,'thermal_electricity')",
      [consultation]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query(
      'INSERT INTO electricity_product_limits(product_id,min_kwh,max_kwh) VALUES($1,0,0)',
      [hardware]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await fixture.pool.query(
    "INSERT INTO product_categories(product_id,category) VALUES($1,'electricity_generation_station_consultation')",
    [consultation]
  );
  await expect(
    fixture.pool.query("UPDATE products SET type='hardware' WHERE id=$1", [consultation])
  ).rejects.toMatchObject({ code: '23514' });
  await fixture.pool.query(
    'INSERT INTO electricity_product_limits(product_id,min_kwh,max_kwh) VALUES($1,0,0)',
    [electricity]
  );
});
it('enforces compatible unique hardware and one immutable active agreement per plan', async () => {
  await fixture.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
    plan,
    hardware,
  ]);
  await expect(
    fixture.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
      plan,
      hardware,
    ])
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    fixture.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
      hardware,
      plan,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  const active = (
    await fixture.pool.query(
      "INSERT INTO saving_plan_agreement_versions(plan_id,title,body,status,effective_from,created_by) VALUES($1,'Accepted title','Verbatim terms','draft',NULL,'catalogue-fixture') RETURNING id",
      [plan]
    )
  ).rows[0].id;
  await fixture.pool.query(
    "UPDATE saving_plan_agreement_versions SET status='active',effective_from=now() WHERE id=$1",
    [active]
  );
  const second = (
    await fixture.pool.query(
      "INSERT INTO saving_plan_agreement_versions(plan_id,title,body,status,created_by) VALUES($1,'Another title','Other terms','draft','catalogue-fixture') RETURNING id",
      [plan]
    )
  ).rows[0].id;
  await expect(
    fixture.pool.query(
      "UPDATE saving_plan_agreement_versions SET status='active',effective_from=now() WHERE id=$1",
      [second]
    )
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    fixture.pool.query("UPDATE saving_plan_agreement_versions SET body='Rewrite' WHERE id=$1", [
      active,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM products WHERE id=$1', [hardware])
  ).rejects.toMatchObject({ code: '23503' });
});

it('preserves invalid legacy relationships on a failed upgrade and retries after explicit reconciliation', async () => {
  const db = await createIsolatedTestDb('test_catalogue_upgrade_');
  try {
    await db.pool.query(`CREATE TABLE products(id uuid PRIMARY KEY,type text NOT NULL,price bigint);
      CREATE TABLE vat_configurations(id uuid PRIMARY KEY);
      CREATE TABLE product_price_versions(id uuid PRIMARY KEY,vat_category_override uuid);
      CREATE TABLE product_categories(id uuid PRIMARY KEY,product_id uuid NOT NULL,category text NOT NULL);
      CREATE TABLE electricity_product_limits(id uuid PRIMARY KEY,product_id uuid NOT NULL);`);
    const id = randomUUID(),
      category = randomUUID();
    await db.pool.query("INSERT INTO products(id,type,price) VALUES($1,'hardware',1000)", [id]);
    await db.pool.query(
      "INSERT INTO product_categories(id,product_id,category) VALUES($1,$2,'thermal_electricity')",
      [category, id]
    );
    const migration = readFileSync(
      resolve(__dirname, '../drizzle/production/0246_catalogue_foundation_guards.sql'),
      'utf8'
    ).replaceAll('"public".', `"${db.schemaName}".`);
    const before = (await db.pool.query('SELECT * FROM products')).rows;
    await expect(db.pool.query(migration)).rejects.toMatchObject({ code: '23514' });
    expect((await db.pool.query('SELECT * FROM products')).rows).toEqual(before);
    expect((await db.pool.query('SELECT category FROM product_categories')).rows).toEqual([
      { category: 'thermal_electricity' },
    ]);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname IN ('products_price_nonnegative','product_price_versions_vat_category_override_vat_configurations_id_fk')",
          [db.schemaName]
        )
      ).rows[0].n
    ).toBe(0);
    await db.pool.query("UPDATE products SET type='electricity' WHERE id=$1", [id]);
    await db.pool.query(migration);
    await expect(
      db.pool.query('UPDATE products SET price=-1 WHERE id=$1', [id])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.pool.query("UPDATE products SET type='hardware' WHERE id=$1", [id])
    ).rejects.toMatchObject({ code: '23514' });
    expect((await db.pool.query('SELECT category FROM product_categories')).rows).toEqual([
      { category: 'thermal_electricity' },
    ]);
  } finally {
    await db.pool.end();
    await dropTestSchema(db.schemaName);
  }
});
