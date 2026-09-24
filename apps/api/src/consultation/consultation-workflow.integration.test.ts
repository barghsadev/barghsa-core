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
     VALUES('consultation-staff','Consultation staff','Test','["orders:read","orders:write","invoices:write"]')`
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
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
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
  const later = await fetch(
    `${http.base}/api/admin/consultations/requests?status=submitted&assignment=unassigned&priority=normal&minAgeDays=0&after=${requestId}`,
    { headers: headers.reviewer! }
  );
  expect(later.status, http.logs()).toBe(200);
  expect(
    ((await later.json()) as { requests: Array<{ id: string }> }).requests.map((row) => row.id)
  ).not.toContain(requestId);
  expect(
    (
      await fetch(`${http.base}/api/admin/consultations/requests?after=bad`, {
        headers: headers.reviewer!,
      })
    ).status
  ).toBe(400);
  const assigned = await post(`${root}/assign`, 'reviewer', { assignTo: 'self' });
  expect(assigned.status, http.logs()).toBe(200);
  expect(await assigned.json()).toMatchObject({ status: 'under_review', staffOwnerId: 'reviewer' });
  const customerList = await fetch(
    `${http.base}/api/consultations/requests?profileId=${profileId}`,
    { headers: headers.customer! }
  );
  expect(customerList.status, http.logs()).toBe(200);
  expect(await customerList.json()).toMatchObject({
    requests: [
      {
        id: requestId,
        staff_owner_username: 'reviewer@consultation-flow.test',
        staff_team: null,
        invoice_state: null,
        refund_pending: false,
      },
    ],
  });
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
  expect(body.request).toMatchObject({
    status: 'rejected',
    staff_owner_username: 'reviewer@consultation-flow.test',
  });
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
  const teamDetail = await fetch(`${http.base}/api/consultations/requests/${secondId}`, {
    headers: headers.customer!,
  });
  expect(teamDetail.status, http.logs()).toBe(200);
  expect(await teamDetail.json()).toMatchObject({
    request: { staff_owner_username: null, staff_team: 'Consultation team' },
  });
  const unassigned = await fetch(
    `${http.base}/api/admin/consultations/requests?assignment=unassigned`,
    {
      headers: headers.reviewer!,
    }
  );
  expect((await unassigned.json()) as { requests: unknown[] }).toMatchObject({ requests: [] });
});

it('issues and atomically replaces an unpaid consultation fee, but refuses a paid invoice', async () => {
  const submitted = await post('/api/consultations/requests', 'customer', {
    profileId,
    productId,
    submissionKey: randomUUID(),
  });
  expect(submitted.status, http.logs()).toBe(201);
  const requestId = ((await submitted.json()) as { requestId: string }).requestId;
  const root = `/api/admin/consultations/requests/${requestId}`;
  const validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const firstOffer = {
    idempotencyKey: randomUUID(),
    fee: '500000',
    scope: 'Station feasibility review',
    deliverables: 'Written feasibility report',
    validUntil,
  };
  expect((await post(`${root}/fee`, 'reviewer', firstOffer)).status).toBe(409);
  expect((await post(`${root}/review`, 'reviewer', {})).status).toBe(200);
  const offered = await post(`${root}/fee`, 'reviewer', firstOffer);
  expect(offered.status, http.logs()).toBe(200);
  const firstId = ((await offered.json()) as { invoiceId: string }).invoiceId;
  const replayed = await post(`${root}/fee`, 'reviewer', firstOffer);
  expect(replayed.status, http.logs()).toBe(200);
  expect(await replayed.json()).toMatchObject({ invoiceId: firstId });
  const acceptance = await post(`/api/consultations/requests/${requestId}/accept`, 'customer', {});
  expect(acceptance.status, http.logs()).toBe(200);
  const firstInvoice = (
    await http.pool.query(
      'SELECT consultation_id,profile_id,state,total_amount FROM invoices WHERE id=$1',
      [firstId]
    )
  ).rows[0];
  expect(firstInvoice).toMatchObject({
    consultation_id: requestId,
    profile_id: profileId,
    state: 'Unpaid',
    total_amount: '500000',
  });
  const revised = await post(`${root}/fee`, 'reviewer', {
    ...firstOffer,
    idempotencyKey: randomUUID(),
    fee: '600000',
    reason: 'Additional engineering analysis is needed',
  });
  expect(revised.status, http.logs()).toBe(200);
  const secondId = ((await revised.json()) as { invoiceId: string }).invoiceId;
  expect(secondId).not.toBe(firstId);
  const invoices = (
    await http.pool.query(
      'SELECT id,state,total_amount,replaces_invoice_id,consultation_id FROM invoices WHERE id=ANY($1::uuid[]) ORDER BY created_at,id',
      [[firstId, secondId]]
    )
  ).rows;
  expect(invoices.find((row) => row.id === firstId)?.state).toBe('Cancelled');
  expect(invoices.find((row) => row.id === secondId)).toMatchObject({
    state: 'Unpaid',
    total_amount: '600000',
    replaces_invoice_id: firstId,
    consultation_id: requestId,
  });
  const staffDetail = await fetch(`${http.base}${root}`, { headers: headers.reviewer! });
  expect(staffDetail.status, http.logs()).toBe(200);
  expect(await staffDetail.json()).toMatchObject({
    request: {
      invoice_id: secondId,
      invoice_state: 'Unpaid',
      fee: '600000',
      scope: firstOffer.scope,
      deliverables: firstOffer.deliverables,
    },
  });
  const detail = await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
    headers: headers.customer!,
  });
  const body = (await detail.json()) as {
    request: { status: string; invoice_id: string; fee: string };
    history: Array<{ status: string }>;
  };
  expect(body.request).toMatchObject({
    status: 'offer_pending',
    invoice_id: secondId,
    fee: '600000',
  });
  const offerList = await fetch(`${http.base}/api/consultations/requests?profileId=${profileId}`, {
    headers: headers.customer!,
  });
  expect(offerList.status, http.logs()).toBe(200);
  const offerRows = (await offerList.json()) as {
    requests: Array<Record<string, unknown>>;
  };
  expect(offerRows.requests.find((row) => row.id === requestId)).toMatchObject({
    invoice_id: secondId,
    invoice_state: 'Unpaid',
    offer_valid_until: validUntil,
    accepted_at: null,
    refund_pending: false,
  });
  expect(
    (
      await http.pool.query('SELECT accepted_at FROM consultation_requests WHERE id=$1', [
        requestId,
      ])
    ).rows[0]?.accepted_at
  ).toBeNull();
  expect(body.history.map((event) => event.status)).toEqual([
    'submitted',
    'under_review',
    'offer_pending',
    'offer_pending',
    'under_review',
    'offer_pending',
  ]);
  await http.pool.query("UPDATE invoices SET state='Paid',paid_amount=600000 WHERE id=$1", [
    secondId,
  ]);
  const afterPayment = await post(`${root}/fee`, 'reviewer', {
    ...firstOffer,
    idempotencyKey: randomUUID(),
    fee: '700000',
    reason: 'Do not replace after payment',
  });
  expect(afterPayment.status, http.logs()).toBe(409);
  expect(
    (
      await http.pool.query('SELECT invoice_id,fee FROM consultation_requests WHERE id=$1', [
        requestId,
      ])
    ).rows[0]
  ).toMatchObject({ invoice_id: secondId, fee: '600000' });

  const another = await post('/api/consultations/requests', 'customer', {
    profileId,
    productId,
    submissionKey: randomUUID(),
  });
  expect(another.status, http.logs()).toBe(201);
  const anotherId = ((await another.json()) as { requestId: string }).requestId;
  const anotherRoot = `/api/admin/consultations/requests/${anotherId}`;
  expect((await post(`${anotherRoot}/review`, 'reviewer', {})).status).toBe(200);
  const anotherOffer = await post(`${anotherRoot}/fee`, 'reviewer', {
    ...firstOffer,
    idempotencyKey: randomUUID(),
  });
  expect(anotherOffer.status, http.logs()).toBe(200);
  const anotherInvoiceId = ((await anotherOffer.json()) as { invoiceId: string }).invoiceId;
  const cancelled = await post(`${anotherRoot}/cancel`, 'reviewer', {
    reason: 'Customer requested cancellation',
  });
  expect(cancelled.status, http.logs()).toBe(200);
  expect((await cancelled.json()) as { status: string }).toMatchObject({ status: 'cancelled' });
  expect(
    (await http.pool.query('SELECT state FROM invoices WHERE id=$1', [anotherInvoiceId])).rows[0]
  ).toMatchObject({ state: 'Cancelled' });
});
