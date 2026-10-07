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
  [`/api/staff/electricity/orders/${randomUUID()}`, 'electricity_orders'],
  [`/api/staff/saving/orders/${randomUUID()}`, 'saving_orders'],
] as const;
it.each(
  lanes.flatMap(([path, table]) =>
    (['revocation', 'disabled'] as const).map((change) => [path, table, change] as const)
  )
)(
  'checks current permission before private detail existence: %s / %s / %s',
  async (path, table, change) => {
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
    expect((await fetch(http.base + path, { headers })).status, http.logs()).toBe(404);
    await http.pool.query(
      'UPDATE staff_roles SET permissions=\'["contracts:write"]\' WHERE role_id=$1',
      [role]
    );
    expect((await fetch(http.base + path, { headers })).status).toBe(404);
    await http.pool.query(
      'UPDATE staff_roles SET permissions=\'["contracts:read"]\' WHERE role_id=$1',
      [role]
    );
    const blocker = await http.pool.connect();
    let request: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      if (change === 'revocation')
        await blocker.query("UPDATE staff_roles SET permissions='[]' WHERE role_id=$1", [role]);
      else
        await blocker.query('UPDATE users SET disabled_at=clock_timestamp() WHERE user_id=$1', [
          actor,
        ]);
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
      expect(result.status, await result.clone().text()).toBe(change === 'disabled' ? 401 : 403);
      expect(await result.json()).not.toHaveProperty('contractSnapshot');
      expect((await fetch(http.base + path, { headers })).status).toBe(
        change === 'disabled' ? 401 : 403
      );
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await request;
    }
  }
);
