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

const lanes = [
  ['/api/staff/electricity/orders', 'electricity_orders'],
  ['/api/staff/electricity/orders/conversations', 'electricity_order_comments'],
  ['/api/staff/saving/orders', 'saving_orders'],
] as const;
it.each(lanes)(
  'rejects %s after permission revocation commits during its private read',
  async (path, table) => {
    const actor = 'staff-read-' + randomUUID(),
      role = randomUUID(),
      session = randomUUID();
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'fixture',true)",
      [actor]
    );
    await http.pool.query(
      "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES($1,$1,'Read fixture','[\"contracts:read\"]')",
      [role]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','staff')",
      [session, actor, randomUUID(), randomUUID()]
    );
    const headers = { Cookie: `barghsa_session=${session}` };
    expect((await fetch(http.base + path, { headers })).status, http.logs()).toBe(200);
    await http.pool.query(
      'UPDATE staff_roles SET permissions=\'["contracts:write"]\' WHERE role_id=$1',
      [role]
    );
    expect((await fetch(http.base + path, { headers })).status).toBe(200);
    await http.pool.query(
      'UPDATE staff_roles SET permissions=\'["contracts:read"]\' WHERE role_id=$1',
      [role]
    );
    const blocker = await http.pool.connect();
    let request: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("UPDATE staff_roles SET permissions='[]' WHERE role_id=$1", [role]);
      await blocker.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      request = fetch(http.base + path, { headers });
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',
                [pid]
              )
            ).rows[0].waiting
        )
        .toBe(true);
      await blocker.query('COMMIT');
      const result = await request;
      expect(result.status, await result.clone().text()).toBe(403);
      expect(await result.json()).not.toHaveProperty('orders');
      expect((await fetch(http.base + path, { headers })).status).toBe(403);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await request;
    }
  }
);

it('withdraws a queue result if the held staff session expires during its read', async () => {
  const actor = 'staff-clock-' + randomUUID(),
    session = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff,is_admin) VALUES($1,$1,'fixture',true,true)",
    [actor]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','staff')",
    [session, actor, randomUUID(), randomUUID()]
  );
  const blocker = await http.pool.connect();
  let request: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE electricity_orders IN ACCESS EXCLUSIVE MODE');
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '1 second' WHERE session_id=$1",
      [session]
    );
    request = fetch(http.base + '/api/staff/electricity/orders', {
      headers: { Cookie: `barghsa_session=${session}` },
    });
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',
              [pid]
            )
          ).rows[0].waiting
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
    expect(await result.json()).not.toHaveProperty('orders');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await request;
  }
});
