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
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM users u JOIN sessions s%FOR UPDATE OF u%' "
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

it('resolves effective scheduled prices in public and staff reads without rewriting the legacy price', async () => {
  const id = await seed();
  const version = (
    await http.pool.query(
      "INSERT INTO product_price_versions(product_id,price,effective_from,created_by) VALUES ($1,9007199254740993,NOW()+INTERVAL '1 day','operator') RETURNING id",
      [id]
    )
  ).rows[0].id;
  expect(await (await request(`/${id}`)).json()).toMatchObject({ price: '1000' });
  await http.pool.query(
    "UPDATE product_price_versions SET effective_from=NOW()-INTERVAL '1 day' WHERE id=$1",
    [version]
  );
  expect(await (await request(`/${id}`)).json()).toMatchObject({ price: '9007199254740993' });
  const listed = await (await request()).json();
  expect(listed).toEqual(
    expect.arrayContaining([expect.objectContaining({ id, price: '9007199254740993' })])
  );
  const publicRows = await (await fetch(`${http.base}/api/products`)).json();
  expect(publicRows).toEqual(
    expect.arrayContaining([expect.objectContaining({ id, price: '9007199254740993' })])
  );
  expect(
    (await http.pool.query('SELECT price FROM products WHERE id=$1', [id])).rows[0].price
  ).toBe('1000');
});

it('validates category types on edit and treats repeated categories as a set', async () => {
  const category = 'electricity_generation_station_consultation';
  const response = await request('', 'POST', {
    ...createBody,
    type: 'consultation',
    categories: [category, category],
  });
  expect(response.status).toBe(201);
  const product = (await response.json()) as { id: string; categories: string[] };
  expect(product.categories).toEqual([category]);
  expect(
    (await request(`/${product.id}`, 'PUT', { categories: [category, category] })).status
  ).toBe(200);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='catalogue_product_updated'")).rows
  ).toHaveLength(0);
  for (const id of [product.id, await seed()]) {
    expect((await request(`/${id}`, 'PUT', { categories: ['green_electricity'] })).status).toBe(
      400
    );
  }
  expect(await (await request(`/${product.id}`)).json()).toMatchObject({ categories: [category] });
  const changed = 'electricity_saving_certificate_consultation';
  expect((await request(`/${product.id}`, 'PUT', { categories: [changed, changed] })).status).toBe(
    200
  );
  expect(await (await request(`/${product.id}`)).json()).toMatchObject({ categories: [changed] });
  expect(
    (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='catalogue_product_updated'"
      )
    ).rows
  ).toEqual([
    {
      metadata: {
        productId: product.id,
        categories: [changed],
        stepUpVerified: true,
        stepUpVerifiedAt: expect.any(String),
      },
    },
  ]);
});

it('rejects unknown fields, blank localized titles and ambiguous price dates without mutations', async () => {
  const id = await seed();
  for (const body of [
    { ...createBody, ignored: true },
    { ...createBody, title: { fa: ' ', en: 'Valid' } },
    { ...createBody, title: { fa: 'Valid', en: ' ' } },
    { ...createBody, title: { ...createBody.title, ignored: true } },
    { ...createBody, description: { fa: '', en: '', ignored: true } },
  ])
    expect((await request('', 'POST', body)).status).toBe(400);
  for (const body of [
    { status: 'inactive', ignored: true },
    { title: { fa: ' ', en: 'Valid' } },
    { description: { fa: '', en: '', ignored: true } },
  ])
    expect((await request(`/${id}`, 'PUT', body)).status).toBe(400);
  for (const body of [
    { price: '2000', ignored: true },
    { price: '2000', effectiveFrom: '2035-01-02T12:00:00' },
  ])
    expect((await request(`/${id}/prices`, 'POST', body)).status).toBe(400);
  expect(
    (await http.pool.query('SELECT status,price FROM products WHERE id=$1', [id])).rows[0]
  ).toEqual({ status: 'active', price: '1000' });
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'catalogue_product_%'")).rows
  ).toHaveLength(0);
  expect(
    (
      await request(`/${id}/prices`, 'POST', {
        price: '2000',
        effectiveFrom: '2035-01-02T12:00:00+03:30',
      })
    ).status
  ).toBe(200);
  expect(await (await request(`/${id}`)).json()).toMatchObject({
    price: '1000',
    priceHistory: [{ price: '2000', effectiveFrom: '2035-01-02T08:30:00.000Z' }],
  });
});

it('reports enabled green rules and intersecting current or scheduled VAT references', async () => {
  await http.pool.query(
    "INSERT INTO products(system_key,title,price,status) VALUES ('green_electricity','{\"en\":\"Green test\"}',1000,'active') ON CONFLICT(system_key) DO NOTHING"
  );
  const green = (
    await http.pool.query("SELECT id FROM products WHERE system_key='green_electricity'")
  ).rows[0].id as string;
  expect(await (await request(`/${green}/rule-references`)).json()).toEqual({
    greenModes: ['simpleOrder'],
    vatOverride: false,
  });
  const id = await seed();
  expect(await (await request(`/${id}/rule-references`)).json()).toEqual({
    greenModes: [],
    vatOverride: false,
  });
  const rate = (
    await http.pool.query(
      "INSERT INTO vat_configurations(category,rate,effective_from,created_by) VALUES ('product_override',900,NOW()+INTERVAL '2 days','operator') RETURNING id"
    )
  ).rows[0].id;
  const override = (
    await http.pool.query(
      "INSERT INTO product_vat_overrides(product_id,vat_config_id,effective_from,created_by) VALUES ($1,$2,NOW()+INTERVAL '1 day','operator') RETURNING id",
      [id, rate]
    )
  ).rows[0].id;
  expect(await (await request(`/${id}/rule-references`)).json()).toEqual({
    greenModes: [],
    vatOverride: true,
  });
  await http.pool.query(
    "UPDATE product_vat_overrides SET effective_until=NOW()+INTERVAL '36 hours' WHERE id=$1",
    [override]
  );
  expect(await (await request(`/${id}/rule-references`)).json()).toEqual({
    greenModes: [],
    vatOverride: false,
  });
  expect((await request(`/${id}/rule-references`, 'GET', undefined, 'other')).status).toBe(403);
  expect((await request('/invalid/rule-references')).status).toBe(400);
  expect((await request(`/${randomUUID()}/rule-references`)).status).toBe(404);
  try {
    await http.pool.query(
      "INSERT INTO app_config(key,value) VALUES ('electricity.green_mandatory_rules','{}') ON CONFLICT(key) DO UPDATE SET value='{}'"
    );
    expect((await request(`/${green}/rule-references`)).status).toBe(503);
    expect((await request(`/${id}/rule-references`)).status).toBe(200);
  } finally {
    await http.pool.query("DELETE FROM app_config WHERE key='electricity.green_mandatory_rules'");
  }
});

async function expireAtAudit(run: () => Promise<void>) {
  await http.pool
    .query(`CREATE OR REPLACE FUNCTION expire_price_session() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN UPDATE sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE user_id='operator'; RETURN NEW; END $$;
 CREATE TRIGGER expire_price_session BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'catalogue_product_%') EXECUTE FUNCTION expire_price_session()`);
  try {
    await run();
  } finally {
    await http.pool.query('DROP TRIGGER expire_price_session ON audit_log');
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day' WHERE user_id='operator'"
    );
  }
}

it.each(['create', 'update', 'archive', 'price'] as const)(
  'rolls back %s when session expires before commit',
  async (action) => {
    const id = await seed();
    const before = (await http.pool.query('SELECT count(*)::int AS count FROM products')).rows[0]
      .count;
    await expireAtAudit(async () => {
      const response =
        action === 'create'
          ? await request('', 'POST', createBody)
          : action === 'update'
            ? await request(`/${id}`, 'PUT', { status: 'inactive' })
            : action === 'archive'
              ? await request(`/${id}`, 'DELETE')
              : await request(`/${id}/prices`, 'POST', { price: '2000' });
      expect(response.status).toBe(401);
      expect(
        (await http.pool.query('SELECT count(*)::int AS count FROM products')).rows[0].count
      ).toBe(before);
      expect(
        (await http.pool.query('SELECT status,price FROM products WHERE id=$1', [id])).rows
      ).toEqual([{ status: 'active', price: '1000' }]);
      expect(
        (await http.pool.query('SELECT id FROM product_price_versions WHERE product_id=$1', [id]))
          .rows
      ).toHaveLength(0);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'catalogue_product_%'"))
          .rows
      ).toHaveLength(0);
    });
  }
);

it('records verified step-up time in the price configuration audit', async () => {
  const verifiedAt = new Date(Date.now() - 60_000);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=$1 WHERE user_id='operator'", [
    verifiedAt,
  ]);
  expect((await request('', 'POST', createBody)).ok).toBe(true);
  const rows = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event LIKE 'catalogue_product_%'"
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].metadata).toMatchObject({
    stepUpVerified: true,
    stepUpVerifiedAt: verifiedAt.toISOString(),
  });
});
