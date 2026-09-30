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

it('keeps job payload and status private to the submitting user', async () => {
  const path = `${http.base}/api/jobs/${id}`;
  const owner = await fetch(path, { headers: headers['job-owner'] });
  expect(owner.status).toBe(200);
  expect(await owner.json()).toMatchObject({
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
});
