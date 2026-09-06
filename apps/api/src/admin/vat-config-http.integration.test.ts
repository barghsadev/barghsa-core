import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>,
  headers: Record<string, string>,
  rateId: string,
  overrideId: string,
  productId: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('vat-editor','Slot editor','Test','["admin:finance:edit"]'); INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('vat-admin','vat-admin@example.test','test-only',true); INSERT INTO user_roles(user_id,role_id) VALUES ('vat-admin','vat-editor')`
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'vat-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    cookie: `barghsa_session=${session}`,
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  };
}, 30000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM product_vat_overrides; DELETE FROM vat_configurations; DELETE FROM audit_log WHERE event='change_recorded'"
  );
  productId = (
    await http.pool.query(
      "INSERT INTO products(system_key,title,price,status) VALUES ('vat_test','{\"en\":\"VAT product\"}',1000,'active') ON CONFLICT(system_key) DO UPDATE SET status='active' RETURNING id"
    )
  ).rows[0].id;
  rateId = (
    await http.pool.query(
      "INSERT INTO vat_configurations(category,rate,effective_from,created_by) VALUES ('electricity',900,'2026-01-01','vat-admin') RETURNING id"
    )
  ).rows[0].id;
  overrideId = (
    await http.pool.query(
      "INSERT INTO product_vat_overrides(product_id,vat_config_id,effective_from,created_by) VALUES ($1,$2,'2026-01-01','vat-admin') RETURNING id",
      [productId, rateId]
    )
  ).rows[0].id;
});
async function mutation(action: 'create' | 'end' | 'override' | 'endOverride') {
  const paths = {
    create: '',
    end: `/${rateId}/end`,
    override: '/overrides',
    endOverride: `/overrides/${overrideId}/end`,
  };
  if (action === 'override')
    productId = (
      await http.pool.query(
        "INSERT INTO products(system_key,title,price,status) VALUES ('vat_second','{}',1000,'active') ON CONFLICT(system_key) DO UPDATE SET status='active' RETURNING id"
      )
    ).rows[0].id;
  const bodies = {
    create: {
      category: 'electricity',
      rateBasisPoints: 1000,
      effectiveFrom: '2026-02-01T00:00:00Z',
    },
    end: { effectiveUntil: '2026-02-01T00:00:00Z' },
    override: { productId, vatConfigId: rateId, effectiveFrom: '2026-02-01T00:00:00Z' },
    endOverride: { effectiveUntil: '2026-02-01T00:00:00Z' },
  };
  return fetch(`${http.base}/api/admin/finance/vat${paths[action]}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodies[action]),
  });
}
async function unchanged() {
  expect(
    (await http.pool.query('SELECT id,rate,effective_until FROM vat_configurations')).rows
  ).toEqual([{ id: rateId, rate: 900, effective_until: null }]);
  expect((await http.pool.query('SELECT effective_until FROM product_vat_overrides')).rows).toEqual(
    [{ effective_until: null }]
  );
}
it.each(['create', 'end', 'override', 'endOverride'] as const)(
  'rolls back VAT %s on audit failure',
  async (action) => {
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_vat_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_vat_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event = 'change_recorded') EXECUTE FUNCTION reject_vat_audit()"
    );
    try {
      expect((await mutation(action)).status).toBe(500);
      await unchanged();
    } finally {
      await http.pool.query('DROP TRIGGER reject_vat_audit ON audit_log');
    }
  }
);
it.each(['create', 'end', 'override', 'endOverride'] as const)(
  'rechecks VAT %s authority',
  async (action) => {
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='vat-admin' FOR UPDATE");
      pending = mutation(action);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query("DELETE FROM user_roles WHERE user_id='vat-admin'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      await unchanged();
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('vat-admin','vat-editor') ON CONFLICT DO NOTHING"
      );
    }
  }
);

it('serializes repeated end-date requests without duplicate change audits', async () => {
  const responses = await Promise.all([mutation('end'), mutation('end')]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
  ).toHaveLength(1);
});
it('preserves the latest VAT state after waiting for another writer', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('barghsa:vat-configuration', 0))"
    );
    pending = mutation('end');
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%barghsa:vat-configuration%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query("UPDATE vat_configurations SET effective_until='2026-03-01' WHERE id=$1", [
      rateId,
    ]);
    await client.query('COMMIT');
    expect((await pending).status).toBe(200);
    expect(
      (
        await http.pool.query('SELECT effective_until FROM vat_configurations WHERE id=$1', [
          rateId,
        ])
      ).rows[0].effective_until.toISOString()
    ).toBe('2026-03-01T00:00:00.000Z');
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});

it.each([
  ['', { category: 'electricity', rateBasisPoints: 900, unexpected: true }],
  ['', { category: 'electricity', rateBasisPoints: 10001 }],
  ['', { category: 'electricity', rateBasisPoints: 900, effectiveFrom: '2027-01-01T00:00:00' }],
  ['/rate/end', { effectiveUntil: '2027-01-01T00:00:00' }],
  ['/rate/end', { unexpected: true }],
  ['/overrides', { productId: 'invalid', vatConfigId: 'invalid' }],
  ['/override/end', { unexpected: true }],
] as const)('rejects invalid VAT payload %s %j', async (path, body) => {
  const response = await fetch(
    `${http.base}/api/admin/finance/vat${path.replace('/rate', `/${rateId}`).replace('/override/', `/overrides/${overrideId}/`)}`,
    { method: 'POST', headers, body: JSON.stringify(body) }
  );
  expect(response.status).toBe(400);
  await unchanged();
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
  ).toHaveLength(0);
});
it('preserves the explicit effective-date offset', async () => {
  const response = await fetch(`${http.base}/api/admin/finance/vat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      category: 'electricity',
      rateBasisPoints: 1000,
      effectiveFrom: '2026-02-01T03:30:00+03:30',
    }),
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ effectiveFrom: '2026-02-01T00:00:00.000Z' });
});

it('exposes only product choices to the finance editor', async () => {
  const response = await fetch(`${http.base}/api/admin/finance/vat/products`, { headers });
  expect(response.status).toBe(200);
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  expect(rows.find((row) => row.id === productId)).toMatchObject({ title: { en: 'VAT product' } });
  for (const row of rows) expect(Object.keys(row).sort()).toEqual(['id', 'title', 'type']);
});
