import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { activateReadyContracts } from '@barghsa/db/contract-activation';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let staffHeaders: Record<string, string>;
let input: Record<string, unknown>;

beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('buyer','buyer@electricity.test','test-only')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,'buyer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES('reviewer','reviewer@electricity.test','test-only',true)"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('reviewer','role-legal-contracts')"
  );
  const staffSession = randomUUID(),
    staffCsrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,'reviewer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [staffSession, staffCsrf, randomUUID()]
  );
  staffHeaders = {
    Cookie: `barghsa_session=${staffSession}`,
    'X-CSRF-Token': staffCsrf,
    'Content-Type': 'application/json',
  };
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('buyer','LEGAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    `INSERT INTO products(type,system_key,title,status,price)
     VALUES ('electricity','thermal','{"en":"Thermal"}','active',100000)
     ON CONFLICT (system_key) DO UPDATE SET status='active',price=100000`
  );
  await http.pool.query(
    `INSERT INTO products(type,system_key,title,status,price)
     VALUES ('electricity','green','{"en":"Green"}','active',200000)
     ON CONFLICT (system_key) DO UPDATE SET status='active',price=200000`
  );
  const provinceId = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان','Province') RETURNING id"
    )
  ).rows[0].id;
  const cityId = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر','City') RETURNING id",
      [provinceId]
    )
  ).rows[0].id;
  input = {
    profileId,
    period: 'next_week',
    totalKwh: '10',
    idempotencyKey: randomUUID(),
    address: { provinceId, cityId, fullAddress: 'Electricity Street', postalCode: '1234567890' },
  };
  await refreshQuote();
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);

const post = (path: string, body: unknown) =>
  fetch(`${http.base}/api/electricity/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

async function refreshQuote() {
  const response = await post('preview/simple', {
    profileId: input.profileId,
    period: input.period,
    totalKwh: input.totalKwh,
    ...('giftCode' in input ? { giftCode: input.giftCode } : {}),
  });
  expect(response.status, http.logs()).toBe(200);
  input.expectedQuoteDigest = ((await response.json()) as { reviewDigest: string }).reviewDigest;
}

async function submittedOrder() {
  const response = await post('orders/simple', input);
  expect(response.status, http.logs()).toBe(201);
  return (await response.json()) as {
    orderId: string;
    contractId: string;
    invoiceId: string;
  };
}

const staffPost = (id: string, decision: string, body: unknown) =>
  fetch(`${http.base}/api/staff/electricity/orders/${id}/${decision}`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify(body),
  });

it('queues the exact order for staff and approves it once with customer notification', async () => {
  const order = await submittedOrder();
  const queueResponse = await fetch(`${http.base}/api/staff/electricity/orders`, {
    headers: staffHeaders,
  });
  expect(queueResponse.status, http.logs()).toBe(200);
  expect((await fetch(`${http.base}/api/staff/electricity/orders`, { headers })).status).toBe(403);
  const queue = (await queueResponse.json()) as { orders: Array<{ orderId: string }> };
  expect(queue.orders.map((entry) => entry.orderId)).toContain(order.orderId);
  const detailResponse = await fetch(`${http.base}/api/staff/electricity/orders/${order.orderId}`, {
    headers: staffHeaders,
  });
  expect(detailResponse.status, http.logs()).toBe(200);
  const detail = (await detailResponse.json()) as { versionId: string; contractSnapshot: unknown };
  expect(detail.contractSnapshot).toBeTruthy();
  const body = { idempotencyKey: randomUUID(), expectedVersionId: detail.versionId };
  const approved = await staffPost(order.orderId, 'approve', body);
  expect(approved.status, http.logs()).toBe(200);
  expect(await approved.json()).toMatchObject({ orderId: order.orderId, status: 'approved' });
  const repeat = await staffPost(order.orderId, 'approve', body);
  expect(repeat.status, http.logs()).toBe(200);
  const saved = (
    await http.pool.query(
      `SELECT e.status,c.state,COUNT(cp.version_id)::int AS publication_count
       FROM electricity_orders e JOIN electricity_contracts ec ON ec.order_id=e.id
       JOIN contracts c ON c.id=ec.contract_id
       LEFT JOIN contract_publications cp ON cp.contract_id=c.id
       WHERE e.id=$1 GROUP BY e.status,c.state`,
      [order.orderId]
    )
  ).rows[0];
  expect(saved).toMatchObject({
    status: 'approved',
    state: 'AwaitingCustomerAcceptance',
    publication_count: 1,
  });
  const notices = (
    await http.pool.query(
      "SELECT COUNT(*)::int AS count FROM in_app_notifications WHERE recipient_user_id='buyer'"
    )
  ).rows[0].count;
  expect(notices).toBeGreaterThan(0);
});

it('requires a reason and leaves an unpaid rejected order financially closed', async () => {
  const order = await submittedOrder();
  const versionId = (
    await http.pool.query('SELECT current_version_id FROM contracts WHERE id=$1', [
      order.contractId,
    ])
  ).rows[0].current_version_id;
  const missingReason = await staffPost(order.orderId, 'reject', {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
  });
  expect(missingReason.status).toBe(400);
  const rejected = await staffPost(order.orderId, 'reject', {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
    reason: 'Cannot deliver at this address',
  });
  expect(rejected.status, http.logs()).toBe(200);
  const states = (
    await http.pool.query(
      `SELECT e.status,o.status AS order_status,c.state AS contract_state,i.state AS invoice_state
       FROM electricity_orders e JOIN orders o ON o.id=e.id
       JOIN electricity_contracts ec ON ec.order_id=e.id JOIN contracts c ON c.id=ec.contract_id
       JOIN invoices i ON i.order_id=o.id WHERE e.id=$1`,
      [order.orderId]
    )
  ).rows[0];
  expect(states).toMatchObject({
    status: 'rejected',
    order_status: 'CANCELLED',
    contract_state: 'Rejected',
    invoice_state: 'Cancelled',
  });
});

it('requests changes with a reason and returns the order to the customer', async () => {
  const order = await submittedOrder();
  const versionId = (
    await http.pool.query('SELECT current_version_id FROM contracts WHERE id=$1', [
      order.contractId,
    ])
  ).rows[0].current_version_id;
  const response = await staffPost(order.orderId, 'request-changes', {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
    reason: 'Please correct the delivery address',
  });
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'changes_requested' });
  const detail = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers });
  expect(await detail.json()).toMatchObject({
    electricityStatus: 'changes_requested',
    nextAction: 'resubmit_changes',
  });
  const corrected = {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
    fullAddress: 'Corrected Electricity Street',
    postalCode: '1234567890',
    responseNote: 'I corrected the delivery address',
  };
  const resubmit = () =>
    fetch(`${http.base}/api/electricity/orders/${order.orderId}/resubmit-address`, {
      method: 'POST',
      headers,
      body: JSON.stringify(corrected),
    });
  const first = await resubmit();
  expect(first.status, http.logs()).toBe(200);
  const result = (await first.json()) as { versionId: string; status: string };
  expect(result).toMatchObject({ status: 'awaiting_staff_review' });
  expect(result.versionId).not.toBe(versionId);
  expect((await resubmit()).status).toBe(200);
  const amended = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers });
  expect(await amended.json()).toMatchObject({
    electricityStatus: 'awaiting_staff_review',
    fullAddress: 'Corrected Electricity Street',
    versionId: result.versionId,
  });
  const amendedRequirements = (
    await http.pool.query(
      'SELECT initial_invoice_id,service_starts_at,service_ends_at FROM contract_activation_requirements WHERE version_id=$1',
      [result.versionId]
    )
  ).rows[0];
  expect(amendedRequirements.initial_invoice_id).toBe(order.invoiceId);
  expect(amendedRequirements.service_starts_at).not.toBeNull();
  expect(amendedRequirements.service_ends_at).not.toBeNull();
  const queue = await fetch(`${http.base}/api/staff/electricity/orders`, { headers: staffHeaders });
  const queueBody = (await queue.json()) as {
    orders: Array<{ orderId: string; versionId: string }>;
  };
  expect(queueBody.orders).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ orderId: order.orderId, versionId: result.versionId }),
    ])
  );
  const stale = await staffPost(order.orderId, 'approve', {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
  });
  expect(stale.status).toBe(409);
});

it('creates a mandatory refund obligation when a paid order is rejected', async () => {
  const order = await submittedOrder();
  await http.pool.query(
    "UPDATE invoices SET paid_amount=500000,state='PartiallyFunded' WHERE id=$1",
    [order.invoiceId]
  );
  const versionId = (
    await http.pool.query('SELECT current_version_id FROM contracts WHERE id=$1', [
      order.contractId,
    ])
  ).rows[0].current_version_id;
  const response = await staffPost(order.orderId, 'reject', {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
    reason: 'Cannot deliver at this address',
  });
  expect(response.status, http.logs()).toBe(200);
  const obligation = (
    await http.pool.query('SELECT * FROM refund_obligations WHERE order_id=$1', [order.orderId])
  ).rows[0];
  expect(obligation).toMatchObject({
    invoice_id: order.invoiceId,
    status: 'pending',
    total_paid_amount: '500000',
    completed_refund_amount: '0',
  });
  const refund = (
    await http.pool.query('SELECT * FROM refunds WHERE id=$1', [obligation.refund_id])
  ).rows[0];
  expect(refund).toMatchObject({ amount: '500000', state: 'Requested', destination: 'wallet' });
  const customerDetail = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, {
    headers,
  });
  expect(await customerDetail.json()).toMatchObject({
    electricityStatus: 'rejected',
    financialStatus: 'refund_pending',
    nextAction: 'await_refund',
  });
  await expect(
    http.pool.query('UPDATE invoices SET paid_amount=600000 WHERE id=$1', [order.invoiceId])
  ).rejects.toThrow('Electricity order is unavailable for payment');
});

it('funds the linked invoice and activates only after customer acceptance', async () => {
  const order = await submittedOrder();
  const versionId = (
    await http.pool.query('SELECT current_version_id FROM contracts WHERE id=$1', [
      order.contractId,
    ])
  ).rows[0].current_version_id as string;
  await http.pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance)
     VALUES($1,1500000,0) ON CONFLICT (profile_id)
     DO UPDATE SET posted_balance=1500000,reserved_balance=0`,
    [input.profileId]
  );
  const approved = await staffPost(order.orderId, 'approve', {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
  });
  expect(approved.status, http.logs()).toBe(200);
  expect((await activateReadyContracts(http.pool)).activated).toBe(0);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='buyer'");
  const paymentPath = `${http.base}/api/invoices/${order.invoiceId}/wallet-payment`;
  const walletReviewResponse = await fetch(paymentPath, { headers });
  expect(walletReviewResponse.status, http.logs()).toBe(200);
  const walletReview = (await walletReviewResponse.json()) as { review: { hash: string } };
  const payment = await fetch(paymentPath, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      expectedRemainingAmount: '1000000',
      expectedReviewHash: walletReview.review.hash,
    }),
  });
  expect(payment.status, http.logs()).toBe(200);
  expect((await activateReadyContracts(http.pool)).activated).toBe(0);
  const acceptanceReview = await fetch(
    `${http.base}/api/contracts/${order.contractId}/acceptance-review?versionId=${versionId}`,
    { headers }
  );
  expect(acceptanceReview.status, http.logs()).toBe(200);
  const acceptance = (await acceptanceReview.json()) as { hash: string };
  const accepted = await fetch(`${http.base}/api/contracts/${order.contractId}/accept`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      expectedVersionId: versionId,
      expectedReviewHash: acceptance.hash,
    }),
  });
  expect(accepted.status, http.logs()).toBe(200);
  const beforeActivation = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, {
    headers,
  });
  expect(await beforeActivation.json()).toMatchObject({
    electricityStatus: 'approved',
    financialStatus: 'paid',
    nextAction: 'await_activation',
    paidIrR: '1000000',
  });
  expect((await activateReadyContracts(http.pool)).activated).toBe(1);
  const detail = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, {
    headers,
  });
  expect(await detail.json()).toMatchObject({
    electricityStatus: 'active',
    financialStatus: 'paid',
    contractState: 'Active',
  });
  const parent = (await http.pool.query('SELECT status FROM orders WHERE id=$1', [order.orderId]))
    .rows[0];
  expect(parent.status).toBe('CONFIRMED');
});

it('previews and atomically submits an order, contract, lines and payable invoice once', async () => {
  const preview = await post('preview/simple', {
    profileId: input.profileId,
    period: input.period,
    totalKwh: input.totalKwh,
  });
  expect(preview.status, http.logs()).toBe(200);
  const quote = (await preview.json()) as Record<string, unknown>;
  expect(quote).toMatchObject({ totalKwh: '10', subtotalIrR: '1000000', totalIrR: '1000000' });
  const first = await post('orders/simple', input);
  expect(first.status, http.logs()).toBe(201);
  const result = (await first.json()) as {
    orderId: string;
    contractId: string;
    invoiceId: string;
    totalIrR: string;
  };
  expect(result.totalIrR).toBe('1000000');
  const detail = await fetch(`${http.base}/api/electricity/orders/${result.orderId}`, { headers });
  expect(detail.status, http.logs()).toBe(200);
  expect(await detail.json()).toMatchObject({
    orderId: result.orderId,
    contractId: result.contractId,
    invoiceId: result.invoiceId,
    totalIrR: '1000000',
    electricityStatus: 'awaiting_staff_review',
    financialStatus: 'unpaid',
    nextAction: 'await_review',
  });
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('other-buyer','other@electricity.test','test-only')"
  );
  const otherSession = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,'other-buyer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [otherSession, randomUUID(), randomUUID()]
  );
  expect(
    (
      await fetch(`${http.base}/api/electricity/orders/${result.orderId}`, {
        headers: { Cookie: `barghsa_session=${otherSession}` },
      })
    ).status
  ).toBe(404);
  const repeat = await post('orders/simple', input);
  expect(repeat.status, http.logs()).toBe(201);
  expect(await repeat.json()).toEqual(result);
  const altered = await post('orders/simple', { ...input, totalKwh: '11' });
  expect(altered.status).toBe(409);
  const saved = (
    await http.pool.query(
      `SELECT o.status AS order_status,e.status AS electricity_status,e.total_kwh,
            c.state AS contract_state,i.state AS invoice_state,i.total_amount,
            (SELECT COUNT(*)::int FROM electricity_order_lines WHERE order_id=o.id) AS line_count
       FROM orders o JOIN electricity_orders e ON e.id=o.id
       JOIN contracts c ON c.id=$2 JOIN invoices i ON i.id=$3 WHERE o.id=$1`,
      [result.orderId, result.contractId, result.invoiceId]
    )
  ).rows[0];
  expect(saved).toMatchObject({
    order_status: 'PENDING',
    electricity_status: 'awaiting_staff_review',
    total_kwh: '10',
    contract_state: 'AwaitingStaffReview',
    invoice_state: 'Unpaid',
    total_amount: '1000000',
    line_count: 1,
  });
  const requirements = (
    await http.pool.query(
      `SELECT r.initial_invoice_id,r.service_starts_at,r.service_ends_at,r.payment_required
       FROM contracts c JOIN contract_activation_requirements r ON r.version_id=c.current_version_id
       WHERE c.id=$1`,
      [result.contractId]
    )
  ).rows[0];
  expect(requirements).toMatchObject({
    initial_invoice_id: result.invoiceId,
    payment_required: true,
  });
  expect(requirements.service_starts_at).not.toBeNull();
  expect(requirements.service_ends_at).not.toBeNull();
  const count = (
    await http.pool.query(
      'SELECT COUNT(*)::int AS count FROM electricity_order_submissions WHERE user_id=$1',
      ['buyer']
    )
  ).rows[0].count;
  expect(count).toBe(1);
});

it('allows manual quantity when bill provider is unconfigured', async () => {
  const response = await fetch(
    `${http.base}/api/electricity/bill-data/${input.profileId}?period=next_week`,
    { headers }
  );
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toMatchObject({ available: false, manualEntryAllowed: true });
});

it('freezes the mandatory green and gift composition into one invoice', async () => {
  await http.pool.query(
    `INSERT INTO app_config(key,value,version) VALUES('electricity.green_mandatory_rules',$1::jsonb,1)`,
    [
      JSON.stringify({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 0,
          mandatory_green_share_percent: 20,
        },
        advanced_order: {
          mandatory_green_enabled: false,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
      }),
    ]
  );
  await http.pool.query(
    `INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,created_by)
     VALUES('POWER','fixed_irr',100000,'2026-01-01','buyer')`
  );
  input.giftCode = 'power';
  await refreshQuote();
  const response = await post('orders/simple', input);
  expect(response.status, http.logs()).toBe(201);
  const order = (await response.json()) as {
    orderId: string;
    invoiceId: string;
    lines: Array<{ systemKey: string; quantityKwh: string }>;
    totalIrR: string;
    discountIrR: string;
  };
  expect(order.lines.map((line) => [line.systemKey, line.quantityKwh])).toEqual([
    ['thermal', '8'],
    ['green', '2'],
  ]);
  expect(order.discountIrR).toBe('100000');
  expect(order.totalIrR).toBe('1100000');
  const invoice = (
    await http.pool.query(
      `SELECT i.total_amount, i.invoice_calculation_snapshot, o.gift_discount_amount,
            (SELECT COUNT(*)::int FROM invoice_lines WHERE invoice_id=i.id) AS line_count
       FROM invoices i JOIN orders o ON o.id=i.order_id WHERE i.id=$1`,
      [order.invoiceId]
    )
  ).rows[0];
  expect(invoice).toMatchObject({
    total_amount: '1100000',
    gift_discount_amount: '100000',
    line_count: 2,
  });
  expect(invoice.invoice_calculation_snapshot.lines).toHaveLength(2);
});

it('serializes concurrent retries and rolls back rejected product submissions', async () => {
  const [first, second] = await Promise.all([
    post('orders/simple', input),
    post('orders/simple', input),
  ]);
  expect(first.status, http.logs()).toBe(201);
  expect(second.status, http.logs()).toBe(201);
  expect(await first.json()).toEqual(await second.json());
  await http.pool.query("UPDATE products SET status='inactive' WHERE system_key='thermal'");
  const failed = await post('orders/simple', { ...input, idempotencyKey: randomUUID() });
  expect(failed.status).toBe(400);
  const count = (
    await http.pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE user_id=$1', ['buyer'])
  ).rows[0].n;
  expect(count).toBe(1);
});

it('rejects a reviewed quote after its authoritative price changes', async () => {
  await http.pool.query("UPDATE products SET price=150000 WHERE system_key='thermal'");
  const response = await post('orders/simple', input);
  expect(response.status, http.logs()).toBe(409);
  const count = (
    await http.pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE user_id=$1', ['buyer'])
  ).rows[0].n;
  expect(count).toBe(0);
});

it('resumes completed steps and removes the draft atomically on submission', async () => {
  const path = `${http.base}/api/electricity/drafts/simple`;
  const get = () => fetch(`${path}?profileId=${input.profileId}`, { headers });
  const put = (currentStep: number, totalKwh?: string) =>
    fetch(path, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        profileId: input.profileId,
        currentStep,
        data: { period: 'next_week', ...(totalKwh ? { totalKwh } : {}) },
      }),
    });
  expect(await (await get()).json()).toMatchObject({ currentStep: 1, data: null });
  expect((await put(2)).status).toBe(200);
  expect((await put(3, '10')).status).toBe(200);
  expect((await put(3, 'invalid')).status).toBe(400);
  expect(await (await get()).json()).toMatchObject({
    currentStep: 3,
    data: { period: 'next_week', totalKwh: '10' },
  });
  expect((await post('orders/simple', input)).status).toBe(201);
  expect(await (await get()).json()).toMatchObject({ currentStep: 1, data: null });
});

it('expires old drafts using the configured retention period', async () => {
  const path = `${http.base}/api/electricity/drafts/simple`;
  const body = { profileId: input.profileId, currentStep: 2, data: { period: 'next_week' } };
  expect((await fetch(path, { method: 'PUT', headers, body: JSON.stringify(body) })).status).toBe(
    200
  );
  await http.pool.query(
    "UPDATE electricity_customer_drafts SET updated_at=NOW()-INTERVAL '8 days' WHERE profile_id=$1",
    [input.profileId]
  );
  const get = () => fetch(`${path}?profileId=${input.profileId}`, { headers });
  expect(await (await get()).json()).toMatchObject({ currentStep: 1, data: null });
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('electricity.order_draft_ttl_days','14')"
  );
  expect((await fetch(path, { method: 'PUT', headers, body: JSON.stringify(body) })).status).toBe(
    200
  );
  await http.pool.query(
    "UPDATE electricity_customer_drafts SET updated_at=NOW()-INTERVAL '8 days' WHERE profile_id=$1",
    [input.profileId]
  );
  expect(await (await get()).json()).toMatchObject({ currentStep: 2, data: body.data });
});
