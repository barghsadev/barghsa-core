import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { activateReadyContracts } from '@barghsa/db/contract-activation';
import { runWalletRefund } from '@barghsa/db/refund-processing';
import { expireSavingInventory } from '@barghsa/db/saving-inventory';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let customerHeaders: Record<string, string>;
let staffHeaders: Record<string, string>;
let input: {
  profileId: string;
  savingPlanId: string;
  hardwareProductId: string;
  billIdentifier: string;
  installationAddressId: string;
  agreementVersionId: string;
};
let legalProfileId: string;

function request(path: string, method: string, body?: unknown, headers = customerHeaders) {
  return fetch(`${http.base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('saving-order-admin','Saving order','Test role','["admin:catalogue:edit","contracts:read","contracts:write"]')`
  );
  for (const [user, staff] of [
    ['saving-order-buyer', false],
    ['saving-order-staff', true],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',$3)",
      [user, `${user}@example.test`, staff]
    );
    if (staff)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES($1,'saving-order-admin')",
        [user]
      );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, user, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (staff) staffHeaders = headers;
    else customerHeaders = headers;
  }
  const profileId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('saving-order-buyer','INDIVIDUAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0]!.id;
  legalProfileId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('saving-order-buyer','LEGAL','ACTIVE',false) RETURNING id"
    )
  ).rows[0]!.id;
  const provinceId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان تست','Test Province') RETURNING id"
    )
  ).rows[0]!.id;
  const cityId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر تست','Test City') RETURNING id",
      [provinceId]
    )
  ).rows[0]!.id;
  const addressId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address)
     VALUES($1,$2,$3,'Test installation address','1234567890',true) RETURNING id`,
      [profileId, provinceId, cityId]
    )
  ).rows[0]!.id;
  const hardwareResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'hardware',
      title: { fa: 'دستگاه', en: 'Device' },
      description: { fa: 'تجهیز', en: 'Equipment' },
      price: '200000',
      status: 'active',
    },
    staffHeaders
  );
  expect(hardwareResponse.status, http.logs()).toBe(201);
  const hardware = (await hardwareResponse.json()) as { id: string };
  const inventory = await request(
    `/api/admin/catalogue/hardware/${hardware.id}/inventory`,
    'PUT',
    { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
    staffHeaders
  );
  expect(inventory.status, http.logs()).toBe(200);
  expect(await inventory.json()).toMatchObject({
    stockTracking: true,
    stockCount: 2,
    reservedCount: 0,
  });
  const inventoryRead = await request(
    `/api/admin/catalogue/hardware/${hardware.id}/inventory`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(inventoryRead.status, http.logs()).toBe(200);
  expect(await inventoryRead.json()).toMatchObject({ reservationMinutes: 30 });
  const planResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'saving_plan',
      title: { fa: 'طرح', en: 'Plan' },
      description: { fa: 'صرفه‌جویی', en: 'Saving' },
      price: '100000',
      status: 'inactive',
      hardwareIds: [hardware.id],
    },
    staffHeaders
  );
  expect(planResponse.status, http.logs()).toBe(201);
  const plan = (await planResponse.json()) as { id: string };
  const draftResponse = await request(
    `/api/admin/catalogue/saving-plans/${plan.id}/agreements/draft`,
    'POST',
    { title: 'Test terms', body: 'The customer agrees to the plan.' },
    staffHeaders
  );
  expect(draftResponse.status, http.logs()).toBe(201);
  const agreement = (await draftResponse.json()) as { id: string };
  expect(
    (
      await request(
        `/api/admin/catalogue/saving-plans/${plan.id}/agreements/${agreement.id}/activate`,
        'POST',
        undefined,
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(201);
  expect(
    (
      await request(
        `/api/admin/catalogue/products/${plan.id}`,
        'PUT',
        { status: 'active' },
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(200);
  await http.pool.query(
    `INSERT INTO vat_configurations(category,rate,effective_from,created_by)
     VALUES('saving_plan',900,NOW()-INTERVAL '1 day','saving-order-staff')`
  );
  input = {
    profileId,
    savingPlanId: plan.id,
    hardwareProductId: hardware.id,
    billIdentifier: '1234567890123',
    installationAddressId: addressId,
    agreementVersionId: agreement.id,
  };
}, 60000);

afterAll(async () => {
  await http?.close();
}, 15000);

it('quotes net VAT, rejects legal profiles, and atomically submits once', async () => {
  const legal = await request('/api/saving/orders/quote', 'POST', {
    ...input,
    profileId: legalProfileId,
  });
  expect(legal.status, http.logs()).toBe(400);
  const quoteResponse = await request('/api/saving/orders/quote', 'POST', input);
  expect(quoteResponse.status, http.logs()).toBe(201);
  const quote = (await quoteResponse.json()) as {
    reviewDigest: string;
    totalIrR: string;
    vatIrR: string;
  };
  expect(quote.vatIrR).toBe('9000');
  expect(quote.totalIrR).toBe('309000');
  const beforeDuplicate = await request('/api/saving/orders/duplicate', 'POST', {
    profileId: input.profileId,
    savingPlanId: input.savingPlanId,
    billIdentifier: input.billIdentifier,
  });
  expect(beforeDuplicate.status, http.logs()).toBe(201);
  expect(await beforeDuplicate.json()).toEqual({ duplicate: false, existingOrderId: null });
  const verification = await request('/api/saving/orders/verify-bill', 'POST', {
    profileId: input.profileId,
    billIdentifier: input.billIdentifier,
  });
  expect(verification.status, http.logs()).toBe(201);
  expect(await verification.json()).toMatchObject({ status: 'not_configured' });
  const stale = await request('/api/saving/orders', 'POST', {
    ...input,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: '0'.repeat(64),
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(stale.status, http.logs()).toBe(409);
  const submission = {
    ...input,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  };
  const first = await request('/api/saving/orders', 'POST', submission);
  expect(first.status, http.logs()).toBe(201);
  const result = (await first.json()) as {
    savingOrderId: string;
    orderId: string;
    contractId: string;
    invoiceId: string;
  };
  const afterDuplicate = await request('/api/saving/orders/duplicate', 'POST', {
    profileId: input.profileId,
    savingPlanId: input.savingPlanId,
    billIdentifier: input.billIdentifier,
  });
  expect(afterDuplicate.status, http.logs()).toBe(201);
  expect(await afterDuplicate.json()).toEqual({
    duplicate: true,
    existingOrderId: result.savingOrderId,
  });
  const retry = await request('/api/saving/orders', 'POST', submission);
  expect(retry.status, http.logs()).toBe(201);
  expect(await retry.json()).toEqual(result);
  const detail = await request(`/api/saving/orders/${result.savingOrderId}`, 'GET');
  expect(detail.status, http.logs()).toBe(200);
  expect(await detail.json()).toMatchObject({
    status: 'awaiting_staff_review',
    invoice_state: 'Unpaid',
    contract_state: 'AwaitingStaffReview',
    stages: [
      { stage: 'request_confirmation' },
      { stage: 'product_delivery' },
      { stage: 'installation_and_document_upload' },
      { stage: 'equipment_handover' },
      { stage: 'process_completion' },
    ],
  });
  const list = await request(`/api/saving/orders?profileId=${input.profileId}`, 'GET');
  expect(list.status, http.logs()).toBe(200);
  expect(await list.json()).toMatchObject({ orders: [{ id: result.savingOrderId }] });
  const counts = await http.pool.query<{ orders: string; contracts: string; invoices: string }>(
    `SELECT (SELECT COUNT(*)::text FROM orders WHERE id=$1) AS orders,
            (SELECT COUNT(*)::text FROM contracts WHERE order_id=$1) AS contracts,
            (SELECT COUNT(*)::text FROM invoices WHERE order_id=$1) AS invoices`,
    [result.orderId]
  );
  expect(counts.rows[0]).toMatchObject({ orders: '1', contracts: '1', invoices: '1' });
  const commentsPath = `/api/saving/orders/${result.savingOrderId}/comments`;
  const staffCommentsPath = `/api/staff/saving/orders/${result.savingOrderId}/comments`;
  const customerComment = { idempotencyKey: randomUUID(), body: 'Please call before delivery.' };
  const postedCustomer = await request(commentsPath, 'POST', customerComment);
  expect(postedCustomer.status, http.logs()).toBe(200);
  expect(await postedCustomer.json()).toMatchObject({
    body: customerComment.body,
    authorRole: 'customer',
  });
  const customerRetry = await request(commentsPath, 'POST', customerComment);
  expect(customerRetry.status, http.logs()).toBe(200);
  const postedStaff = await request(
    staffCommentsPath,
    'POST',
    { idempotencyKey: randomUUID(), body: 'We will call before delivery.' },
    staffHeaders
  );
  expect(postedStaff.status, http.logs()).toBe(200);
  expect(await postedStaff.json()).toMatchObject({ authorRole: 'staff' });
  const comments = await request(commentsPath, 'GET');
  expect(comments.status, http.logs()).toBe(200);
  expect(await comments.json()).toMatchObject({
    comments: [
      { body: customerComment.body, authorRole: 'customer' },
      { body: 'We will call before delivery.', authorRole: 'staff' },
    ],
    nextBefore: null,
  });
  const persistedComments = await http.pool.query<{ total: string }>(
    'SELECT COUNT(*)::text AS total FROM saving_order_comments WHERE order_id=$1',
    [result.savingOrderId]
  );
  expect(persistedComments.rows[0]?.total).toBe('2');
  expect(
    (
      await http.pool.query(
        `SELECT 1 FROM in_app_notifications WHERE recipient_user_id='saving-order-buyer'
       AND link_route=$1 AND localized_content->'en'->>'body' LIKE '%replied%'`,
        [`/savings/orders/${result.savingOrderId}`]
      )
    ).rowCount
  ).toBe(1);
  await expect(
    http.pool.query('UPDATE saving_order_comments SET body=$1 WHERE order_id=$2', [
      'silently changed',
      result.savingOrderId,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  const duplicate = await request('/api/saving/orders', 'POST', {
    ...submission,
    idempotencyKey: randomUUID(),
  });
  expect(duplicate.status, http.logs()).toBe(409);

  await http.pool.query(
    `INSERT INTO gift_codes(code,discount_type,discount_value,categories,created_by)
     VALUES('SAVING30','fixed_irr',30000,ARRAY['saving_plan'],'saving-order-staff')`
  );
  const discountedInput = { ...input, billIdentifier: '1234567890124', giftCode: 'saving30' };
  const discountedQuoteResponse = await request(
    '/api/saving/orders/quote',
    'POST',
    discountedInput
  );
  expect(discountedQuoteResponse.status, http.logs()).toBe(201);
  const discountedQuote = (await discountedQuoteResponse.json()) as {
    reviewDigest: string;
    discountIrR: string;
    vatIrR: string;
    totalIrR: string;
  };
  expect(discountedQuote).toMatchObject({
    discountIrR: '30000',
    vatIrR: '8100',
    totalIrR: '278100',
  });
  const discounted = await request('/api/saving/orders', 'POST', {
    ...discountedInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: discountedQuote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(discounted.status, http.logs()).toBe(201);
  const discountedOrder = (await discounted.json()) as { orderId: string; savingOrderId: string };
  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]?.reserved_count
  ).toBe(2);
  const inventoryPath = `/api/admin/catalogue/hardware/${input.hardwareProductId}/inventory`;
  expect(
    (
      await request(
        inventoryPath,
        'PUT',
        {
          stockTracking: true,
          stockCount: 1,
          reservationMinutes: 30,
        },
        staffHeaders
      )
    ).status
  ).toBe(409);
  expect(
    (
      await request(
        inventoryPath,
        'PUT',
        {
          stockTracking: false,
          stockCount: 2,
          reservationMinutes: 30,
        },
        staffHeaders
      )
    ).status
  ).toBe(409);
  const noStockInput = { ...input, billIdentifier: '1234567890126' };
  const noStockQuote = await request('/api/saving/orders/quote', 'POST', noStockInput);
  expect(noStockQuote.status, http.logs()).toBe(201);
  const noStockDigest = ((await noStockQuote.json()) as { reviewDigest: string }).reviewDigest;
  expect(
    (
      await request('/api/saving/orders', 'POST', {
        ...noStockInput,
        idempotencyKey: randomUUID(),
        expectedQuoteDigest: noStockDigest,
        agreementAccepted: true,
        hardwareConfirmed: true,
        submitForStaffReview: true,
      })
    ).status,
    http.logs()
  ).toBe(409);
  expect(
    (
      await http.pool.query<{ discount_amount: string }>(
        'SELECT discount_amount::text FROM gift_code_redemptions WHERE order_id=$1',
        [discountedOrder.orderId]
      )
    ).rows[0]?.discount_amount
  ).toBe('30000');

  const staffQueue = await request('/api/staff/saving/orders', 'GET', undefined, staffHeaders);
  expect(staffQueue.status, http.logs()).toBe(200);
  expect(
    ((await staffQueue.json()) as { orders: Array<{ id: string }> }).orders.map((order) => order.id)
  ).toContain(result.savingOrderId);
  const staffDetailResponse = await request(
    `/api/staff/saving/orders/${result.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(staffDetailResponse.status, http.logs()).toBe(200);
  const staffDetail = (await staffDetailResponse.json()) as { versionId: string };
  const approval = { idempotencyKey: randomUUID(), expectedVersionId: staffDetail.versionId };
  const approvePath = `/api/staff/saving/orders/${result.savingOrderId}/approve`;
  const approved = await request(approvePath, 'POST', approval, staffHeaders);
  expect(approved.status, http.logs()).toBe(200);
  expect(await approved.json()).toMatchObject({ status: 'approved' });
  expect(
    (
      await http.pool.query<{ stock_count: number; reserved_count: number }>(
        'SELECT stock_count,reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]
  ).toMatchObject({ stock_count: 1, reserved_count: 1 });
  const approvalRetry = await request(approvePath, 'POST', approval, staffHeaders);
  expect(approvalRetry.status, http.logs()).toBe(200);
  expect(await approvalRetry.json()).toMatchObject({ status: 'approved' });
  expect(
    (
      await request(
        approvePath,
        'POST',
        { ...approval, idempotencyKey: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(409);
  const stagePath = (stage: string, action = 'complete') =>
    `/api/staff/saving/orders/${result.savingOrderId}/stages/${stage}/${action}`;
  const stageInput = () => ({
    idempotencyKey: randomUUID(),
    expectedStatus: 'in_progress',
    explanation: 'Staff verified progress',
  });
  expect(
    (await request(stagePath('product_delivery'), 'POST', stageInput(), staffHeaders)).status
  ).toBe(409);
  await http.pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance)
     VALUES($1,1000000,0) ON CONFLICT(profile_id)
     DO UPDATE SET posted_balance=1000000,reserved_balance=0`,
    [input.profileId]
  );
  const paymentPath = `/api/invoices/${result.invoiceId}/wallet-payment`;
  const walletReviewResponse = await request(paymentPath, 'GET');
  expect(walletReviewResponse.status, http.logs()).toBe(200);
  const walletHash = ((await walletReviewResponse.json()) as { review: { hash: string } }).review
    .hash;
  const paid = await request(paymentPath, 'POST', {
    idempotencyKey: randomUUID(),
    expectedRemainingAmount: quote.totalIrR,
    expectedReviewHash: walletHash,
  });
  expect(paid.status, http.logs()).toBe(200);
  const delivered = await request(
    stagePath('product_delivery'),
    'POST',
    stageInput(),
    staffHeaders
  );
  expect(delivered.status, http.logs()).toBe(200);
  expect(await delivered.json()).toMatchObject({
    status: 'in_progress',
    nextStage: 'installation_and_document_upload',
  });
  expect(
    (await request(stagePath('equipment_handover', 'skip'), 'POST', stageInput(), staffHeaders))
      .status
  ).toBe(409);
  const installed = await request(
    stagePath('installation_and_document_upload'),
    'POST',
    stageInput(),
    staffHeaders
  );
  expect(installed.status, http.logs()).toBe(200);
  const skipped = await request(
    stagePath('equipment_handover', 'skip'),
    'POST',
    stageInput(),
    staffHeaders
  );
  expect(skipped.status, http.logs()).toBe(200);
  expect(
    (await request(stagePath('process_completion'), 'POST', stageInput(), staffHeaders)).status
  ).toBe(409);
  const acceptanceReview = await request(
    `/api/contracts/${result.contractId}/acceptance-review?versionId=${staffDetail.versionId}`,
    'GET'
  );
  expect(acceptanceReview.status, http.logs()).toBe(200);
  const acceptanceHash = ((await acceptanceReview.json()) as { hash: string }).hash;
  const accepted = await request(`/api/contracts/${result.contractId}/accept`, 'POST', {
    idempotencyKey: randomUUID(),
    expectedVersionId: staffDetail.versionId,
    expectedReviewHash: acceptanceHash,
  });
  expect(accepted.status, http.logs()).toBe(200);
  expect((await activateReadyContracts(http.pool)).activated).toBe(1);
  const completed = await request(
    stagePath('process_completion'),
    'POST',
    stageInput(),
    staffHeaders
  );
  expect(completed.status, http.logs()).toBe(200);
  expect(await completed.json()).toMatchObject({ status: 'completed', nextStage: null });
  expect(
    (await request(stagePath('process_completion'), 'POST', stageInput(), staffHeaders)).status
  ).toBe(409);
  const customerProgress = await request(`/api/saving/orders/${result.savingOrderId}`, 'GET');
  expect(customerProgress.status, http.logs()).toBe(200);
  expect(await customerProgress.json()).toMatchObject({
    status: 'completed',
    stages: [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'skipped' },
      { status: 'completed' },
    ],
  });
  const history = await request(
    `/api/staff/saving/orders/${result.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(history.status, http.logs()).toBe(200);
  expect(((await history.json()) as { events: unknown[] }).events).toHaveLength(9);

  const rejectedDetail = await request(
    `/api/staff/saving/orders/${discountedOrder.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(rejectedDetail.status, http.logs()).toBe(200);
  const rejectedVersion = ((await rejectedDetail.json()) as { versionId: string }).versionId;
  const rejected = await request(
    `/api/staff/saving/orders/${discountedOrder.savingOrderId}/reject`,
    'POST',
    {
      idempotencyKey: randomUUID(),
      expectedVersionId: rejectedVersion,
      reason: 'Device unavailable',
    },
    staffHeaders
  );
  expect(rejected.status, http.logs()).toBe(200);
  expect(await rejected.json()).toMatchObject({ status: 'rejected' });
  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]?.reserved_count
  ).toBe(0);
  const rejectedState = await http.pool.query<{ invoice_state: string }>(
    'SELECT state AS invoice_state FROM invoices WHERE order_id=$1',
    [discountedOrder.orderId]
  );
  expect(rejectedState.rows[0]?.invoice_state).toBe('Cancelled');

  const paidInput = { ...input, billIdentifier: '1234567890125' };
  const paidQuoteResponse = await request('/api/saving/orders/quote', 'POST', paidInput);
  expect(paidQuoteResponse.status, http.logs()).toBe(201);
  const paidQuote = (await paidQuoteResponse.json()) as { reviewDigest: string; totalIrR: string };
  const paidSubmission = await request('/api/saving/orders', 'POST', {
    ...paidInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: paidQuote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(paidSubmission.status, http.logs()).toBe(201);
  const paidOrder = (await paidSubmission.json()) as {
    savingOrderId: string;
    orderId: string;
    invoiceId: string;
  };
  const paidReviewPath = `/api/invoices/${paidOrder.invoiceId}/wallet-payment`;
  const paidWalletReview = await request(paidReviewPath, 'GET');
  expect(paidWalletReview.status, http.logs()).toBe(200);
  const paidHash = ((await paidWalletReview.json()) as { review: { hash: string } }).review.hash;
  expect(
    (
      await request(paidReviewPath, 'POST', {
        idempotencyKey: randomUUID(),
        expectedRemainingAmount: paidQuote.totalIrR,
        expectedReviewHash: paidHash,
      })
    ).status,
    http.logs()
  ).toBe(200);
  const paidStaffDetail = await request(
    `/api/staff/saving/orders/${paidOrder.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(paidStaffDetail.status, http.logs()).toBe(200);
  const paidVersion = ((await paidStaffDetail.json()) as { versionId: string }).versionId;
  const paidRejected = await request(
    `/api/staff/saving/orders/${paidOrder.savingOrderId}/reject`,
    'POST',
    { idempotencyKey: randomUUID(), expectedVersionId: paidVersion, reason: 'Device unavailable' },
    staffHeaders
  );
  expect(paidRejected.status, http.logs()).toBe(200);
  expect(await paidRejected.json()).toMatchObject({
    status: 'rejected',
    refundId: expect.any(String),
  });
  const obligation = await http.pool.query<{ id: string; status: string; amount: string }>(
    `SELECT r.id,r.state AS status,r.amount::text AS amount FROM refund_obligations o
     JOIN refunds r ON r.id=o.refund_id WHERE o.order_id=$1`,
    [paidOrder.orderId]
  );
  expect(obligation.rows[0]).toMatchObject({ status: 'Processing', amount: paidQuote.totalIrR });
  expect(await runWalletRefund(http.pool, obligation.rows[0]!.id)).toBe('completed');
  const refundedState = await http.pool.query<{ financial_status: string }>(
    'SELECT financial_status FROM saving_orders WHERE id=$1',
    [paidOrder.savingOrderId]
  );
  expect(refundedState.rows[0]?.financial_status).toBe('refunded');
  const refundNotice = await http.pool.query<{ link_route: string }>(
    'SELECT link_route FROM in_app_notifications WHERE delivery_key=$1',
    [`refund:${obligation.rows[0]!.id}:Completed`]
  );
  expect(refundNotice.rows[0]?.link_route).toBe(`/savings/orders/${paidOrder.savingOrderId}`);
  expect(
    (
      await http.pool.query<{ stock_count: number; reserved_count: number }>(
        'SELECT stock_count,reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]
  ).toMatchObject({ stock_count: 1, reserved_count: 0 });
  const expiryInput = { ...input, billIdentifier: '1234567890127' };
  const expiryQuoteResponse = await request('/api/saving/orders/quote', 'POST', expiryInput);
  expect(expiryQuoteResponse.status, http.logs()).toBe(201);
  const expiryDigest = ((await expiryQuoteResponse.json()) as { reviewDigest: string })
    .reviewDigest;
  const expirySubmission = await request('/api/saving/orders', 'POST', {
    ...expiryInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: expiryDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(expirySubmission.status, http.logs()).toBe(201);
  const expiryOrder = (await expirySubmission.json()) as { savingOrderId: string };
  await http.pool.query(
    "UPDATE saving_inventory_reservations SET expires_at=NOW()-INTERVAL '1 minute' WHERE order_id=$1",
    [expiryOrder.savingOrderId]
  );
  expect(await expireSavingInventory(http.pool)).toMatchObject({ expired: 1 });
  expect(await expireSavingInventory(http.pool)).toMatchObject({ expired: 0 });
  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]?.reserved_count
  ).toBe(0);
  const expiryDetail = await request(
    `/api/staff/saving/orders/${expiryOrder.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(expiryDetail.status, http.logs()).toBe(200);
  const expiryVersion = ((await expiryDetail.json()) as { versionId: string }).versionId;
  const expiryApproval = await request(
    `/api/staff/saving/orders/${expiryOrder.savingOrderId}/approve`,
    'POST',
    { idempotencyKey: randomUUID(), expectedVersionId: expiryVersion },
    staffHeaders
  );
  expect(expiryApproval.status, http.logs()).toBe(200);
  expect(
    (
      await http.pool.query<{ stock_count: number; reserved_count: number }>(
        'SELECT stock_count,reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]
  ).toMatchObject({ stock_count: 0, reserved_count: 0 });
}, 90000);
