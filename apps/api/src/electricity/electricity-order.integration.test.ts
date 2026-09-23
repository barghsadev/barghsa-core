import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { activateReadyContracts } from '@barghsa/db/contract-activation';
import { retryDueWalletRefunds, runWalletRefund } from '@barghsa/db/refund-processing';
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

it('submits a four-product advanced bundle once with one contract and invoice', async () => {
  for (const [key, price] of [
    ['free_market', 300000],
    ['energy_saving', 400000],
  ] as const) {
    await http.pool.query(
      `INSERT INTO products(type,system_key,title,status,price)
       VALUES('electricity',$1,$2::jsonb,'active',$3)
       ON CONFLICT(system_key) DO UPDATE SET status='active',price=EXCLUDED.price`,
      [key, JSON.stringify({ en: key }), price]
    );
  }
  const startAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const endAt = new Date(Date.now() + 9 * 86_400_000).toISOString();
  const request = {
    profileId: input.profileId,
    startAt,
    endAt,
    quantities: { thermal: '10', green: '2', free_market: '3', energy_saving: '4' },
  };
  const previewResponse = await post('preview/advanced', request);
  expect(previewResponse.status, http.logs()).toBe(200);
  const preview = (await previewResponse.json()) as {
    reviewDigest: string;
    totalKwh: string;
    subtotalIrR: string;
    discountIrR: string;
    vatIrR: string;
    totalIrR: string;
    lines: Array<{
      systemKey: string;
      quantityKwh: string;
      unitPriceIrR: string;
      subtotalIrR: string;
      discountIrR: string;
      vatIrR: string;
    }>;
    walletBalanceIrR: string;
  };
  expect(preview.totalKwh).toBe('19');
  expect(preview.lines.map((line) => line.systemKey)).toEqual([
    'thermal',
    'green',
    'free_market',
    'energy_saving',
  ]);
  expect(preview.walletBalanceIrR).toBe('0');
  const shiftedStart = await post('preview/advanced', {
    ...request,
    startAt: new Date(new Date(startAt).getTime() + 3_600_000).toISOString(),
  });
  expect(shiftedStart.status, http.logs()).toBe(200);
  expect(((await shiftedStart.json()) as { reviewDigest: string }).reviewDigest).not.toBe(
    preview.reviewDigest
  );
  const submission = {
    ...request,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: preview.reviewDigest,
    address: input.address,
  };
  const responses = await Promise.all([
    post('orders/advanced', submission),
    post('orders/advanced', submission),
  ]);
  expect(
    responses.map((response) => response.status),
    http.logs()
  ).toEqual([201, 201]);
  const first = (await responses[0]!.json()) as {
    orderId: string;
    contractId: string;
    invoiceId: string;
  };
  const repeated = (await responses[1]!.json()) as typeof first;
  expect(first).toEqual(repeated);
  const saved = (
    await http.pool.query(
      `SELECT e.mode,e.period_start,e.period_end,e.pricing_snapshot,i.total_amount,
      (SELECT count(*)::int FROM electricity_order_lines WHERE order_id=e.id) AS line_count,
      (SELECT count(*)::int FROM invoices WHERE order_id=e.id) AS invoice_count,
      (SELECT count(*)::int FROM contracts WHERE order_id=e.id) AS contract_count
     FROM electricity_orders e JOIN invoices i ON i.order_id=e.id WHERE e.id=$1`,
      [first.orderId]
    )
  ).rows[0];
  expect(saved.mode).toBe('advanced');
  expect(saved.period_start.toISOString()).toBe(startAt);
  expect(saved.period_end.toISOString()).toBe(endAt);
  expect(saved).toMatchObject({ line_count: 4, invoice_count: 1, contract_count: 1 });
  expect(saved.total_amount).toBe(preview.totalIrR);
  expect(saved.pricing_snapshot).toMatchObject({
    periodStart: startAt,
    periodEnd: endAt,
    totalKwh: preview.totalKwh,
    subtotalIrR: preview.subtotalIrR,
    discountIrR: preview.discountIrR,
    vatIrR: preview.vatIrR,
    totalIrR: preview.totalIrR,
    lines: preview.lines,
  });
  expect(
    (await post('orders/advanced', { ...submission, quantities: { thermal: '11' } })).status
  ).toBe(409);
  const stale = await post('preview/advanced', request);
  expect(stale.status).toBe(200);
  const staleDigest = ((await stale.json()) as { reviewDigest: string }).reviewDigest;
  await http.pool.query("UPDATE products SET price=500000 WHERE system_key='thermal'");
  expect(
    (
      await post('orders/advanced', {
        ...submission,
        idempotencyKey: randomUUID(),
        expectedQuoteDigest: staleDigest,
      })
    ).status
  ).toBe(409);
});

it('invalidates an advanced review when the green rule changes before submission', async () => {
  const request = {
    profileId: input.profileId,
    startAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    endAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    quantities: { thermal: '8', green: '0' },
  };
  const previewResponse = await post('preview/advanced', request);
  expect(previewResponse.status, http.logs()).toBe(200);
  const reviewed = (await previewResponse.json()) as { reviewDigest: string };
  await http.pool.query(
    `INSERT INTO app_config(key,value,version) VALUES('electricity.green_mandatory_rules',$1::jsonb,1)`,
    [
      JSON.stringify({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
        advanced_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 0,
          mandatory_green_share_percent: 20,
        },
      }),
    ]
  );
  const submission = {
    ...request,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: reviewed.reviewDigest,
    address: input.address,
  };
  expect((await post('orders/advanced', submission)).status).toBe(409);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM electricity_order_submissions'))
      .rows[0].count
  ).toBe(0);
});

it('derives mandatory green only from advanced thermal quantity', async () => {
  await http.pool.query(
    `INSERT INTO app_config(key,value,version) VALUES('electricity.green_mandatory_rules',$1::jsonb,1)`,
    [
      JSON.stringify({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
        advanced_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 0,
          mandatory_green_share_percent: 20,
        },
      }),
    ]
  );
  await http.pool.query(
    `INSERT INTO products(type,system_key,title,status,price)
     VALUES('electricity','free_market','{"en":"Free market"}','active',300000)
     ON CONFLICT(system_key) DO UPDATE SET status='active',price=300000`
  );
  const request = {
    profileId: input.profileId,
    startAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    endAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    quantities: { thermal: '8', free_market: '3', green: '0' },
  };
  const response = await post('preview/advanced', request);
  expect(response.status, http.logs()).toBe(200);
  const preview = (await response.json()) as {
    mandatoryGreenEnabled: boolean;
    lines: Array<{ systemKey: string; quantityKwh: string }>;
  };
  expect(preview.mandatoryGreenEnabled).toBe(true);
  expect(preview.lines.map((line) => [line.systemKey, line.quantityKwh])).toEqual([
    ['thermal', '8'],
    ['green', '2'],
    ['free_market', '3'],
  ]);
  expect(
    (
      await post('preview/advanced', {
        ...request,
        quantities: { ...request.quantities, green: '1' },
      })
    ).status
  ).toBe(400);
  const freeMarket = await post('preview/advanced', {
    ...request,
    quantities: { thermal: '0', free_market: '3', green: '0' },
  });
  expect(freeMarket.status, http.logs()).toBe(200);
  expect(
    ((await freeMarket.json()) as { lines: Array<{ systemKey: string }> }).lines.map(
      (line) => line.systemKey
    )
  ).toEqual(['free_market']);
});

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
    status: 'processing',
    total_paid_amount: '500000',
    completed_refund_amount: '0',
  });
  const refund = (
    await http.pool.query('SELECT * FROM refunds WHERE id=$1', [obligation.refund_id])
  ).rows[0];
  expect(refund).toMatchObject({ amount: '500000', state: 'Processing', destination: 'wallet' });
  await expect(
    http.pool.query(
      "UPDATE refund_obligations SET status='completed',completed_refund_amount=total_paid_amount WHERE id=$1",
      [obligation.id]
    )
  ).rejects.toThrow('Electricity refund obligation state must match its refund');
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
  expect(await retryDueWalletRefunds(http.pool)).toContain('completed');
  expect(await runWalletRefund(http.pool, refund.id)).toBe('deferred');
  const finished = (
    await http.pool.query('SELECT * FROM refund_obligations WHERE id=$1', [obligation.id])
  ).rows[0];
  expect(finished).toMatchObject({ status: 'completed', completed_refund_amount: '500000' });
  expect(
    (
      await http.pool.query('SELECT state,refunded_amount FROM invoices WHERE id=$1', [
        order.invoiceId,
      ])
    ).rows[0]
  ).toEqual({ state: 'Refunded', refunded_amount: '500000' });
  const wallet = (
    await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
      input.profileId,
    ])
  ).rows[0];
  expect(wallet.posted_balance).toBe('500000');
  const credit = (
    await http.pool.query('SELECT metadata FROM wallet_transactions WHERE idempotency_key=$1', [
      `refund-wallet-credit:${refund.id}`,
    ])
  ).rows[0];
  expect(credit.metadata).toMatchObject({
    refundId: refund.id,
    invoiceId: order.invoiceId,
    contractId: order.contractId,
    orderId: order.orderId,
    paymentSourcesUnavailable: true,
  });
  await expect(
    http.pool.query("UPDATE refunds SET state='Cancelled' WHERE id=$1", [refund.id])
  ).rejects.toThrow();
});

it('lists only the customer profile orders and cancels an unpublished order once', async () => {
  const order = await submittedOrder();
  const response = await fetch(`${http.base}/api/electricity/orders?profileId=${input.profileId}`, {
    headers,
  });
  expect(response.status, http.logs()).toBe(200);
  const listing = (await response.json()) as {
    orders: Array<{ orderId: string; financialStatus: string; nextAction: string }>;
  };
  expect(listing.orders).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        orderId: order.orderId,
        financialStatus: 'unpaid',
        nextAction: 'await_review',
      }),
    ])
  );
  const before = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers });
  const detail = (await before.json()) as {
    versionId: string;
    lines: Array<{ systemKey: string; quantityKwh: string }>;
    timeline: Array<{ event: string }>;
  };
  expect(detail.lines).toEqual(
    expect.arrayContaining([expect.objectContaining({ systemKey: 'thermal', quantityKwh: '10' })])
  );
  const request = {
    idempotencyKey: randomUUID(),
    expectedVersionId: detail.versionId,
    reason: 'Delivery is no longer needed',
  };
  const cancel = () => post(`orders/${order.orderId}/cancel`, request);
  const first = await cancel();
  expect(first.status, http.logs()).toBe(200);
  expect(await first.json()).toMatchObject({ status: 'cancelled', refundId: null });
  expect((await cancel()).status).toBe(200);
  const after = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers });
  expect(await after.json()).toMatchObject({
    electricityStatus: 'cancelled',
    financialStatus: 'unpaid',
    financiallyClosed: true,
    timeline: expect.arrayContaining([
      expect.objectContaining({ event: 'electricity.order_cancelled', reason: request.reason }),
    ]),
  });
  expect(
    (await http.pool.query('SELECT state FROM invoices WHERE id=$1', [order.invoiceId])).rows[0]
      .state
  ).toBe('Cancelled');
  expect(
    (
      await staffPost(order.orderId, 'approve', {
        idempotencyKey: randomUUID(),
        expectedVersionId: detail.versionId,
      })
    ).status
  ).toBe(409);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('outsider','outsider@electricity.test','test-only')"
  );
  const outsideSession = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,'outsider',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [outsideSession, randomUUID(), randomUUID()]
  );
  expect(
    (
      await fetch(`${http.base}/api/electricity/orders?profileId=${input.profileId}`, {
        headers: { Cookie: `barghsa_session=${outsideSession}` },
      })
    ).status
  ).toBe(404);
});

it('keeps a paid cancellation open through failed retries until finance restores its wallet credit', async () => {
  const order = await submittedOrder();
  await http.pool.query(
    "UPDATE invoices SET paid_amount=500000,state='PartiallyFunded' WHERE id=$1",
    [order.invoiceId]
  );
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='buyer'");
  const versionId = (
    await http.pool.query('SELECT current_version_id FROM contracts WHERE id=$1', [
      order.contractId,
    ])
  ).rows[0].current_version_id;
  const cancelled = await post(`orders/${order.orderId}/cancel`, {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
    reason: 'Delivery is no longer needed',
  });
  expect(cancelled.status, http.logs()).toBe(200);
  const refundId = ((await cancelled.json()) as { refundId: string }).refundId;
  expect(refundId).toBeTruthy();
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [input.profileId]);
  for (let attempt = 0; attempt < 5; attempt++) {
    const outcome = await runWalletRefund(http.pool, refundId);
    expect(outcome).toBe(attempt === 4 ? 'exhausted' : 'failed');
    if (attempt < 4)
      await http.pool.query(
        'UPDATE refund_retry_jobs SET next_attempt_at=NOW() WHERE refund_id=$1',
        [refundId]
      );
  }
  const pending = (
    await http.pool.query(
      'SELECT status,completed_refund_amount FROM refund_obligations WHERE refund_id=$1',
      [refundId]
    )
  ).rows[0];
  expect(pending).toMatchObject({ status: 'failed', completed_refund_amount: '0' });
  await http.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [input.profileId]);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('reviewer','role-finance')"
  );
  const queueResponse = await fetch(`${http.base}/api/admin/wallet-refunds/contract-obligations`, {
    headers: staffHeaders,
  });
  expect(queueResponse.status, http.logs()).toBe(200);
  const queue = (await queueResponse.json()) as {
    obligations: Array<{ id: string; orderId: string; exhausted: boolean }>;
  };
  expect(queue.obligations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: refundId, orderId: order.orderId, exhausted: true }),
    ])
  );
  const retried = await fetch(`${http.base}/api/admin/wallet-refunds/${refundId}/process`, {
    method: 'POST',
    headers: staffHeaders,
    body: '{}',
  });
  expect(retried.status, http.logs()).toBe(200);
  expect(await retried.json()).toMatchObject({ state: 'Completed' });
  const final = (
    await http.pool.query(
      'SELECT status,completed_refund_amount FROM refund_obligations WHERE refund_id=$1',
      [refundId]
    )
  ).rows[0];
  expect(final).toMatchObject({ status: 'completed', completed_refund_amount: '500000' });
  expect(
    (
      await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        input.profileId,
      ])
    ).rows[0].posted_balance
  ).toBe('500000');
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
    timeline: expect.arrayContaining([expect.objectContaining({ event: 'contract.activated' })]),
  });
  const parent = (await http.pool.query('SELECT status FROM orders WHERE id=$1', [order.orderId]))
    .rows[0];
  expect(parent.status).toBe('CONFIRMED');
});

it.each(['reject', 'approve_future', 'approve_current'] as const)(
  'accepts one bounded future increase request and lets staff %s it with an audit trail',
  async (decision) => {
    if (decision === 'approve_current') {
      input.period = 'current_week';
      await refreshQuote();
    }
    const order = await submittedOrder();
    const versionId = (
      await http.pool.query('SELECT current_version_id FROM contracts WHERE id=$1', [
        order.contractId,
      ])
    ).rows[0].current_version_id as string;
    await http.pool.query(
      `INSERT INTO wallets(profile_id,posted_balance,reserved_balance)
    VALUES($1,1500000,0) ON CONFLICT(profile_id) DO UPDATE SET posted_balance=1500000,reserved_balance=0`,
      [input.profileId]
    );
    expect(
      (
        await staffPost(order.orderId, 'approve', {
          idempotencyKey: randomUUID(),
          expectedVersionId: versionId,
        })
      ).status,
      http.logs()
    ).toBe(200);
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='buyer'");
    const walletPath = `${http.base}/api/invoices/${order.invoiceId}/wallet-payment`;
    const walletReview = await fetch(walletPath, { headers });
    expect(walletReview.status, http.logs()).toBe(200);
    const walletHash = ((await walletReview.json()) as { review: { hash: string } }).review.hash;
    const payment = await fetch(walletPath, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        expectedRemainingAmount: '1000000',
        expectedReviewHash: walletHash,
      }),
    });
    expect(payment.status, http.logs()).toBe(200);
    const acceptanceReview = await fetch(
      `${http.base}/api/contracts/${order.contractId}/acceptance-review?versionId=${versionId}`,
      { headers }
    );
    expect(acceptanceReview.status, http.logs()).toBe(200);
    const acceptanceHash = ((await acceptanceReview.json()) as { hash: string }).hash;
    expect(
      (
        await fetch(`${http.base}/api/contracts/${order.contractId}/accept`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            idempotencyKey: randomUUID(),
            expectedVersionId: versionId,
            expectedReviewHash: acceptanceHash,
          }),
        })
      ).status,
      http.logs()
    ).toBe(200);
    expect((await activateReadyContracts(http.pool)).activated).toBe(1);

    const path = `${http.base}/api/electricity/contracts/${order.contractId}/increase`;
    const initial = await fetch(path, { headers });
    expect(initial.status, http.logs()).toBe(200);
    expect(await initial.json()).toMatchObject({
      canRequest: false,
      maxPercentage: 0,
      request: null,
    });
    await http.pool.query(
      `INSERT INTO app_config(key,value,version)
    VALUES('electricity.contract_limits',$1::jsonb,1)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1`,
      [
        JSON.stringify({
          max_quantity_increase_percent: 20,
          max_contract_duration_months: 24,
          lead_time_days: 0,
        }),
      ]
    );
    expect(await (await fetch(path, { headers })).json()).toMatchObject({
      canRequest: true,
      maxPercentage: 20,
    });
    const request = {
      requestedKwh: '12',
      expectedVersionId: versionId,
      idempotencyKey: randomUUID(),
    };
    const overLimit = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...request, requestedKwh: '13' }),
    });
    expect(overLimit.status, http.logs()).toBe(409);
    const submitted = await fetch(path, { method: 'POST', headers, body: JSON.stringify(request) });
    expect(submitted.status, http.logs()).toBe(201);
    const result = (await submitted.json()) as { requestId: string };
    expect(
      (await fetch(path, { method: 'POST', headers, body: JSON.stringify(request) })).status,
      http.logs()
    ).toBe(201);
    expect(
      (
        await http.pool.query(
          'SELECT count(*)::int AS count FROM electricity_quantity_increase_requests WHERE contract_id=$1',
          [order.contractId]
        )
      ).rows[0].count
    ).toBe(1);
    const staffQueue = await fetch(`${http.base}/api/staff/electricity/increase-requests`, {
      headers: staffHeaders,
    });
    expect(staffQueue.status, http.logs()).toBe(200);
    expect(
      (await fetch(`${http.base}/api/staff/electricity/increase-requests`, { headers })).status
    ).toBe(403);
    expect((await fetch(path, { headers: staffHeaders })).status).toBe(404);
    expect((await staffQueue.json()) as { requests: Array<{ requestId: string }> }).toMatchObject({
      requests: [expect.objectContaining({ requestId: result.requestId })],
    });
    if (decision !== 'reject') {
      const approval = { idempotencyKey: randomUUID() };
      const approvePath = `${http.base}/api/staff/electricity/increase-requests/${result.requestId}/approve`;
      const approved = await fetch(approvePath, {
        method: 'POST',
        headers: staffHeaders,
        body: JSON.stringify(approval),
      });
      expect(approved.status, http.logs()).toBe(201);
      const amendment = (await approved.json()) as {
        amendmentSha256: string;
        amendmentDocument: Record<string, string>;
        status: string;
      };
      expect(amendment).toMatchObject({
        status: 'awaiting_signature',
        amendmentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        amendmentDocument: {
          originalKwh: '10',
          requestedKwh: '12',
          incrementalKwh: '2',
          contractId: order.contractId,
        },
      });
      const canonicalDocument = JSON.stringify(
        Object.fromEntries(
          Object.entries(amendment.amendmentDocument).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      );
      expect(createHash('sha256').update(canonicalDocument).digest('hex')).toBe(
        amendment.amendmentSha256
      );
      expect(await (await fetch(path, { headers })).json()).toMatchObject({
        canRequest: false,
        request: { status: 'awaiting_signature', amendmentSha256: amendment.amendmentSha256 },
      });
      expect(
        (
          await fetch(approvePath, {
            method: 'POST',
            headers: staffHeaders,
            body: JSON.stringify(approval),
          })
        ).status
      ).toBe(201);
      expect(
        (
          await fetch(approvePath, {
            method: 'POST',
            headers: staffHeaders,
            body: JSON.stringify({ idempotencyKey: randomUUID() }),
          })
        ).status
      ).toBe(409);
      await expect(
        http.pool.query(
          "UPDATE electricity_quantity_increase_requests SET amendment_sha256=repeat('0',64) WHERE id=$1",
          [result.requestId]
        )
      ).rejects.toMatchObject({ code: '23514' });
      const review = (await (await fetch(path, { headers })).json()) as {
        quote: { adjustmentIrR: string };
      };
      if (decision === 'approve_future') expect(review.quote.adjustmentIrR).toBe('200000');
      else expect(BigInt(review.quote.adjustmentIrR)).toBeGreaterThan(0n);
      const signature = {
        expectedAmendmentSha256: amendment.amendmentSha256,
        expectedAdjustmentIrR: review.quote.adjustmentIrR,
        idempotencyKey: randomUUID(),
      };
      const signPath = `${path}/sign`;
      expect(
        (
          await fetch(signPath, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              ...signature,
              expectedAmendmentSha256: '0'.repeat(64),
            }),
          })
        ).status
      ).toBe(409);
      expect(
        (
          await fetch(signPath, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...signature, expectedAdjustmentIrR: '1' }),
          })
        ).status
      ).toBe(409);
      const signed = await fetch(signPath, {
        method: 'POST',
        headers,
        body: JSON.stringify(signature),
      });
      expect(signed.status, http.logs()).toBe(201);
      const signedRequest = (await signed.json()) as {
        status: string;
        adjustmentInvoiceId: string;
        adjustmentAmount: string;
      };
      expect(signedRequest).toMatchObject({
        status: 'awaiting_payment',
        adjustmentAmount: review.quote.adjustmentIrR,
        adjustmentInvoiceId: expect.any(String),
      });
      const evidence = (
        await http.pool.query(
          'SELECT signature_evidence,pricing_snapshot,signed_at FROM electricity_quantity_increase_requests WHERE id=$1',
          [result.requestId]
        )
      ).rows[0];
      expect(evidence).toMatchObject({
        signature_evidence: {
          signedBy: 'buyer',
          amendmentSha256: amendment.amendmentSha256,
          adjustmentIrR: review.quote.adjustmentIrR,
        },
        pricing_snapshot: {
          originalInvoiceId: order.invoiceId,
          adjustmentIrR: review.quote.adjustmentIrR,
        },
        signed_at: expect.any(Date),
      });
      expect(
        (
          await fetch(signPath, {
            method: 'POST',
            headers,
            body: JSON.stringify(signature),
          })
        ).status
      ).toBe(201);
      expect(
        (
          await fetch(signPath, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...signature, idempotencyKey: randomUUID() }),
          })
        ).status
      ).toBe(409);
      const adjustment = (
        await http.pool.query(
          'SELECT state,total_amount,adjustment_for_invoice_id FROM invoices WHERE id=$1',
          [signedRequest.adjustmentInvoiceId]
        )
      ).rows[0];
      expect(adjustment).toMatchObject({
        state: 'Unpaid',
        total_amount: review.quote.adjustmentIrR,
        adjustment_for_invoice_id: order.invoiceId,
      });
      await expect(
        http.pool.query(
          "UPDATE electricity_quantity_increase_requests SET status='effective',effective_at=now() WHERE id=$1",
          [result.requestId]
        )
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        (
          (await (
            await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers })
          ).json()) as { effectiveTotalKwh: string }
        ).effectiveTotalKwh
      ).toBe('10');
      const adjustmentWalletPath = `${http.base}/api/invoices/${signedRequest.adjustmentInvoiceId}/wallet-payment`;
      const adjustmentReview = await fetch(adjustmentWalletPath, { headers });
      expect(adjustmentReview.status, http.logs()).toBe(200);
      const hash = ((await adjustmentReview.json()) as { review: { hash: string } }).review.hash;
      const adjustmentPayment = await fetch(adjustmentWalletPath, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotencyKey: randomUUID(),
          expectedRemainingAmount: review.quote.adjustmentIrR,
          expectedReviewHash: hash,
        }),
      });
      expect(adjustmentPayment.status, http.logs()).toBe(200);
      if (decision === 'approve_future') {
        expect(await (await fetch(path, { headers })).json()).toMatchObject({
          request: {
            status: 'awaiting_effective_date',
            adjustmentInvoiceId: signedRequest.adjustmentInvoiceId,
          },
        });
        const activation = await http.pool.query<{ activated: boolean }>(
          'SELECT finalize_paid_electricity_increase($1,$2) AS activated',
          [
            result.requestId,
            new Date(
              new Date(amendment.amendmentDocument.earliestEffectiveFrom!).getTime() + 60_000
            ),
          ]
        );
        expect(activation.rows[0]?.activated).toBe(true);
      }
      expect(await (await fetch(path, { headers })).json()).toMatchObject({
        request: { status: 'effective', adjustmentInvoiceId: signedRequest.adjustmentInvoiceId },
      });
      expect(
        (
          (await (
            await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers })
          ).json()) as { effectiveTotalKwh: string }
        ).effectiveTotalKwh
      ).toBe('12');
      const events = (
        await http.pool.query(
          "SELECT event FROM audit_log WHERE metadata::jsonb->>'requestId'=$1 ORDER BY created_at",
          [result.requestId]
        )
      ).rows.map((row: { event: string }) => row.event);
      expect(events).toEqual([
        'electricity.increase_requested',
        'electricity.increase_approved',
        'electricity.increase_signed',
        'electricity.increase_effective',
      ]);
      const effectiveNotices = await http.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM in_app_notifications WHERE delivery_key=$1',
        [`electricity-increase-effective:${result.requestId}`]
      );
      expect(effectiveNotices.rows[0]?.count).toBe(1);
      return;
    }
    const rejected = await fetch(
      `${http.base}/api/staff/electricity/increase-requests/${result.requestId}/reject`,
      {
        method: 'POST',
        headers: staffHeaders,
        body: JSON.stringify({ idempotencyKey: randomUUID(), reason: 'Outside approved capacity' }),
      }
    );
    expect(rejected.status, http.logs()).toBe(201);
    expect(await (await fetch(path, { headers })).json()).toMatchObject({
      canRequest: false,
      request: { status: 'rejected', reviewReason: 'Outside approved capacity' },
    });
    expect(
      (
        await fetch(path, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...request, idempotencyKey: randomUUID() }),
        })
      ).status,
      http.logs()
    ).toBe(409);
    const events = (
      await http.pool.query(
        "SELECT event FROM audit_log WHERE metadata::jsonb->>'requestId'=$1 ORDER BY created_at",
        [result.requestId]
      )
    ).rows.map((row: { event: string }) => row.event);
    expect(events).toEqual(['electricity.increase_requested', 'electricity.increase_rejected']);
  }
);

it('tracks an approved contract cancellation and its existing mandatory refund', async () => {
  const order = await submittedOrder();
  const versionId = (
    await http.pool.query('SELECT current_version_id FROM contracts WHERE id=$1', [
      order.contractId,
    ])
  ).rows[0].current_version_id as string;
  expect(
    (
      await staffPost(order.orderId, 'approve', {
        idempotencyKey: randomUUID(),
        expectedVersionId: versionId,
      })
    ).status
  ).toBe(200);
  await http.pool.query(
    "UPDATE invoices SET paid_amount=500000,state='PartiallyFunded' WHERE id=$1",
    [order.invoiceId]
  );
  const previewResponse = await fetch(
    `${http.base}/api/admin/contracts/${order.contractId}/cancellation-preview`,
    { headers: staffHeaders }
  );
  expect(previewResponse.status, http.logs()).toBe(200);
  const preview = (await previewResponse.json()) as { fingerprint: string };
  const prepared = await fetch(
    `${http.base}/api/admin/contracts/${order.contractId}/cancellations`,
    {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({
        expectedVersionId: versionId,
        expectedFingerprint: preview.fingerprint,
        reason: 'Delivery stopped',
        refundDecision: { mode: 'full_wallet' },
        idempotencyKey: randomUUID(),
      }),
    }
  );
  expect(prepared.status, http.logs()).toBe(201);
  const intent = (await prepared.json()) as { id: string };
  const executed = await fetch(
    `${http.base}/api/admin/contracts/${order.contractId}/cancellations/execute`,
    {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({ intentId: intent.id, idempotencyKey: randomUUID() }),
    }
  );
  expect(executed.status, http.logs()).toBe(201);
  const detailResponse = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, {
    headers,
  });
  expect(await detailResponse.json()).toMatchObject({
    electricityStatus: 'cancelled',
    financialStatus: 'refund_pending',
    nextAction: 'await_refund',
    timeline: expect.arrayContaining([expect.objectContaining({ event: 'contract.cancelled' })]),
  });
  expect(
    (await http.pool.query('SELECT status FROM orders WHERE id=$1', [order.orderId])).rows[0].status
  ).toBe('CANCELLED');
  const refund = (
    await http.pool.query(
      'SELECT refund_id FROM contract_refund_obligations WHERE contract_id=$1',
      [order.contractId]
    )
  ).rows[0];
  expect(await runWalletRefund(http.pool, refund.refund_id)).toBe('completed');
  const finished = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers });
  expect(await finished.json()).toMatchObject({
    electricityStatus: 'cancelled',
    financialStatus: 'refunded',
    financiallyClosed: true,
  });
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
