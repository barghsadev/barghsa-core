import { AuditWindow } from '../test/audit-window.js';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractElectricityLimitsService } from './contract-electricity-limits.service.js';
type RecoveryHistory = Awaited<ReturnType<ContractElectricityLimitsService['recoveryHistory']>>;
type RecoveryDraft = Awaited<ReturnType<ContractElectricityLimitsService['stageRecovery']>>;
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
  await auditWindow.excludeExisting("event='change_recorded'", []);
});
function save(user = 'operator') {
  return fetch(`${http.base}/api/admin/config/contract-electricity-limits`, {
    method: 'PUT',
    headers: headers[user]!,
    body: JSON.stringify(input),
  });
}

it('recovers only a reviewed earlier revision and rejects stale, superseded and unauthorized activation', async () => {
  const url = `${http.base}/api/admin/config/contract-electricity-limits`;
  const request = (suffix: string, body?: object, user = 'operator') =>
    fetch(`${url}${suffix}`, {
      headers: headers[user]!,
      ...(body && { method: suffix ? 'POST' : 'PUT', body: JSON.stringify(body) }),
    });
  const first = await request('', input);
  expect(first.status).toBe(200);
  const original = await first.json();
  const second = await request('', { ...input, lead_time_days: 9 });
  expect(second.status).toBe(200);
  expect((await request('/rollback-history', undefined, 'other')).status).toBe(403);
  const history = await request('/rollback-history');
  expect(history.status).toBe(200);
  const page = (await history.json()) as RecoveryHistory;
  expect(page).toEqual({
    baseVersion: 2,
    draft: null,
    items: [{ id: expect.any(String), version: 1, config: original }],
    nextBeforeVersion: null,
  });
  const sourceId = page.items[0]!.id;
  expect((await request('/rollback-draft', { sourceId, expectedVersion: 1 })).status).toBe(409);
  expect(
    (await request('/rollback-draft', { sourceId: randomUUID(), expectedVersion: 2 })).status
  ).toBe(404);
  expect(
    (await request('/rollback-draft', { sourceId, expectedVersion: 2, config: input })).status
  ).toBe(400);
  const stage = await request('/rollback-draft', { sourceId, expectedVersion: 2 });
  expect(stage.status).toBe(201);
  const draft = (await stage.json()) as RecoveryDraft;
  expect(draft).toEqual({
    id: expect.any(String),
    baseVersion: 2,
    sourceId,
    sourceVersion: 1,
    config: original,
  });
  expect(await (await request('/rollback-draft', { sourceId, expectedVersion: 2 })).json()).toEqual(
    draft
  );
  expect(await (await request('')).json()).toMatchObject({ leadTimeDays: 9 });
  const activate = { draftId: draft.id, expectedVersion: 2 };
  expect((await request('/rollback-activate', activate, 'other')).status).toBe(403);
  expect((await request('/rollback-activate', { ...activate, draftId: randomUUID() })).status).toBe(
    409
  );
  const activated = await request('/rollback-activate', activate);
  expect(activated.status).toBe(200);
  expect(await activated.json()).toEqual({ config: original, version: 3, draftId: draft.id });
  expect((await request('/rollback-activate', activate)).status).toBe(409);
  expect(await (await request('')).json()).toEqual(original);
  const final = await (await request('/rollback-history?beforeVersion=2')).json();
  expect(final).toMatchObject({ baseVersion: 3, draft: null, items: page.items });
  const audits = await auditWindow.query(
    "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='change_recorded' AND metadata::jsonb->>'action'='rollback_activated'"
  );
  expect(audits.rows).toHaveLength(1);
  expect(audits.rows[0].metadata).toMatchObject({
    draftId: draft.id,
    sourceId,
    sourceVersion: 1,
    previousVersion: 2,
    version: 3,
    newValue: input,
  });
});

it('requires current step-up and leaves a stale recovery draft inert after a normal save', async () => {
  expect((await save()).status).toBe(200);
  expect((await save()).status).toBe(200);
  const url = `${http.base}/api/admin/config/contract-electricity-limits`;
  const history = (await (
    await fetch(`${url}/rollback-history`, { headers: headers.operator! })
  ).json()) as RecoveryHistory;
  const post = (path: string, body: object, user: string) =>
    fetch(`${url}/${path}`, {
      method: 'POST',
      headers: headers[user]!,
      body: JSON.stringify(body),
    });
  const input = { sourceId: history.items[0]!.id, expectedVersion: 2 };
  const staged = await post('rollback-draft', input, 'operator');
  expect(staged.status).toBe(201);
  const draft = (await staged.json()) as RecoveryDraft;
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='viewer'");
  try {
    expect((await post('rollback-draft', input, 'viewer')).status).toBe(403);
    expect(
      (await post('rollback-activate', { draftId: draft.id, expectedVersion: 2 }, 'viewer')).status
    ).toBe(403);
  } finally {
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='viewer'");
  }
  expect((await save()).status).toBe(200);
  expect(
    (await post('rollback-activate', { draftId: draft.id, expectedVersion: 2 }, 'operator')).status
  ).toBe(409);
  const after = await (
    await fetch(`${url}/rollback-history`, { headers: headers.operator! })
  ).json();
  expect(after).toMatchObject({ baseVersion: 3, draft: null });
});
it('returns owned camelCase fields for invalid limits without writing settings or audit', async () => {
  const response = await fetch(`${http.base}/api/admin/config/contract-electricity-limits`, {
    method: 'PUT',
    headers: headers.operator!,
    body: JSON.stringify({
      max_quantity_increase_percent: -1,
      maxContractDuration: 0,
      lead_time_days: 36501,
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: {
      code: 'VALIDATION:INPUT:INVALID',
      fields: ['maxQuantityIncreasePercent', 'maxContractDuration', 'leadTimeDays'],
    },
  });
  expect(
    (await http.pool.query('SELECT key FROM app_config WHERE key=$1', [key])).rows
  ).toHaveLength(0);
  expect(
    (await auditWindow.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
  ).toHaveLength(0);
});
it('keeps unknown and mixed input general without reflecting private keys, and checks permission first', async () => {
  for (const user of ['operator', 'other']) {
    const response = await fetch(`${http.base}/api/admin/config/contract-electricity-limits`, {
      method: 'PUT',
      headers: headers[user]!,
      body: JSON.stringify({ ...input, lead_time_days: -1, privateSecret: 'private-value' }),
    });
    expect(response.status).toBe(user === 'operator' ? 400 : 403);
    const body = await response.json();
    expect(body).not.toHaveProperty('error.fields');
    expect(JSON.stringify(body)).not.toMatch(/privateSecret|private-value/);
  }
});
it('preserves snake/camel alias precedence and boundary values', async () => {
  const response = await fetch(`${http.base}/api/admin/config/contract-electricity-limits`, {
    method: 'PUT',
    headers: headers.operator!,
    body: JSON.stringify({
      max_quantity_increase_percent: 1000,
      maxQuantityIncreasePercent: -1,
      maxContractDuration: 1200,
      lead_time_days: null,
      leadTimeDays: 36500,
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    maxQuantityIncreasePercent: 1000,
    maxContractDuration: 1200,
    leadTimeDays: 36500,
  });
});
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
      await auditWindow.query(
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
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%users%' AND cardinality(pg_blocking_pids(pid)) > 0 "
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
      (await auditWindow.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
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

const auditWindow = new AuditWindow(() => http.pool);
