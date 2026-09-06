import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>,
  headers: Record<string, string>,
  templateId: string;
const objects = new Set<string>();
const storage = createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  if (req.method === 'PUT') objects.add(new URL(req.url!, 'http://localhost').pathname);
  if (req.method === 'DELETE') objects.delete(new URL(req.url!, 'http://localhost').pathname);
  res.writeHead(200).end();
});
beforeAll(async () => {
  storage.listen(0, '127.0.0.1');
  await once(storage, 'listening');
  const address = storage.address() as { port: number };
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, `http://127.0.0.1:${address.port}`);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('template-editor','Slot editor','Test','["admin:documents:edit"]'); INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('template-admin','template-admin@example.test','test-only',true); INSERT INTO user_roles(user_id,role_id) VALUES ('template-admin','template-editor')`
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'template-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
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
  await new Promise<void>((resolve) => storage.close(() => resolve()));
});
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM contract_template_versions; DELETE FROM contract_templates; DELETE FROM audit_log WHERE event='change_recorded'"
  );
  objects.clear();
  templateId = (
    await http.pool.query(
      "INSERT INTO contract_templates(name,created_by) VALUES ('Original','template-admin') RETURNING id"
    )
  ).rows[0].id;
});
function mutation(action: 'create' | 'update' | 'delete' | 'upload') {
  return fetch(
    `${http.base}/api/admin/contract-templates${action === 'create' ? '' : `/${templateId}`}${action === 'upload' ? '/versions' : ''}`,
    {
      method:
        action === 'create' || action === 'upload'
          ? 'POST'
          : action === 'update'
            ? 'PATCH'
            : 'DELETE',
      headers,
      ...(action === 'delete'
        ? {}
        : {
            body: JSON.stringify(
              action === 'upload'
                ? {
                    fileName: 'contract.txt',
                    contentType: 'text/plain',
                    content: 'Dear {{customerName}}',
                  }
                : { name: action === 'create' ? 'Second template' : 'Changed template' }
            ),
          }),
    }
  );
}
it.each(['create', 'update', 'delete', 'upload'] as const)(
  'rolls back template %s on audit failure',
  async (action) => {
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_template_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_template_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event = 'change_recorded') EXECUTE FUNCTION reject_template_audit()"
    );
    try {
      expect((await mutation(action)).status).toBe(500);
      expect((await http.pool.query('SELECT id,name FROM contract_templates')).rows).toEqual([
        { id: templateId, name: 'Original' },
      ]);
      expect(
        (await http.pool.query('SELECT id FROM contract_template_versions')).rows
      ).toHaveLength(0);
      await expect.poll(() => objects.size).toBe(0);
    } finally {
      await http.pool.query('DROP TRIGGER reject_template_audit ON audit_log');
    }
  }
);
it.each(['create', 'update', 'delete', 'upload'] as const)(
  'rechecks template %s authority',
  async (action) => {
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='template-admin' FOR UPDATE");
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
      await client.query("DELETE FROM user_roles WHERE user_id='template-admin'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect((await http.pool.query('SELECT id,name FROM contract_templates')).rows).toEqual([
        { id: templateId, name: 'Original' },
      ]);
      expect(
        (await http.pool.query('SELECT id FROM contract_template_versions')).rows
      ).toHaveLength(0);
      await expect.poll(() => objects.size).toBe(0);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('template-admin','template-editor') ON CONFLICT DO NOTHING"
      );
    }
  }
);

it('preserves a concurrent metadata edit when changing another field', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query(
      "UPDATE contract_templates SET description='Concurrent description' WHERE id=$1",
      [templateId]
    );
    pending = mutation('update');
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM contract_templates%FOR UPDATE%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await pending).status).toBe(200);
    expect(
      (
        await http.pool.query('SELECT name,description FROM contract_templates WHERE id=$1', [
          templateId,
        ])
      ).rows
    ).toEqual([{ name: 'Changed template', description: 'Concurrent description' }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});
it('persists metadata and version history and protects versioned deletion', async () => {
  expect((await mutation('create')).status).toBe(201);
  expect((await mutation('update')).status).toBe(200);
  const uploaded = await mutation('upload');
  expect(uploaded.status).toBe(201);
  expect(await uploaded.json()).toMatchObject({ versionNumber: 1, placeholders: ['customerName'] });
  expect((await mutation('delete')).status).toBe(409);
  expect(objects.size).toBe(1);
});
