import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);

it('binds the submitted CSRF token through authentication lock waits before touching or mutating', async () => {
  const sessionId = randomUUID(),
    oldToken = randomUUID(),
    nextToken = randomUUID(),
    profileId = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('csrf-owner','csrf-owner@example.test','test-only')"
  );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,is_default,status) VALUES ($1,'csrf-owner','INDIVIDUAL',true,'ACTIVE')",
    [profileId]
  );
  const idle = (
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ($1,'csrf-owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '10 minutes') RETURNING idle_deadline",
      [sessionId, oldToken]
    )
  ).rows[0].idle_deadline;
  const headers = {
    Cookie: `barghsa_session=${sessionId}`,
    'X-CSRF-Token': oldToken,
    'Content-Type': 'application/json',
  };
  const select = (token = oldToken) =>
    fetch(`${http.base}/api/profiles/default/${profileId}`, {
      method: 'POST',
      headers: { ...headers, 'X-CSRF-Token': token },
    });
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT user_id FROM users WHERE user_id='csrf-owner' FOR UPDATE");
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = select();
    await expect
      .poll(async () =>
        (
          await http.pool.query(
            'SELECT query FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
            [pid]
          )
        ).rows.map((row) => row.query)
      )
      .toEqual([expect.stringContaining('WHERE s.session_id=$1 FOR UPDATE OF u')]);
    await blocker.query('UPDATE sessions SET csrf_token=$1 WHERE session_id=$2', [
      nextToken,
      sessionId,
    ]);
    await blocker.query('COMMIT');
    const denied = await pending;
    expect(denied.status, await denied.clone().text()).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'AUTHZ:CSRF_TOKEN_INVALID' } });
    expect(
      (await http.pool.query('SELECT idle_deadline FROM sessions WHERE session_id=$1', [sessionId]))
        .rows[0].idle_deadline
    ).toEqual(idle);
    expect(
      (
        await http.pool.query(
          "SELECT profile_id FROM user_profile_contexts WHERE user_id='csrf-owner'"
        )
      ).rows
    ).toEqual([]);
    expect(http.logs()).not.toContain(oldToken);
    expect(http.logs()).not.toContain(nextToken);
    expect((await select(nextToken)).status).toBe(200);
    expect(
      (
        await http.pool.query(
          "SELECT profile_id FROM user_profile_contexts WHERE user_id='csrf-owner'"
        )
      ).rows
    ).toEqual([{ profile_id: profileId }]);
    expect((await fetch(`${http.base}/api/profiles`, { headers })).status).toBe(200);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});
