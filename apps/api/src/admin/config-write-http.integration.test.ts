import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  WALLET_TOP_UP_LIMIT_CONFIG_KEY,
  WALLET_TOP_UP_LIMIT_LOCK_NAMESPACE,
} from '@barghsa/shared/finance';

import {
  SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
  ESCALATION_POLICY_CONFIG_KEY,
  STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
} from '@barghsa/shared/admin';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const cases = [
  {
    path: 'delivery-window',
    key: 'notification.delivery_window',
    body: { timezone: 'UTC', start_hour: 8, end_hour: 20 },
    stored: { timezone: 'UTC', start_hour: 8, end_hour: 20 },
    response: { timezone: 'UTC', startHour: 8, endHour: 20 },
    grant: 'admin:notification-providers:edit',
  },
  {
    path: 'dual-approval-threshold',
    key: DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
    body: { threshold_irr: 500_000_000 },
    stored: { threshold_irr: 500_000_000 },
    response: { thresholdIrR: 500_000_000 },
    grant: 'admin:financial:edit',
  },
  {
    path: 'wallet-top-up-limit',
    key: WALLET_TOP_UP_LIMIT_CONFIG_KEY,
    body: { limit_irr: 1_000_000_000 },
    stored: { limit_irr: 1_000_000_000 },
    response: { limitIrR: 1_000_000_000, version: 1 },
    grant: 'admin:financial:edit',
  },
  {
    path: 'service-response-targets',
    key: SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
    body: { ticket: 48, verification_case: 72 },
    stored: { ticket: 48, verification_case: 72 },
    response: { ticket: 48, verification_case: 72 },
    grant: 'admin:service-targets:edit',
  },
  {
    path: 'escalation-policy',
    key: ESCALATION_POLICY_CONFIG_KEY,
    body: {
      ticket: {
        level2: { delayHours: 24, channels: ['in_app'] },
        level3: { delayHours: 48, channels: ['in_app', 'email'] },
      },
      verification_case: null,
    },
    stored: {
      ticket: {
        level2: { delayHours: 24, channels: ['in_app'] },
        level3: { delayHours: 48, channels: ['in_app', 'email'] },
      },
      verification_case: null,
    },
    response: {
      ticket: {
        level2: { delayHours: 24, channels: ['in_app'] },
        level3: { delayHours: 48, channels: ['in_app', 'email'] },
      },
      verification_case: null,
    },
    grant: 'admin:service-escalation:edit',
  },
  {
    path: 'assignment-rules',
    key: STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
    body: {
      ticket: { teamId: null, strategy: 'load' },
      verification_case: { teamId: null, strategy: 'round_robin' },
    },
    stored: {
      ticket: { teamId: null, strategy: 'load' },
      verification_case: { teamId: null, strategy: 'round_robin' },
    },
    response: {
      ticket: { teamId: null, strategy: 'load' },
      verification_case: { teamId: null, strategy: 'round_robin' },
    },
    grant: 'admin:staff-teams:edit',
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

const walletLimit = cases.find((item) => item.path === 'wallet-top-up-limit')!;
const daytimeWindow = cases.find((item) => item.path === 'delivery-window')!;
async function resetWalletLimitActor() {
  await http.pool.query(
    "UPDATE sessions SET revoked_at=NULL,csrf_token=$1,expires_at=clock_timestamp()+INTERVAL '1 day',idle_deadline=clock_timestamp()+INTERVAL '30 minutes',step_up_verified_at=clock_timestamp() WHERE user_id='operator'",
    [headers.operator!['X-CSRF-Token']]
  );
}

for (const change of ['revoke', 'csrf', 'step-up'] as const) {
  it(`delivery window rejects ${change} changed after the HTTP guard`, async () => {
    const before = await snapshot();
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        "SELECT role_id FROM staff_roles WHERE role_id='test-config-editor' FOR UPDATE"
      );
      pending = write(daytimeWindow);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE OF ur,r%'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await blocker.query(
        change === 'revoke'
          ? "UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id='operator'"
          : change === 'csrf'
            ? "UPDATE sessions SET csrf_token='rotated' WHERE user_id='operator'"
            : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '16 minutes' WHERE user_id='operator'"
      );
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(change === 'revoke' ? 401 : 403);
      expect(await snapshot()).toEqual(before);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
      await resetWalletLimitActor();
    }
  });
}

for (const expiry of ['session', 'step-up'] as const) {
  it(`delivery window rolls back config/version/audit if ${expiry} expires during audit`, async () => {
    const before = await snapshot();
    await http.pool.query(
      'CREATE FUNCTION delay_daytime_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$'
    );
    await http.pool.query(
      'CREATE TRIGGER delay_daytime_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_daytime_audit()'
    );
    try {
      await http.pool.query(
        expiry === 'session'
          ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '800 milliseconds' WHERE user_id='operator'"
          : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '800 milliseconds' WHERE user_id='operator'"
      );
      expect((await write(daytimeWindow)).status).toBe(expiry === 'session' ? 401 : 403);
      expect(await snapshot()).toEqual(before);
    } finally {
      await http.pool.query('DROP TRIGGER delay_daytime_audit ON audit_log');
      await http.pool.query('DROP FUNCTION delay_daytime_audit()');
      await resetWalletLimitActor();
    }
  });
}

it('persists minute boundaries and binds the delivery-window audit to the current session/correlation', async () => {
  const correlation = randomUUID();
  const body = { timezone: 'UTC', start_hour: 9.25, end_hour: 21.75 };
  const response = await fetch(`${http.base}/api/admin/config/delivery-window`, {
    method: 'PUT',
    headers: { ...headers.operator, 'X-Correlation-ID': correlation },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ timezone: 'UTC', startHour: 9.25, endHour: 21.75 });
  const saved = await fetch(`${http.base}/api/admin/config/delivery-window`, {
    headers: headers.operator!,
  });
  expect(await saved.json()).toEqual({ timezone: 'UTC', startHour: 9.25, endHour: 21.75 });
  expect((await snapshot()).config).toEqual([{ key: daytimeWindow.key, value: body, version: 1 }]);
  expect(
    (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE event='config_change'"
      )
    ).rows
  ).toEqual([
    {
      correlation_id: correlation,
      metadata: {
        key: daytimeWindow.key,
        newValue: body,
        sessionId: headers.operator!.Cookie!.split('=')[1],
      },
    },
  ]);
});

it.each([9.001, null, false, '9', 24])(
  'rejects invalid window boundary %s without writes',
  async (start) => {
    const before = await snapshot();
    const response = await fetch(`${http.base}/api/admin/config/delivery-window`, {
      method: 'PUT',
      headers: headers.operator!,
      body: JSON.stringify({ ...daytimeWindow.body, start_hour: start }),
    });
    expect(response.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  }
);

for (const change of ['revoke', 'csrf', 'step-up'] as const) {
  it(`wallet limit rejects ${change} changed after the HTTP guard while waiting on policy`, async () => {
    const before = await snapshot();
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
        WALLET_TOP_UP_LIMIT_LOCK_NAMESPACE,
        WALLET_TOP_UP_LIMIT_CONFIG_KEY,
      ]);
      pending = write(walletLimit);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(hashtext%'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await blocker.query(
        change === 'revoke'
          ? "UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id='operator'"
          : change === 'csrf'
            ? "UPDATE sessions SET csrf_token='rotated' WHERE user_id='operator'"
            : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '16 minutes' WHERE user_id='operator'"
      );
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(change === 'revoke' ? 401 : 403);
      expect(await snapshot()).toEqual(before);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
      await resetWalletLimitActor();
    }
  });
}

for (const expiry of ['session', 'step-up'] as const) {
  it(`wallet limit rolls back config/version/audit when ${expiry} expires during audit`, async () => {
    const before = await snapshot();
    await http.pool.query(
      'CREATE FUNCTION delay_wallet_limit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$'
    );
    await http.pool.query(
      'CREATE TRIGGER delay_wallet_limit_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_wallet_limit_audit()'
    );
    let pending: Promise<Response> | undefined;
    try {
      await http.pool.query(
        expiry === 'session'
          ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '800 milliseconds' WHERE user_id='operator'"
          : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '800 milliseconds' WHERE user_id='operator'"
      );
      pending = write(walletLimit);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      expect((await pending).status).toBe(expiry === 'session' ? 401 : 403);
      expect(await snapshot()).toEqual(before);
    } finally {
      await pending;
      await http.pool.query('DROP TRIGGER delay_wallet_limit_audit ON audit_log');
      await http.pool.query('DROP FUNCTION delay_wallet_limit_audit()');
      await resetWalletLimitActor();
    }
  });
}

it('wallet limit reports a corrupt stored value as unavailable, never as the default', async () => {
  await http.pool.query(
    'INSERT INTO app_config(key,value,version) VALUES ($1,\'{"limit_irr":"corrupt"}\',3)',
    [WALLET_TOP_UP_LIMIT_CONFIG_KEY]
  );
  const before = await snapshot();
  const response = await fetch(`${http.base}/api/admin/config/wallet-top-up-limit`, {
    headers: headers.operator!,
  });
  expect(response.status).toBe(503);
  expect(await snapshot()).toEqual(before);
});

it('wallet limit audit binds the current session and request correlation', async () => {
  const correlation = randomUUID();
  const response = await fetch(`${http.base}/api/admin/config/wallet-top-up-limit`, {
    method: 'PUT',
    headers: { ...headers.operator, 'X-Correlation-ID': correlation },
    body: JSON.stringify(walletLimit.body),
  });
  expect(response.status).toBe(200);
  const audit = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE event='config_change'"
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    correlation_id: correlation,
    metadata: { sessionId: headers.operator!.Cookie!.split('=')[1] },
  });
});
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
  it(`${item.path}: rejects a grant revoked while authentication waits on its actor lock`, async () => {
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
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM users u JOIN sessions s%FOR UPDATE OF u%'"
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

for (const item of cases.filter((item) => item.grant === 'admin:financial:edit')) {
  it(`${item.path}: requires recent password confirmation before changing settings`, async () => {
    const before = await snapshot();
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='operator'");
    try {
      const response = await write(item);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
      });
      expect(await snapshot()).toEqual(before);
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '16 minutes' WHERE user_id='operator'"
      );
      expect((await write(item)).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    } finally {
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='operator'"
      );
    }
    expect((await write(item)).status).toBe(200);
  });
}
