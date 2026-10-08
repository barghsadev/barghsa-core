import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<'job-owner' | 'job-other', Record<string, string>> = {
  'job-owner': {},
  'job-other': {},
};
const id = randomUUID();

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['job-owner', 'job-other'] as const) {
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,'test-only')`,
      [user, `${user}@example.test`]
    );
    const sessionId = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES ($1,$2,$3,$4,now()+interval '1 day',now()+interval '1 hour')`,
      [sessionId, user, csrf, randomUUID()]
    );
    headers[user] = { cookie: `barghsa_session=${sessionId}`, 'x-csrf-token': csrf };
  }
  await http.pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by) VALUES ($1,'test-export','{}','job-owner')`,
    [id]
  );
}, 30_000);

afterAll(async () => {
  await http?.close();
});

it.each(['/\\outside.test', '/%5coutside.test', '/%255coutside.test'])(
  'refuses a completed job result that escapes the application: %s',
  async (resultUrl) => {
    const unsafeId = randomUUID();
    await http.pool.query(
      "INSERT INTO async_jobs(id,type,payload,created_by,status,progress_pct,result_url) VALUES ($1,'test-export','{}','job-owner','completed',100,$2)",
      [unsafeId, resultUrl]
    );
    const result = await fetch(http.base + '/api/jobs/' + unsafeId + '/result', {
      headers: headers['job-owner'],
      redirect: 'manual',
    });
    expect(result.status).toBe(204);
    expect(result.headers.get('location')).toBeNull();
  }
);

it('keeps job payload and status private to the submitting user', async () => {
  const path = `${http.base}/api/jobs/${id}`;
  const owner = await fetch(path, { headers: headers['job-owner'] });
  expect(owner.status).toBe(200);
  const body = await owner.json();
  expect(body).not.toHaveProperty('payload');
  expect(body).toMatchObject({
    id,
    type: 'test-export',
    status: 'queued',
    progress_pct: 0,
  });
  expect((await fetch(`${path}/status`, { headers: headers['job-owner'] })).status).toBe(200);
  expect((await fetch(path, { headers: headers['job-other'] })).status).toBe(404);
  expect((await fetch(path)).status).toBe(401);
  expect((await fetch(`${path}/result`, { headers: headers['job-owner'] })).status).toBe(202);
});

it('redirects only a completed owner result and lets the owner retry a failed job', async () => {
  const path = `${http.base}/api/jobs/${id}`;
  await http.pool.query(
    `UPDATE async_jobs SET status='completed',progress_pct=100,result_url='/account',completed_at=now() WHERE id=$1`,
    [id]
  );
  const result = await fetch(`${path}/result`, {
    headers: headers['job-owner'],
    redirect: 'manual',
  });
  expect(result.status).toBe(302);
  expect(result.headers.get('location')).toBe('/account');
  expect((await fetch(`${path}/result`, { headers: headers['job-other'] })).status).toBe(404);
  await http.pool.query(
    `UPDATE async_jobs SET status='failed',result_url=NULL,error_message='JOB_FAILED',completed_at=now() WHERE id=$1`,
    [id]
  );
  expect((await fetch(`${path}/result`, { headers: headers['job-owner'] })).status).toBe(409);
  expect(
    (await fetch(`${path}/retry`, { method: 'POST', headers: headers['job-other'] })).status
  ).toBe(404);
  const retry = await fetch(`${path}/retry`, { method: 'POST', headers: headers['job-owner'] });
  expect(retry.status).toBe(202);
  expect(await retry.json()).toMatchObject({
    status: 'queued',
    progress_pct: 0,
    error_message: null,
  });
  expect(
    (
      await http.pool.query(
        "SELECT user_id,metadata::jsonb AS metadata FROM audit_log WHERE event='async_job_retried' AND metadata::jsonb->>'jobId'=$1",
        [id]
      )
    ).rows
  ).toMatchObject([{ user_id: 'job-owner', metadata: { jobId: id, type: 'test-export' } }]);
});

it('rolls back a retry when the session expires while waiting for its job lock', async () => {
  const sessionId = headers['job-owner'].cookie!.split('=')[1]!;
  const beforeAudit = (
    await http.pool.query(
      "SELECT id FROM audit_log WHERE event='async_job_retried' AND metadata::jsonb->>'jobId'=$1",
      [id]
    )
  ).rowCount;
  await http.pool.query(
    "UPDATE async_jobs SET status='failed',error_message='JOB_FAILED' WHERE id=$1",
    [id]
  );
  const held = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await held.query('BEGIN');
    await held.query('SELECT id FROM async_jobs WHERE id=$1 FOR UPDATE', [id]);
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE session_id=$1",
      [sessionId]
    );
    pending = fetch(http.base + '/api/jobs/' + id + '/retry', {
      method: 'POST',
      headers: headers['job-owner'],
    });
    await expect
      .poll(
        async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query LIKE '%UPDATE async_jobs%'"
              )
            ).rows[0].count
          ),
        { timeout: 5_000 }
      )
      .toBe(1);
    await held.query('SELECT pg_sleep(2.1)');
    await held.query('COMMIT');
    expect((await pending).status).toBe(401);
    expect(
      (await http.pool.query('SELECT status,error_message FROM async_jobs WHERE id=$1', [id]))
        .rows[0]
    ).toMatchObject({ status: 'failed', error_message: 'JOB_FAILED' });
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE event='async_job_retried' AND metadata::jsonb->>'jobId'=$1",
          [id]
        )
      ).rowCount
    ).toBe(beforeAudit);
  } finally {
    await held.query('ROLLBACK').catch(() => undefined);
    held.release();
    await pending;
    await http.pool.query(
      "UPDATE sessions SET expires_at=now()+interval '1 day',idle_deadline=now()+interval '1 hour' WHERE session_id=$1",
      [sessionId]
    );
  }
}, 15_000);

it('isolates the same owner across operating contexts and requires CSRF for retry', async () => {
  const sessionId = randomUUID();
  const csrf = randomUUID();
  await http.pool.query("UPDATE users SET is_staff=true WHERE user_id='job-owner'");
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES ($1,'job-owner',$2,$3,now()+interval '1 day',now()+interval '1 hour','staff')",
    [sessionId, csrf, randomUUID()]
  );
  const staff = { cookie: 'barghsa_session=' + sessionId, 'x-csrf-token': csrf };
  const path = http.base + '/api/jobs/' + id;
  for (const suffix of ['', '/status', '/result'])
    expect((await fetch(path + suffix, { headers: staff })).status).toBe(404);
  expect((await fetch(path + '/retry', { method: 'POST', headers: staff })).status).toBe(404);
  expect(
    (
      await fetch(path + '/retry', {
        method: 'POST',
        headers: { cookie: headers['job-owner'].cookie! },
      })
    ).status
  ).toBe(403);
  expect(
    (await fetch(http.base + '/api/jobs/not-a-uuid', { headers: headers['job-owner'] })).status
  ).toBe(404);
});

it('rolls back an owner retry when its audit cannot be persisted', async () => {
  const failedId = randomUUID();
  await http.pool.query(
    "INSERT INTO async_jobs(id,type,payload,created_by,status,error_message) VALUES ($1,'test-export','{}','job-owner','failed','JOB_FAILED')",
    [failedId]
  );
  await http.pool.query(`
    CREATE FUNCTION reject_job_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='async_job_retried' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_job_retry_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_job_retry_audit()
  `);
  try {
    const response = await fetch(http.base + '/api/jobs/' + failedId + '/retry', {
      method: 'POST',
      headers: headers['job-owner'],
    });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('audit unavailable');
    expect(
      (await http.pool.query('SELECT status,error_message FROM async_jobs WHERE id=$1', [failedId]))
        .rows[0]
    ).toMatchObject({ status: 'failed', error_message: 'JOB_FAILED' });
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE event='async_job_retried' AND metadata::jsonb->>'jobId'=$1",
          [failedId]
        )
      ).rowCount
    ).toBe(0);
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_job_retry_audit ON audit_log; DROP FUNCTION reject_job_retry_audit()'
    );
  }
});
