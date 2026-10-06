import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string, productId: string;
const headers: Record<string, string> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES('dual-history','dual-history@example.test','test-only',true)"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,operating_context,expires_at,idle_deadline) VALUES($1,'dual-history',$2,$3,'customer',now()+interval '1 day',now()+interval '30 minutes')",
    [session, csrf, randomUUID()]
  );
  Object.assign(headers, {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  });
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default,first_name,last_name) VALUES('dual-history','INDIVIDUAL','VERIFIED',true,'Dual','History') RETURNING id"
    )
  ).rows[0].id;
  productId = (
    await http.pool.query(
      "INSERT INTO products(type,system_key,title,status,price) VALUES('consultation','general_consultation','{\"en\":\"General\"}','active',0) RETURNING id"
    )
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
it('keeps a dual-role customer action and unknown legacy context stable after role changes', async () => {
  const body = { profileId, productId, submissionKey: randomUUID() };
  const submit = () =>
    fetch(http.base + '/api/consultations/requests', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  const created = await submit();
  expect(created.status, http.logs()).toBe(201);
  const requestId = ((await created.json()) as { requestId: string }).requestId;
  const detail = async () => {
    const result = await fetch(`${http.base}/api/consultations/requests/${requestId}`, { headers });
    expect(result.status, http.logs()).toBe(200);
    return (await result.json()) as {
      history: Array<{ actor_type: string; reason: string | null }>;
    };
  };
  expect((await detail()).history).toEqual([
    expect.objectContaining({ actor_type: 'customer', status: 'submitted' }),
  ]);
  expect(
    (
      await http.pool.query(
        'SELECT actor_context,actor_user_id FROM consultation_request_events WHERE request_id=$1',
        [requestId]
      )
    ).rows
  ).toEqual([{ actor_context: 'customer', actor_user_id: 'dual-history' }]);
  expect(
    (
      await http.pool.query(
        "SELECT operating_context FROM audit_log WHERE event='consultation.request.submitted' AND user_id='dual-history'"
      )
    ).rows
  ).toEqual([{ operating_context: 'customer' }]);
  await http.pool.query(
    "INSERT INTO consultation_request_events(request_id,status,actor_user_id,reason) VALUES($1,'submitted','dual-history','Legacy context not recorded')",
    [requestId]
  );
  for (const staff of [false, true]) {
    await http.pool.query("UPDATE users SET is_staff=$1 WHERE user_id='dual-history'", [staff]);
    const history = (await detail()).history;
    expect(history).toHaveLength(2);
    expect(history[0]).not.toHaveProperty('actor_user_id');
    expect(
      (
        await http.pool.query(
          'SELECT DISTINCT actor_user_id FROM consultation_request_events WHERE request_id=$1',
          [requestId]
        )
      ).rows
    ).toEqual([{ actor_user_id: 'dual-history' }]);
    expect(history[0]).toMatchObject({ actor_type: 'customer', status: 'submitted' });
    expect(history[1]).toMatchObject({
      actor_type: 'unknown',
      status: 'submitted',
      reason: 'Legacy context not recorded',
    });
  }
  expect((await submit()).status).toBe(201);
  expect(
    (
      await http.pool.query('SELECT id FROM consultation_request_events WHERE request_id=$1', [
        requestId,
      ])
    ).rows
  ).toHaveLength(2);
  expect((await fetch(http.base + '/api/admin/staff', { headers })).status).toBe(403);
  const spoof = await fetch(http.base + '/api/consultations/requests', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, submissionKey: randomUUID(), actor_context: 'staff' }),
  });
  expect(spoof.status).toBe(400);
  const originalHeaders = { ...headers };
  const switchContext = async (context: 'staff' | 'customer') => {
    const response = await fetch(http.base + '/api/auth/sessions/context', {
      method: 'POST',
      headers,
      body: JSON.stringify({ context }),
    });
    expect(response.status, http.logs()).toBe(200);
    const cookies = response.headers.getSetCookie().join(';');
    const session = cookies.match(/barghsa_session=([^;]+)/)?.[1];
    const csrf = cookies.match(/barghsa_csrf=([^;]+)/)?.[1];
    expect(session).toBeTruthy();
    expect(csrf).toBeTruthy();
    headers.Cookie = `barghsa_session=${session}; barghsa_csrf=${csrf}`;
    headers['X-CSRF-Token'] = csrf!;
  };
  await switchContext('staff');
  expect(
    (await fetch(`${http.base}/api/consultations/requests/${requestId}`, { headers })).status
  ).toBe(403);
  expect(
    (
      await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
        headers: originalHeaders,
      })
    ).status
  ).toBe(401);
  await switchContext('customer');
  const afterSwitch = (await detail()).history;
  expect(afterSwitch).toHaveLength(2);
  expect(afterSwitch[0]).toMatchObject({ actor_type: 'customer', status: 'submitted' });
  expect(afterSwitch[1]).toMatchObject({
    actor_type: 'unknown',
    reason: 'Legacy context not recorded',
  });
});
