import { createRequire } from 'node:module';
import { createStorageProvider, type StorageProvider } from '@barghsa/shared/storage';
import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>,
  headers: Record<string, string>,
  templateId: string;
const requireWorker = createRequire(require.resolve('@barghsa/worker/package.json'));
const { cleanupStorageObjects } = requireWorker('./dist/storage/cleanup.js') as {
  cleanupStorageObjects(
    pool: typeof http.pool,
    storage: StorageProvider
  ): Promise<{ deleted: number; failed: number }>;
};
let cleanupProvider: StorageProvider;
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
  cleanupProvider = createStorageProvider({
    type: 's3',
    bucket: 'test-evidence',
    region: 'test',
    endpoint: `http://127.0.0.1:${address.port}`,
    accessKeyId: 'test',
    secretAccessKey: 'test',
    forcePathStyle: true,
  });
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
    "DELETE FROM contract_template_versions; DELETE FROM contract_templates; DELETE FROM storage_records; DELETE FROM audit_log WHERE event='change_recorded'"
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
      if (action === 'upload') {
        const records = (await http.pool.query('SELECT status,metadata FROM storage_records')).rows;
        expect(records).toMatchObject([
          { status: 'removed', metadata: { provisionalCopy: true, deletionRequested: true } },
        ]);
        expect(objects.size).toBe(1);
        await http.pool.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
        expect(await cleanupStorageObjects(http.pool, cleanupProvider)).toEqual({
          deleted: 1,
          failed: 0,
        });
      }
      expect(objects.size).toBe(0);
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

it('returns complete ordered immutable version metadata after later uploads', async () => {
  const first = await (await mutation('upload')).json();
  const secondResponse = await fetch(
    `${http.base}/api/admin/contract-templates/${templateId}/versions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: 'revision.txt', content: '{{date}} {{amount}}' }),
    }
  );
  expect(secondResponse.status).toBe(201);
  const second = await secondResponse.json();
  const response = await fetch(`${http.base}/api/admin/contract-templates/${templateId}`, {
    headers,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    versionCount: 2,
    latestVersion: second,
    versions: [first, second],
  });
  expect(objects.size).toBe(2);
});
it.each([
  ['POST', '', { name: '   ' }],
  ['POST', '', { name: 'New', unexpected: true }],
  ['PATCH', '/id', { name: '  ' }],
  ['PATCH', '/id', { status: 'inactive', unexpected: true }],
  ['POST', '/id/versions', { fileName: 'a.txt', content: 'Test', unexpected: true }],
] as const)('rejects invalid template payload %s %s %j', async (method, suffix, body) => {
  const response = await fetch(
    `${http.base}/api/admin/contract-templates${suffix.replace('/id', `/${templateId}`)}`,
    { method, headers, body: JSON.stringify(body) }
  );
  expect(response.status).toBe(400);
  expect((await http.pool.query('SELECT name FROM contract_templates')).rows).toEqual([
    { name: 'Original' },
  ]);
  expect(objects.size).toBe(0);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='change_recorded'")).rows
  ).toHaveLength(0);
});

it('accepts a 10 MiB template and rejects a larger decoded file before storage', async () => {
  const upload = (content: string) =>
    fetch(`${http.base}/api/admin/contract-templates/${templateId}/versions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: 'large.txt', content }),
    });
  const response = await upload('x'.repeat(10 * 1024 * 1024));
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ fileSize: 10 * 1024 * 1024 });
  expect((await upload('x'.repeat(10 * 1024 * 1024 + 1))).status).toBe(413);
  expect(objects.size).toBe(1);
  expect((await http.pool.query('SELECT id FROM contract_template_versions')).rows).toHaveLength(1);
}, 15000);
it('retains the ordinary JSON body limit outside version uploads', async () => {
  const response = await fetch(`${http.base}/api/admin/contract-templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Oversized', description: 'x'.repeat(120 * 1024) }),
  });
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({
    error: { code: 'VALIDATION:INPUT:PAYLOAD_TOO_LARGE', message: 'The request is too large' },
  });
  expect((await http.pool.query('SELECT name FROM contract_templates')).rows).toEqual([
    { name: 'Original' },
  ]);
});

it('makes committed version files immutable and ineligible for cleanup', async () => {
  expect((await mutation('upload')).status).toBe(201);
  const records = (await http.pool.query('SELECT status,signed_by,metadata FROM storage_records'))
    .rows;
  expect(records).toMatchObject([
    {
      status: 'immutable',
      signed_by: 'template-admin',
      metadata: { purpose: 'contract_template', templateId, uploadedBy: 'template-admin' },
    },
  ]);
  await http.pool.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
  expect(await cleanupStorageObjects(http.pool, cleanupProvider)).toEqual({
    deleted: 0,
    failed: 0,
  });
  expect(objects.size).toBe(1);
});
it('does not write storage when the durable reservation cannot commit', async () => {
  await http.pool.query(
    "CREATE FUNCTION reject_template_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test reservation failure'; END $$; CREATE TRIGGER reject_template_reservation BEFORE INSERT ON storage_records FOR EACH ROW EXECUTE FUNCTION reject_template_reservation()"
  );
  try {
    expect((await mutation('upload')).status).toBe(500);
    expect(objects.size).toBe(0);
    expect((await http.pool.query('SELECT id FROM contract_template_versions')).rows).toEqual([]);
  } finally {
    await http.pool.query('DROP TRIGGER reject_template_reservation ON storage_records');
  }
});
