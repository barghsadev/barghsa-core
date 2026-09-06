import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>,
  headers: Record<string, string>,
  agentId: string,
  modelId: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('slot-editor','Slot editor','Test','["admin:ai:agents"]'); INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('slot-admin','slot-admin@example.test','test-only',true); INSERT INTO user_roles(user_id,role_id) VALUES ('slot-admin','slot-editor')`
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'slot-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
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
    "UPDATE ai_agent_slots SET agent_id=NULL; DELETE FROM ai_agents; DELETE FROM ai_models; DELETE FROM audit_log WHERE event LIKE 'ai_agent_%'"
  );
  modelId = (
    await http.pool.query(
      "INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by) VALUES ('Local','openai_compatible','https://example.test','test','slot-admin') RETURNING id"
    )
  ).rows[0].id;
  agentId = (
    await http.pool.query(
      "INSERT INTO ai_agents(title,description,model_id,created_by) VALUES ('Support','Test',$1,'slot-admin') RETURNING id",
      [modelId]
    )
  ).rows[0].id;
});

function mutation(action: 'create' | 'update' | 'delete') {
  return fetch(`${http.base}/api/admin/agents${action === 'create' ? '' : `/${agentId}`}`, {
    method: action === 'create' ? 'POST' : action === 'update' ? 'PUT' : 'DELETE',
    headers,
    ...(action === 'delete'
      ? {}
      : {
          body: JSON.stringify({
            title: 'Changed agent',
            ...(action === 'create' ? { modelId, kbIds: [], policyIds: [] } : {}),
          }),
        }),
  });
}
it.each(['create', 'update', 'delete'] as const)(
  'rolls back agent %s on audit failure',
  async (action) => {
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_agent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_agent_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'ai_agent_%') EXECUTE FUNCTION reject_agent_audit()"
    );
    try {
      expect((await mutation(action)).status).toBe(500);
      expect((await http.pool.query('SELECT id,title FROM ai_agents')).rows).toEqual([
        { id: agentId, title: 'Support' },
      ]);
    } finally {
      await http.pool.query('DROP TRIGGER reject_agent_audit ON audit_log');
    }
  }
);
it.each(['create', 'update', 'delete'] as const)('rechecks agent %s authority', async (action) => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='slot-admin' FOR UPDATE");
    pending = mutation(action);
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
    await client.query("DELETE FROM user_roles WHERE user_id='slot-admin'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect((await http.pool.query('SELECT id,title FROM ai_agents')).rows).toEqual([
      { id: agentId, title: 'Support' },
    ]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_%'")).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('slot-admin','slot-editor') ON CONFLICT DO NOTHING"
    );
  }
});
it('persists agent CRUD with audit entries', async () => {
  expect((await mutation('create')).status).toBe(201);
  expect((await mutation('update')).status).toBe(200);
  expect((await mutation('delete')).status).toBe(204);
  expect((await http.pool.query('SELECT title FROM ai_agents')).rows).toEqual([
    { title: 'Changed agent' },
  ]);
  expect(
    (
      await http.pool.query(
        "SELECT event FROM audit_log WHERE event LIKE 'ai_agent_%' ORDER BY created_at,id"
      )
    ).rows.map((row) => row.event)
  ).toEqual(['ai_agent_created', 'ai_agent_updated', 'ai_agent_deleted']);
});

it('audits the latest enabled state after a concurrent edit', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('UPDATE ai_agents SET enabled=false WHERE id=$1', [agentId]);
    pending = fetch(`${http.base}/api/admin/agents/${agentId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: true }),
    });
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM ai_agents%FOR UPDATE%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await pending).status).toBe(200);
    expect(
      (
        await http.pool.query(
          "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='ai_agent_updated'"
        )
      ).rows
    ).toEqual([
      {
        metadata: expect.objectContaining({
          enabledBefore: false,
          enabledAfter: true,
          changedFields: ['enabled'],
        }),
      },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});

const linkCases = (['kb', 'policy'] as const).flatMap((kind) =>
  (['add', 'remove'] as const).map((action) => ({ kind, action }))
);
async function prepareLink(entry: (typeof linkCases)[number]) {
  const id =
    entry.kind === 'kb'
      ? ((
          await http.pool.query(
            "INSERT INTO knowledge_bases(title,created_by) VALUES ('Agent KB','slot-admin') RETURNING id"
          )
        ).rows[0].id as string)
      : ((
          await http.pool.query(
            `INSERT INTO ai_policies(title,policy_type,rules,created_by) VALUES ('Agent policy','allowed_topics','{"topics":["energy"]}','slot-admin') RETURNING id`
          )
        ).rows[0].id as string);
  if (entry.action === 'remove')
    await http.pool.query(
      `INSERT INTO ${entry.kind === 'kb' ? 'ai_agent_kbs' : 'ai_agent_policies'}(agent_id,${entry.kind === 'kb' ? 'kb_id' : 'policy_id'}) VALUES ($1,$2)`,
      [agentId, id]
    );
  return id;
}
function linkRequest(entry: (typeof linkCases)[number], id: string) {
  return fetch(
    `${http.base}/api/admin/agents/${agentId}/${entry.kind === 'kb' ? 'kbs' : 'policies'}${entry.action === 'remove' ? `/${id}` : ''}`,
    {
      method: entry.action === 'add' ? 'POST' : 'DELETE',
      headers,
      ...(entry.action === 'add'
        ? { body: JSON.stringify(entry.kind === 'kb' ? { kbId: id } : { policyId: id }) }
        : {}),
    }
  );
}
async function unchangedLink(entry: (typeof linkCases)[number]) {
  expect(
    (
      await http.pool.query(
        `SELECT agent_id FROM ${entry.kind === 'kb' ? 'ai_agent_kbs' : 'ai_agent_policies'} WHERE agent_id=$1`,
        [agentId]
      )
    ).rows
  ).toHaveLength(entry.action === 'remove' ? 1 : 0);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_%'")).rows
  ).toHaveLength(0);
}
it.each(linkCases)('rolls back agent $kind $action links on audit failure', async (entry) => {
  const id = await prepareLink(entry);
  await http.pool.query(
    "CREATE OR REPLACE FUNCTION reject_agent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_agent_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'ai_agent_%') EXECUTE FUNCTION reject_agent_audit()"
  );
  try {
    expect((await linkRequest(entry, id)).status).toBe(500);
    await unchangedLink(entry);
  } finally {
    await http.pool.query('DROP TRIGGER reject_agent_audit ON audit_log');
  }
});
it.each(linkCases)('rechecks agent $kind $action link authority', async (entry) => {
  const id = await prepareLink(entry),
    client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='slot-admin' FOR UPDATE");
    pending = linkRequest(entry, id);
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
    await client.query("DELETE FROM user_roles WHERE user_id='slot-admin'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    await unchangedLink(entry);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('slot-admin','slot-editor') ON CONFLICT DO NOTHING"
    );
  }
});
it.each(['kb', 'policy'] as const)(
  'adds and removes %s links with one audit per change',
  async (kind) => {
    const id = await prepareLink({ kind, action: 'add' });
    expect((await linkRequest({ kind, action: 'add' }, id)).status).toBe(204);
    expect((await linkRequest({ kind, action: 'add' }, id)).status).toBe(204);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_%'")).rows
    ).toHaveLength(1);
    expect((await linkRequest({ kind, action: 'remove' }, id)).status).toBe(204);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_%'")).rows
    ).toHaveLength(2);
    expect(
      (
        await http.pool.query(
          `SELECT id FROM ${kind === 'kb' ? 'knowledge_bases' : 'ai_policies'} WHERE id=$1`,
          [id]
        )
      ).rows
    ).toHaveLength(1);
  }
);

it('rejects blank titles and unexpected agent fields without mutations', async () => {
  for (const body of [{ title: '   ' }, { title: 'Valid', unexpected: true }]) {
    for (const method of ['POST', 'PUT']) {
      expect(
        (
          await fetch(`${http.base}/api/admin/agents${method === 'PUT' ? `/${agentId}` : ''}`, {
            method,
            headers,
            body: JSON.stringify({ ...body, ...(method === 'POST' ? { modelId } : {}) }),
          })
        ).status
      ).toBe(400);
    }
  }
  expect((await http.pool.query('SELECT title FROM ai_agents')).rows).toEqual([
    { title: 'Support' },
  ]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_%'")).rows
  ).toHaveLength(0);
  const response = await fetch(`${http.base}/api/admin/agents/${agentId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ title: '  Trimmed agent  ' }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ title: 'Trimmed agent' });
});
it.each(['kb', 'policy'] as const)('rejects unknown %s link payload fields', async (kind) => {
  const id = await prepareLink({ kind, action: 'add' });
  expect(
    (
      await fetch(
        `${http.base}/api/admin/agents/${agentId}/${kind === 'kb' ? 'kbs' : 'policies'}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...(kind === 'kb' ? { kbId: id } : { policyId: id }),
            unexpected: true,
          }),
        }
      )
    ).status
  ).toBe(400);
  await unchangedLink({ kind, action: 'add' });
});
