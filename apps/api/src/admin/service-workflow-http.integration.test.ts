import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULT_SERVICE_WORKFLOWS, SERVICE_WORKFLOW_CONFIG_KEY } from '@barghsa/shared/admin';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const session = randomUUID(),
  csrf = randomUUID(),
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
const grants = ['admin:service-targets:edit', 'admin:service-escalation:edit'];
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool
    .query(`INSERT INTO users(user_id,username,password_hash,is_staff) VALUES('workflow-editor','workflow@example.test','test',true);
    INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('workflow-editor','Workflow editor','Test','[]');
    INSERT INTO user_roles(user_id,role_id) VALUES('workflow-editor','workflow-editor')`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES($1,'workflow-editor',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf, randomUUID()]
  );
}, 40000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await http.pool.query('DELETE FROM app_config WHERE key=$1', [SERVICE_WORKFLOW_CONFIG_KEY]);
  await http.pool.query(
    "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='workflow-editor'",
    [JSON.stringify(grants)]
  );
  await http.pool.query(
    'UPDATE sessions SET revoked_at=NULL,step_up_verified_at=NOW() WHERE session_id=$1',
    [session]
  );
});
const read = () => fetch(http.base + '/api/admin/config/service-workflows', { headers });
const history = (query = '') =>
  fetch(http.base + '/api/admin/config/service-workflows/history' + query, { headers });
const restore = (
  sourceId: string,
  expectedVersion: number,
  requestHeaders: Record<string, string> = headers
) =>
  fetch(http.base + '/api/admin/config/service-workflows/restore', {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({ sourceId, expectedVersion }),
  });
const write = (policy: unknown, expectedVersion = 0) =>
  fetch(http.base + '/api/admin/config/service-workflows', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ policy, expectedVersion }),
  });
const proposal = () => ({
  ...structuredClone(DEFAULT_SERVICE_WORKFLOWS),
  ticket_urgent: {
    hours: 1,
    notification: 'breach',
    email: true,
    escalation: {
      condition: 'ticket_priority',
      from: { kind: 'role', id: 'workflow-editor' },
      to: { kind: 'admins', id: null },
      afterHours: 2,
      email: false,
    },
  },
});
it('expands a populated legacy episode ledger without losing tier, deduplication or time constraints', async () => {
  const c = await http.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`CREATE TEMP TABLE service_breach_alerts(id text,service_type text,item_id text,target_hours int CHECK(target_hours>0),source_activity_at timestamptz,escalation_level int CHECK(escalation_level BETWEEN 1 AND 3),
      CONSTRAINT chk_sba_service_type CHECK(service_type IN ('ticket','verification_case','consultation')),UNIQUE(service_type,item_id)) ON COMMIT DROP;
      INSERT INTO service_breach_alerts VALUES('old','ticket','existing',4,NULL,3)`);
    const sql = readFileSync(
      '../../packages/db/drizzle/production/0280_service_workflow_targets.sql',
      'utf8'
    );
    await c.query(sql);
    expect((await c.query('SELECT * FROM service_breach_alerts')).rows).toEqual([
      {
        id: 'old',
        service_type: 'ticket',
        item_id: 'existing',
        target_hours: 4,
        source_activity_at: null,
        escalation_level: 3,
        policy_fingerprint: null,
      },
    ]);
    await c.query('SAVEPOINT invalid');
    await expect(
      c.query(
        "INSERT INTO service_breach_alerts VALUES('new','workflow_ticket_urgent','new',1,NOW(),1,NULL)"
      )
    ).rejects.toThrow();
    await c.query('ROLLBACK TO SAVEPOINT invalid');
    await expect(
      c.query("INSERT INTO service_breach_alerts VALUES('dup','ticket','existing',1,NULL,1,NULL)")
    ).rejects.toThrow();
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
it('requires both current capabilities, CSRF and recent step-up without changing policy', async () => {
  expect((await read()).status).toBe(200);
  for (const permissions of [[], [grants[0]], [grants[1]]]) {
    await http.pool.query(
      "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='workflow-editor'",
      [JSON.stringify(permissions)]
    );
    expect((await read()).status).toBe(403);
    expect((await write(proposal())).status).toBe(403);
  }
  await http.pool.query(
    "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='workflow-editor'",
    [JSON.stringify(grants)]
  );
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    session,
  ]);
  expect((await write(proposal())).status).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW() WHERE session_id=$1', [
    session,
  ]);
  const noCsrf = await fetch(http.base + '/api/admin/config/service-workflows', {
    method: 'PUT',
    headers: { ...headers, 'X-CSRF-Token': 'bad' },
    body: JSON.stringify({ policy: proposal(), expectedVersion: 0 }),
  });
  expect(noCsrf.status).toBe(403);
  expect(
    (
      await http.pool.query('SELECT key FROM app_config WHERE key=$1', [
        SERVICE_WORKFLOW_CONFIG_KEY,
      ])
    ).rows
  ).toEqual([]);
});
it('saves all thresholds and routing together, rejects stale concurrent writers and audits exact old/new values', async () => {
  const p = proposal();
  const replies = await Promise.all([write(p), write(p)]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  const view = await (await read()).json();
  expect(view).toMatchObject({ policy: p, version: 1 });
  const audit = (
    await http.pool.query(
      "SELECT metadata::jsonb AS m FROM audit_log WHERE metadata::jsonb->>'key'=$1 ORDER BY created_at DESC LIMIT 1",
      [SERVICE_WORKFLOW_CONFIG_KEY]
    )
  ).rows[0].m;
  expect(audit.previous.policy).toEqual(DEFAULT_SERVICE_WORKFLOWS);
  expect(audit.next.policy).toEqual(p);
  expect((await write(DEFAULT_SERVICE_WORKFLOWS, 1)).status).toBe(200);
});
it('refuses invalid rules and missing/deactivated references without reflecting secret input', async () => {
  const p = proposal();
  p.ticket_urgent.escalation.from.id = 'missing-role';
  expect((await write(p)).status).toBe(409);
  const team = (
    await http.pool.query(
      "INSERT INTO staff_teams(name,is_active) VALUES('Unavailable workflow team',false) RETURNING id"
    )
  ).rows[0].id;
  p.ticket_urgent.escalation.from = { kind: 'team', id: team };
  expect((await write(p)).status).toBe(409);
  p.ticket_urgent.hours = 0;
  expect((await write(p)).status).toBe(400);
  expect(
    (
      await http.pool.query('SELECT key FROM app_config WHERE key=$1', [
        SERVICE_WORKFLOW_CONFIG_KEY,
      ])
    ).rows
  ).toEqual([]);
});
it('rolls policy, version and delivery-related history back when the audit write fails', async () => {
  const before = (await http.pool.query("SELECT version FROM config_version WHERE id='global'"))
    .rows[0].version;
  await http.pool
    .query(`CREATE FUNCTION fail_workflow_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
    CREATE TRIGGER fail_workflow_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_workflow_audit()`);
  try {
    expect((await write(proposal())).status).toBe(500);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_workflow_audit ON audit_log; DROP FUNCTION fail_workflow_audit()'
    );
  }
  expect((await read()).status).toBe(200);
  expect(await (await read()).json()).toMatchObject({ version: 0 });
  expect(
    (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows[0].version
  ).toBe(before);
});

it('recovers an existing audited version with current grants, step-up and an exact version', async () => {
  const sourceId = randomUUID();
  const policy = proposal();
  // This audit shape predates explicit activation and restore provenance.
  await http.pool.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
    VALUES($1,'workflow-editor','config_change',$2::jsonb,$3,'127.0.0.1')`,
    [
      sourceId,
      JSON.stringify({ key: SERVICE_WORKFLOW_CONFIG_KEY, next: { policy, version: 1 } }),
      randomUUID(),
    ]
  );
  await http.pool.query('INSERT INTO app_config(key,value,version) VALUES($1,$2::jsonb,2)', [
    SERVICE_WORKFLOW_CONFIG_KEY,
    JSON.stringify(DEFAULT_SERVICE_WORKFLOWS),
  ]);
  expect((await history('?beforeVersion=bad')).status).toBe(400);
  const listed = await history('?beforeVersion=2');
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({
    items: expect.arrayContaining([{ id: sourceId, version: 1, value: policy }]),
  });
  expect((await restore(randomUUID(), 2)).status).toBe(404);
  expect((await restore(sourceId, 1)).status).toBe(409);
  expect((await restore(sourceId, 2, { ...headers, 'X-CSRF-Token': 'invalid' })).status).toBe(403);
  const retiredSource = randomUUID();
  const retiredPolicy = proposal();
  retiredPolicy.ticket_urgent.escalation.from.id = 'retired-role';
  await http.pool.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
    VALUES($1,'workflow-editor','config_change',$2::jsonb,$3,'127.0.0.1')`,
    [
      retiredSource,
      JSON.stringify({
        key: SERVICE_WORKFLOW_CONFIG_KEY,
        next: { policy: retiredPolicy, version: 1 },
      }),
      randomUUID(),
    ]
  );
  expect((await restore(retiredSource, 2)).status).toBe(409);
  expect(await (await read()).json()).toMatchObject({
    policy: DEFAULT_SERVICE_WORKFLOWS,
    version: 2,
  });
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    session,
  ]);
  expect((await restore(sourceId, 2)).status).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW() WHERE session_id=$1', [
    session,
  ]);
  await http.pool.query(
    "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='workflow-editor'",
    [JSON.stringify(grants.slice(0, 1))]
  );
  expect((await history()).status).toBe(403);
  expect((await restore(sourceId, 2)).status).toBe(403);
  await http.pool.query(
    "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='workflow-editor'",
    [JSON.stringify(grants)]
  );
  const replies = await Promise.all([restore(sourceId, 2), restore(sourceId, 2)]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await (await read()).json()).toMatchObject({ policy, version: 3 });
  const { rows } = await http.pool.query(
    `SELECT metadata::jsonb AS data FROM audit_log
     WHERE metadata::jsonb->'restoredFrom'->>'id'=$1`,
    [sourceId]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].data).toMatchObject({
    action: 'activate',
    restoredFrom: { id: sourceId, version: 1 },
    next: { policy, version: 3 },
  });
  expect((await restore(randomUUID(), 3)).status).toBe(404);
});
