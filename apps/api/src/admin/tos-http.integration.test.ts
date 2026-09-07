import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const draft = { versionId: 'review-v1', contentFa: 'شرایط آزمایشی', contentEn: 'Test terms' };

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('tos-editor','Terms editor','Test role','[\"admin:tos:edit\"]')"
  );
  for (const actor of ['editor', 'other']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
      [actor, `${actor}@example.test`]
    );
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour')",
      [session, actor, csrf, randomUUID()]
    );
    headers[actor] = {
      cookie: `barghsa_session=${session}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    };
  }
}, 40000);
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM user_roles WHERE user_id='other'; DELETE FROM tos_acceptances; UPDATE users SET last_accepted_tos_version=NULL; DELETE FROM tos_versions; DELETE FROM audit_log WHERE event='tos_updated'; INSERT INTO user_roles(user_id,role_id) VALUES ('editor','tos-editor') ON CONFLICT DO NOTHING"
  );
});
afterAll(async () => {
  await http?.close();
}, 15000);
function request(path = '', method = 'GET', body?: unknown, actor = 'editor') {
  return fetch(`${http.base}/api/admin/tos/versions${path}`, {
    method,
    headers: headers[actor]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function create() {
  const response = await request('', 'POST', draft);
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

it('audits draft create, edit, publication and discard with current actor context', async () => {
  expect((await request('', 'POST', draft, 'other')).status).toBe(403);
  const { id } = await create();
  expect((await request(`/${id}`, 'PUT', { contentEn: 'Edited terms' })).status).toBe(200);
  expect((await request(`/${id}/publish`, 'POST', { changeType: 'major' })).status).toBe(200);
  expect((await request(`/${id}`, 'PUT', { contentEn: 'Forbidden edit' })).status).toBe(400);
  expect((await request(`/${id}`, 'DELETE')).status).toBe(400);
  const next = await request('', 'POST', { ...draft, versionId: 'review-v2' });
  expect(next.status).toBe(201);
  const second = (await next.json()) as { id: string };
  expect((await request(`/${second.id}`, 'DELETE')).status).toBe(204);
  const audits = (
    await http.pool.query(
      "SELECT user_id,metadata::jsonb->>'action' AS action,ip FROM audit_log WHERE event='tos_updated' ORDER BY created_at,id"
    )
  ).rows;
  expect(audits.map((row) => row.action)).toEqual([
    'create',
    'edit',
    'publish',
    'create',
    'discard',
  ]);
  expect(
    audits.every((row) => row.user_id === 'editor' && row.ip !== 'admin' && row.ip !== 'unknown')
  ).toBe(true);
});

it('rolls all draft changes back when their audit cannot be recorded', async () => {
  const { id } = await create();
  await http.pool.query(
    "CREATE FUNCTION reject_tos_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_tos_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='tos_updated') EXECUTE FUNCTION reject_tos_audit()"
  );
  try {
    for (const [path, method, body] of [
      [`/${id}`, 'PUT', { contentEn: 'Must roll back' }],
      [`/${id}/publish`, 'POST', { changeType: 'major' }],
      [`/${id}`, 'DELETE', undefined],
    ] as const) {
      expect((await request(path, method, body)).status).toBe(500);
      expect(
        (await http.pool.query('SELECT content_en,status FROM tos_versions WHERE id=$1', [id])).rows
      ).toEqual([{ content_en: draft.contentEn, status: 'draft' }]);
    }
    await http.pool.query('DELETE FROM tos_versions WHERE id=$1', [id]);
    expect((await request('', 'POST', draft)).status).toBe(500);
    expect((await http.pool.query('SELECT id FROM tos_versions')).rows).toHaveLength(0);
  } finally {
    await http.pool.query('DROP TRIGGER reject_tos_audit ON audit_log');
  }
});

it('creates only one draft under concurrent requests from different editors', async () => {
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('other','tos-editor')");
  const responses = await Promise.all(
    Array.from({ length: 5 }, (_, n) =>
      request('', 'POST', { ...draft, versionId: `concurrent-${n}` }, n % 2 ? 'other' : 'editor')
    )
  );
  expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(4);
  expect(
    (await http.pool.query("SELECT id FROM tos_versions WHERE status='draft'")).rows
  ).toHaveLength(1);
});

it('rejects editor authority revoked while a draft mutation waits for the actor lock', async () => {
  const { id } = await create();
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='editor' FOR UPDATE");
    pending = request(`/${id}`, 'PUT', { contentEn: 'Must not save' });
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
    await client.query("DELETE FROM user_roles WHERE user_id='editor'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect(
      (await http.pool.query('SELECT content_en FROM tos_versions WHERE id=$1', [id])).rows[0]
        .content_en
    ).toBe(draft.contentEn);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});
