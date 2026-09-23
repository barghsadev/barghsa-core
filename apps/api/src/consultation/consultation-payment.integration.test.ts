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
     '["orders:read","orders:write","invoices:write","admin:financial:edit"]')`
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
    'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES($1,3000000,0)',
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

async function pay(invoiceId: string) {
  const review = await fetch(`${http.base}/api/invoices/${invoiceId}/wallet-payment`, {
    headers: headers['consultation-payer']!,
  });
  expect(review.status, http.logs()).toBe(200);
  const context = (await review.json()) as {
    remainingAmount: string;
    review: { hash: string };
  };
  const paid = await post(`/api/invoices/${invoiceId}/wallet-payment`, 'consultation-payer', {
    idempotencyKey: randomUUID(),
    expectedRemainingAmount: context.remainingAmount,
    expectedReviewHash: context.review.hash,
  });
  expect(paid.status, await paid.clone().text()).toBe(200);
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

it('charges or credits a paid consultation without changing the paid invoice', async () => {
  const { requestId, invoiceId, root } = await offer();
  expect(
    (await post(`/api/consultations/requests/${requestId}/accept`, 'consultation-payer', {})).status
  ).toBe(200);
  await pay(invoiceId);
  const validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const chargeInput = {
    idempotencyKey: randomUUID(),
    fee: '600000',
    reason: 'Additional review required',
    validUntil,
  };
  const charge = await post(`${root}/paid-fee`, 'consultation-finance', chargeInput);
  expect(charge.status, http.logs()).toBe(200);
  const chargeBody = (await charge.json()) as {
    invoiceId: string;
    adjustmentInvoiceId: string;
    status: string;
  };
  expect(chargeBody).toMatchObject({
    status: 'offer_pending',
    invoiceId: chargeBody.adjustmentInvoiceId,
  });
  expect((await post(`${root}/paid-fee`, 'consultation-finance', chargeInput)).status).toBe(200);
  expect(
    (
      await post(`${root}/fee`, 'consultation-finance', {
        idempotencyKey: randomUUID(),
        fee: '700000',
        scope: 'Feasibility study',
        deliverables: 'Written report',
        validUntil,
        reason: 'Replace charge',
      })
    ).status
  ).toBe(409);
  expect(
    (
      await post(`${root}/paid-fee`, 'consultation-finance', {
        ...chargeInput,
        reason: 'Different reason',
      })
    ).status
  ).toBe(409);
  expect(
    (await post(`/api/consultations/requests/${requestId}/decline`, 'consultation-payer', {}))
      .status
  ).toBe(409);
  expect(
    (await post(`/api/consultations/requests/${requestId}/accept`, 'consultation-payer', {})).status
  ).toBe(200);
  await pay(chargeBody.invoiceId);
  const creditInput = {
    idempotencyKey: randomUUID(),
    fee: '450000',
    reason: 'Reduced review scope',
    validUntil,
  };
  const credit = await post(`${root}/paid-fee`, 'consultation-finance', creditInput);
  expect(credit.status, http.logs()).toBe(200);
  const creditBody = (await credit.json()) as {
    adjustmentInvoiceId: string;
    refundIds: string[];
    status: string;
  };
  expect(creditBody.status).toBe('offer_accepted');
  expect(creditBody.refundIds.length).toBeGreaterThan(0);
  expect((await post(`${root}/paid-fee`, 'consultation-finance', creditInput)).status).toBe(200);
  const original = (
    await http.pool.query<{ state: string; total_amount: string }>(
      'SELECT state,total_amount::text FROM invoices WHERE id=$1',
      [invoiceId]
    )
  ).rows[0];
  expect(original).toMatchObject({ state: 'Paid', total_amount: '500000' });
  const creditInvoice = (
    await http.pool.query<{ adjustment_kind: string; adjustment_for_invoice_id: string }>(
      'SELECT adjustment_kind,adjustment_for_invoice_id FROM invoices WHERE id=$1',
      [creditBody.adjustmentInvoiceId]
    )
  ).rows[0];
  expect(creditInvoice).toMatchObject({
    adjustment_kind: 'credit',
    adjustment_for_invoice_id: chargeBody.invoiceId,
  });
  const detail = await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
    headers: headers['consultation-payer']!,
  });
  expect(detail.status, http.logs()).toBe(200);
  const body = (await detail.json()) as {
    request: { fee: string; status: string };
    refunds: Array<{ id: string; amount: string }>;
  };
  expect(body).toMatchObject({
    request: { fee: '450000', status: 'offer_accepted' },
  });
  expect(body.refunds.map((refund) => refund.id).sort()).toEqual([...creditBody.refundIds].sort());
  expect(body.refunds.reduce((sum, refund) => sum + BigInt(refund.amount), 0n)).toBe(150000n);
  const rejected = await post(`${root}/paid-reject`, 'consultation-finance', {
    idempotencyKey: randomUUID(),
    reason: 'Service cannot be provided',
  });
  expect(rejected.status, http.logs()).toBe(200);
  const rejectedBody = (await rejected.json()) as { status: string; refundIds: string[] };
  expect(rejectedBody.status).toBe('rejected');
  expect(rejectedBody.refundIds.length).toBeGreaterThan(0);
  const finalRefunds = (
    await http.pool.query<{ amount: string }>(
      'SELECT amount::text FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE i.consultation_id=$1',
      [requestId]
    )
  ).rows;
  expect(finalRefunds.reduce((sum, refund) => sum + BigInt(refund.amount), 0n)).toBe(600000n);
});

it('cancels an unpaid revised charge and requests a refund for the prior paid consultation', async () => {
  const { requestId, invoiceId, root } = await offer();
  expect(
    (await post(`/api/consultations/requests/${requestId}/accept`, 'consultation-payer', {})).status
  ).toBe(200);
  await pay(invoiceId);
  const validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const revised = await post(`${root}/paid-fee`, 'consultation-finance', {
    idempotencyKey: randomUUID(),
    fee: '600000',
    reason: 'Additional review',
    validUntil,
  });
  expect(revised.status, http.logs()).toBe(200);
  const revisedInvoiceId = ((await revised.json()) as { invoiceId: string }).invoiceId;
  const input = { idempotencyKey: randomUUID(), reason: 'Customer cancelled the consultation' };
  const closed = await post(`${root}/paid-cancel`, 'consultation-finance', input);
  expect(closed.status, http.logs()).toBe(200);
  const result = (await closed.json()) as {
    status: string;
    cancelledInvoiceId: string;
    creditInvoiceIds: string[];
    refundIds: string[];
  };
  expect(result).toMatchObject({ status: 'cancelled', cancelledInvoiceId: revisedInvoiceId });
  expect(result.creditInvoiceIds).toHaveLength(1);
  expect(result.refundIds).toHaveLength(1);
  expect((await post(`${root}/paid-cancel`, 'consultation-finance', input)).status).toBe(200);
  expect(
    (
      await post(`${root}/paid-cancel`, 'consultation-finance', {
        ...input,
        reason: 'Changed reason',
      })
    ).status
  ).toBe(409);
  expect(
    (await http.pool.query('SELECT state FROM invoices WHERE id=$1', [revisedInvoiceId])).rows[0]
  ).toMatchObject({ state: 'Cancelled' });
  expect(
    (
      await http.pool.query(
        'SELECT state,total_amount::text AS total_amount FROM invoices WHERE id=$1',
        [invoiceId]
      )
    ).rows[0]
  ).toMatchObject({ state: 'Paid', total_amount: '500000' });
  const refund = (
    await http.pool.query('SELECT state,amount::text AS amount FROM refunds WHERE id=$1', [
      result.refundIds[0],
    ])
  ).rows[0];
  expect(refund).toMatchObject({ state: 'Requested', amount: '500000' });
  const customer = await fetch(`${http.base}/api/consultations/requests/${requestId}`, {
    headers: headers['consultation-payer']!,
  });
  expect(customer.status, http.logs()).toBe(200);
  expect(await customer.json()).toMatchObject({
    request: { status: 'cancelled' },
    refunds: [{ id: result.refundIds[0] }],
  });
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
