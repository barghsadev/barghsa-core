import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
});
it.each([
  ['/api/staff/solar/requests', 'solar_construction_requests'],
  ['/api/staff/solar/document-review-queue', 'solar_construction_requests'],
  ['/api/staff/solar/postal-queue', 'solar_construction_requests'],
  ['/api/staff/consultations', 'consultation_requests'],
] as const)('withdraws %s after its held session expires', async (path, table) => {
  const actor = 'staff-expiry-' + randomUUID(),
    session = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff,is_admin) VALUES($1,$1,'fixture',true,true)",
    [actor]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','staff')",
    [session, actor, randomUUID(), randomUUID()]
  );
  const headers = { Cookie: `barghsa_session=${session}` };
  expect((await fetch(http.base + path, { headers })).status, http.logs()).toBe(200);
  const blocker = await http.pool.connect();
  let request: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '1 second' WHERE session_id=$1",
      [session]
    );
    request = fetch(http.base + path, { headers });
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
              [pid]
            )
          ).rows[0].blocked
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT expires_at<clock_timestamp() AS expired FROM sessions WHERE session_id=$1',
              [session]
            )
          ).rows[0].expired
      )
      .toBe(true);
    await blocker.query('COMMIT');
    const result = await request;
    expect(result.status, await result.clone().text()).toBe(401);
    const body = await result.json();
    for (const key of ['requests', 'documents', 'nextBefore', 'nextAfter'])
      expect(body).not.toHaveProperty(key);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await request;
  }
});
