import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let sessionId: string, headers: Record<string, string>;
const actor = 'zzz-permission-viewer',
  target = 'aaa-permission-target',
  role = 'inspection-reviewer';
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_staff)
    VALUES($1,'viewer@example.test','fixture-only',true),($2,'target@example.test','fixture-only',true)`,
    [actor, target]
  );
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES($1,'Inspection reviewer','Fixture','["admin:roles:edit"]')`,
    [role]
  );
  await http.pool.query(
    `INSERT INTO user_roles(user_id,role_id) VALUES($1,$2),($3,'role-finance'),($3,'role-customer-support')`,
    [actor, role, target]
  );
}, 40000);
beforeEach(async () => {
  await http.pool.query(
    'UPDATE users SET disabled_at=NULL,activation_token=NULL,is_admin=false WHERE user_id=ANY($1::text[])',
    [[actor, target]]
  );
  await http.pool.query(
    `UPDATE staff_roles SET permissions='["admin:roles:edit"]' WHERE role_id=$1`,
    [role]
  );
  sessionId = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline)
    VALUES($1,$2,$3,clock_timestamp()+INTERVAL '1 day',clock_timestamp()+INTERVAL '30 minutes')`,
    [sessionId, actor, randomUUID()]
  );
  headers = { Cookie: `barghsa_session=${sessionId}` };
});
afterAll(async () => {
  await http?.close();
}, 15000);
const read = (id = target) =>
  fetch(`${http.base}/api/admin/users/${encodeURIComponent(id)}/effective-permissions`, {
    headers,
    signal: AbortSignal.timeout(12000),
  });
it('returns the current union once, including no access for pending or disabled accounts and wildcard recovery', async () => {
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toContain('private');
  expect(result.headers.get('cache-control')).toContain('no-store');
  const body = (await result.json()) as { permissions: { permission: string }[] };
  expect(body.permissions.map((item) => item.permission)).toContain('payments:read');
  expect(body.permissions.filter((item) => item.permission === 'users:read')).toHaveLength(1);
  await http.pool.query("UPDATE users SET activation_token='fixture-only' WHERE user_id=$1", [
    target,
  ]);
  expect(await (await read()).json()).toMatchObject({
    permissions: [],
    isWildcard: false,
    roleIds: expect.arrayContaining(['role-finance']),
  });
  await http.pool.query('UPDATE users SET activation_token=NULL,is_admin=true WHERE user_id=$1', [
    target,
  ]);
  expect(await (await read()).json()).toMatchObject({
    isAdmin: true,
    isWildcard: true,
    permissions: [{ permission: '*', group: 'admin' }],
  });
  await http.pool.query('UPDATE users SET disabled_at=clock_timestamp() WHERE user_id=$1', [
    target,
  ]);
  expect(await (await read()).json()).toMatchObject({
    isAdmin: true,
    isWildcard: false,
    permissions: [],
  });
  expect((await read('missing')).status).toBe(404);
});
for (const change of ['permission', 'session', 'target', 'expiry'] as const) {
  it(`rechecks ${change} after a target account lock wait`, async () => {
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [target]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const deadline =
        change === 'expiry'
          ? (
              await http.pool.query(
                "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '3 seconds' WHERE session_id=$1 RETURNING expires_at",
                [sessionId]
              )
            ).rows[0].expires_at
          : null;
      pending = read();
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',
                [pid]
              )
            ).rows[0].count
        )
        .toBe(1);
      if (change === 'permission')
        await http.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id=$1", [role]);
      if (change === 'session')
        await http.pool.query(
          'UPDATE sessions SET revoked_at=clock_timestamp() WHERE session_id=$1',
          [sessionId]
        );
      if (change === 'target')
        await blocker.query('UPDATE users SET disabled_at=clock_timestamp() WHERE user_id=$1', [
          target,
        ]);
      if (change === 'expiry')
        await expect
          .poll(
            async () =>
              (
                await http.pool.query('SELECT clock_timestamp()>$1::timestamptz AS expired', [
                  deadline,
                ])
              ).rows[0].expired,
            { timeout: 5000 }
          )
          .toBe(true);
      await blocker.query('COMMIT');
      const result = await pending;
      if (change === 'target') {
        expect(result.status).toBe(200);
        expect(await result.json()).toMatchObject({ permissions: [], isWildcard: false });
      } else expect(result.status).toBe(change === 'permission' ? 403 : 401);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }, 15000);
}
