import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
let productId: string;
const headers: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('consultation-payment-staff','Consultation payment staff','Test',
     '["orders:read","orders:write","invoices:write"]')`
  );
  for (const [user, isStaff] of [
    ['consultation-payer', false],
    ['consultation-finance', true],
  ] as const) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,$3,$4)',
      [user, `${user}@consultation-payment.test`, 'test-only', isStaff]
    );
    if (isStaff)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES('consultation-finance','consultation-payment-staff')"
      );
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
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('consultation-payer','LEGAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0].id as string;
  await http.pool.query(
    'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES($1,1000000,0)',
    [profileId]
  );
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

async function offer() {
  const created = await post('/api/consultations/requests', 'consultation-payer', {
    profileId,
    productId,
    submissionKey: randomUUID(),
  });
  expect(created.status, http.logs()).toBe(201);
  const requestId = ((await created.json()) as { requestId: string }).requestId;
  const root = `/api/admin/consultations/requests/${requestId}`;
  expect((await post(`${root}/review`, 'consultation-finance', {})).status).toBe(200);
  const offered = await post(`${root}/fee`, 'consultation-finance', {
    idempotencyKey: randomUUID(),
    fee: '500000',
    scope: 'Feasibility study',
    deliverables: 'Written report',
    validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  expect(offered.status, http.logs()).toBe(200);
  const invoiceId = ((await offered.json()) as { invoiceId: string }).invoiceId;
  return { requestId, invoiceId, root };
}

it('settles an accepted offer with a real wallet payment, then allows staff completion', async () => {
  const { requestId, invoiceId, root } = await offer();
  const accepted = await post(
    `/api/consultations/requests/${requestId}/accept`,
    'consultation-payer',
    {}
  );
  expect(accepted.status, http.logs()).toBe(200);
  expect(await accepted.json()).toMatchObject({
    status: 'offer_pending',
    paymentRequired: true,
    invoiceId,
  });
  expect(
    (await post(`${root}/complete`, 'consultation-finance', { reason: 'Too early' })).status
  ).toBe(409);
  const review = await fetch(`${http.base}/api/invoices/${invoiceId}/wallet-payment`, {
    headers: headers['consultation-payer']!,
  });
  expect(review.status, http.logs()).toBe(200);
  const context = (await review.json()) as {
    remainingAmount: string;
    canPay: boolean;
    review: { hash: string };
  };
  expect(context).toMatchObject({ remainingAmount: '500000', canPay: true });
  const payment = await post(`/api/invoices/${invoiceId}/wallet-payment`, 'consultation-payer', {
    idempotencyKey: randomUUID(),
    expectedRemainingAmount: context.remainingAmount,
    expectedReviewHash: context.review.hash,
  });
  expect(payment.status, http.logs()).toBe(200);
  expect(await payment.json()).toMatchObject({ state: 'Paid', invoiceId });
  const after = await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
    headers: headers['consultation-payer']!,
  });
  expect(after.status, http.logs()).toBe(200);
  const detail = (await after.json()) as {
    request: { status: string; accepted_at: string; invoice_state: string };
    history: Array<{ status: string }>;
  };
  expect(detail.request.status).toBe('offer_accepted');
  expect(detail.request.invoice_state).toBe('Paid');
  expect(detail.request.accepted_at).toBeTruthy();
  const invoiceDetail = await fetch(`${http.base}/api/invoices/${invoiceId}`, {
    headers: headers['consultation-payer']!,
  });
  expect(invoiceDetail.status, http.logs()).toBe(200);
  expect(await invoiceDetail.json()).toMatchObject({ consultationId: requestId });
  expect(detail.history.map((event) => event.status)).toEqual([
    'submitted',
    'under_review',
    'offer_pending',
    'offer_pending',
    'offer_accepted',
  ]);
  const completed = await post(`${root}/complete`, 'consultation-finance', {
    reason: 'Feasibility report delivered',
  });
  expect(completed.status, http.logs()).toBe(200);
  expect(await completed.json()).toMatchObject({ status: 'completed' });
});

it('declines an offer and cancels its unpaid invoice', async () => {
  const { requestId, invoiceId } = await offer();
  const declined = await post(
    `/api/consultations/requests/${requestId}/decline`,
    'consultation-payer',
    {
      reason: 'The proposed scope is not needed',
    }
  );
  expect(declined.status, http.logs()).toBe(200);
  expect(await declined.json()).toMatchObject({ status: 'offer_declined' });
  expect(
    (await http.pool.query('SELECT state FROM invoices WHERE id=$1', [invoiceId])).rows[0]
  ).toMatchObject({ state: 'Cancelled' });
  expect(
    (await post(`/api/consultations/requests/${requestId}/accept`, 'consultation-payer', {})).status
  ).toBe(409);
});

it('accepts a previously paid invoice without losing the consultation status', async () => {
  const { requestId, invoiceId } = await offer();
  const review = await fetch(`${http.base}/api/invoices/${invoiceId}/wallet-payment`, {
    headers: headers['consultation-payer']!,
  });
  const context = (await review.json()) as {
    remainingAmount: string;
    review: { hash: string };
  };
  const payment = await post(`/api/invoices/${invoiceId}/wallet-payment`, 'consultation-payer', {
    idempotencyKey: randomUUID(),
    expectedRemainingAmount: context.remainingAmount,
    expectedReviewHash: context.review.hash,
  });
  expect(payment.status, http.logs()).toBe(200);
  expect(
    (await http.pool.query('SELECT status FROM consultation_requests WHERE id=$1', [requestId]))
      .rows[0]
  ).toMatchObject({ status: 'offer_pending' });
  const accepted = await post(
    `/api/consultations/requests/${requestId}/accept`,
    'consultation-payer',
    {}
  );
  expect(accepted.status, http.logs()).toBe(200);
  expect(await accepted.json()).toMatchObject({ status: 'offer_accepted', paymentRequired: false });
});
