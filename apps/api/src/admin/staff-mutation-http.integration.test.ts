import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
async function actor() {
  const userId = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
    [userId, `${userId}@example.test`]
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-admin')", [
    userId,
  ]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [session, userId, csrf, randomUUID()]
  );
  return {
    userId,
    headers: {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
  };
}
const operations = ['create', 'roles', 'disable', 'activation'] as const;
for (const operation of operations)
  for (const change of ['remove-role', 'disable-actor'] as const) {
    it(`${operation} rejects ${change} winning the account lock after the request guard`, async () => {
      const current = await actor(),
        target = randomUUID(),
        username = `${target}@example.test`;
      await http.pool.query(
        "INSERT INTO users(user_id,username,password_hash,is_staff,must_change_password,activation_token,activation_token_expires_at) VALUES ($1,$2,'test-only',true,true,'unchanged-fixture-token',NOW()+INTERVAL '1 day')",
        [target, username]
      );
      const path =
        operation === 'create'
          ? '/api/admin/users/create-staff'
          : operation === 'roles'
            ? `/api/admin/users/${target}/roles`
            : operation === 'disable'
              ? `/api/admin/staff/${target}/disable`
              : `/api/admin/users/${target}/resend-activation`;
      const body =
        operation === 'create'
          ? {
              username: `created-${username}`,
              firstName: 'Test',
              lastName: 'Staff',
              activationMethod: 'tempPassword',
            }
          : operation === 'roles'
            ? { roleIds: ['role-finance'], reason: 'Test race' }
            : {};
      const lock = await http.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await lock.query('BEGIN');
        await lock.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [current.userId]);
        pending = fetch(`${http.base}${path}`, {
          method: operation === 'roles' ? 'PUT' : 'POST',
          headers: current.headers,
          body: JSON.stringify(body),
        });
        const deadline = Date.now() + 10000;
        let waiting = false;
        while (Date.now() < deadline) {
          waiting =
            (
              await http.pool.query(
                "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%'"
              )
            ).rows.length > 0;
          if (waiting) break;
          await new Promise((done) => setTimeout(done, 20));
        }
        expect(waiting, http.logs()).toBe(true);
        if (change === 'remove-role')
          await lock.query('DELETE FROM user_roles WHERE user_id=$1', [current.userId]);
        else
          await lock.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [current.userId]);
        await lock.query('COMMIT');
        const response = await pending;
        expect(response.status, (await response.text()) + http.logs()).toBe(403);
        expect(
          (
            await http.pool.query(
              'SELECT disabled_at,activation_token FROM users WHERE user_id=$1',
              [target]
            )
          ).rows[0]
        ).toEqual({ disabled_at: null, activation_token: 'unchanged-fixture-token' });
        expect(
          (await http.pool.query('SELECT 1 FROM user_roles WHERE user_id=$1', [target])).rows
        ).toEqual([]);
        expect(
          (await http.pool.query('SELECT 1 FROM users WHERE username=$1', [`created-${username}`]))
            .rows
        ).toEqual([]);
        expect(
          (await http.pool.query('SELECT 1 FROM audit_log WHERE user_id=$1', [current.userId])).rows
        ).toEqual([]);
        expect(
          (await http.pool.query('SELECT 1 FROM auth_delivery_outbox WHERE user_id=$1', [target]))
            .rows
        ).toEqual([]);
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await pending;
      }
    }, 20000);
  }
it('serializes two administrators removing each other without deadlocking or using revoked grants', async () => {
  const first = await actor(),
    second = await actor();
  const responses = await Promise.all(
    [
      [first, second],
      [second, first],
    ].map(([source, target]) =>
      fetch(`${http.base}/api/admin/users/${target!.userId}/roles`, {
        method: 'PUT',
        headers: source!.headers,
        body: JSON.stringify({ roleIds: ['role-finance'], reason: 'Concurrent role review' }),
      })
    )
  );
  expect(responses.map((response) => response.status).sort(), http.logs()).toEqual([200, 403]);
  const roles = (
    await http.pool.query(
      'SELECT role_id FROM user_roles WHERE user_id=ANY($1::text[]) ORDER BY role_id',
      [[first.userId, second.userId]]
    )
  ).rows;
  expect(roles).toEqual([{ role_id: 'role-admin' }, { role_id: 'role-finance' }]);
});
