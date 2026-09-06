import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const cases = [
  {
    path: 'profile-verification-mode',
    key: 'profile_verification_mode',
    body: { mode: 'MANUAL' },
    stored: 'MANUAL',
    response: { mode: 'MANUAL' },
    grant: 'admin:config:write',
  },
  {
    path: 'delivery-window',
    key: 'notification.delivery_window',
    body: { timezone: 'UTC', start_hour: 8, end_hour: 20 },
    stored: { timezone: 'UTC', start_hour: 8, end_hour: 20 },
    response: { timezone: 'UTC', startHour: 8, endHour: 20 },
    grant: 'admin:notification-providers:edit',
  },
] as const;

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
    VALUES ('test-config-editor','Config editor','Test role',$1),
           ('test-config-viewer','Config viewer','Test role','["admin:config:read"]')`,
    [JSON.stringify(cases.map((value) => value.grant))]
  );
  for (const [user, role] of [
    ['operator', 'test-config-editor'],
    ['viewer', 'test-config-viewer'],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
      [user, user + '@example.test']
    );
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
beforeEach(async () => {
  await http.pool.query('DELETE FROM app_config WHERE key=ANY($1::text[])', [
    cases.map((value) => value.key),
  ]);
  await http.pool.query('DELETE FROM audit_log');
});

function write(item: (typeof cases)[number], user = 'operator') {
  return fetch(`${http.base}/api/admin/config/${item.path}`, {
    method: 'PUT',
    headers: headers[user]!,
    body: JSON.stringify(item.body),
  });
}
async function snapshot() {
  return {
    config: (
      await http.pool.query(
        'SELECT key,value,version FROM app_config WHERE key=ANY($1::text[]) ORDER BY key',
        [cases.map((value) => value.key)]
      )
    ).rows,
    version: (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows,
    audits: (
      await http.pool.query(
        "SELECT event,metadata FROM audit_log WHERE event='config_change' ORDER BY id"
      )
    ).rows,
  };
}
for (const item of cases) {
  it(`${item.path}: denies read-only staff without changing config or audit history`, async () => {
    const before = await snapshot();
    expect((await write(item, 'viewer')).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it(`${item.path}: commits config, version and audit together for the current grant`, async () => {
    const before = await snapshot();
    const response = await write(item);
    expect(response.status, http.logs()).toBe(200);
    expect(await response.json()).toEqual(item.response);
    const saved = await snapshot();
    expect(saved.config).toEqual([{ key: item.key, value: item.stored, version: 1 }]);
    expect(before.version).toHaveLength(1);
    expect(saved.version).toEqual([{ version: Number(before.version[0].version) + 1 }]);
    expect(saved.audits).toHaveLength(1);
    expect(JSON.parse(saved.audits[0].metadata)).toMatchObject({
      key: item.key,
      newValue: item.stored,
    });
  });
  it(`${item.path}: rolls back configuration and global version when audit insertion fails`, async () => {
    const before = await snapshot();
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_config_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER reject_config_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_config_audit()"
    );
    try {
      expect((await write(item)).status).toBe(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await http.pool.query('DROP TRIGGER reject_config_audit ON audit_log');
    }
  });
  it(`${item.path}: rejects a grant revoked while the request waits on its actor lock`, async () => {
    const before = await snapshot();
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='operator' FOR UPDATE");
      pending = write(item);
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
      await client.query("DELETE FROM user_roles WHERE user_id='operator'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-config-editor') ON CONFLICT DO NOTHING"
      );
    }
    expect((await write(item)).status).toBe(200);
  });
}
