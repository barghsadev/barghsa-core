import { beforeAll, afterAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
let id: string;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('price-author','price@example.test','test-only')"
  );
  id = (
    await fixture.pool.query(
      "INSERT INTO products(type,title,price,status) VALUES ('hardware','{\"en\":\"Price test\"}',1000,'active') RETURNING id"
    )
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await fixture?.close();
}, 15000);
async function price(at: string) {
  return (await fixture.pool.query('SELECT effective_product_price($1,$2) AS price', [id, at]))
    .rows[0].price;
}
it('keeps the legacy price before the first schedule, applies exact boundaries and refuses history gaps', async () => {
  expect(await price('2026-09-01T00:00:00Z')).toBe('1000');
  await fixture.pool.query(
    "INSERT INTO product_price_versions(product_id,price,effective_from,effective_until,created_by) VALUES ($1,9007199254740993,'2026-09-02T00:00:00Z','2026-09-03T00:00:00Z','price-author'),($1,9007199254740995,'2026-09-03T00:00:00Z','2026-09-04T00:00:00Z','price-author')",
    [id]
  );
  expect(await price('2026-09-01T23:59:59.999999Z')).toBe('1000');
  expect(await price('2026-09-02T00:00:00Z')).toBe('9007199254740993');
  expect(await price('2026-09-03T00:00:00Z')).toBe('9007199254740995');
  expect(await price('2026-09-04T00:00:00Z')).toBeNull();
  expect(
    (await fixture.pool.query('SELECT price FROM products WHERE id=$1', [id])).rows[0].price
  ).toBe('1000');
});
