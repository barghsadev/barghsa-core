import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
let profileId: string;
let productId: string;

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('consultation-staff','Consultation staff','Test','["orders:read","orders:write"]')`
  );
  for (const [user, isStaff] of [
    ['customer', false],
    ['reviewer', true],
  ] as const) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,$3,$4)',
      [user, `${user}@consultation-flow.test`, 'test-only', isStaff]
    );
    if (isStaff) {
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES('reviewer','consultation-staff')"
      );
    }
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('customer','LEGAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0].id as string;
  productId = (
    await http.pool.query(
      "SELECT id FROM products WHERE system_key='electricity_generation_station'"
    )
  ).rows[0].id as string;
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);

function post(path: string, user: string, body: unknown) {
  return fetch(`${http.base}${path}`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify(body),
  });
}

it('moves a consultation through staff assignment, customer information, and a reasoned decision', async () => {
  const submitted = await post('/api/consultations/requests', 'customer', {
    profileId,
    productId,
    submissionKey: randomUUID(),
  });
  expect(submitted.status, http.logs()).toBe(201);
  const requestId = ((await submitted.json()) as { requestId: string }).requestId;
  const root = `/api/admin/consultations/requests/${requestId}`;
  expect(
    (
      await fetch(`${http.base}/api/admin/consultations/requests`, {
        headers: headers.customer!,
      })
    ).status
  ).toBe(403);
  const queue = await fetch(
    `${http.base}/api/admin/consultations/requests?status=submitted&assignment=unassigned&priority=normal&minAgeDays=0`,
    {
      headers: headers.reviewer!,
    }
  );
  expect(queue.status, http.logs()).toBe(200);
  expect((await queue.json()) as { requests: Array<{ id: string }> }).toMatchObject({
    requests: [{ id: requestId }],
  });
  const assigned = await post(`${root}/assign`, 'reviewer', { assignTo: 'self' });
  expect(assigned.status, http.logs()).toBe(200);
  expect(await assigned.json()).toMatchObject({ status: 'under_review', staffOwnerId: 'reviewer' });
  expect((await post(`${root}/review`, 'reviewer', {})).status).toBe(409);
  const requested = await post(`${root}/request-info`, 'reviewer', {
    reason: 'Please provide the planned station capacity.',
  });
  expect(requested.status, http.logs()).toBe(200);
  expect(await requested.json()).toMatchObject({ status: 'awaiting_customer_info' });
  const supplied = await post(`/api/consultations/requests/${requestId}/provide-info`, 'customer', {
    reason: 'The planned capacity is 5 MW.',
  });
  expect(supplied.status, http.logs()).toBe(200);
  const rejected = await post(`${root}/reject`, 'reviewer', {
    reason: 'Site is outside the service area.',
  });
  expect(rejected.status, http.logs()).toBe(200);
  expect((await post(`${root}/cancel`, 'reviewer', { reason: 'Too late' })).status).toBe(409);
  const detail = await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
    headers: headers.customer!,
  });
  expect(detail.status, http.logs()).toBe(200);
  const body = (await detail.json()) as {
    request: { status: string };
    history: Array<{ status: string; actor_type: string; reason: string | null }>;
  };
  expect(body.request.status).toBe('rejected');
  expect(body.history.map((event) => event.status)).toEqual([
    'submitted',
    'under_review',
    'awaiting_customer_info',
    'under_review',
    'rejected',
  ]);
  expect(body.history.at(-1)).toMatchObject({
    actor_type: 'staff',
    reason: 'Site is outside the service area.',
  });
  const notifications = (
    await http.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM in_app_notifications WHERE recipient_user_id='customer' AND profile_id=$1",
      [profileId]
    )
  ).rows[0]!.count;
  expect(notifications).toBe(5);
  await http.pool.query("INSERT INTO staff_teams(name,is_active) VALUES('Consultation team',true)");
  const teams = await fetch(`${http.base}/api/admin/consultations/teams`, {
    headers: headers.reviewer!,
  });
  expect(teams.status, http.logs()).toBe(200);
  expect(await teams.json()).toMatchObject({ teams: [{ name: 'Consultation team' }] });
  const second = await post('/api/consultations/requests', 'customer', {
    profileId,
    productId,
    submissionKey: randomUUID(),
  });
  expect(second.status, http.logs()).toBe(201);
  const secondId = ((await second.json()) as { requestId: string }).requestId;
  const teamAssigned = await post(
    `/api/admin/consultations/requests/${secondId}/assign`,
    'reviewer',
    { assignTo: 'team', team: 'Consultation team' }
  );
  expect(teamAssigned.status, http.logs()).toBe(200);
  expect(await teamAssigned.json()).toMatchObject({
    status: 'submitted',
    staffTeam: 'Consultation team',
    staffOwnerId: null,
  });
  const unassigned = await fetch(
    `${http.base}/api/admin/consultations/requests?assignment=unassigned`,
    {
      headers: headers.reviewer!,
    }
  );
  expect((await unassigned.json()) as { requests: unknown[] }).toMatchObject({ requests: [] });
});
