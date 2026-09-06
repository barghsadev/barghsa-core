import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>,
  headers: Record<string, string>,
  agentId: string;
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
    "UPDATE ai_agent_slots SET agent_id=NULL; DELETE FROM ai_agents; DELETE FROM ai_models; DELETE FROM audit_log WHERE event LIKE 'ai_agent_slot_%'"
  );
  const model = (
    await http.pool.query(
      "INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by) VALUES ('Local','openai_compatible','https://example.test','test','slot-admin') RETURNING id"
    )
  ).rows[0].id;
  agentId = (
    await http.pool.query(
      "INSERT INTO ai_agents(title,description,model_id,created_by) VALUES ('Support','Test',$1,'slot-admin') RETURNING id",
      [model]
    )
  ).rows[0].id;
});
function assign(id: string | null, slot = 'individual_chatbot') {
  return fetch(`${http.base}/api/admin/agent-slots/${slot}/agent`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ agentId: id }),
  });
}
it.each(['assign', 'clear'] as const)('rolls back slot %s on audit failure', async (action) => {
  if (action === 'clear')
    await http.pool.query(
      "UPDATE ai_agent_slots SET agent_id=$1 WHERE slot_key='individual_chatbot'",
      [agentId]
    );
  await http.pool.query(
    "CREATE OR REPLACE FUNCTION reject_slot_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_slot_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'ai_agent_slot_%') EXECUTE FUNCTION reject_slot_audit()"
  );
  try {
    expect((await assign(action === 'assign' ? agentId : null)).status).toBe(500);
    expect(
      (
        await http.pool.query(
          "SELECT agent_id FROM ai_agent_slots WHERE slot_key='individual_chatbot'"
        )
      ).rows
    ).toEqual([{ agent_id: action === 'clear' ? agentId : null }]);
  } finally {
    await http.pool.query('DROP TRIGGER reject_slot_audit ON audit_log');
  }
});
it.each(['assign', 'clear'] as const)('rechecks current authority for slot %s', async (action) => {
  if (action === 'clear')
    await http.pool.query(
      "UPDATE ai_agent_slots SET agent_id=$1 WHERE slot_key='individual_chatbot'",
      [agentId]
    );
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='slot-admin' FOR UPDATE");
    pending = assign(action === 'assign' ? agentId : null);
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
    expect(
      (
        await http.pool.query(
          "SELECT agent_id FROM ai_agent_slots WHERE slot_key='individual_chatbot'"
        )
      ).rows
    ).toEqual([{ agent_id: action === 'clear' ? agentId : null }]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_slot_%'")).rows
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
it('reports cross-slot use and avoids duplicate assignment audits', async () => {
  expect((await assign(agentId)).status).toBe(200);
  const second = await assign(agentId, 'staff_chatbot');
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({
    agent: { id: agentId },
    alsoUsedIn: ['individual_chatbot'],
  });
  expect((await assign(agentId)).status).toBe(200);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_slot_%'")).rows
  ).toHaveLength(2);
  expect((await assign(null)).status).toBe(200);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='ai_agent_slot_cleared'")).rows
  ).toHaveLength(1);
});
it('refuses an agent deleted during assignment without writing an audit', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ai_agents WHERE id=$1', [agentId]);
    pending = assign(agentId);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE ai_agent_slots%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await pending).status).toBe(409);
    expect(
      (
        await http.pool.query(
          "SELECT agent_id FROM ai_agent_slots WHERE slot_key='individual_chatbot'"
        )
      ).rows
    ).toEqual([{ agent_id: null }]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_slot_%'")).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});

it('rejects unknown slot-assignment payload fields', async () => {
  expect(
    (
      await fetch(`${http.base}/api/admin/agent-slots/individual_chatbot/agent`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ agentId, unexpected: true }),
      })
    ).status
  ).toBe(400);
  expect(
    (
      await http.pool.query(
        "SELECT agent_id FROM ai_agent_slots WHERE slot_key='individual_chatbot'"
      )
    ).rows
  ).toEqual([{ agent_id: null }]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_agent_slot_%'")).rows
  ).toHaveLength(0);
});
