import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeAll(async () => {
  const priorKey = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  const priorAllowlist = process.env.SMTP_HOST_ALLOWLIST;
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = '';
  process.env.SMTP_HOST_ALLOWLIST = '';
  try {
    http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    if (priorKey === undefined) delete process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
    else process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = priorKey;
    if (priorAllowlist === undefined) delete process.env.SMTP_HOST_ALLOWLIST;
    else process.env.SMTP_HOST_ALLOWLIST = priorAllowlist;
  }
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
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at,otp_step_up_verified_at) VALUES ($1,'provider-editor',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW(),NOW())",
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

it('rejects a private SMTP destination through the provider test API before dialing it', async () => {
  let connections = 0;
  const listener = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  try {
    const id = randomUUID();
    const config = {
      host: '127.0.0.1',
      port: (listener.address() as AddressInfo).port,
      security: 'TLS',
      from_email: 'sender@example.test',
    };
    await http.pool.query(
      `INSERT INTO email_provider_configs(id,transport,label,status,config,created_by)
       VALUES ($1,'smtp','Private destination fixture','draft',$2::jsonb,'provider-editor')`,
      [id, JSON.stringify(config)]
    );
    const response = await fetch(`${http.base}/api/admin/email-providers/${id}/test-connection`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipient: 'provider-editor@example.test' }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      lastTestStatus: 'failed',
      test: { ok: false, error: expect.stringMatching(/blocked/i) },
    });
    expect(connections).toBe(0);
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
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
  it(`${channel}: rejects an omitted test recipient before changing the draft`, async () => {
    const id = await seed();
    const response = await fetch(
      `${http.base}/api/admin/${channel}-providers/${id}/test-connection`,
      {
        method: 'POST',
        headers,
        body: '{}',
      }
    );
    expect(response.status).toBe(400);
    expect(
      (
        await http.pool.query(`SELECT last_test_status, last_test_at FROM ${table} WHERE id=$1`, [
          id,
        ])
      ).rows
    ).toEqual([{ last_test_status: 'pending', last_test_at: null }]);
  });
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
  it(`${channel}: refuses to write a new secret without an encryption key`, async () => {
    const id = await seed();
    const before = (await http.pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows;
    const config =
      channel === 'email' ? { password: 'fixture-secret' } : { api_key: 'fixture-secret' };
    const response = await fetch(`${http.base}/api/admin/${channel}-providers/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ config }),
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('fixture-secret');
    expect((await http.pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows).toEqual(
      before
    );
  });
}
