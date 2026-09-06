import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-catalogue','Jobs','Test role','["admin:catalogue:edit","admin:catalogue:edit"]'),('test-catalogue-view','View jobs','Test role','["admin:catalogue:edit"]')`
  );
  for (const [user, role] of [
    ['operator', 'test-catalogue'],
    ['viewer', 'test-catalogue-view'],
    ['other', null],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
      [user, `${user}@example.test`]
    );
    if (role)
      await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [user, role]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
const basePath = '/api/admin/catalogue/products';
const createBody = {
  type: 'hardware',
  title: { en: 'Local product', fa: 'Test product' },
  price: '9007199254740993',
  status: 'active',
};
beforeEach(async () => {
  await http.pool.query("DELETE FROM audit_log WHERE event LIKE 'catalogue_product_%'");
});
async function seed() {
  return (
    await http.pool.query(
      'INSERT INTO products(type,title,price,status) VALUES (\'hardware\',\'{"en":"Original","fa":"Test"}\',1000,\'active\') RETURNING id'
    )
  ).rows[0].id as string;
}
function request(path = '', method = 'GET', body?: unknown, user = 'operator') {
  return fetch(`${http.base}${basePath}${path}`, {
    method,
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
it.each(['create', 'update', 'archive', 'price'])(
  'rejects revoked catalogue authority during %s',
  async (action) => {
    const id = await seed();
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='operator' FOR UPDATE");
      pending =
        action === 'create'
          ? request('', 'POST', createBody)
          : action === 'update'
            ? request(`/${id}`, 'PUT', { status: 'inactive' })
            : action === 'archive'
              ? request(`/${id}`, 'DELETE')
              : request(`/${id}/prices`, 'POST', { price: '2000' });
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%' "
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query("DELETE FROM user_roles WHERE user_id='operator'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(
        (await http.pool.query('SELECT status,price FROM products WHERE id=$1', [id])).rows[0]
      ).toEqual({ status: 'active', price: '1000' });
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'catalogue_product_%'"))
          .rows
      ).toHaveLength(0);
      expect(
        (
          await http.pool.query(
            "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"
          )
        ).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-catalogue') ON CONFLICT DO NOTHING"
      );
    }
  }
);
it('creates exact large prices, adds price history and archives without deleting the product', async () => {
  const created = await request('', 'POST', createBody);
  expect(created.status).toBe(201);
  const product = (await created.json()) as { id: string; price: string };
  expect(product.price).toBe('9007199254740993');
  expect(
    (await request(`/${product.id}/prices`, 'POST', { price: '9007199254740995' })).status
  ).toBe(200);
  expect(
    (await http.pool.query('SELECT price FROM products WHERE id=$1', [product.id])).rows[0].price
  ).toBe('9007199254740995');
  expect(
    (
      await http.pool.query('SELECT id FROM product_price_versions WHERE product_id=$1', [
        product.id,
      ])
    ).rows
  ).toHaveLength(2);
  expect((await request(`/${product.id}`, 'DELETE')).status).toBe(204);
  expect(
    (await http.pool.query('SELECT status FROM products WHERE id=$1', [product.id])).rows[0].status
  ).toBe('archived');
});
it('rolls product and price history back if the audit cannot be recorded', async () => {
  const id = await seed();
  await http.pool.query(
    "CREATE FUNCTION reject_catalogue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test catalogue audit failure'; END $$; CREATE TRIGGER reject_catalogue_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='catalogue_product_price_changed') EXECUTE FUNCTION reject_catalogue_audit()"
  );
  try {
    expect((await request(`/${id}/prices`, 'POST', { price: '2000' })).status).toBe(500);
    expect(
      (await http.pool.query('SELECT price FROM products WHERE id=$1', [id])).rows[0].price
    ).toBe('1000');
    expect(
      (await http.pool.query('SELECT id FROM product_price_versions WHERE product_id=$1', [id]))
        .rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query('DROP TRIGGER reject_catalogue_audit ON audit_log');
  }
});

it('serializes two staff edits so the second identical edit is a no-op', async () => {
  const id = await seed();
  const responses = await Promise.all([
    request(`/${id}`, 'PUT', { status: 'inactive' }),
    request(`/${id}`, 'PUT', { status: 'inactive' }, 'viewer'),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='catalogue_product_updated'")).rows
  ).toHaveLength(1);
});
