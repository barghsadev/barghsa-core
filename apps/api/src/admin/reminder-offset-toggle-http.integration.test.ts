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
  await http.pool.query(
    "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day', idle_deadline=NOW()+INTERVAL '30 minutes', step_up_verified_at=NOW()"
  );
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
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT u.user_id FROM users u JOIN sessions%FOR UPDATE OF u%'"
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

it.each(['pair', 'audit', 'read'] as const)(
  'rejects expired sessions after waiting for the %s lock without saving a toggle or audit',
  async (target) => {
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      if (target === 'pair')
        await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
          'barghsa.invoice_reminder_offset_toggles',
          'electricity:-7',
        ]);
      else if (target === 'read')
        await blocker.query('LOCK TABLE invoice_reminder_offset_toggles IN ACCESS EXCLUSIVE MODE');
      else await blocker.query('LOCK TABLE audit_log IN SHARE MODE');
      await http.pool.query(
        "UPDATE sessions SET expires_at=NOW()+INTERVAL '2 seconds' WHERE user_id='operator'"
      );
      pending = request(target === 'read' ? 'GET' : 'PUT');
      const pattern =
        target === 'pair'
          ? '%SELECT pg_advisory_xact_lock%'
          : target === 'audit'
            ? '%INSERT INTO audit_log%'
            : '%FROM invoice_reminder_offset_toggles%';
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
                [pattern]
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                "SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE user_id='operator'"
              )
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(401);
      expect(
        (await http.pool.query('SELECT * FROM invoice_reminder_offset_toggles')).rows
      ).toHaveLength(0);
      expect((await http.pool.query('SELECT * FROM audit_log')).rows).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);

it('rechecks step-up after waiting for the pair lock', async () => {
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
      'barghsa.invoice_reminder_offset_toggles',
      'electricity:-7',
    ]);
    pending = request('PUT');
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT pg_advisory_xact_lock%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await blocker.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='operator'");
    await blocker.query('COMMIT');
    const response = await pending;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTHZ:STEP_UP_REQUIRED' } });
    expect(
      (await http.pool.query('SELECT * FROM invoice_reminder_offset_toggles')).rows
    ).toHaveLength(0);
    expect((await http.pool.query('SELECT * FROM audit_log')).rows).toHaveLength(0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});
