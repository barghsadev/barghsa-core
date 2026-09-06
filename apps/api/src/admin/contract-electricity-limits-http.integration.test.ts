import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-contract-limit','Jobs','Test role','["admin:catalogue:edit","admin:catalogue:edit"]'),('test-contract-limit-view','View jobs','Test role','["admin:catalogue:edit"]')`
  );
  for (const [user, role] of [
    ['operator', 'test-contract-limit'],
    ['viewer', 'test-contract-limit-view'],
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
const key = 'electricity.contract_limits';
const input = {
  max_quantity_increase_percent: 30,
  max_contract_duration_months: 12,
  lead_time_days: 3,
};
beforeEach(async () => {
  await http.pool.query('DELETE FROM app_config WHERE key=$1', [key]);
  await http.pool.query("DELETE FROM audit_log WHERE event='change_recorded'");
});
function save(user = 'operator') {
  return fetch(`${http.base}/api/admin/config/contract-electricity-limits`, {
    method: 'PUT',
    headers: headers[user]!,
    body: JSON.stringify(input),
  });
}
it('serializes first saves from different staff before recording previous versions', async () => {
  const client = await http.pool.connect();
  let first: Promise<Response> | undefined, second: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT id FROM config_version WHERE id='global' FOR UPDATE");
    first = save();
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE config_version SET version%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    second = save('viewer');
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"
            )
          ).rows[0].count
        )
      )
      .toBe(2);
    await client.query('COMMIT');
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    const rows = (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='change_recorded' ORDER BY (metadata::jsonb->>'version')::int"
      )
    ).rows;
    expect(rows.map((r) => [r.metadata.previousVersion, r.metadata.version])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await Promise.all([first, second]);
  }
});
it('rejects removed authority while saving without an idle transaction', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='operator' FOR UPDATE");
    pending = save();
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
      (await http.pool.query('SELECT key FROM app_config WHERE key=$1', [key])).rows
    ).toHaveLength(0);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
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
      "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-contract-limit') ON CONFLICT DO NOTHING"
    );
  }
});
it('rolls back settings and global version when audit storage fails', async () => {
  const version = (await http.pool.query("SELECT version FROM config_version WHERE id='global'"))
    .rows[0].version;
  await http.pool.query(
    "CREATE FUNCTION reject_contract_limit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test limit audit failure'; END $$; CREATE TRIGGER reject_contract_limit_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='change_recorded') EXECUTE FUNCTION reject_contract_limit_audit()"
  );
  try {
    expect((await save()).status).toBe(500);
    expect(
      (await http.pool.query('SELECT key FROM app_config WHERE key=$1', [key])).rows
    ).toHaveLength(0);
    expect(
      (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows[0]
        .version
    ).toBe(version);
  } finally {
    await http.pool.query('DROP TRIGGER reject_contract_limit_audit ON audit_log');
  }
});
