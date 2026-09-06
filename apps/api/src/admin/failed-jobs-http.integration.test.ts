import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-jobs','Jobs','Test role','["admin:jobs:view","admin:jobs:retry"]'),('test-jobs-view','View jobs','Test role','["admin:jobs:view"]')`
  );
  for (const [user, role] of [
    ['operator', 'test-jobs'],
    ['viewer', 'test-jobs-view'],
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
beforeEach(async () => {
  await http.pool.query('DELETE FROM background_jobs');
  await http.pool.query(
    "DELETE FROM audit_log WHERE event IN ('job_retry_requested','job_resolved')"
  );
});
function request(path = '', method = 'GET', body?: unknown, user = 'operator') {
  return fetch(`${http.base}/api/admin/failed-jobs${path}`, {
    method,
    headers: headers[user]!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function seed(type = 'storage_cleanup', status = 'failed', id = randomUUID()) {
  await http.pool.query(
    'INSERT INTO background_jobs(id,job_type,status,attempts,max_attempts,error) VALUES ($1,$2,$3,5,5,$4)',
    [id, type, status, 'Test transport failure']
  );
  return id;
}
async function row(id: string) {
  return (await http.pool.query('SELECT * FROM background_jobs WHERE id=$1', [id])).rows[0];
}
it('reports current independent view/retry capabilities and enforces authorization and step-up', async () => {
  expect((await fetch(`${http.base}/api/admin/failed-jobs`)).status).toBe(401);
  expect(await (await request('/access', 'GET', undefined, 'viewer')).json()).toEqual({
    canView: true,
    canRetry: false,
  });
  expect((await request('', 'GET', undefined, 'other')).status).toBe(403);
  const id = await seed();
  expect((await request(`/${id}/retry`, 'POST', {}, 'viewer')).status).toBe(403);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='operator'");
  expect((await request(`/${id}/retry`, 'POST', {})).status).toBe(403);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='operator'");
  const noCsrf = await fetch(`${http.base}/api/admin/failed-jobs/${id}/retry`, {
    method: 'POST',
    headers: { Cookie: headers.operator!.Cookie! },
  });
  expect(noCsrf.status).toBe(403);
});
it('filters and pages the migrated job table and rejects malformed input before SQL', async () => {
  await seed();
  await seed('auth_delivery', 'dead_letter');
  expect(await (await request('?status=dead_letter&jobType=auth_delivery')).json()).toMatchObject([
    { jobType: 'auth_delivery', status: 'dead_letter', attempts: 5 },
  ]);
  expect(await (await request('?limit=1&offset=1')).json()).toHaveLength(1);
  for (const query of [
    'limit=1&limit=2',
    'limit=1.5',
    'offset=',
    'offset=1000001',
    'status=bad',
    'jobType=bad',
  ])
    expect((await request(`?${query}`)).status).toBe(400);
  for (const path of ['/bad/retry', '/bad/resolve'])
    expect((await request(path, 'POST', {})).status).toBe(400);
  for (const body of [{ ids: [] }, { ids: ['bad'] }, { ids: [randomUUID()], unexpected: true }])
    expect((await request('/retry-bulk', 'POST', body)).status).toBe(400);
});
it('retries failed and exhausted jobs, resolves with actor attribution, and rejects terminal or missing single jobs', async () => {
  for (const status of ['failed', 'dead_letter']) {
    const id = await seed(status === 'failed' ? 'storage_cleanup' : 'auth_delivery', status);
    const retry = await request(`/${id}/retry`, 'POST', {});
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id, status: 'retrying', attempts: 1 });
    expect((await request(`/${id}/retry`, 'POST', {})).status).toBe(409);
    const resolved = await request(`/${id}/resolve`, 'POST', {});
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      id,
      status: 'resolved',
      resolvedById: 'operator',
      resolvedByUsername: 'operator@example.test',
    });
    expect((await request(`/${id}/resolve`, 'POST', {})).status).toBe(409);
    expect((await request(`/${id}/retry`, 'POST', {})).status).toBe(409);
  }
  expect((await request(`/${randomUUID()}/retry`, 'POST', {})).status).toBe(404);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event IN ('job_retry_requested','job_resolved')"
      )
    ).rows
  ).toHaveLength(4);
});
it('deduplicates bulk retry, skips missing/terminal jobs, and rolls the entire batch back on audit failure', async () => {
  const first = await seed('storage_cleanup', 'failed', '10000000-0000-4000-8000-000000000001');
  const second = await seed('auth_delivery', 'dead_letter', '10000000-0000-4000-8000-000000000002');
  const resolved = await seed('service_breach_scan', 'resolved');
  await http.pool.query(
    `CREATE FUNCTION reject_job_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_job_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='job_retry_requested' AND NEW.metadata::jsonb->>'backgroundJobId'='10000000-0000-4000-8000-000000000002') EXECUTE FUNCTION reject_job_audit()`
  );
  try {
    expect((await request('/retry-bulk', 'POST', { ids: [first, second] })).status).toBe(500);
    expect((await row(first)).status).toBe('failed');
    expect((await row(second)).status).toBe('dead_letter');
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='job_retry_requested'")).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query('DROP TRIGGER reject_job_audit ON audit_log');
  }
  const response = await request('/retry-bulk', 'POST', {
    ids: [second, first, first, resolved, randomUUID()],
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject([
    { id: first, status: 'retrying' },
    { id: second, status: 'retrying' },
  ]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='job_retry_requested'")).rows
  ).toHaveLength(2);
});
it('rejects a permission revoked after the guard and releases its transaction without changing jobs', async () => {
  const id = await seed(),
    client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='operator' FOR UPDATE");
    pending = request(`/${id}/retry`, 'POST', {});
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
    expect((await row(id)).status).toBe('failed');
    expect((await request('/access')).status).toBe(200);
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
      "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-jobs') ON CONFLICT DO NOTHING"
    );
  }
});
