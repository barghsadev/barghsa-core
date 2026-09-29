import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
const userId = randomUUID();
const originalSessionId = randomUUID();
const originalCsrf = randomUUID();

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await fixture.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_admin,is_staff)
     VALUES($1,$2,'fixture-not-a-login-hash',true,true)`,
    [userId, `dual-${userId}@example.test`]
  );
  await fixture.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline,step_up_verified_at)
     VALUES($1,$2,$3,now()+interval '1 day',now()+interval '30 minutes',now())`,
    [originalSessionId, userId, originalCsrf]
  );
}, 40000);

afterAll(async () => {
  await fixture?.close();
}, 15000);

function auth(sessionId: string, csrf: string) {
  return { Cookie: `barghsa_session=${sessionId}; barghsa_csrf=${csrf}` };
}

async function switchTo(sessionId: string, csrf: string, context: 'staff' | 'customer') {
  return fetch(`${fixture.base}/api/auth/sessions/context`, {
    method: 'POST',
    headers: {
      ...auth(sessionId, csrf),
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ context }),
  });
}

function rotatedCredentials(response: Response) {
  const values = Object.fromEntries(
    response.headers
      .getSetCookie()
      .filter((cookie) => !cookie.startsWith('barghsa_session=;'))
      .map((cookie) => cookie.split(';')[0]!.split('='))
  );
  expect(values.barghsa_session).toBeTruthy();
  expect(values.barghsa_refresh).toBeTruthy();
  expect(values.barghsa_csrf).toBeTruthy();
  return { sessionId: values.barghsa_session!, csrf: values.barghsa_csrf! };
}

it('separates staff and customer authority across rotations and rejects stale credentials', async () => {
  expect(
    (
      await fixture.pool.query('SELECT operating_context FROM sessions WHERE session_id=$1', [
        originalSessionId,
      ])
    ).rows[0].operating_context
  ).toBe('staff');
  const staffProfiles = await fetch(`${fixture.base}/api/profiles`, {
    headers: auth(originalSessionId, originalCsrf),
  });
  expect(staffProfiles.status).toBe(403);

  const customerResponse = await switchTo(originalSessionId, originalCsrf, 'customer');
  expect(customerResponse.status, await customerResponse.clone().text()).toBe(200);
  const customer = rotatedCredentials(customerResponse);
  expect(customer.sessionId).not.toBe(originalSessionId);
  expect(customer.csrf).not.toBe(originalCsrf);
  expect((await customerResponse.json()) as { operatingContext: string }).toMatchObject({
    operatingContext: 'customer',
  });
  expect(
    (
      await fixture.pool.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [
        originalSessionId,
      ])
    ).rows[0].revoked_at
  ).not.toBeNull();
  expect(
    (
      await fetch(`${fixture.base}/api/auth/user`, {
        headers: auth(originalSessionId, originalCsrf),
      })
    ).status
  ).toBe(401);
  const currentUser = await fetch(`${fixture.base}/api/auth/user`, {
    headers: auth(customer.sessionId, customer.csrf),
  });
  expect(await currentUser.json()).toMatchObject({
    isStaff: true,
    operatingContext: 'customer',
    canSwitchContext: true,
  });
  expect(
    (
      await fetch(`${fixture.base}/api/admin/staff`, {
        headers: auth(customer.sessionId, customer.csrf),
      })
    ).status
  ).toBe(403);
  expect(
    (
      await fetch(`${fixture.base}/api/profiles`, {
        headers: auth(customer.sessionId, customer.csrf),
      })
    ).status
  ).toBe(200);
  const staffJob = randomUUID();
  const customerJob = randomUUID();
  await fixture.pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by,operating_context)
     VALUES($1,'test-export','{}',$3,'staff'),($2,'test-export','{}',$3,'customer')`,
    [staffJob, customerJob, userId]
  );
  expect(
    (
      await fetch(`${fixture.base}/api/jobs/${staffJob}`, {
        headers: auth(customer.sessionId, customer.csrf),
      })
    ).status
  ).toBe(404);
  expect(
    (
      await fetch(`${fixture.base}/api/jobs/${customerJob}`, {
        headers: auth(customer.sessionId, customer.csrf),
      })
    ).status
  ).toBe(200);

  const staffResponse = await switchTo(customer.sessionId, customer.csrf, 'staff');
  expect(staffResponse.status, await staffResponse.clone().text()).toBe(200);
  const staff = rotatedCredentials(staffResponse);
  expect(
    (await fetch(`${fixture.base}/api/profiles`, { headers: auth(staff.sessionId, staff.csrf) }))
      .status
  ).toBe(403);
  expect(
    (
      await fetch(`${fixture.base}/api/ai/knowledge/availability`, {
        headers: auth(staff.sessionId, staff.csrf),
      })
    ).status
  ).toBe(403);
  expect(
    (
      await fetch(`${fixture.base}/api/jobs/${customerJob}`, {
        headers: auth(staff.sessionId, staff.csrf),
      })
    ).status
  ).toBe(404);
  expect(
    (
      await fetch(`${fixture.base}/api/jobs/${staffJob}`, {
        headers: auth(staff.sessionId, staff.csrf),
      })
    ).status
  ).toBe(200);
  expect((await switchTo(staff.sessionId, customer.csrf, 'customer')).status).toBe(403);
  expect(
    (
      await fixture.pool.query(
        'SELECT operating_context,step_up_verified_at FROM sessions WHERE session_id=$1',
        [staff.sessionId]
      )
    ).rows[0]
  ).toMatchObject({ operating_context: 'staff', step_up_verified_at: null });
  expect(
    (
      await fixture.pool.query(
        `SELECT metadata::jsonb->>'to' AS target FROM audit_log
         WHERE user_id=$1 AND event='auth.operating_context_switched' ORDER BY created_at`,
        [userId]
      )
    ).rows.map((row: { target: string }) => row.target)
  ).toEqual(['customer', 'staff']);
});

it('cannot switch an ordinary customer into staff authority', async () => {
  const customerId = randomUUID();
  const sessionId = randomUUID();
  const csrf = randomUUID();
  await fixture.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,$3)', [
    customerId,
    `customer-${customerId}@example.test`,
    'fixture-not-a-login-hash',
  ]);
  await fixture.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline)
     VALUES($1,$2,$3,now()+interval '1 day',now()+interval '30 minutes')`,
    [sessionId, customerId, csrf]
  );
  expect((await switchTo(sessionId, csrf, 'staff')).status).toBe(403);
  expect(
    (
      await fixture.pool.query(
        'SELECT operating_context,revoked_at FROM sessions WHERE session_id=$1',
        [sessionId]
      )
    ).rows[0]
  ).toMatchObject({ operating_context: 'customer', revoked_at: null });
});
