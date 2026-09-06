import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let ids: { kb: string; group: string };
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('kb-editor','KB editor','Test role','[\"admin:ai:kb\"]')"
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('kb-admin','kb-admin@example.test','test-only',true)"
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('kb-admin','kb-editor')");
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'kb-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
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
    "DELETE FROM knowledge_bases; DELETE FROM kb_groups; DELETE FROM audit_log WHERE event LIKE 'kb_%'"
  );
  ids = {
    kb: (
      await http.pool.query(
        "INSERT INTO knowledge_bases(title,description,created_by) VALUES ('Original KB','original','kb-admin') RETURNING id"
      )
    ).rows[0].id,
    group: (
      await http.pool.query(
        "INSERT INTO kb_groups(title,description,created_by) VALUES ('Original group','original','kb-admin') RETURNING id"
      )
    ).rows[0].id,
  };
  await http.pool.query('INSERT INTO kb_group_members(group_id,kb_id) VALUES ($1,$2)', [
    ids.group,
    ids.kb,
  ]);
});
const entities = [
  { kind: 'kb', table: 'knowledge_bases', path: 'knowledge-bases', title: 'Original KB' },
  { kind: 'group', table: 'kb_groups', path: 'kb-groups', title: 'Original group' },
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
        : { body: JSON.stringify({ title: 'Changed', description: 'changed' }) }),
    }
  );
}
it.each(cases)('rolls back $kind $action and cascades when the audit fails', async (entry) => {
  await http.pool.query(
    "CREATE OR REPLACE FUNCTION reject_kb_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test KB audit failure'; END $$; CREATE TRIGGER reject_kb_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'kb_%') EXECUTE FUNCTION reject_kb_audit()"
  );
  try {
    expect((await request(entry)).status).toBe(500);
    expect((await http.pool.query(`SELECT id,title,description FROM ${entry.table}`)).rows).toEqual(
      [{ id: ids[entry.kind], title: entry.title, description: 'original' }]
    );
    expect((await http.pool.query('SELECT group_id,kb_id FROM kb_group_members')).rows).toEqual([
      { group_id: ids.group, kb_id: ids.kb },
    ]);
  } finally {
    await http.pool.query('DROP TRIGGER reject_kb_audit ON audit_log');
  }
});
it.each(cases)('rechecks current authority for $kind $action', async (entry) => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='kb-admin' FOR UPDATE");
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
    await client.query("DELETE FROM user_roles WHERE user_id='kb-admin'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect((await http.pool.query(`SELECT id,title FROM ${entry.table}`)).rows).toEqual([
      { id: ids[entry.kind], title: entry.title },
    ]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
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
      "INSERT INTO user_roles(user_id,role_id) VALUES ('kb-admin','kb-editor') ON CONFLICT DO NOTHING"
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
      ...(entry.kind === 'kb' ? { documentCount: 0, groupCount: 1 } : { memberCount: 1 }),
    });
    expect((await request({ ...entry, action: 'delete' })).status).toBe(204);
    expect((await http.pool.query('SELECT * FROM kb_group_members')).rows).toHaveLength(0);
    expect(
      (
        await http.pool.query(
          `SELECT id FROM ${entry.kind === 'kb' ? 'kb_groups' : 'knowledge_bases'}`
        )
      ).rows
    ).toHaveLength(1);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
    ).toHaveLength(3);
  }
);
