import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let ids: { policy: string; group: string };
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('policy-editor','KB editor','Test role','[\"admin:ai:policies\"]')"
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('policy-admin','policy-admin@example.test','test-only',true)"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('policy-admin','policy-editor')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'policy-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
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
    "DELETE FROM ai_policies; DELETE FROM ai_policy_groups; DELETE FROM audit_log WHERE event LIKE 'ai_policy_%'"
  );
  ids = {
    policy: (
      await http.pool.query(
        "INSERT INTO ai_policies(title,description,policy_type,rules,created_by) VALUES ('Original policy','original','disallowed_actions','{\"actions\":[\"financial_advice\"]}','policy-admin') RETURNING id"
      )
    ).rows[0].id,
    group: (
      await http.pool.query(
        "INSERT INTO ai_policy_groups(title,description,created_by) VALUES ('Original group','original','policy-admin') RETURNING id"
      )
    ).rows[0].id,
  };
  await http.pool.query('INSERT INTO ai_policy_group_members(group_id,policy_id) VALUES ($1,$2)', [
    ids.group,
    ids.policy,
  ]);
});
const entities = [
  { kind: 'policy', table: 'ai_policies', path: 'policies', title: 'Original policy' },
  { kind: 'group', table: 'ai_policy_groups', path: 'policy-groups', title: 'Original group' },
] as const;
const cases = entities.flatMap((entity) =>
  (['create', 'update', 'delete'] as const).map((action) => ({ ...entity, action }))
);
function request(entry: (typeof cases)[number]) {
  return fetch(
    `${http.base}/api/admin/${entry.path}${entry.action === 'create' ? '' : `/${ids[entry.kind]}`}`,
    {
      method: { create: 'POST', update: 'PUT', delete: 'DELETE' }[entry.action],
      headers,
      ...(entry.action === 'delete'
        ? {}
        : {
            body: JSON.stringify({
              title: 'Changed',
              description: 'changed',
              ...(entry.kind === 'policy'
                ? { policyType: 'disallowed_actions', rules: { actions: ['financial_advice'] } }
                : {}),
            }),
          }),
    }
  );
}
it.each(cases)('rolls back $kind $action and cascades when the audit fails', async (entry) => {
  await http.pool.query(
    "CREATE OR REPLACE FUNCTION reject_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test KB audit failure'; END $$; CREATE TRIGGER reject_policy_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'ai_policy_%') EXECUTE FUNCTION reject_policy_audit()"
  );
  try {
    expect((await request(entry)).status).toBe(500);
    expect((await http.pool.query(`SELECT id,title,description FROM ${entry.table}`)).rows).toEqual(
      [{ id: ids[entry.kind], title: entry.title, description: 'original' }]
    );
    expect(
      (await http.pool.query('SELECT group_id,policy_id FROM ai_policy_group_members')).rows
    ).toEqual([{ group_id: ids.group, policy_id: ids.policy }]);
  } finally {
    await http.pool.query('DROP TRIGGER reject_policy_audit ON audit_log');
  }
});
it.each(cases)('rechecks current authority for $kind $action', async (entry) => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='policy-admin' FOR UPDATE");
    pending = request(entry);
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
    await client.query("DELETE FROM user_roles WHERE user_id='policy-admin'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect((await http.pool.query(`SELECT id,title FROM ${entry.table}`)).rows).toEqual([
      { id: ids[entry.kind], title: entry.title },
    ]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_policy_%'")).rows
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
      "INSERT INTO user_roles(user_id,role_id) VALUES ('policy-admin','policy-editor') ON CONFLICT DO NOTHING"
    );
  }
});
it.each(entities)(
  'persists $kind edits, counts memberships and deletes only its links',
  async (entry) => {
    expect((await request({ ...entry, action: 'create' })).status).toBe(201);
    const response = await request({ ...entry, action: 'update' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: 'Changed',
      description: 'changed',
      ...(entry.kind === 'policy' ? { groupCount: 1 } : { memberCount: 1 }),
    });
    expect((await request({ ...entry, action: 'delete' })).status).toBe(204);
    expect((await http.pool.query('SELECT * FROM ai_policy_group_members')).rows).toHaveLength(0);
    expect(
      (
        await http.pool.query(
          `SELECT id FROM ${entry.kind === 'policy' ? 'ai_policy_groups' : 'ai_policies'}`
        )
      ).rows
    ).toHaveLength(1);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_policy_%'")).rows
    ).toHaveLength(3);
  }
);

function membershipRequest(action: 'add' | 'remove') {
  return fetch(
    `${http.base}/api/admin/policy-groups/${ids.group}/members${action === 'remove' ? `/${ids.policy}` : ''}`,
    {
      method: action === 'add' ? 'POST' : 'DELETE',
      headers,
      ...(action === 'add' ? { body: JSON.stringify({ policyId: ids.policy }) } : {}),
    }
  );
}
it.each(['add', 'remove'] as const)('rolls back membership %s when audit fails', async (action) => {
  if (action === 'add') await http.pool.query('DELETE FROM ai_policy_group_members');
  await http.pool.query(
    "CREATE OR REPLACE FUNCTION reject_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_policy_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'ai_policy_%') EXECUTE FUNCTION reject_policy_audit()"
  );
  try {
    expect((await membershipRequest(action)).status).toBe(500);
    expect(
      (await http.pool.query('SELECT policy_id FROM ai_policy_group_members')).rows
    ).toHaveLength(action === 'add' ? 0 : 1);
  } finally {
    await http.pool.query('DROP TRIGGER reject_policy_audit ON audit_log');
  }
});
it.each(['add', 'remove'] as const)('rechecks membership %s authority', async (action) => {
  if (action === 'add') await http.pool.query('DELETE FROM ai_policy_group_members');
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='policy-admin' FOR UPDATE");
    pending = membershipRequest(action);
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
    await client.query("DELETE FROM user_roles WHERE user_id='policy-admin'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect(
      (await http.pool.query('SELECT policy_id FROM ai_policy_group_members')).rows
    ).toHaveLength(action === 'add' ? 0 : 1);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_policy_%'")).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('policy-admin','policy-editor') ON CONFLICT DO NOTHING"
    );
  }
});
it('audits actual membership changes once and retains both records', async () => {
  expect((await membershipRequest('add')).status).toBe(204);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_policy_%'")).rows
  ).toHaveLength(0);
  expect((await membershipRequest('remove')).status).toBe(204);
  expect((await membershipRequest('add')).status).toBe(204);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_policy_%'")).rows
  ).toHaveLength(2);
  expect((await http.pool.query('SELECT id FROM ai_policies')).rows).toHaveLength(1);
  expect((await http.pool.query('SELECT id FROM ai_policy_groups')).rows).toHaveLength(1);
});
it('validates rules against the policy type after a concurrent edit commits', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ai_policies SET policy_type='allowed_topics',rules='{"topics":["energy"]}' WHERE id=$1`,
      [ids.policy]
    );
    pending = fetch(`${http.base}/api/admin/policies/${ids.policy}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ rules: { actions: ['financial_advice'] } }),
    });
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM ai_policies%FOR UPDATE%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await pending).status).toBe(400);
    expect(
      (await http.pool.query('SELECT policy_type,rules FROM ai_policies WHERE id=$1', [ids.policy]))
        .rows
    ).toEqual([{ policy_type: 'allowed_topics', rules: { topics: ['energy'] } }]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_policy_%'")).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});

const malformedRoutes = [
  ['GET', 'policies/invalid'],
  ['PUT', 'policies/invalid'],
  ['DELETE', 'policies/invalid'],
  ['GET', 'policy-groups/invalid'],
  ['PUT', 'policy-groups/invalid'],
  ['DELETE', 'policy-groups/invalid'],
  ['POST', 'policy-groups/invalid/members'],
  ['DELETE', 'policy-groups/invalid/members/invalid'],
] as const;
it.each(malformedRoutes)('rejects malformed IDs on %s %s', async (method, path) => {
  expect((await fetch(`${http.base}/api/admin/${path}`, { method, headers })).status).toBe(400);
});
it('validates the nested policy member ID', async () => {
  for (const path of [`policy-groups/${ids.group}/members/invalid`]) {
    expect(
      (await fetch(`${http.base}/api/admin/${path}`, { method: 'DELETE', headers })).status
    ).toBe(400);
  }
});
it.each(entities)(
  'rejects invalid $kind metadata without writes and trims valid titles',
  async (entry) => {
    for (const method of ['POST', 'PUT']) {
      for (const body of [
        { title: '   ' },
        { title: 'Valid', unexpected: true },
        { title: 'x'.repeat(121) },
        { description: 'x'.repeat(2001) },
      ]) {
        expect(
          (
            await fetch(
              `${http.base}/api/admin/${entry.path}${method === 'PUT' ? `/${ids[entry.kind]}` : ''}`,
              {
                method,
                headers,
                body: JSON.stringify({
                  ...body,
                  ...(entry.kind === 'policy'
                    ? { policyType: 'disallowed_actions', rules: { actions: ['financial_advice'] } }
                    : {}),
                }),
              }
            )
          ).status
        ).toBe(400);
      }
    }
    expect((await http.pool.query(`SELECT title FROM ${entry.table}`)).rows).toEqual([
      { title: entry.title },
    ]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_policy_%'")).rows
    ).toHaveLength(0);
    const response = await fetch(`${http.base}/api/admin/${entry.path}/${ids[entry.kind]}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ title: '  Trimmed title  ' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: 'Trimmed title' });
  }
);
it('rejects malformed and unknown membership payload fields', async () => {
  for (const body of [{ policyId: 'invalid' }, { policyId: ids.policy, unexpected: true }]) {
    expect(
      (
        await fetch(`${http.base}/api/admin/policy-groups/${ids.group}/members`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(400);
  }
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_policy_%'")).rows
  ).toHaveLength(0);
});
