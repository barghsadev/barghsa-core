import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-reminder','Jobs','Test role','["admin:finance:invoices:reminder-offsets","admin:finance:invoices:reminder-offsets"]'),('test-reminder-view','View jobs','Test role','["admin:finance:invoices:reminder-offsets"]')`
  );
  for (const [user, role] of [
    ['operator', 'test-reminder'],
    ['viewer', 'test-reminder-view'],
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
const basePath = '/api/admin/config/invoice-reminder-offsets';
const body = { serviceType: 'electricity', offset: -7, enabled: false };
function request(method = 'GET', user = 'operator') {
  return fetch(`${http.base}${basePath}`, {
    method,
    headers: headers[user]!,
    ...(method === 'PUT' ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(async () => {
  await http.pool.query('DELETE FROM invoice_reminder_offset_toggles');
  await http.pool.query('DELETE FROM audit_log');
});
it('rejects reminder writes after a grant is revoked while waiting on the actor', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='operator' FOR UPDATE");
    pending = request('PUT');
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
      (await http.pool.query('SELECT * FROM invoice_reminder_offset_toggles')).rows
    ).toHaveLength(0);
    expect((await http.pool.query('SELECT * FROM audit_log')).rows).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-reminder') ON CONFLICT DO NOTHING"
    );
  }
  expect((await request('PUT')).status).toBe(200);
  expect(await (await request()).json()).toEqual(expect.arrayContaining([body]));
});
it('rolls back the reminder toggle when its audit insert fails', async () => {
  await http.pool.query(
    "CREATE FUNCTION reject_reminder_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test reminder audit failure'; END $$; CREATE TRIGGER reject_reminder_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_reminder_audit()"
  );
  try {
    expect((await request('PUT')).status).toBe(500);
    expect(
      (await http.pool.query('SELECT * FROM invoice_reminder_offset_toggles')).rows
    ).toHaveLength(0);
    expect((await http.pool.query('SELECT * FROM audit_log')).rows).toHaveLength(0);
  } finally {
    await http.pool.query('DROP TRIGGER reject_reminder_audit ON audit_log');
  }
  expect((await request('PUT')).status).toBe(200);
  expect((await http.pool.query('SELECT metadata::jsonb AS metadata FROM audit_log')).rows).toEqual(
    [{ metadata: { ...body, previousEnabled: true } }]
  );
});
it('denies staff without the reminder grant and preserves the default matrix', async () => {
  expect((await request('GET', 'other')).status).toBe(403);
  expect((await request('PUT', 'other')).status).toBe(403);
  const result = (await (await request()).json()) as Array<{ enabled: boolean }>;
  expect(result).toHaveLength(24);
  expect(result.every((row) => row.enabled)).toBe(true);
});
