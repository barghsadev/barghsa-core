import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, 'http://127.0.0.1:1');
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-upload-policy','Upload policy','Test role','["admin:uploads:edit"]')`
  );
  for (const user of ['operator', 'other']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
      [user, `${user}@example.test`]
    );
    if (user === 'operator')
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ($1,'test-upload-policy')",
        [user]
      );
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
function request(path = '', method = 'GET', body?: unknown, user = 'operator') {
  return fetch(`${http.base}/api/admin/upload-policies${path}`, {
    method,
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const policy = { category: 'document', allowedExtensions: ['.pdf'], maxSizeBytes: 1048576 };
it('enforces current capabilities, CSRF, step-up and deployment-safe input', async () => {
  expect((await fetch(`${http.base}/api/admin/upload-policies`)).status).toBe(401);
  expect(await (await request('/access', 'GET', undefined, 'other')).json()).toEqual({
    canEdit: false,
  });
  for (const path of ['', '/limits'])
    expect((await request(path, 'GET', undefined, 'other')).status).toBe(403);
  expect((await request('', 'POST', policy, 'other')).status).toBe(403);
  expect(
    (
      await fetch(`${http.base}/api/admin/upload-policies`, {
        method: 'POST',
        headers: { Cookie: headers.operator!.Cookie!, 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      })
    ).status
  ).toBe(403);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='operator'");
  expect((await request('', 'POST', policy)).status).toBe(403);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='operator'");
  const limits = (await (await request('/limits')).json()) as Array<{
    category: string;
    allowedExtensions: string[];
    maxSizeBytes: number;
  }>;
  const document = limits.find((item) => item.category === 'document')!;
  expect(document.allowedExtensions).toContain('.pdf');
  for (const body of [
    { ...policy, allowedExtensions: ['.exe'] },
    { ...policy, maxSizeBytes: document.maxSizeBytes + 1 },
    { ...policy, unexpected: true },
  ])
    expect((await request('', 'POST', body)).status).toBe(400);
  expect((await request('/bad/end', 'POST', {})).status).toBe(400);
  expect((await request('?category=bad')).status).toBe(400);
});
it('versions policy changes, preserves history and enforces them during real upload URL issuance', async () => {
  const first = await request('', 'POST', policy);
  expect(first.status).toBe(201);
  const created = (await first.json()) as { id: string };
  const repeated = await request('', 'POST', policy);
  expect(((await repeated.json()) as { id: string }).id).toBe(created.id);
  const second = await request('', 'POST', { ...policy, maxSizeBytes: 2048 });
  expect(second.status).toBe(201);
  const current = (await second.json()) as { id: string };
  const rows = (await (await request('?category=document')).json()) as Array<{
    id: string;
    status: string;
    createdBy: string;
  }>;
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === created.id)?.status).toBe('expired');
  expect(rows.find((row) => row.id === current.id)).toMatchObject({
    status: 'current',
    createdBy: 'operator',
  });
  const presign = (fileSize: number) =>
    fetch(`${http.base}/api/upload/presigned-url`, {
      method: 'POST',
      headers: headers.operator!,
      body: JSON.stringify({
        fileName: 'test.pdf',
        contentType: 'application/pdf',
        fileSize,
        category: 'document',
      }),
    });
  expect((await presign(3000)).status).toBe(400);
  expect((await presign(1024)).status).toBe(200);
  expect((await request(`/${current.id}/end`, 'POST', {})).status).toBe(200);
  expect((await presign(3000)).status).toBe(200);
  expect((await request(`/${current.id}/end`, 'POST', {})).status).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='change_recorded' AND metadata::jsonb->>'entity'='upload_policy'"
      )
    ).rows
  ).toHaveLength(3);
});
it('rolls version closure back if the replacement audit fails', async () => {
  const first = await request('', 'POST', {
    ...policy,
    category: 'image',
    allowedExtensions: ['.png'],
  });
  expect(first.status).toBe(201);
  const created = (await first.json()) as { id: string };
  await http.pool.query(
    `CREATE FUNCTION reject_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_policy_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='change_recorded' AND NEW.metadata::jsonb->>'entity'='upload_policy') EXECUTE FUNCTION reject_policy_audit()`
  );
  try {
    expect(
      (
        await request('', 'POST', {
          ...policy,
          category: 'image',
          allowedExtensions: ['.png'],
          maxSizeBytes: 2048,
        })
      ).status
    ).toBe(500);
    const rows = (await (await request('?category=image')).json()) as Array<{
      id: string;
      status: string;
    }>;
    expect(rows).toEqual([expect.objectContaining({ id: created.id, status: 'current' })]);
  } finally {
    await http.pool.query('DROP TRIGGER reject_policy_audit ON audit_log');
  }
});
it('rejects authority revoked while waiting for the actor lock', async () => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='operator' FOR UPDATE");
    pending = request('', 'POST', { ...policy, category: 'video', allowedExtensions: ['.mp4'] });
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
    await client.query("DELETE FROM user_roles WHERE user_id='operator'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect(
      (await http.pool.query("SELECT id FROM upload_policies WHERE category='video'")).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-upload-policy') ON CONFLICT DO NOTHING"
    );
  }
});

it('never issues an upload URL when the saved policy cannot be read', async () => {
  const input = {
    fileName: 'policy.pdf',
    contentType: 'application/pdf',
    fileSize: 3000,
    category: 'document',
  };
  const presign = () =>
    fetch(`${http.base}/api/upload/presigned-url`, {
      method: 'POST',
      headers: headers.operator!,
      body: JSON.stringify(input),
    });
  const before = Number(
    (await http.pool.query('SELECT COUNT(*) AS count FROM storage_records')).rows[0].count
  );
  await http.pool.query(
    'ALTER TABLE upload_policies RENAME TO upload_policies_fixture_unavailable'
  );
  try {
    const response = await presign();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('presignedUrl');
    expect(
      Number((await http.pool.query('SELECT COUNT(*) AS count FROM storage_records')).rows[0].count)
    ).toBe(before);
  } finally {
    await http.pool.query(
      'ALTER TABLE upload_policies_fixture_unavailable RENAME TO upload_policies'
    );
  }
  expect((await presign()).status).not.toBe(503);
});
