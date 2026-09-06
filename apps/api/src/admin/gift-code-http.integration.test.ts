import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>,
  headers: Record<string, string>,
  giftId: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('gift-editor','Slot editor','Test','["admin:promotions:edit"]'); INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('gift-admin','gift-admin@example.test','test-only',true); INSERT INTO user_roles(user_id,role_id) VALUES ('gift-admin','gift-editor')`
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'gift-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
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
    "DELETE FROM gift_codes; DELETE FROM audit_log WHERE event='change_recorded'"
  );
  giftId = (
    await http.pool.query(
      "INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,created_by) VALUES ('ORIGINAL','fixed_irr',1000,'2026-01-01','gift-admin') RETURNING id"
    )
  ).rows[0].id;
});
function mutation(action: 'create' | 'update' | 'toggle') {
  return fetch(
    `${http.base}/api/admin/promotions/gift-codes${action === 'create' ? '' : `/${giftId}`}${action === 'toggle' ? '/toggle' : ''}`,
    {
      method: action === 'update' ? 'PATCH' : 'POST',
      headers,
      body: JSON.stringify(
        action === 'create'
          ? { code: 'SECOND', discountType: 'fixed_irr', discountValue: '1000' }
          : action === 'update'
            ? { code: 'CHANGED' }
            : { status: 'inactive' }
      ),
    }
  );
}
async function unchanged() {
  expect((await http.pool.query('SELECT id,code,status FROM gift_codes')).rows).toEqual([
    { id: giftId, code: 'ORIGINAL', status: 'active' },
  ]);
}
it.each(['create', 'update', 'toggle'] as const)(
  'rolls back gift code %s on audit failure',
  async (action) => {
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_gift_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_gift_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event = 'change_recorded') EXECUTE FUNCTION reject_gift_audit()"
    );
    try {
      expect((await mutation(action)).status).toBe(500);
      await unchanged();
    } finally {
      await http.pool.query('DROP TRIGGER reject_gift_audit ON audit_log');
    }
  }
);
it.each(['create', 'update', 'toggle'] as const)(
  'rechecks gift code %s authority',
  async (action) => {
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='gift-admin' FOR UPDATE");
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
      await client.query("DELETE FROM user_roles WHERE user_id='gift-admin'");
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
        "INSERT INTO user_roles(user_id,role_id) VALUES ('gift-admin','gift-editor') ON CONFLICT DO NOTHING"
      );
    }
  }
);

it('preserves a concurrent activation change when editing the code', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE gift_codes SET status='inactive' WHERE id=$1", [giftId]);
    pending = mutation('update');
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM gift_codes%FOR UPDATE%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await pending).status).toBe(200);
    expect(
      (await http.pool.query('SELECT code,status FROM gift_codes WHERE id=$1', [giftId])).rows
    ).toEqual([{ code: 'CHANGED', status: 'inactive' }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});
it('persists gift-code changes and suppresses repeated activation audits', async () => {
  expect((await mutation('create')).status).toBe(201);
  expect((await mutation('update')).status).toBe(200);
  expect((await mutation('toggle')).status).toBe(200);
  expect((await mutation('toggle')).status).toBe(200);
  expect((await http.pool.query('SELECT code,status FROM gift_codes ORDER BY code')).rows).toEqual([
    { code: 'CHANGED', status: 'inactive' },
    { code: 'SECOND', status: 'active' },
  ]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
  ).toHaveLength(3);
});
