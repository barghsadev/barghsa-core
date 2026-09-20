import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['admin', 'customer', 'member', 'disabled']) {
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash,is_admin,is_staff,disabled_at)
      VALUES ($1,$2,'test-only',$3,$4,$5)`,
      [
        user,
        `${user}@example.test`,
        user === 'admin',
        user !== 'customer',
        user === 'disabled' ? new Date() : null,
      ]
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
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
});
function call(path: string, method = 'GET', body?: unknown, user = 'admin') {
  return fetch(`${http.base}/api/admin/${path}`, {
    method,
    headers: headers[user]!,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const configurations = [
  {
    path: 'config/service-response-targets',
    key: 'admin.service_response_targets',
    value: { ticket: 24 },
    invalid: { ticket: 1.5 },
  },
  {
    path: 'config/escalation-policy',
    key: 'admin.escalation_policy',
    value: {
      ticket: {
        level2: { delayHours: 2, channels: ['in_app', 'email'] },
        level3: { delayHours: 3, channels: ['in_app'] },
      },
    },
    invalid: {
      ticket: {
        level2: { delayHours: 2, channels: ['email'] },
        level3: { delayHours: 3, channels: ['in_app'] },
      },
    },
  },
];
for (const config of configurations) {
  it(`${config.path} enforces permissions, confirmation, validation and disable`, async () => {
    expect((await call(config.path, 'GET', undefined, 'customer')).status).toBe(403);
    expect((await call(config.path, 'PUT', config.value, 'customer')).status).toBe(403);
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='admin'");
    try {
      expect((await call(config.path, 'PUT', config.value)).status).toBe(403);
    } finally {
      await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='admin'");
    }
    expect((await call(config.path, 'PUT', config.invalid)).status).toBe(400);
    expect((await call(config.path, 'PUT', config.value)).status).toBe(200);
    expect(await (await call(config.path)).json()).toMatchObject(config.value);
    expect((await call(config.path, 'PUT', {})).status).toBe(200);
    expect(await (await call(config.path)).json()).toEqual({
      ticket: null,
      verification_case: null,
    });
  });
  it(`${config.path} serializes first writes and rolls audit failures back`, async () => {
    await http.pool.query('DELETE FROM app_config WHERE key=$1', [config.key]);
    await http.pool.query("DELETE FROM audit_log WHERE metadata::jsonb->>'key'=$1", [config.key]);
    const before = (await http.pool.query("SELECT version FROM config_version WHERE id='global'"))
      .rows[0].version;
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => call(config.path, 'PUT', config.value))
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    const audits = (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata FROM audit_log WHERE metadata::jsonb->>'key'=$1 ORDER BY (metadata::jsonb->>'version')::int",
        [config.key]
      )
    ).rows;
    expect(audits.map((row) => row.metadata.version)).toEqual([1, 2, 3, 4, 5]);
    expect(audits.map((row) => row.metadata.previousVersion)).toEqual([0, 1, 2, 3, 4]);
    expect(audits[0].metadata.previousValue).toBeNull();
    expect(audits[1].metadata.previousValue).toMatchObject(config.value);
    expect(
      (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows[0]
        .version
    ).toBe(before + 5);
    await http.pool
      .query(`CREATE FUNCTION fail_target_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
      CREATE TRIGGER fail_target_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_target_audit()`);
    try {
      expect((await call(config.path, 'PUT', {})).status).toBe(500);
    } finally {
      await http.pool.query(
        'DROP TRIGGER fail_target_audit ON audit_log; DROP FUNCTION fail_target_audit()'
      );
    }
    expect(
      (await http.pool.query('SELECT version,value FROM app_config WHERE key=$1', [config.key]))
        .rows[0]
    ).toMatchObject({ version: 5, value: config.value });
    expect(
      (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows[0]
        .version
    ).toBe(before + 5);
    expect((await call(config.path, 'PUT', {})).status).toBe(200);
  });
}
