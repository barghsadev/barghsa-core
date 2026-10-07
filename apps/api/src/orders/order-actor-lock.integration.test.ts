import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { OrdersService } from './orders.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const actor = { userId: 'actor-lock-owner', sessionId: randomUUID(), csrfToken: randomUUID() };
let profileId: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')",
    [actor.userId]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [actor.sessionId, actor.userId, actor.csrfToken, randomUUID()]
  );
  profileId = (
    await http.pool.query('INSERT INTO profiles(user_id) VALUES($1) RETURNING id', [actor.userId])
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await http?.close();
});
it.each([
  'UPDATE users SET disabled_at=NOW() WHERE user_id=$1',
  "UPDATE users SET user_id=user_id||'-changed' WHERE user_id=$1",
  'DELETE FROM users WHERE user_id=$1',
])('retains the account lock against %s while permitting a recipient FK', async (sql) => {
  const account = await http.pool.connect(),
    competing = await http.pool.connect();
  try {
    await account.query('BEGIN');
    await OrdersService.prototype.lockOrderActor(account, actor);
    await competing.query('BEGIN');
    await competing.query("SET LOCAL lock_timeout='100ms'");
    await expect(competing.query(sql, [actor.userId])).rejects.toMatchObject({ code: '55P03' });
    await competing.query('ROLLBACK');
    await competing.query('BEGIN');
    await competing.query("SET LOCAL lock_timeout='100ms'");
    expect(
      (
        await competing.query(
          "INSERT INTO notification_outbox(profile_id,user_id,event_key,channels,idempotency_key) VALUES($1,$2,'order.submitted',ARRAY['email'],$3) RETURNING id",
          [profileId, actor.userId, randomUUID()]
        )
      ).rowCount
    ).toBe(1);
    await competing.query('ROLLBACK');
    expect(
      (
        await account.query('SELECT user_id,disabled_at FROM users WHERE user_id=$1', [
          actor.userId,
        ])
      ).rows
    ).toEqual([{ user_id: actor.userId, disabled_at: null }]);
  } finally {
    await competing.query('ROLLBACK');
    await account.query('ROLLBACK');
    competing.release();
    account.release();
  }
});
it('continues to reject a disabled actor and an expired session', async () => {
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [actor.userId]);
    await expect(OrdersService.prototype.lockOrderActor(client, actor)).rejects.toMatchObject({
      status: 401,
    });
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await client.query(
      "UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE session_id=$1",
      [actor.sessionId]
    );
    await expect(OrdersService.prototype.lockOrderActor(client, actor)).rejects.toMatchObject({
      status: 401,
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
