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

it('keeps electricity order conversations public or staff-only and reachable after review', async () => {
  const order = await submittedOrder();
  const customerPath = `${http.base}/api/electricity/orders/${order.orderId}/comments`;
  const staffPath = `${http.base}/api/staff/electricity/orders/${order.orderId}/comments`;
  const customerInput = { idempotencyKey: randomUUID(), body: 'Please confirm the delivery date.' };
  const customerReply = await fetch(customerPath, {
    method: 'POST',
    headers,
    body: JSON.stringify(customerInput),
  });
  expect(customerReply.status, http.logs()).toBe(200);
  const customerComment = (await customerReply.json()) as { id: string };
  const retry = await fetch(customerPath, {
    method: 'POST',
    headers,
    body: JSON.stringify(customerInput),
  });
  expect(retry.status, http.logs()).toBe(200);
  expect(((await retry.json()) as { id: string }).id).toBe(customerComment.id);
  expect((await fetch(customerPath, { headers: staffHeaders })).status).toBe(404);
  expect(
    (
      await fetch(customerPath, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...customerInput,
          idempotencyKey: randomUUID(),
          visibility: 'internal',
        }),
      })
    ).status
  ).toBe(400);

  const internalReply = await fetch(staffPath, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      body: 'Check account before replying.',
      visibility: 'internal',
    }),
  });
  expect(internalReply.status, http.logs()).toBe(200);
  const internalComment = (await internalReply.json()) as { id: string };
  const publicReply = await fetch(staffPath, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      body: 'We are checking the delivery date.',
      visibility: 'public',
    }),
  });
  expect(publicReply.status, http.logs()).toBe(200);

  const customerList = await fetch(customerPath, { headers });
  expect(customerList.status, http.logs()).toBe(200);
  expect(
    ((await customerList.json()) as { comments: { body: string }[] }).comments.map(
      (item) => item.body
    )
  ).toEqual([customerInput.body, 'We are checking the delivery date.']);
  expect((await fetch(`${customerPath}?before=${internalComment.id}`, { headers })).status).toBe(
    404
  );
  const staffList = await fetch(staffPath, { headers: staffHeaders });
  expect(staffList.status, http.logs()).toBe(200);
  expect(
    ((await staffList.json()) as { comments: { visibility: string }[] }).comments.map(
      (item) => item.visibility
    )
  ).toEqual(['public', 'internal', 'public']);
  expect(
    (
      await http.pool.query(
        `SELECT COUNT(*)::int AS total FROM in_app_notifications
     WHERE recipient_user_id='buyer' AND link_route=$1`,
        [`/electricity/orders/${order.orderId}`]
      )
    ).rows[0].total
  ).toBe(1);

  const detail = await fetch(`${http.base}/api/staff/electricity/orders/${order.orderId}`, {
    headers: staffHeaders,
  });
  const versionId = ((await detail.json()) as { versionId: string }).versionId;
  expect(
    (
      await staffPost(order.orderId, 'approve', {
        idempotencyKey: randomUUID(),
        expectedVersionId: versionId,
      })
    ).status
  ).toBe(200);
  const reviewQueue = await fetch(`${http.base}/api/staff/electricity/orders`, {
    headers: staffHeaders,
  });
  expect(((await reviewQueue.json()) as { orders: unknown[] }).orders).toHaveLength(0);
  const conversations = await fetch(`${http.base}/api/staff/electricity/orders/conversations`, {
    headers: staffHeaders,
  });
  expect(conversations.status, http.logs()).toBe(200);
  expect(
    ((await conversations.json()) as { orders: { orderId: string }[] }).orders[0]?.orderId
  ).toBe(order.orderId);
  await expect(
    http.pool.query('UPDATE electricity_order_comments SET body=$1 WHERE id=$2', [
      'Changed',
      customerComment.id,
    ])
  ).rejects.toMatchObject({ code: '23514' });
});

it('paginates older electricity order comments without losing the visible page', async () => {
  const order = await submittedOrder();
  await http.pool.query(
    `INSERT INTO electricity_order_comments(id,order_id,author_user_id,visibility,body)
     SELECT uuid_generate_v7(),$1,'buyer','public','Message ' || n FROM generate_series(1,51) AS n`,
    [order.orderId]
  );
  const path = `${http.base}/api/electricity/orders/${order.orderId}/comments`;
  const first = await fetch(path, { headers });
  expect(first.status, http.logs()).toBe(200);
  const page = (await first.json()) as { comments: { id: string }[]; nextBefore: string | null };
  expect(page.comments).toHaveLength(50);
  expect(page.nextBefore).not.toBeNull();
  const older = await fetch(`${path}?before=${page.nextBefore}`, { headers });
  expect(older.status, http.logs()).toBe(200);
  const earlier = (await older.json()) as { comments: { id: string }[]; nextBefore: string | null };
  expect(earlier.comments).toHaveLength(1);
  expect(earlier.nextBefore).toBeNull();
  expect(new Set([...page.comments, ...earlier.comments].map((item) => item.id)).size).toBe(51);
});

it('keeps review, payment and activation on a corrected unpaid invoice', async () => {
  const order = await submittedOrder();
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('reviewer','role-finance')"
  );
  const original = (
    await http.pool.query<{ total_amount: string }>(
      'SELECT total_amount::text FROM invoices WHERE id=$1',
      [order.invoiceId]
    )
  ).rows[0]!;
  const lines = (
    await http.pool.query<{
      description: string;
      quantity: number;
      unit_price: string;
      vat_rate: number;
      is_taxable: boolean;
    }>(
      `SELECT description,quantity,unit_price::text,vat_rate,is_taxable
       FROM invoice_lines WHERE invoice_id=$1 ORDER BY position,id`,
      [order.invoiceId]
    )
  ).rows.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unit_price,
    vatRate: line.vat_rate,
    isTaxable: line.is_taxable,
  }));
  const changedAmount = await fetch(
    `${http.base}/api/admin/invoices/${order.invoiceId}/corrections`,
    {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({
        kind: 'replacement',
        reason: 'Change the amount without a contract amendment',
        idempotencyKey: randomUUID(),
        lines: [{ ...lines[0]!, unitPrice: (BigInt(lines[0]!.unitPrice) + 1n).toString() }],
      }),
    }
  );
  expect(changedAmount.status, http.logs()).toBe(409);
  expect(lines).toHaveLength(1);
  expect(BigInt(lines[0]!.unitPrice) % 2n).toBe(0n);
  const changedEconomics = await fetch(
    `${http.base}/api/admin/invoices/${order.invoiceId}/corrections`,
    {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({
        kind: 'replacement',
        reason: 'Change quantity while keeping the same total',
        idempotencyKey: randomUUID(),
        lines: [
          {
            ...lines[0]!,
            quantity: lines[0]!.quantity * 2,
            unitPrice: (BigInt(lines[0]!.unitPrice) / 2n).toString(),
          },
        ],
      }),
    }
  );
  expect(changedEconomics.status, http.logs()).toBe(409);
  const correction = await fetch(`${http.base}/api/admin/invoices/${order.invoiceId}/corrections`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({
      kind: 'replacement',
      reason: 'Correct invoice description before approval',
      idempotencyKey: randomUUID(),
      lines,
    }),
  });
  expect(correction.status, http.logs()).toBe(201);
  const replacement = (await correction.json()) as { invoiceId: string };
  expect(replacement.invoiceId).not.toBe(order.invoiceId);
  const relinkAudit = (
    await http.pool.query<{ metadata: Record<string, string> }>(
      `SELECT metadata::jsonb FROM audit_log
       WHERE event='electricity.activation_invoice_replaced'
         AND metadata::jsonb->>'orderId'=$1`,
      [order.orderId]
    )
  ).rows;
  expect(relinkAudit).toHaveLength(1);
  expect(relinkAudit[0]!.metadata).toMatchObject({
    contractId: order.contractId,
    originalInvoiceId: order.invoiceId,
    replacementInvoiceId: replacement.invoiceId,
  });
  expect(
    (
      await http.pool.query<{ initial_invoice_id: string }>(
        `SELECT r.initial_invoice_id FROM contracts c
         JOIN contract_activation_requirements r ON r.version_id=c.current_version_id
         WHERE c.id=$1`,
        [order.contractId]
      )
    ).rows[0]!.initial_invoice_id
  ).toBe(replacement.invoiceId);
  const customerDetail = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, {
    headers,
  });
  expect(await customerDetail.json()).toMatchObject({
    invoiceId: replacement.invoiceId,
    invoiceState: 'Unpaid',
    totalIrR: original.total_amount,
    financialStatus: 'unpaid',
  });
  const customerList = await fetch(
    `${http.base}/api/electricity/orders?profileId=${input.profileId}`,
    { headers }
  );
  expect(await customerList.json()).toMatchObject({
    orders: [expect.objectContaining({ orderId: order.orderId, totalIrR: original.total_amount })],
  });
  const staffDetail = await fetch(`${http.base}/api/staff/electricity/orders/${order.orderId}`, {
    headers: staffHeaders,
  });
  expect(await staffDetail.json()).toMatchObject({ invoiceId: replacement.invoiceId });

  const versionId = (
    await http.pool.query<{ current_version_id: string }>(
      'SELECT current_version_id FROM contracts WHERE id=$1',
      [order.contractId]
    )
  ).rows[0]!.current_version_id;
  const approved = await staffPost(order.orderId, 'approve', {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
  });
  expect(approved.status, http.logs()).toBe(200);
  const replacementDetails = await fetch(`${http.base}/api/invoices/${replacement.invoiceId}`, {
    headers,
  });
  expect(replacementDetails.status, http.logs()).toBe(200);
  expect(await replacementDetails.json()).toMatchObject({
    electricityOrderId: order.orderId,
  });
  const publishedCorrection = await fetch(
    `${http.base}/api/admin/invoices/${replacement.invoiceId}/corrections`,
    {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({
        kind: 'replacement',
        reason: 'Published contract cannot be rewritten',
        idempotencyKey: randomUUID(),
        lines,
      }),
    }
  );
  expect(publishedCorrection.status, http.logs()).toBe(409);
  await http.pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance)
     VALUES($1,$2,0) ON CONFLICT (profile_id)
     DO UPDATE SET posted_balance=$2,reserved_balance=0`,
    [input.profileId, original.total_amount]
  );
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='buyer'");
  const paymentPath = `${http.base}/api/invoices/${replacement.invoiceId}/wallet-payment`;
  const paymentReview = await fetch(paymentPath, { headers });
  expect(paymentReview.status, http.logs()).toBe(200);
  const review = (await paymentReview.json()) as { review: { hash: string } };
  const payment = await fetch(paymentPath, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      expectedRemainingAmount: original.total_amount,
      expectedReviewHash: review.review.hash,
    }),
  });
  expect(payment.status, http.logs()).toBe(200);
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
  expect((await activateReadyContracts(http.pool)).activated).toBe(1);
  const active = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers });
  expect(await active.json()).toMatchObject({
    invoiceId: replacement.invoiceId,
    financialStatus: 'paid',
    electricityStatus: 'active',
  });
});

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
  expect(
    (
      await http.pool.query(
        "SELECT content->'commercialValue' AS value FROM contract_versions WHERE contract_id=$1",
        [first.contractId]
      )
    ).rows[0].value
  ).toEqual({ kind: 'fixed', amountIrr: preview.totalIrR });
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
  expect(saved.pricing_snapshot.lines).toEqual(
    expect.arrayContaining([expect.objectContaining({ minKwh: '0', maxKwh: '0' })])
  );
  const snapshotBeforeLimitChange = saved.pricing_snapshot;
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO electricity_product_limits(product_id,min_kwh,max_kwh) VALUES($1,1,0)',
      [saved.pricing_snapshot.lines[0].productId]
    );
    const afterLimitChange = (
      await client.query<{ pricing_snapshot: unknown }>(
        'SELECT pricing_snapshot FROM electricity_orders WHERE id=$1',
        [first.orderId]
      )
    ).rows[0]!.pricing_snapshot;
    expect(afterLimitChange).toEqual(snapshotBeforeLimitChange);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
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
  input.idempotencyKey = randomUUID();
  const laterOrder = await submittedOrder();
  const queueResponse = await fetch(`${http.base}/api/staff/electricity/orders`, {
    headers: staffHeaders,
  });
  expect(queueResponse.status, http.logs()).toBe(200);
  expect((await fetch(`${http.base}/api/staff/electricity/orders`, { headers })).status).toBe(403);
  const queue = (await queueResponse.json()) as {
    orders: Array<{ orderId: string }>;
    nextAfter: string | null;
  };
  expect(queue.orders.map((entry) => entry.orderId)).toContain(order.orderId);
  expect(queue.orders.map((entry) => entry.orderId)).toContain(laterOrder.orderId);
  expect(queue.nextAfter).toBeNull();
  const laterPage = await fetch(
    `${http.base}/api/staff/electricity/orders?after=${order.orderId}`,
    { headers: staffHeaders }
  );
  expect(laterPage.status, http.logs()).toBe(200);
  expect(await laterPage.json()).toMatchObject({
    orders: [expect.objectContaining({ orderId: laterOrder.orderId })],
    nextAfter: null,
  });
  expect(
    (
      await fetch(`${http.base}/api/staff/electricity/orders?after=invalid`, {
        headers: staffHeaders,
      })
    ).status
  ).toBe(400);
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
  const afterApproval = await fetch(
    `${http.base}/api/staff/electricity/orders?after=${order.orderId}`,
    { headers: staffHeaders }
  );
  expect(afterApproval.status, http.logs()).toBe(200);
  expect(await afterApproval.json()).toMatchObject({
    orders: [expect.objectContaining({ orderId: laterOrder.orderId })],
  });
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
  expect(
    (
      await http.pool.query(
        "SELECT content->'commercialValue'->>'amountIrr' AS amount FROM contract_versions WHERE contract_id=$1 ORDER BY version_number",
        [order.contractId]
      )
    ).rows.map((row) => row.amount)
  ).toEqual(['1000000', '1000000']);
  const amended = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers });
  expect(await amended.json()).toMatchObject({
    electricityStatus: 'awaiting_staff_review',
    fullAddress: 'Corrected Electricity Street',
    versionId: result.versionId,
  });
  const staffDetail = await fetch(`${http.base}/api/staff/electricity/orders/${order.orderId}`, {
    headers: staffHeaders,
  });
  expect(staffDetail.status, http.logs()).toBe(200);
  expect(await staffDetail.json()).toMatchObject({
    revisionReview: {
      versionNumber: 2,
      staffReason: 'Please correct the delivery address',
      customerResponse: 'I corrected the delivery address',
      before: { fullAddress: 'Electricity Street', invoiceId: order.invoiceId },
      after: { fullAddress: 'Corrected Electricity Street', invoiceId: order.invoiceId },
    },
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

it('revises an unpaid order with a new quote, invoice and immutable line history', async () => {
  const order = await submittedOrder();
  const before = (await (
    await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers })
  ).json()) as {
    versionId: string;
    totalIrR: string;
  };
  expect(
    (
      await staffPost(order.orderId, 'request-changes', {
        idempotencyKey: randomUUID(),
        expectedVersionId: before.versionId,
        reason: 'Increase the requested quantity',
      })
    ).status
  ).toBe(200);
  const terms = {
    profileId: input.profileId,
    period: 'next_week',
    totalKwh: '12',
    expectedVersionId: before.versionId,
  };
  const preview = await post(`orders/${order.orderId}/revision-preview`, terms);
  expect(preview.status, http.logs()).toBe(200);
  const quote = (await preview.json()) as { reviewDigest: string; totalIrR: string };
  expect(quote.totalIrR).toBe('1200000');
  const amendment = {
    ...terms,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    address: input.address,
    responseNote: 'Quantity corrected',
  };
  const resubmit = () => post(`orders/${order.orderId}/resubmit`, amendment);
  const first = await resubmit();
  expect(first.status, http.logs()).toBe(200);
  const result = (await first.json()) as { versionId: string; invoiceId: string; status: string };
  expect(result).toMatchObject({ status: 'awaiting_staff_review' });
  expect(result.versionId).not.toBe(before.versionId);
  expect(result.invoiceId).not.toBe(order.invoiceId);
  expect(await (await resubmit()).json()).toEqual(result);
  const detail = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers });
  expect(await detail.json()).toMatchObject({
    versionId: result.versionId,
    invoiceId: result.invoiceId,
    totalKwh: '12',
    totalIrR: '1200000',
    lines: [expect.objectContaining({ quantityKwh: '12' })],
  });
  const staffDetail = await fetch(`${http.base}/api/staff/electricity/orders/${order.orderId}`, {
    headers: staffHeaders,
  });
  expect(staffDetail.status, http.logs()).toBe(200);
  expect(await staffDetail.json()).toMatchObject({
    revisionReview: {
      versionNumber: 2,
      staffReason: 'Increase the requested quantity',
      customerResponse: 'Quantity corrected',
      before: { totalKwh: '10', totalIrR: '1000000', invoiceId: order.invoiceId },
      after: { totalKwh: '12', totalIrR: '1200000', invoiceId: result.invoiceId },
    },
  });
  const invoices = (
    await http.pool.query(
      'SELECT id,state,total_amount,replaces_invoice_id FROM invoices WHERE order_id=$1 ORDER BY created_at,id',
      [order.orderId]
    )
  ).rows;
  expect(invoices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: order.invoiceId, state: 'Cancelled', total_amount: '1000000' }),
      expect.objectContaining({
        id: result.invoiceId,
        state: 'Unpaid',
        total_amount: '1200000',
        replaces_invoice_id: order.invoiceId,
      }),
    ])
  );
  expect(
    (
      await http.pool.query(
        'SELECT revision,quantity_kwh FROM electricity_order_lines WHERE order_id=$1 ORDER BY revision',
        [order.orderId]
      )
    ).rows
  ).toEqual([
    { revision: 1, quantity_kwh: '10' },
    { revision: 2, quantity_kwh: '12' },
  ]);
  expect(
    (
      await http.pool.query(
        "SELECT version_number,content->'pricing'->>'totalIrR' AS total,content->'commercialValue'->>'amountIrr' AS contract_value FROM contract_versions WHERE contract_id=$1 ORDER BY version_number",
        [order.contractId]
      )
    ).rows
  ).toEqual([
    { version_number: 1, total: '1000000', contract_value: '1000000' },
    { version_number: 2, total: '1200000', contract_value: '1200000' },
  ]);
  expect(
    (
      await post(`orders/${order.orderId}/resubmit`, {
        ...amendment,
        idempotencyKey: randomUUID(),
        expectedQuoteDigest: '0'.repeat(64),
      })
    ).status
  ).toBe(409);
  expect(
    (
      await staffPost(order.orderId, 'request-changes', {
        idempotencyKey: randomUUID(),
        expectedVersionId: result.versionId,
        reason: 'One more quantity change',
      })
    ).status
  ).toBe(200);
  const secondTerms = { ...terms, totalKwh: '14', expectedVersionId: result.versionId };
  const secondQuoteResponse = await post(`orders/${order.orderId}/revision-preview`, secondTerms);
  expect(secondQuoteResponse.status, http.logs()).toBe(200);
  const secondQuote = (await secondQuoteResponse.json()) as { reviewDigest: string };
  const secondResponse = await post(`orders/${order.orderId}/resubmit`, {
    ...secondTerms,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: secondQuote.reviewDigest,
    address: input.address,
    responseNote: 'Final quantity correction',
  });
  expect(secondResponse.status, http.logs()).toBe(200);
  const second = (await secondResponse.json()) as { versionId: string; invoiceId: string };
  expect(
    (
      await http.pool.query(
        'SELECT revision,quantity_kwh FROM electricity_order_lines WHERE order_id=$1 ORDER BY revision',
        [order.orderId]
      )
    ).rows
  ).toEqual([
    { revision: 1, quantity_kwh: '10' },
    { revision: 2, quantity_kwh: '12' },
    { revision: 3, quantity_kwh: '14' },
  ]);
  expect(
    (
      await http.pool.query('SELECT replaces_invoice_id FROM invoices WHERE id=$1', [
        second.invoiceId,
      ])
    ).rows[0].replaces_invoice_id
  ).toBe(result.invoiceId);
  expect(
    (
      await staffPost(order.orderId, 'approve', {
        idempotencyKey: randomUUID(),
        expectedVersionId: second.versionId,
      })
    ).status,
    http.logs()
  ).toBe(200);
});

it.each([true, false])(
  'releases and reapplies a limited gift code when repricing with restore_on_cancel=%s',
  async (restoreOnCancel) => {
    await http.pool.query(
      `INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,total_limit,restore_on_cancel,created_by)
     VALUES('ONCE','fixed_irr',100000,'2026-01-01',1,$1,'buyer')`,
      [restoreOnCancel]
    );
    input.giftCode = 'ONCE';
    await refreshQuote();
    const order = await submittedOrder();
    const detail = (await (
      await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers })
    ).json()) as { versionId: string };
    expect(
      (
        await staffPost(order.orderId, 'request-changes', {
          idempotencyKey: randomUUID(),
          expectedVersionId: detail.versionId,
          reason: 'Please revise the quantity',
        })
      ).status
    ).toBe(200);
    const terms = {
      profileId: input.profileId,
      expectedVersionId: detail.versionId,
      period: 'next_week',
      totalKwh: '12',
      giftCode: 'ONCE',
    };
    const preview = await post(`orders/${order.orderId}/revision-preview`, terms);
    expect(preview.status, http.logs()).toBe(200);
    const quote = (await preview.json()) as { reviewDigest: string; discountIrR: string };
    expect(quote.discountIrR).toBe('100000');
    expect(
      (
        await post(`orders/${order.orderId}/resubmit`, {
          ...terms,
          idempotencyKey: randomUUID(),
          expectedQuoteDigest: quote.reviewDigest,
          address: input.address,
          responseNote: 'Quantity updated',
        })
      ).status,
      http.logs()
    ).toBe(200);
    expect(
      (
        await http.pool.query(
          'SELECT status FROM gift_code_redemptions WHERE order_id=$1 ORDER BY created_at,id',
          [order.orderId]
        )
      ).rows
        .map((row) => row.status)
        .sort()
    ).toEqual(['consumed', 'released']);
  }
);

it.each([true, false])(
  'applies restore_on_cancel=%s atomically and idempotently to an unpaid electricity order',
  async (restoreOnCancel) => {
    await http.pool.query(
      `INSERT INTO gift_codes(code,discount_type,discount_value,total_limit,restore_on_cancel,created_by)
       VALUES ('CANCELSLOT','fixed_irr',100000,1,$1,'buyer')`,
      [restoreOnCancel]
    );
    input.giftCode = 'CANCELSLOT';
    await refreshQuote();
    const order = await submittedOrder();
    const detail = (await (
      await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers })
    ).json()) as { versionId: string };
    const cancel = () =>
      post(`orders/${order.orderId}/cancel`, {
        idempotencyKey: key,
        expectedVersionId: detail.versionId,
        reason: 'No longer needed',
      });
    const key = randomUUID();
    expect((await cancel()).status, http.logs()).toBe(200);
    const first = (
      await http.pool.query<{ status: string; restored_at: Date | null }>(
        'SELECT status,restored_at FROM gift_code_redemptions WHERE order_id=$1',
        [order.orderId]
      )
    ).rows[0]!;
    expect(first.status).toBe(restoreOnCancel ? 'released' : 'consumed');
    expect(first.restored_at === null).toBe(!restoreOnCancel);
    expect((await cancel()).status).toBe(200);
    expect(
      (
        await http.pool.query<{ status: string; restored_at: Date | null }>(
          'SELECT status,restored_at FROM gift_code_redemptions WHERE order_id=$1',
          [order.orderId]
        )
      ).rows[0]
    ).toEqual(first);
  }
);

it('revises an advanced delivery period and composition', async () => {
  const startAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const endAt = new Date(Date.now() + 9 * 86_400_000).toISOString();
  const terms = {
    profileId: input.profileId,
    startAt,
    endAt,
    quantities: { thermal: '10', green: '2' },
  };
  const originalPreview = await post('preview/advanced', terms);
  expect(originalPreview.status, http.logs()).toBe(200);
  const originalQuote = (await originalPreview.json()) as { reviewDigest: string };
  const original = await post('orders/advanced', {
    ...terms,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: originalQuote.reviewDigest,
    address: input.address,
  });
  expect(original.status, http.logs()).toBe(201);
  const order = (await original.json()) as {
    orderId: string;
    contractId: string;
    invoiceId: string;
  };
  const detail = (await (
    await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers })
  ).json()) as { versionId: string };
  expect(
    (
      await staffPost(order.orderId, 'request-changes', {
        idempotencyKey: randomUUID(),
        expectedVersionId: detail.versionId,
        reason: 'Change the delivery period',
      })
    ).status
  ).toBe(200);
  const revised = {
    ...terms,
    expectedVersionId: detail.versionId,
    endAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    quantities: { thermal: '12', green: '3' },
  };
  const preview = await post(`orders/${order.orderId}/revision-preview`, revised);
  expect(preview.status, http.logs()).toBe(200);
  const quote = (await preview.json()) as { reviewDigest: string; totalKwh: string };
  expect(quote.totalKwh).toBe('15');
  const response = await post(`orders/${order.orderId}/resubmit`, {
    ...revised,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    address: input.address,
    responseNote: 'Period and products changed',
  });
  expect(response.status, http.logs()).toBe(200);
  expect(
    await (await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, { headers })).json()
  ).toMatchObject({
    mode: 'advanced',
    totalKwh: '15',
    lines: [
      expect.objectContaining({ systemKey: 'green', quantityKwh: '3' }),
      expect.objectContaining({ systemKey: 'thermal', quantityKwh: '12' }),
    ],
  });
  const review = await fetch(`${http.base}/api/staff/electricity/orders/${order.orderId}`, {
    headers: staffHeaders,
  });
  expect(review.status, http.logs()).toBe(200);
  expect(await review.json()).toMatchObject({
    revisionReview: {
      before: {
        lines: [
          expect.objectContaining({ systemKey: 'thermal', quantityKwh: '10' }),
          expect.objectContaining({ systemKey: 'green', quantityKwh: '2' }),
        ],
      },
      after: {
        lines: [
          expect.objectContaining({ systemKey: 'thermal', quantityKwh: '12' }),
          expect.objectContaining({ systemKey: 'green', quantityKwh: '3' }),
        ],
      },
    },
  });
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
    orders: Array<{
      orderId: string;
      contractId: string;
      invoiceId: string;
      financialStatus: string;
      nextAction: string;
    }>;
  };
  expect(listing.orders).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        orderId: order.orderId,
        contractId: order.contractId,
        invoiceId: order.invoiceId,
        financialStatus: 'unpaid',
        nextAction: 'await_review',
      }),
    ])
  );
  const pendingList = await fetch(
    `${http.base}/api/electricity/orders?profileId=${input.profileId}&status=pending`,
    { headers }
  );
  expect(pendingList.status, http.logs()).toBe(200);
  expect(
    ((await pendingList.json()) as { orders: Array<{ orderId: string }> }).orders.map(
      (row) => row.orderId
    )
  ).toContain(order.orderId);
  expect(
    (
      await fetch(
        `${http.base}/api/electricity/orders?profileId=${input.profileId}&status=active`,
        {
          headers,
        }
      )
    ).status
  ).toBe(400);
  const olderPage = await fetch(
    `${http.base}/api/electricity/orders?profileId=${input.profileId}&before=${order.orderId}`,
    { headers }
  );
  expect(olderPage.status, http.logs()).toBe(200);
  expect(
    ((await olderPage.json()) as { orders: Array<{ orderId: string }> }).orders.map(
      (row) => row.orderId
    )
  ).not.toContain(order.orderId);
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
  const pendingAfterCancel = await fetch(
    `${http.base}/api/electricity/orders?profileId=${input.profileId}&status=pending`,
    { headers }
  );
  expect(
    ((await pendingAfterCancel.json()) as { orders: Array<{ orderId: string }> }).orders.map(
      (row) => row.orderId
    )
  ).not.toContain(order.orderId);
  expect(
    (
      await fetch(
        `${http.base}/api/electricity/orders?profileId=${input.profileId}&status=pending&before=${order.orderId}`,
        { headers }
      )
    ).status
  ).toBe(404);
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
  const invoiceDetails = await fetch(`${http.base}/api/invoices/${order.invoiceId}`, { headers });
  expect(invoiceDetails.status, http.logs()).toBe(200);
  expect(await invoiceDetails.json()).toMatchObject({ electricityOrderId: order.orderId });
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

it.each([
  'reject',
  'approve_future',
  'approve_current',
  'expire_pending',
  'expire_unsigned',
  'expire_unpaid',
  'expire_review',
] as const)(
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
    const result = (await submitted.json()) as { requestId: string; periodEnd: string };
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
    if (decision === 'expire_pending') {
      const disposition = await http.pool.query<{ disposition: string }>(
        'SELECT expire_electricity_increase($1,$2) AS disposition',
        [result.requestId, new Date(new Date(result.periodEnd).getTime() + 60_000)]
      );
      expect(disposition.rows[0]?.disposition).toBe('unsigned');
      expect(await (await fetch(path, { headers })).json()).toMatchObject({
        request: { status: 'expired', adjustmentInvoiceId: null },
      });
      expect(
        await (
          await fetch(`${http.base}/api/staff/electricity/increase-requests?status=expired`, {
            headers: staffHeaders,
          })
        ).json()
      ).toMatchObject({ requests: [expect.objectContaining({ requestId: result.requestId })] });
      return;
    }
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
      const expiredAt = new Date(
        new Date(amendment.amendmentDocument.periodEnd!).getTime() + 60_000
      );
      if (decision === 'expire_unsigned') {
        const disposition = await http.pool.query<{ disposition: string }>(
          'SELECT expire_electricity_increase($1,$2) AS disposition',
          [result.requestId, expiredAt]
        );
        expect(disposition.rows[0]?.disposition).toBe('unsigned');
        expect(await (await fetch(path, { headers })).json()).toMatchObject({
          request: { status: 'expired', amendmentSha256: amendment.amendmentSha256 },
        });
        return;
      }
      const review = (await (await fetch(path, { headers })).json()) as {
        quote: { adjustmentIrR: string; eligibleFrom: string };
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
      if (decision === 'expire_unpaid') {
        const disposition = await http.pool.query<{ disposition: string }>(
          'SELECT expire_electricity_increase($1,$2) AS disposition',
          [result.requestId, expiredAt]
        );
        expect(disposition.rows[0]?.disposition).toBe('invoice_cancelled');
        expect(await (await fetch(path, { headers })).json()).toMatchObject({
          request: {
            status: 'expired',
            adjustmentInvoiceState: 'Cancelled',
            financialFollowUp: false,
          },
        });
        expect(
          (
            await http.pool.query('SELECT state FROM invoices WHERE id=$1', [
              signedRequest.adjustmentInvoiceId,
            ])
          ).rows[0].state
        ).toBe('Cancelled');
        return;
      }
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
      if (decision === 'expire_review') {
        const disposition = await http.pool.query<{ disposition: string }>(
          'SELECT expire_electricity_increase($1,$2) AS disposition',
          [result.requestId, expiredAt]
        );
        expect(disposition.rows[0]?.disposition).toBe('finance_review');
        expect(await (await fetch(path, { headers })).json()).toMatchObject({
          request: { status: 'expired', adjustmentInvoiceState: 'Paid', financialFollowUp: true },
        });
        expect(
          await (
            await fetch(`${http.base}/api/staff/electricity/increase-requests?status=expired`, {
              headers: staffHeaders,
            })
          ).json()
        ).toMatchObject({ requests: [expect.objectContaining({ requestId: result.requestId })] });
        expect(
          (
            await http.pool.query('SELECT state FROM invoices WHERE id=$1', [
              signedRequest.adjustmentInvoiceId,
            ])
          ).rows[0].state
        ).toBe('Paid');
        return;
      }
      if (decision === 'approve_future' || decision === 'approve_current') {
        expect(await (await fetch(path, { headers })).json()).toMatchObject({
          request: {
            status: 'awaiting_effective_date',
            adjustmentInvoiceId: signedRequest.adjustmentInvoiceId,
          },
        });
        const earlyActivation = await http.pool.query<{ activated: boolean }>(
          'SELECT finalize_paid_electricity_increase($1,$2) AS activated',
          [result.requestId, new Date(new Date(review.quote.eligibleFrom).getTime() - 1_000)]
        );
        expect(earlyActivation.rows[0]?.activated).toBe(false);
        const activation = await http.pool.query<{ activated: boolean }>(
          'SELECT finalize_paid_electricity_increase($1,$2) AS activated',
          [result.requestId, new Date(new Date(review.quote.eligibleFrom).getTime() + 60_000)]
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
      if (decision === 'approve_future') {
        const period = (
          await http.pool.query<{ period_start: Date; period_end: Date }>(
            'SELECT period_start,period_end FROM electricity_orders WHERE id=$1',
            [order.orderId]
          )
        ).rows[0]!;
        const priceStart = new Date(
          (period.period_start.getTime() + period.period_end.getTime()) / 2
        );
        const proposal = await fetch(
          `${http.base}/api/staff/electricity/contracts/${order.contractId}/price-adjustments`,
          {
            method: 'POST',
            headers: staffHeaders,
            body: JSON.stringify({
              expectedVersionId: versionId,
              effectiveFrom: priceStart.toISOString(),
              percentageBps: '1000',
              reason: 'Future tariff change',
              contractualBasis: 'Clause 7',
              idempotencyKey: randomUUID(),
            }),
          }
        );
        expect(proposal.status, http.logs()).toBe(201);
        expect(await proposal.json()).toMatchObject({
          adjustmentAmountIrR: '60000',
          calculation: {
            quote: {
              components: [
                expect.objectContaining({ source: 'original_invoice', changeIrR: '50000' }),
                expect.objectContaining({ source: 'quantity_increase', changeIrR: '10000' }),
              ],
            },
          },
        });
      }
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

it.each([false, true])(
  'tracks a paid contract cancellation and restore_after_payment=%s',
  async (restoreAfterPayment) => {
    await http.pool.query(
      `INSERT INTO gift_codes(code,discount_type,discount_value,total_limit,restore_after_payment,created_by)
     VALUES ('PAIDCANCEL','fixed_irr',100000,1,$1,'buyer')`,
      [restoreAfterPayment]
    );
    input.giftCode = 'PAIDCANCEL';
    await refreshQuote();
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
    const redemption = (
      await http.pool.query<{ status: string; restored_at: Date | null }>(
        'SELECT status,restored_at FROM gift_code_redemptions WHERE order_id=$1',
        [order.orderId]
      )
    ).rows[0]!;
    expect(redemption.status).toBe(restoreAfterPayment ? 'released' : 'consumed');
    expect(redemption.restored_at === null).toBe(!restoreAfterPayment);
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
      (await http.pool.query('SELECT status FROM orders WHERE id=$1', [order.orderId])).rows[0]
        .status
    ).toBe('CANCELLED');
    const refund = (
      await http.pool.query(
        'SELECT refund_id FROM contract_refund_obligations WHERE contract_id=$1',
        [order.contractId]
      )
    ).rows[0];
    expect(await runWalletRefund(http.pool, refund.refund_id)).toBe('completed');
    const finished = await fetch(`${http.base}/api/electricity/orders/${order.orderId}`, {
      headers,
    });
    expect(await finished.json()).toMatchObject({
      electricityStatus: 'cancelled',
      financialStatus: 'refunded',
      financiallyClosed: true,
    });
  }
);

it('previews and atomically submits an order, contract, lines and payable invoice once', async () => {
  await http.pool.query('UPDATE profiles SET title=$2 WHERE id=$1', [
    input.profileId,
    'Customer Company',
  ]);
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
    profileName: 'Customer Company',
    mode: 'simple',
    submittedAt: expect.any(String),
    postalCode: '1234567890',
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

it.each(['charge', 'credit'] as const)(
  'discloses a future staff price %s before issuing its linked adjustment',
  async (kind) => {
    const order = await submittedOrder();
    const contract = (
      await http.pool.query<{
        current_version_id: string;
      }>('SELECT current_version_id FROM contracts WHERE id=$1', [order.contractId])
    ).rows[0]!;
    const period = (
      await http.pool.query<{ period_start: Date; period_end: Date }>(
        'SELECT period_start,period_end FROM electricity_orders WHERE id=$1',
        [order.orderId]
      )
    ).rows[0]!;
    const effectiveFrom = new Date(
      (period.period_start.getTime() + period.period_end.getTime()) / 2
    );
    expect(
      (
        await staffPost(order.orderId, 'approve', {
          expectedVersionId: contract.current_version_id,
          idempotencyKey: randomUUID(),
        })
      ).status,
      http.logs()
    ).toBe(200);
    await http.pool.query(
      `INSERT INTO wallets(profile_id,posted_balance,reserved_balance)
      VALUES($1,1500000,0) ON CONFLICT(profile_id)
      DO UPDATE SET posted_balance=1500000,reserved_balance=0`,
      [input.profileId]
    );
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='buyer'");
    const originalPaymentPath = `${http.base}/api/invoices/${order.invoiceId}/wallet-payment`;
    const originalPaymentReview = await fetch(originalPaymentPath, { headers });
    expect(originalPaymentReview.status, http.logs()).toBe(200);
    const reviewHash = ((await originalPaymentReview.json()) as { review: { hash: string } }).review
      .hash;
    expect(
      (
        await fetch(originalPaymentPath, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            idempotencyKey: randomUUID(),
            expectedRemainingAmount: '1000000',
            expectedReviewHash: reviewHash,
          }),
        })
      ).status,
      http.logs()
    ).toBe(200);
    const acceptancePath = `${http.base}/api/contracts/${order.contractId}`;
    const acceptanceReview = await fetch(
      `${acceptancePath}/acceptance-review?versionId=${contract.current_version_id}`,
      { headers }
    );
    expect(acceptanceReview.status, http.logs()).toBe(200);
    const acceptanceHash = ((await acceptanceReview.json()) as { hash: string }).hash;
    expect(
      (
        await fetch(`${acceptancePath}/accept`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            idempotencyKey: randomUUID(),
            expectedVersionId: contract.current_version_id,
            expectedReviewHash: acceptanceHash,
          }),
        })
      ).status,
      http.logs()
    ).toBe(200);
    expect((await activateReadyContracts(http.pool)).activated).toBe(1);

    const staffPath = `${http.base}/api/staff/electricity/contracts/${order.contractId}/price-adjustments`;
    const customerPath = `${http.base}/api/electricity/contracts/${order.contractId}/price-adjustments`;
    const percentageBps = kind === 'charge' ? '1000' : '-1000';
    const proposalBody = {
      expectedVersionId: contract.current_version_id,
      effectiveFrom: effectiveFrom.toISOString(),
      percentageBps,
      reason: 'Published future tariff correction',
      contractualBasis: 'Clause 7 of signed electricity contract',
      idempotencyKey: randomUUID(),
    };
    const propose = () =>
      fetch(staffPath, {
        method: 'POST',
        headers: staffHeaders,
        body: JSON.stringify(proposalBody),
      });
    const proposedResponse = await propose();
    expect(proposedResponse.status, http.logs()).toBe(201);
    const proposed = (await proposedResponse.json()) as {
      adjustmentId: string;
      calculationSha256: string;
      adjustmentAmountIrR: string;
    };
    expect(proposed.adjustmentAmountIrR).toBe(kind === 'charge' ? '50000' : '-50000');
    expect(((await (await propose()).json()) as { adjustmentId: string }).adjustmentId).toBe(
      proposed.adjustmentId
    );
    const disclosedResponse = await fetch(customerPath, { headers });
    expect(disclosedResponse.status, http.logs()).toBe(200);
    expect(await disclosedResponse.json()).toMatchObject({
      adjustments: [
        {
          adjustmentId: proposed.adjustmentId,
          status: 'proposed',
          reason: proposalBody.reason,
          contractualBasis: proposalBody.contractualBasis,
          adjustmentInvoiceId: null,
          calculation: { quote: { amountIrR: proposed.adjustmentAmountIrR } },
        },
      ],
    });
    const finalizePath = `${http.base}/api/staff/electricity/price-adjustments/${proposed.adjustmentId}/finalize`;
    const finalizeBody = {
      expectedCalculationSha256: proposed.calculationSha256,
      idempotencyKey: randomUUID(),
    };
    expect(
      (
        await fetch(finalizePath, {
          method: 'POST',
          headers: staffHeaders,
          body: JSON.stringify(finalizeBody),
        })
      ).status
    ).toBe(403);
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES('reviewer','role-finance')"
    );
    expect(
      (
        await fetch(finalizePath, {
          method: 'POST',
          headers: staffHeaders,
          body: JSON.stringify({ ...finalizeBody, expectedCalculationSha256: '0'.repeat(64) }),
        })
      ).status
    ).toBe(409);
    const finalizedResponse = await fetch(finalizePath, {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify(finalizeBody),
    });
    expect(finalizedResponse.status, http.logs()).toBe(201);
    const finalized = (await finalizedResponse.json()) as {
      adjustmentInvoiceId: string;
      status: string;
    };
    expect(finalized.status).toBe('finalized');
    expect(
      (
        (await (
          await fetch(finalizePath, {
            method: 'POST',
            headers: staffHeaders,
            body: JSON.stringify(finalizeBody),
          })
        ).json()) as { adjustmentInvoiceId: string }
      ).adjustmentInvoiceId
    ).toBe(finalized.adjustmentInvoiceId);
    const invoice = (
      await http.pool.query<{
        state: string;
        adjustment_kind: string;
        total_amount: string;
        payable_from: Date | null;
        adjustment_for_invoice_id: string;
      }>(
        `SELECT state,adjustment_kind,total_amount,payable_from,adjustment_for_invoice_id
        FROM invoices WHERE id=$1`,
        [finalized.adjustmentInvoiceId]
      )
    ).rows[0]!;
    expect(invoice).toMatchObject({
      state: 'Unpaid',
      adjustment_kind: kind,
      total_amount: '50000',
      adjustment_for_invoice_id: order.invoiceId,
    });
    if (kind === 'credit') expect(invoice.payable_from).toBeNull();
    const original = (
      await http.pool.query<{ state: string; total_amount: string }>(
        'SELECT state,total_amount FROM invoices WHERE id=$1',
        [order.invoiceId]
      )
    ).rows[0]!;
    expect(original).toMatchObject({ state: 'Paid', total_amount: '1000000' });
    expect(await (await fetch(customerPath, { headers })).json()).toMatchObject({
      adjustments: [
        {
          adjustmentId: proposed.adjustmentId,
          status: 'finalized',
          adjustmentInvoiceId: finalized.adjustmentInvoiceId,
        },
      ],
    });
    await expect(
      http.pool.query("UPDATE electricity_price_adjustments SET reason='rewritten' WHERE id=$1", [
        proposed.adjustmentId,
      ])
    ).rejects.toMatchObject({ code: '23514' });
    const secondProposal = await fetch(staffPath, {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({
        ...proposalBody,
        idempotencyKey: randomUUID(),
        reason: 'Superseded second proposal',
      }),
    });
    expect(secondProposal.status, http.logs()).toBe(201);
    const secondId = ((await secondProposal.json()) as { adjustmentId: string }).adjustmentId;
    const cancelled = await fetch(
      `${http.base}/api/staff/electricity/price-adjustments/${secondId}/cancel`,
      {
        method: 'POST',
        headers: staffHeaders,
        body: JSON.stringify({ idempotencyKey: randomUUID() }),
      }
    );
    expect(cancelled.status, http.logs()).toBe(201);
    expect((await cancelled.json()) as { status: string }).toMatchObject({ status: 'cancelled' });
    expect(await (await fetch(customerPath, { headers })).json()).toMatchObject({
      adjustments: [
        expect.objectContaining({ adjustmentId: secondId, status: 'cancelled' }),
        expect.objectContaining({ adjustmentId: proposed.adjustmentId, status: 'finalized' }),
      ],
    });
    await http.pool.query(
      `INSERT INTO app_config(key,value,version) VALUES('electricity.contract_limits',$1::jsonb,1)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1`,
      [
        JSON.stringify({
          max_quantity_increase_percent: 20,
          max_contract_duration_months: 24,
          lead_time_days: 0,
        }),
      ]
    );
    const increasePath = `${http.base}/api/electricity/contracts/${order.contractId}/increase`;
    const increaseResponse = await fetch(increasePath, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestedKwh: '12',
        expectedVersionId: contract.current_version_id,
        idempotencyKey: randomUUID(),
      }),
    });
    expect(increaseResponse.status, http.logs()).toBe(201);
    const increaseId = ((await increaseResponse.json()) as { requestId: string }).requestId;
    const increaseApproval = await fetch(
      `${http.base}/api/staff/electricity/increase-requests/${increaseId}/approve`,
      {
        method: 'POST',
        headers: staffHeaders,
        body: JSON.stringify({ idempotencyKey: randomUUID() }),
      }
    );
    expect(increaseApproval.status, http.logs()).toBe(201);
    const increaseQuote = await fetch(increasePath, { headers });
    expect(increaseQuote.status, http.logs()).toBe(200);
    expect((await increaseQuote.json()) as { quote: { adjustmentIrR: string } }).toMatchObject({
      quote: { adjustmentIrR: kind === 'charge' ? '210000' : '190000' },
    });
  },
  40000
);
