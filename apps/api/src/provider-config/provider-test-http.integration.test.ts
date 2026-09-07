import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('provider-editor','Provider editor','Fixture','[\"admin:notification-providers:edit\"]')"
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('provider-editor','provider-editor@example.test','test-only',true)"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('provider-editor','provider-editor')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'provider-editor',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM email_provider_configs');
  await http.pool.query('DELETE FROM sms_provider_configs');
});

for (const channel of ['email', 'sms']) {
  const table = `${channel}_provider_configs`;
  async function seed(status = 'pending') {
    const id = randomUUID();
    await http.pool.query(
      `INSERT INTO ${table}(id,transport,label,status,config,created_by,last_test_status,last_test_at) VALUES ($1,$2,'Fixture','draft','{}','provider-editor',$3,CASE WHEN $3='passed' THEN NOW() END)`,
      [id, channel === 'email' ? 'smtp' : 'smsir', status]
    );
    return id;
  }
  for (const passed of [true, false]) {
    it(`${channel}: rejects a client-supplied test outcome (${passed})`, async () => {
      const id = await seed();
      const before = (await http.pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows;
      const response = await fetch(`${http.base}/api/admin/${channel}-providers/${id}/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ passed }),
      });
      expect(response.status).toBe(409);
      expect((await http.pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows).toEqual(
        before
      );
    });
  }
  it(`${channel}: credential edits invalidate the prior successful test`, async () => {
    const id = await seed('passed');
    const response = await fetch(`${http.base}/api/admin/${channel}-providers/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ config: {} }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      lastTestStatus: 'pending',
      lastTestAt: null,
      lastTestError: null,
    });
    expect(
      (
        await fetch(`${http.base}/api/admin/${channel}-providers/${id}/activate`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status
    ).toBe(409);
    expect(
      (await http.pool.query(`SELECT status,last_test_status FROM ${table} WHERE id=$1`, [id]))
        .rows[0]
    ).toEqual({ status: 'draft', last_test_status: 'pending' });
  });
  it(`${channel}: cannot turn an untested disabled draft into an active rollback`, async () => {
    const id = await seed();
    await http.pool.query(`UPDATE ${table} SET status='disabled' WHERE id=$1`, [id]);
    const before = (await http.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    expect(
      (
        await fetch(`${http.base}/api/admin/${channel}-providers/${id}/rollback`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status
    ).toBe(409);
    expect((await http.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows).toEqual(before);
  });
}
