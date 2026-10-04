import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { startHttpFixture } from '../test/http-fixture.js';
import {
  consultationFeeEffects,
  consultationReplayActor,
  waitForCapturedConsultationDeadline,
} from '../test/consultation-fee-http-proof.js';

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

async function offerFee(path: string, user: string, body: Record<string, unknown>) {
  const { idempotencyKey: _key, ...terms } = body;
  const preview = await post(path.replace(/\/fee$/, '/fee-review'), user, terms);
  if (!preview.ok) return preview;
  const review = (await preview.json()) as { hash: string };
  return post(path, user, { ...body, expectedReviewHash: review.hash });
}

async function decide(path: string, user: string, body: Record<string, unknown> = {}) {
  const decision = path.endsWith('/decline') ? 'decline' : 'accept';
  const preview = await post(path.replace(/\/(accept|decline)$/, '/offer-review'), user, {
    decision,
  });
  if (!preview.ok) return preview;
  const review = (await preview.json()) as { hash: string };
  return post(path, user, { ...body, expectedReviewHash: review.hash });
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
    requests: [{ id: requestId, staff_owner_id: null, staff_owner_name: null, staff_team: null }],
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
  await http.pool.query(
    "INSERT INTO conversation_identities(user_id,display_name,share_in_activity) VALUES('customer','Support-only customer',false),('reviewer','Chosen consultation staff',true)"
  );
  const detail = await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
    headers: headers.customer!,
  });
  expect(detail.status, http.logs()).toBe(200);
  const body = (await detail.json()) as {
    request: { status: string };
    history: Array<{
      status: string;
      actor_type: string;
      actor_name: string | null;
      reason: string | null;
    }>;
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
  expect(body.history.map((event) => event.actor_name)).toEqual([
    null,
    'Chosen consultation staff',
    'Chosen consultation staff',
    null,
    'Chosen consultation staff',
  ]);
  expect(JSON.stringify(body.history)).not.toMatch(
    /actor_user_id|@consultation-flow.test|Support-only customer/
  );
  const staffDetail = await fetch(`${http.base}${root}`, { headers: headers.reviewer! });
  expect(staffDetail.status).toBe(200);
  expect(await staffDetail.json()).toMatchObject({
    request: {
      id: requestId,
      staff_owner_id: 'reviewer',
      staff_owner_name: 'Chosen consultation staff',
    },
    history: expect.arrayContaining([
      expect.objectContaining({ actor_name: 'Chosen consultation staff' }),
    ]),
  });
  await http.pool.query(
    "UPDATE conversation_identities SET share_in_activity=false WHERE user_id='reviewer'"
  );
  const cleared = (await (
    await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
      headers: headers.customer!,
    })
  ).json()) as { history: Array<{ actor_name: string | null }> };
  expect(cleared.history.every((event) => event.actor_name === null)).toBe(true);
  const clearedStaff = await fetch(`${http.base}${root}`, { headers: headers.reviewer! });
  expect(clearedStaff.status).toBe(200);
  expect(await clearedStaff.json()).toMatchObject({
    request: { id: requestId, staff_owner_id: 'reviewer', staff_owner_name: null },
    history: expect.arrayContaining([expect.objectContaining({ actor_name: null })]),
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
  const staffTeamDetail = await fetch(`${http.base}/api/admin/consultations/requests/${secondId}`, {
    headers: headers.reviewer!,
  });
  expect(staffTeamDetail.status).toBe(200);
  expect(await staffTeamDetail.json()).toMatchObject({
    request: {
      id: secondId,
      staff_owner_id: null,
      staff_owner_name: null,
      staff_team: 'Consultation team',
    },
  });
  const unassigned = await fetch(
    `${http.base}/api/admin/consultations/requests?assignment=unassigned`,
    {
      headers: headers.reviewer!,
    }
  );
  expect((await unassigned.json()) as { requests: unknown[] }).toMatchObject({ requests: [] });
});

it('projects only consented consultation owner names without changing queue paging or selected detail', async () => {
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_staff)
     VALUES('context-named','private-named-login@example.test','test-only',true),
       ('context-hidden','private-hidden-login@example.test','test-only',true)`
  );
  await http.pool.query(
    `INSERT INTO profiles(user_id,profile_type,status,is_default,first_name,last_name)
     VALUES('context-named','INDIVIDUAL','ACTIVE',true,'Private named','Profile'),
       ('context-hidden','INDIVIDUAL','ACTIVE',true,'Private hidden','Profile')`
  );
  await http.pool.query(
    `INSERT INTO conversation_identities(user_id,display_name,share_in_activity)
     VALUES('context-named','Chosen consultation owner',true),
       ('context-hidden','Support-only owner',false)`
  );
  const ids = Array.from({ length: 101 }, () => randomUUID());
  await http.pool.query(
    `INSERT INTO consultation_requests(id,profile_id,product_id,product_snapshot,submitted_by,
       submission_key,staff_owner_id,staff_team,status,submitted_at)
     SELECT id,$2,$3,'{"title":{"en":"Assignment context","fa":"مسئول مشاوره"}}'::jsonb,
       'customer',id,CASE n%4 WHEN 0 THEN 'context-named' WHEN 1 THEN 'context-hidden' ELSE NULL END,
       CASE WHEN n%4=2 THEN 'Operations team' END,'submitted',NOW()-INTERVAL '20 days'+n*INTERVAL '1 second'
     FROM unnest($1::uuid[]) WITH ORDINALITY AS seed(id,n)`,
    [ids, profileId, productId]
  );
  const path = '/api/admin/consultations/requests?status=submitted&priority=high&minAgeDays=7';
  const queue = await fetch(`${http.base}${path}`, { headers: headers.reviewer! });
  expect(queue.status, http.logs()).toBe(200);
  const page = (await queue.json()) as {
    requests: Array<{
      id: string;
      staff_owner_id: string | null;
      staff_owner_name: string | null;
      staff_team: string | null;
    }>;
    nextAfter: string | null;
  };
  expect(page.requests.map((row) => row.id)).toEqual(ids.slice(0, 100));
  expect(page.nextAfter).toBe(ids[99]);
  for (const [index, row] of page.requests.entries()) {
    const n = index + 1;
    expect(row).toMatchObject({
      staff_owner_id: n % 4 === 0 ? 'context-named' : n % 4 === 1 ? 'context-hidden' : null,
      staff_owner_name: n % 4 === 0 ? 'Chosen consultation owner' : null,
      staff_team: n % 4 === 2 ? 'Operations team' : null,
    });
  }
  expect(JSON.stringify(page)).not.toMatch(
    /private-.*login|Private (named|hidden)|Support-only owner/
  );
  const next = await fetch(`${http.base}${path}&after=${page.nextAfter}`, {
    headers: headers.reviewer!,
  });
  expect(next.status, http.logs()).toBe(200);
  expect(await next.json()).toMatchObject({
    requests: [{ id: ids[100], staff_owner_id: 'context-hidden', staff_owner_name: null }],
    nextAfter: null,
  });
  const selected = () =>
    fetch(`${http.base}/api/admin/consultations/requests/${ids[3]}`, {
      headers: headers.reviewer!,
    });
  const detail = await selected();
  expect(detail.status, http.logs()).toBe(200);
  expect(await detail.json()).toMatchObject({
    request: {
      id: ids[3],
      staff_owner_id: 'context-named',
      staff_owner_name: 'Chosen consultation owner',
    },
  });
  await http.pool.query(
    "UPDATE conversation_identities SET share_in_activity=false WHERE user_id='context-named'"
  );
  expect(await (await selected()).json()).toMatchObject({
    request: { id: ids[3], staff_owner_name: null },
  });
  await http.pool.query(
    "UPDATE conversation_identities SET share_in_activity=true WHERE user_id='context-named'"
  );
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='context-named'");
  expect(await (await selected()).json()).toMatchObject({
    request: { id: ids[3], staff_owner_name: null },
  });
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
  expect((await offerFee(`${root}/fee`, 'reviewer', firstOffer)).status).toBe(409);
  expect((await post(`${root}/review`, 'reviewer', {})).status).toBe(200);
  const invalidOffer = { ...firstOffer, expectedReviewHash: 'a'.repeat(64) };
  const rejectedFee = async (
    route: string,
    body: unknown,
    fields?: string[],
    status = 400,
    user = 'reviewer'
  ) => {
    const before = await consultationFeeEffects(http.pool, requestId);
    const response = await post(route, user, body);
    expect(response.status, http.logs()).toBe(status);
    const failure = await response.json();
    expect(failure).toHaveProperty(
      'error.correlationId',
      expect.stringMatching(/^[0-9a-f-]{36}$/i)
    );
    expect(JSON.stringify(failure)).not.toContain('PRIVATE');
    if (fields) expect(failure).toHaveProperty('error.fields', fields);
    else expect(failure).not.toHaveProperty('error.fields');
    expect(await consultationFeeEffects(http.pool, requestId)).toEqual(before);
  };
  for (const [route, body] of [
    [
      `${root}/fee-review`,
      {
        fee: firstOffer.fee,
        scope: firstOffer.scope,
        deliverables: firstOffer.deliverables,
        validUntil,
      },
    ],
    [`${root}/fee`, invalidOffer],
  ] as const) {
    for (const [invalid, fields] of [
      [{ ...body, fee: '0' }, ['fee']],
      [{ ...body, fee: '9223372036854775808' }, ['fee']],
      [{ ...body, scope: 'x'.repeat(4001) }, ['scope']],
      [{ ...body, deliverables: '' }, ['deliverables']],
      [{ ...body, validUntil: '2000-01-01T00:00:00Z' }, ['validUntil']],
      [{ ...body, reason: 'x'.repeat(2001) }, ['reason']],
    ] as const)
      await rejectedFee(route, invalid, [...fields]);
    for (const invalid of [
      { ...body, fee: '0', extra: 'PRIVATE' },
      null,
      ...(route.endsWith('/fee')
        ? [
            { ...body, idempotencyKey: 'PRIVATE', fee: '0' },
            { ...body, expectedReviewHash: 'PRIVATE' },
          ]
        : []),
    ])
      await rejectedFee(route, invalid);
    await rejectedFee(
      route.replace(requestId, randomUUID()),
      { ...body, fee: '0' },
      undefined,
      404
    );
    await rejectedFee(route, { ...body, fee: '0' }, undefined, 403, 'customer');
  }
  await http.pool.query(
    "UPDATE staff_roles SET permissions='[\"orders:write\"]' WHERE role_id='consultation-staff'"
  );
  try {
    await rejectedFee(
      `${root}/fee-review`,
      { fee: '0', scope: firstOffer.scope, deliverables: firstOffer.deliverables, validUntil },
      undefined,
      403
    );
  } finally {
    await http.pool.query(
      'UPDATE staff_roles SET permissions=\'["orders:read","orders:write","invoices:write"]\' WHERE role_id=\'consultation-staff\''
    );
  }
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='reviewer'");
  try {
    await rejectedFee(`${root}/fee`, { ...invalidOffer, fee: '0' }, undefined, 403);
  } finally {
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='reviewer'");
  }
  const firstPreview = await post(`${root}/fee-review`, 'reviewer', {
    fee: firstOffer.fee,
    scope: firstOffer.scope,
    deliverables: firstOffer.deliverables,
    validUntil: firstOffer.validUntil,
  });
  expect(firstPreview.status, http.logs()).toBe(200);
  const reviewed = (await firstPreview.json()) as {
    hash: string;
    data: { fee: string; outcome: string };
  };
  expect(reviewed.data).toMatchObject({ fee: '500000', outcome: 'issue_invoice' });
  expect((await post(`${root}/fee`, 'reviewer', firstOffer)).status).toBe(400);
  expect(
    (
      await post(`${root}/fee`, 'reviewer', {
        ...firstOffer,
        fee: '500001',
        expectedReviewHash: reviewed.hash,
      })
    ).status
  ).toBe(409);
  const offered = await post(`${root}/fee`, 'reviewer', {
    ...firstOffer,
    expectedReviewHash: reviewed.hash,
  });
  expect(offered.status, http.logs()).toBe(200);
  const offerResult = (await offered.json()) as {
    invoiceId: string;
    financialReview: { hash: string };
  };
  const firstId = offerResult.invoiceId;
  expect(offerResult.financialReview.hash).toBe(reviewed.hash);
  const storedReview = (
    await http.pool.query<{ metadata: { financialReview: { hash: string } } }>(
      `SELECT metadata::jsonb AS metadata FROM audit_log
       WHERE event='consultation.request.changed'
         AND metadata::jsonb->>'requestId'=$1
         AND metadata::jsonb->>'action'='fee_offer_review'`,
      [requestId]
    )
  ).rows[0];
  expect(storedReview?.metadata.financialReview.hash).toBe(reviewed.hash);
  const replayed = await post(`${root}/fee`, 'reviewer', {
    ...firstOffer,
    expectedReviewHash: reviewed.hash,
  });
  expect(replayed.status, http.logs()).toBe(200);
  expect(await replayed.json()).toMatchObject({ invoiceId: firstId });
  const acceptance = await decide(`/api/consultations/requests/${requestId}/accept`, 'customer');
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
  const revisionInput = {
    ...firstOffer,
    idempotencyKey: randomUUID(),
    fee: '600000',
    reason: 'Additional engineering analysis is needed',
  };
  const revisionPreview = await post(`${root}/fee-review`, 'reviewer', {
    fee: revisionInput.fee,
    scope: revisionInput.scope,
    deliverables: revisionInput.deliverables,
    validUntil: revisionInput.validUntil,
    reason: revisionInput.reason,
  });
  expect(revisionPreview.status, http.logs()).toBe(200);
  const revisionReview = (await revisionPreview.json()) as {
    hash: string;
    data: { previousInvoice: { id: string; state: string; totalAmount: string } };
  };
  expect(revisionReview.data.previousInvoice).toMatchObject({
    id: firstId,
    state: 'Unpaid',
    totalAmount: '500000',
  });
  await http.pool.query("UPDATE invoices SET state='Overdue' WHERE id=$1", [firstId]);
  expect(
    (
      await post(`${root}/fee`, 'reviewer', {
        ...revisionInput,
        expectedReviewHash: revisionReview.hash,
      })
    ).status
  ).toBe(409);
  const revised = await offerFee(`${root}/fee`, 'reviewer', revisionInput);
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
  const afterPayment = await offerFee(`${root}/fee`, 'reviewer', {
    ...firstOffer,
    idempotencyKey: randomUUID(),
    fee: '700000',
    reason: 'Do not replace after payment',
  });
  expect(afterPayment.status, http.logs()).toBe(409);
  headers['fee-replay-reviewer'] = await consultationReplayActor(
    http.pool,
    'fee-replay-reviewer',
    'consultation-staff'
  );
  const progressEffects = await consultationFeeEffects(http.pool, requestId);
  const originalReplay = await post(`${root}/fee`, 'reviewer', {
    ...firstOffer,
    expectedReviewHash: reviewed.hash,
  });
  expect(originalReplay.status, http.logs()).toBe(200);
  expect(await originalReplay.json()).toEqual(offerResult);
  for (const [user, body] of [
    ['fee-replay-reviewer', { ...firstOffer, expectedReviewHash: reviewed.hash }],
    ['reviewer', { ...firstOffer, expectedReviewHash: 'a'.repeat(64) }],
    [
      'reviewer',
      { ...firstOffer, scope: 'PRIVATE changed scope', expectedReviewHash: reviewed.hash },
    ],
  ] as const)
    await rejectedFee(`${root}/fee`, body, undefined, 409, user);
  expect(await consultationFeeEffects(http.pool, requestId)).toEqual(progressEffects);
  const expiringSubmit = await post('/api/consultations/requests', 'customer', {
    profileId,
    productId,
    submissionKey: randomUUID(),
  });
  expect(expiringSubmit.status, http.logs()).toBe(201);
  const expiringId = ((await expiringSubmit.json()) as { requestId: string }).requestId;
  const expiringRoot = `/api/admin/consultations/requests/${expiringId}`;
  expect((await post(`${expiringRoot}/review`, 'reviewer', {})).status, http.logs()).toBe(200);
  const expiringBody = {
    ...firstOffer,
    idempotencyKey: randomUUID(),
    validUntil: new Date(Date.now() + 5000).toISOString(),
  };
  const expiringPreview = await post(`${expiringRoot}/fee-review`, 'reviewer', {
    fee: expiringBody.fee,
    scope: expiringBody.scope,
    deliverables: expiringBody.deliverables,
    validUntil: expiringBody.validUntil,
  });
  expect(expiringPreview.status, http.logs()).toBe(200);
  const expiringHash = ((await expiringPreview.json()) as { hash: string }).hash;
  const expiringCommand = { ...expiringBody, expectedReviewHash: expiringHash };
  const expiringWrite = await post(`${expiringRoot}/fee`, 'reviewer', expiringCommand);
  expect(expiringWrite.status, http.logs()).toBe(200);
  const expiringReceipt = await expiringWrite.json(),
    expiryEffects = await consultationFeeEffects(http.pool, expiringId);
  await waitForCapturedConsultationDeadline(expiringBody.validUntil);
  const expiredReplay = await post(`${expiringRoot}/fee`, 'reviewer', expiringCommand);
  expect(expiredReplay.status, http.logs()).toBe(200);
  expect(await expiredReplay.json()).toEqual(expiringReceipt);
  expect(await consultationFeeEffects(http.pool, expiringId)).toEqual(expiryEffects);
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
  const anotherOffer = await offerFee(`${anotherRoot}/fee`, 'reviewer', {
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
}, 30_000);

it('projects owned consultation reasons while retaining exact bounds, live authority and invoice step-up guards', async () => {
  const submitted = await post('/api/consultations/requests', 'customer', {
    profileId,
    productId,
    submissionKey: randomUUID(),
  });
  expect(submitted.status, http.logs()).toBe(201);
  const created = (await submitted.json()) as { requestId: string; status: string };
  expect(created).toEqual({ requestId: expect.any(String), status: 'submitted' });
  const requestId = created.requestId;
  const root = `/api/admin/consultations/requests/${requestId}`;
  const informationPath = `/api/consultations/requests/${requestId}/provide-info`;
  expect((await post(`${root}/review`, 'reviewer', {})).status).toBe(200);
  const snapshot = async () =>
    (
      await http.pool.query(
        `SELECT
         (SELECT to_jsonb(r) FROM consultation_requests r WHERE id=$1::uuid) AS request,
         (SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at,id)
          FROM consultation_request_events e WHERE request_id=$1::uuid) AS events,
         (SELECT jsonb_agg(to_jsonb(i) ORDER BY id)
          FROM invoices i WHERE consultation_id=$1::text) AS invoices,
         (SELECT count(*)::int FROM audit_log
          WHERE event LIKE 'consultation.%' AND metadata::jsonb->>'requestId'=$1::text) AS audits,
         (SELECT count(*)::int FROM in_app_notifications WHERE profile_id=$2::uuid) AS notifications`,
        [requestId, profileId]
      )
    ).rows[0];
  const reject = async (
    path: string,
    user: string,
    body: unknown,
    fields?: string[],
    status = 400
  ) => {
    const response = await post(path, user, body);
    expect(response.status, http.logs()).toBe(status);
    const receipt = (await response.json()) as { error: { code: string; fields?: string[] } };
    if (status === 400) expect(receipt.error.code).toBe(ErrorCodes.VALIDATION_INPUT_INVALID.code);
    expect(receipt.error.fields).toEqual(fields);
    expect(JSON.stringify(receipt)).not.toMatch(/PRIVATE|expectedReviewHash|privateKey/);
    return receipt;
  };
  const before = await snapshot();
  for (const action of ['request-info', 'complete', 'reject', 'cancel']) {
    await reject(`${root}/${action}`, 'reviewer', { reason: 'PRIVATE'.repeat(286) }, ['reason']);
    await reject(`${root}/${action}`, 'reviewer', { reason: '', privateKey: 'PRIVATE' });
    await reject(`${root}/${action}`, 'customer', { reason: '' }, undefined, 403);
  }
  await reject(informationPath, 'customer', { reason: ' ' }, ['reason']);
  await reject(informationPath, 'customer', { reason: [] }, ['reason']);
  await reject(informationPath, 'customer', { reason: '', expectedReviewHash: 'PRIVATE' });
  await reject(informationPath, 'customer', []);
  const permissions = (
    await http.pool.query<{ permissions: string }>(
      "SELECT permissions FROM staff_roles WHERE role_id='consultation-staff'"
    )
  ).rows[0]!.permissions;
  try {
    await http.pool.query(
      "UPDATE staff_roles SET permissions=$1 WHERE role_id='consultation-staff'",
      [JSON.stringify(['orders:read'])]
    );
    await reject(`${root}/request-info`, 'reviewer', { reason: '' }, undefined, 403);
  } finally {
    await http.pool.query(
      "UPDATE staff_roles SET permissions=$1 WHERE role_id='consultation-staff'",
      [permissions]
    );
  }
  expect(await snapshot()).toEqual(before);
  const requestedReason = 's'.repeat(2000);
  const requested = await post(`${root}/request-info`, 'reviewer', {
    reason: ` ${requestedReason} `,
  });
  expect(requested.status, http.logs()).toBe(200);
  expect(await requested.json()).toEqual({ requestId, status: 'awaiting_customer_info' });
  const waiting = await snapshot();
  const staffContextDenied = await reject(
    informationPath,
    'reviewer',
    { reason: 'Other actor' },
    undefined,
    403
  );
  expect(staffContextDenied.error.code).toBe(ErrorCodes.AUTHZ_FORBIDDEN.code);
  expect(await snapshot()).toEqual(waiting);
  const suppliedReason = 'c'.repeat(2000);
  const supplied = await post(informationPath, 'customer', { reason: ` ${suppliedReason} ` });
  expect(supplied.status, http.logs()).toBe(200);
  expect(await supplied.json()).toEqual({ requestId, status: 'under_review' });
  expect(
    (
      await http.pool.query(
        'SELECT status,reason FROM consultation_request_events WHERE request_id=$1 ORDER BY created_at,id',
        [requestId]
      )
    ).rows.slice(-2)
  ).toEqual([
    { status: 'awaiting_customer_info', reason: requestedReason },
    { status: 'under_review', reason: suppliedReason },
  ]);
  const offered = await offerFee(`${root}/fee`, 'reviewer', {
    idempotencyKey: randomUUID(),
    fee: '100000',
    scope: 'Existing invoice guards',
    deliverables: 'Written report',
    validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  expect(offered.status, http.logs()).toBe(200);
  const invoiced = await snapshot();
  try {
    await http.pool.query(
      "UPDATE staff_roles SET permissions=$1 WHERE role_id='consultation-staff'",
      [JSON.stringify(['orders:read', 'orders:write'])]
    );
    await reject(`${root}/reject`, 'reviewer', { reason: 'Valid rejection' }, undefined, 403);
  } finally {
    await http.pool.query(
      "UPDATE staff_roles SET permissions=$1 WHERE role_id='consultation-staff'",
      [permissions]
    );
  }
  expect(await snapshot()).toEqual(invoiced);
  const stepUp = (
    await http.pool.query<{ step_up_verified_at: string }>(
      "SELECT step_up_verified_at::text FROM sessions WHERE user_id='reviewer'"
    )
  ).rows[0]!.step_up_verified_at;
  try {
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='reviewer'");
    const denied = await reject(
      `${root}/cancel`,
      'reviewer',
      { reason: 'Valid cancellation' },
      undefined,
      403
    );
    expect(denied.error.code).toBe(ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code);
  } finally {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=$1::timestamptz WHERE user_id='reviewer'",
      [stepUp]
    );
  }
  expect(await snapshot()).toEqual(invoiced);
  const rejected = await post(`${root}/reject`, 'reviewer', { reason: 'r'.repeat(2000) });
  expect(rejected.status, http.logs()).toBe(200);
  expect(await rejected.json()).toEqual({ requestId, status: 'rejected' });
});
