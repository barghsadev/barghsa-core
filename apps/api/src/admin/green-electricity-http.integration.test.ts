import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-green','Jobs','Test role','["admin:catalogue:edit","admin:catalogue:edit"]'),('test-green-view','View jobs','Test role','["admin:catalogue:edit"]')`
  );
  for (const [user, role] of [
    ['operator', 'test-green'],
    ['viewer', 'test-green-view'],
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
const input = {
  simple_order: {
    mandatory_green_enabled: true,
    average_power_threshold_kw: 1000,
    mandatory_green_share_percent: 4,
  },
  advanced_order: {
    mandatory_green_enabled: false,
    average_power_threshold_kw: 1000,
    mandatory_green_share_percent: 4,
  },
};
const configKey = 'electricity.green_mandatory_rules';
beforeEach(async () => {
  await http.pool.query('DELETE FROM app_config WHERE key=$1', [configKey]);
  await http.pool.query("DELETE FROM audit_log WHERE event='config_change'");
  await http.pool.query(
    "INSERT INTO products(system_key,title,price,status) VALUES ('green_electricity','{\"en\":\"Green test\"}',1000,'active') ON CONFLICT(system_key) DO UPDATE SET status='active',price=1000"
  );
});
function save(body: unknown = input, user = 'operator') {
  return fetch(`${http.base}/api/admin/config/green-electricity-rules`, {
    method: 'PUT',
    headers: headers[user]!,
    body: JSON.stringify(body),
  });
}
it('serializes first writes and preserves a continuous audit version chain', async () => {
  const responses = await Promise.all([save(), save(input, 'viewer')]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  const audits = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='config_change' ORDER BY (metadata::jsonb->>'version')::int"
    )
  ).rows;
  expect(audits.map((r) => [r.metadata.previousVersion, r.metadata.version])).toEqual([
    [0, 1],
    [1, 2],
  ]);
});
it.each(['permission', 'product'])(
  'rejects changed %s after preflight without saving',
  async (change) => {
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
      if (change === 'permission')
        await client.query("DELETE FROM user_roles WHERE user_id='operator'");
      else
        await client.query(
          "UPDATE products SET status='inactive' WHERE system_key='green_electricity'"
        );
      await client.query('COMMIT');
      expect((await pending).status).toBe(change === 'permission' ? 403 : 400);
      expect(
        (await http.pool.query('SELECT key FROM app_config WHERE key=$1', [configKey])).rows
      ).toHaveLength(0);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='config_change'")).rows
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
        "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-green') ON CONFLICT DO NOTHING"
      );
    }
  }
);
it('rolls back config and global version if the final audit fails', async () => {
  const version = (await http.pool.query("SELECT version FROM config_version WHERE id='global'"))
    .rows[0].version;
  await http.pool.query(
    "CREATE FUNCTION reject_green_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test green audit failure'; END $$; CREATE TRIGGER reject_green_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='config_change') EXECUTE FUNCTION reject_green_audit()"
  );
  try {
    expect((await save()).status).toBe(500);
    expect(
      (await http.pool.query('SELECT key FROM app_config WHERE key=$1', [configKey])).rows
    ).toHaveLength(0);
    expect(
      (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows[0]
        .version
    ).toBe(version);
  } finally {
    await http.pool.query('DROP TRIGGER reject_green_audit ON audit_log');
  }
});

it('refuses corrupt saved rules and limits while leaving their evidence intact', async () => {
  for (const [key, path] of [
    [configKey, 'green-electricity-rules'],
    ['electricity.contract_limits', 'contract-electricity-limits'],
  ]) {
    await http.pool.query(
      'INSERT INTO app_config(key,value) VALUES ($1,\'{"damaged":true}\') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
      [key]
    );
    const response = await fetch(`${http.base}/api/admin/config/${path}`, {
      headers: headers.operator!,
    });
    expect(response.status).toBe(503);
    expect(
      (await http.pool.query('SELECT value FROM app_config WHERE key=$1', [key])).rows[0].value
    ).toEqual({ damaged: true });
  }
  expect(
    (
      await fetch(`${http.base}/api/admin/config/green-electricity-rules/safety-status`, {
        headers: headers.operator!,
      })
    ).status
  ).toBe(503);
});

it('requires password step-up before changing rules', async () => {
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='operator'");
  try {
    expect((await save()).status).toBe(403);
    expect(
      (await http.pool.query('SELECT key FROM app_config WHERE key=$1', [configKey])).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='operator'");
  }
});
