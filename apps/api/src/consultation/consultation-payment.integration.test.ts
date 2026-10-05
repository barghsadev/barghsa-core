import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import {
  consultationFeeEffects,
  consultationReplayActor,
  waitForCapturedConsultationDeadline,
} from '../test/consultation-fee-http-proof.js';

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

async function offerFee(path: string, user: string, body: Record<string, unknown>) {
  const { idempotencyKey: _key, ...terms } = body;
  const preview = await post(path.replace(/\/fee$/, '/fee-review'), user, terms);
  if (!preview.ok) return preview;
  const review = (await preview.json()) as { hash: string };
  return post(path, user, { ...body, expectedReviewHash: review.hash });
}

async function adjustFee(path: string, user: string, body: Record<string, unknown>) {
  const { idempotencyKey: _key, ...terms } = body;
  const preview = await post(path.replace(/\/paid-fee$/, '/paid-fee-review'), user, terms);
  if (!preview.ok) return preview;
  const review = (await preview.json()) as { hash: string };
  return post(path, user, { ...body, expectedReviewHash: review.hash });
}

const resolutionHashes = new Map<string, string>();
async function resolvePaid(path: string, user: string, body: Record<string, unknown>) {
  const key = String(body.idempotencyKey);
  let hash = resolutionHashes.get(key);
  if (!hash) {
    const action = path.endsWith('/paid-cancel')
      ? 'cancel'
      : path.endsWith('/paid-reject')
        ? 'reject'
        : 'recover_refund';
    const preview = await post(
      path.replace(/\/(paid-cancel|paid-reject|refund-recovery)$/, '/paid-resolution-review'),
      user,
      {
        action,
        reason: body.reason,
      }
    );
    if (!preview.ok) return preview;
    hash = ((await preview.json()) as { hash: string }).hash;
    resolutionHashes.set(key, hash);
  }
  return post(path, user, { ...body, expectedReviewHash: hash });
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
  const offered = await offerFee(`${root}/fee`, 'consultation-finance', {
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

it('settles a reviewed offer with a real wallet payment, then allows staff completion', async () => {
  const { requestId, invoiceId, root } = await offer();
  const path = `/api/consultations/requests/${requestId}/accept`;
  expect((await post(path, 'consultation-payer', {})).status).toBe(400);
  const preview = await post(
    `/api/consultations/requests/${requestId}/offer-review`,
    'consultation-payer',
    { decision: 'accept' }
  );
  expect(preview.status, http.logs()).toBe(200);
  const offerReview = (await preview.json()) as {
    hash: string;
    data: { fee: string; invoice: { id: string; totalAmount: string }; outcome: string };
  };
  expect(offerReview.data).toMatchObject({
    fee: '500000',
    invoice: { id: invoiceId, totalAmount: '500000' },
    outcome: 'payment_required',
  });
  await http.pool.query("UPDATE consultation_requests SET scope='Updated scope' WHERE id=$1", [
    requestId,
  ]);
  expect(
    (await post(path, 'consultation-payer', { expectedReviewHash: offerReview.hash })).status
  ).toBe(409);
  expect(
    (
      await http.pool.query('SELECT accepted_at FROM consultation_requests WHERE id=$1', [
        requestId,
      ])
    ).rows[0].accepted_at
  ).toBeNull();
  const current = await post(
    `/api/consultations/requests/${requestId}/offer-review`,
    'consultation-payer',
    { decision: 'accept' }
  );
  const currentHash = ((await current.json()) as { hash: string }).hash;
  expect(currentHash).not.toBe(offerReview.hash);
  const accepted = await post(path, 'consultation-payer', { expectedReviewHash: currentHash });
  expect(accepted.status, http.logs()).toBe(200);
  expect(await accepted.json()).toMatchObject({
    status: 'offer_pending',
    paymentRequired: true,
    invoiceId,
    financialReview: { hash: currentHash },
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
    (await decide(`/api/consultations/requests/${requestId}/accept`, 'consultation-payer')).status
  ).toBe(200);
  await pay(invoiceId);
  const validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const chargeInput = {
    idempotencyKey: randomUUID(),
    fee: '600000',
    reason: 'Additional review required',
    validUntil,
  };
  const rejectedPaidFee = async (
    route: string,
    body: unknown,
    fields?: string[],
    status = 400,
    user = 'consultation-finance'
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
  const invalidPaid = { ...chargeInput, expectedReviewHash: 'a'.repeat(64) };
  for (const [route, body] of [
    [`${root}/paid-fee-review`, { fee: chargeInput.fee, reason: chargeInput.reason, validUntil }],
    [`${root}/paid-fee`, invalidPaid],
  ] as const) {
    for (const [invalid, fields] of [
      [{ ...body, fee: '0' }, ['fee']],
      [{ ...body, fee: '9223372036854775808' }, ['fee']],
      [{ ...body, fee: '500000' }, ['fee']],
      [{ ...body, reason: 'x'.repeat(1001) }, ['reason']],
      [{ ...body, validUntil: '2000-01-01T00:00:00Z' }, ['validUntil']],
    ] as const)
      await rejectedPaidFee(route, invalid, [...fields]);
    for (const invalid of [
      null,
      { ...body, fee: '0', unknown: 'PRIVATE' },
      ...(route.endsWith('/paid-fee')
        ? [
            { ...body, idempotencyKey: 'PRIVATE', fee: '0' },
            { ...body, expectedReviewHash: 'PRIVATE' },
          ]
        : []),
    ])
      await rejectedPaidFee(route, invalid);
    await rejectedPaidFee(
      route.replace(requestId, randomUUID()),
      { ...body, fee: '0' },
      undefined,
      404
    );
    await rejectedPaidFee(route, { ...body, fee: '0' }, undefined, 403, 'consultation-payer');
  }
  await http.pool.query(
    'UPDATE staff_roles SET permissions=\'["orders:read","orders:write","invoices:write"]\' WHERE role_id=\'consultation-payment-staff\''
  );
  try {
    await rejectedPaidFee(
      `${root}/paid-fee-review`,
      { fee: '0', reason: chargeInput.reason, validUntil },
      undefined,
      403
    );
  } finally {
    await http.pool.query(
      'UPDATE staff_roles SET permissions=\'["orders:read","orders:write","invoices:write","admin:financial:edit"]\' WHERE role_id=\'consultation-payment-staff\''
    );
  }
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='consultation-finance'"
  );
  try {
    await rejectedPaidFee(`${root}/paid-fee`, { ...invalidPaid, reason: '' }, undefined, 403);
  } finally {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='consultation-finance'"
    );
  }
  const chargePreview = await post(`${root}/paid-fee-review`, 'consultation-finance', {
    fee: chargeInput.fee,
    reason: chargeInput.reason,
    validUntil: chargeInput.validUntil,
  });
  expect(chargePreview.status, http.logs()).toBe(200);
  const chargeReview = (await chargePreview.json()) as {
    hash: string;
    data: { previousFee: string; revisedFee: string; difference: string; outcome: string };
  };
  expect(chargeReview.data).toMatchObject({
    previousFee: '500000',
    revisedFee: '600000',
    difference: '100000',
    outcome: 'charge_invoice',
  });
  expect((await post(`${root}/paid-fee`, 'consultation-finance', chargeInput)).status).toBe(400);
  await http.pool.query("UPDATE invoices SET state='PartiallyRefunded' WHERE id=$1", [invoiceId]);
  expect(
    (
      await post(`${root}/paid-fee`, 'consultation-finance', {
        ...chargeInput,
        expectedReviewHash: chargeReview.hash,
      })
    ).status
  ).toBe(409);
  await http.pool.query("UPDATE invoices SET state='Paid' WHERE id=$1", [invoiceId]);
  const charge = await post(`${root}/paid-fee`, 'consultation-finance', {
    ...chargeInput,
    expectedReviewHash: chargeReview.hash,
  });
  expect(charge.status, http.logs()).toBe(200);
  const chargeBody = (await charge.json()) as {
    invoiceId: string;
    adjustmentInvoiceId: string;
    status: string;
    financialReview: { hash: string };
  };
  expect(chargeBody).toMatchObject({
    status: 'offer_pending',
    invoiceId: chargeBody.adjustmentInvoiceId,
  });
  expect(chargeBody.financialReview.hash).toBe(chargeReview.hash);
  expect(
    (
      await post(`${root}/paid-fee`, 'consultation-finance', {
        ...chargeInput,
        expectedReviewHash: chargeReview.hash,
      })
    ).status
  ).toBe(200);
  expect(
    (
      await offerFee(`${root}/fee`, 'consultation-finance', {
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
        expectedReviewHash: chargeReview.hash,
      })
    ).status
  ).toBe(409);
  expect(
    (await decide(`/api/consultations/requests/${requestId}/decline`, 'consultation-payer')).status
  ).toBe(409);
  expect(
    (await decide(`/api/consultations/requests/${requestId}/accept`, 'consultation-payer')).status
  ).toBe(200);
  await pay(chargeBody.invoiceId);
  headers['paid-fee-replay-reviewer'] = await consultationReplayActor(
    http.pool,
    'paid-fee-replay-reviewer',
    'consultation-payment-staff'
  );
  const paidProgressEffects = await consultationFeeEffects(http.pool, requestId);
  const paidProgressReplay = await post(`${root}/paid-fee`, 'consultation-finance', {
    ...chargeInput,
    expectedReviewHash: chargeReview.hash,
  });
  expect(paidProgressReplay.status, http.logs()).toBe(200);
  expect(await paidProgressReplay.json()).toEqual(chargeBody);
  for (const [user, body] of [
    ['paid-fee-replay-reviewer', { ...chargeInput, expectedReviewHash: chargeReview.hash }],
    ['consultation-finance', { ...chargeInput, expectedReviewHash: 'a'.repeat(64) }],
    [
      'consultation-finance',
      {
        ...chargeInput,
        reason: 'Different captured reason',
        expectedReviewHash: chargeReview.hash,
      },
    ],
  ] as const)
    await rejectedPaidFee(`${root}/paid-fee`, body, undefined, 409, user);
  expect(await consultationFeeEffects(http.pool, requestId)).toEqual(paidProgressEffects);
  const creditInput = {
    idempotencyKey: randomUUID(),
    fee: '450000',
    reason: 'Reduced review scope',
    validUntil,
  };
  const creditPreview = await post(`${root}/paid-fee-review`, 'consultation-finance', {
    fee: creditInput.fee,
    reason: creditInput.reason,
    validUntil: creditInput.validUntil,
  });
  expect(creditPreview.status, http.logs()).toBe(200);
  const creditReview = (await creditPreview.json()) as {
    hash: string;
    data: { difference: string; outcome: string; refundPlan: Array<{ amount: string }> };
  };
  expect(creditReview.data.difference).toBe('-150000');
  expect(creditReview.data.outcome).toBe('credit_and_wallet_refund');
  expect(creditReview.data.refundPlan.reduce((sum, item) => sum + BigInt(item.amount), 0n)).toBe(
    150000n
  );
  const credit = await post(`${root}/paid-fee`, 'consultation-finance', {
    ...creditInput,
    expectedReviewHash: creditReview.hash,
  });
  expect(credit.status, http.logs()).toBe(200);
  const creditBody = (await credit.json()) as {
    adjustmentInvoiceId: string;
    refundIds: string[];
    status: string;
    financialReview: { hash: string };
  };
  expect(creditBody.status).toBe('offer_accepted');
  expect(creditBody.financialReview.hash).toBe(creditReview.hash);
  expect(creditBody.refundIds.length).toBeGreaterThan(0);
  const stored = (
    await http.pool.query<{ metadata: { financialReview: { hash: string } } }>(
      `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.fee.adjusted'
       AND metadata::jsonb->>'idempotencyKey'=$1`,
      [creditInput.idempotencyKey]
    )
  ).rows[0];
  expect(stored?.metadata.financialReview.hash).toBe(creditReview.hash);
  expect(
    (
      await post(`${root}/paid-fee`, 'consultation-finance', {
        ...creditInput,
        expectedReviewHash: creditReview.hash,
      })
    ).status
  ).toBe(200);
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
  // Earlier fixture requests must not consume this additional probe's submission window.
  // Keep the current financial-proof request and all of its captured snapshots unchanged.
  await http.pool.query(
    "UPDATE consultation_requests SET submitted_at=clock_timestamp()-INTERVAL '2 minutes' WHERE profile_id=$1 AND id<>$2",
    [profileId, requestId]
  );
  const expiring = await offer();
  expect(
    (await decide(`/api/consultations/requests/${expiring.requestId}/accept`, 'consultation-payer'))
      .status,
    http.logs()
  ).toBe(200);
  await pay(expiring.invoiceId);
  const expiringPaid = {
    idempotencyKey: randomUUID(),
    fee: '600000',
    reason: 'Captured expiry proof',
    validUntil: new Date(Date.now() + 5000).toISOString(),
  };
  const expiringPreview = await post(`${expiring.root}/paid-fee-review`, 'consultation-finance', {
    fee: expiringPaid.fee,
    reason: expiringPaid.reason,
    validUntil: expiringPaid.validUntil,
  });
  expect(expiringPreview.status, http.logs()).toBe(200);
  const expiringHash = ((await expiringPreview.json()) as { hash: string }).hash;
  const expiringCommand = { ...expiringPaid, expectedReviewHash: expiringHash };
  const expiringWrite = await post(
    `${expiring.root}/paid-fee`,
    'consultation-finance',
    expiringCommand
  );
  expect(expiringWrite.status, http.logs()).toBe(200);
  const expiringReceipt = await expiringWrite.json(),
    expiryEffects = await consultationFeeEffects(http.pool, expiring.requestId);
  await waitForCapturedConsultationDeadline(expiringPaid.validUntil);
  const expiredReplay = await post(
    `${expiring.root}/paid-fee`,
    'consultation-finance',
    expiringCommand
  );
  expect(expiredReplay.status, http.logs()).toBe(200);
  expect(await expiredReplay.json()).toEqual(expiringReceipt);
  expect(await consultationFeeEffects(http.pool, expiring.requestId)).toEqual(expiryEffects);
  const resolutionCommand = {
    idempotencyKey: randomUUID(),
    reason: 'Resolution reason',
    expectedReviewHash: 'a'.repeat(64),
  };
  for (const [route, body] of [
    [`${root}/paid-resolution-review`, { action: 'reject', reason: resolutionCommand.reason }],
    [`${root}/paid-cancel`, resolutionCommand],
    [`${root}/paid-reject`, resolutionCommand],
    [`${root}/refund-recovery`, resolutionCommand],
  ] as const) {
    await rejectedPaidFee(route, { ...body, reason: '' }, ['reason']);
    await rejectedPaidFee(route, { ...body, reason: 'x'.repeat(1001) }, ['reason']);
    await rejectedPaidFee(route, { ...body, reason: '', unknown: 'PRIVATE' });
    await rejectedPaidFee(
      route,
      route.endsWith('/paid-resolution-review')
        ? { ...body, reason: '', action: 'PRIVATE' }
        : { ...body, reason: '', expectedReviewHash: 'PRIVATE' }
    );
    await rejectedPaidFee(
      route.replace(requestId, randomUUID()),
      { ...body, reason: '' },
      undefined,
      404
    );
    await rejectedPaidFee(route, { ...body, reason: '' }, undefined, 403, 'consultation-payer');
  }
  const resolutionPermissions = [
    'orders:read',
    'orders:write',
    'invoices:write',
    'admin:financial:edit',
  ];
  for (const permission of ['orders:write', 'admin:financial:edit', 'invoices:write']) {
    await http.pool.query('UPDATE staff_roles SET permissions=$1 WHERE role_id=$2', [
      JSON.stringify(resolutionPermissions.filter((item) => item !== permission)),
      'consultation-payment-staff',
    ]);
    try {
      await rejectedPaidFee(
        `${root}/paid-resolution-review`,
        { action: 'cancel', reason: '' },
        undefined,
        403
      );
      await rejectedPaidFee(
        `${root}/paid-cancel`,
        { ...resolutionCommand, reason: '' },
        undefined,
        403
      );
      await rejectedPaidFee(
        `${root}/paid-resolution-review`,
        { action: 'recover_refund', reason: '' },
        permission === 'invoices:write' ? ['reason'] : undefined,
        permission === 'invoices:write' ? 400 : 403
      );
      await rejectedPaidFee(
        `${root}/refund-recovery`,
        { ...resolutionCommand, reason: '' },
        permission === 'invoices:write' ? ['reason'] : undefined,
        permission === 'invoices:write' ? 400 : 403
      );
    } finally {
      await http.pool.query('UPDATE staff_roles SET permissions=$1 WHERE role_id=$2', [
        JSON.stringify(resolutionPermissions),
        'consultation-payment-staff',
      ]);
    }
  }
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='consultation-finance'"
  );
  try {
    await rejectedPaidFee(
      `${root}/paid-reject`,
      { ...resolutionCommand, reason: '' },
      undefined,
      403
    );
    await rejectedPaidFee(
      `${root}/refund-recovery`,
      { ...resolutionCommand, reason: '' },
      undefined,
      403
    );
    await rejectedPaidFee(
      `${root}/paid-resolution-review`,
      { action: 'recover_refund', reason: '' },
      ['reason']
    );
  } finally {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='consultation-finance'"
    );
  }
  await http.pool.query(
    "UPDATE sessions SET revoked_at=NOW() WHERE user_id='consultation-finance'"
  );
  try {
    await rejectedPaidFee(
      `${root}/paid-resolution-review`,
      { action: 'cancel', reason: '' },
      undefined,
      401
    );
    await rejectedPaidFee(
      `${root}/paid-reject`,
      { ...resolutionCommand, reason: '' },
      undefined,
      401
    );
  } finally {
    await http.pool.query(
      "UPDATE sessions SET revoked_at=NULL WHERE user_id='consultation-finance'"
    );
  }
  const rejected = await resolvePaid(`${root}/paid-reject`, 'consultation-finance', {
    idempotencyKey: randomUUID(),
    reason: 'Service cannot be provided',
  });
  expect(rejected.status, http.logs()).toBe(200);
  const rejectedBody = (await rejected.json()) as { status: string; refundIds: string[] };
  expect(rejectedBody.status).toBe('rejected');
  expect(rejectedBody.refundIds.length).toBeGreaterThan(0);
  const savedClosure = (
    await http.pool.query<{
      metadata: { idempotencyKey: string; reason: string; financialReview: { hash: string } };
    }>(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.paid.closed' AND metadata::jsonb->>'requestId'=$1",
      [requestId]
    )
  ).rows;
  expect(savedClosure).toHaveLength(1);
  const finalRefunds = (
    await http.pool.query<{ amount: string }>(
      'SELECT amount::text FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE i.consultation_id=$1',
      [requestId]
    )
  ).rows;
  expect(finalRefunds.reduce((sum, refund) => sum + BigInt(refund.amount), 0n)).toBe(600000n);
  const rejectedRefundId = creditBody.refundIds[0]!;
  const rejectedRefundAmount = (
    await http.pool.query<{ amount: string }>('SELECT amount::text FROM refunds WHERE id=$1', [
      rejectedRefundId,
    ])
  ).rows[0]!.amount;
  const rejectedRefundReview = await post(
    `/api/admin/wallet-refunds/${rejectedRefundId}/reject/review`,
    'consultation-finance',
    { reason: 'Refund details require correction' }
  );
  expect(rejectedRefundReview.status, http.logs()).toBe(200);
  const expectedReviewHash = ((await rejectedRefundReview.json()) as { hash: string }).hash;
  const rejectedRefund = await post(
    `/api/admin/wallet-refunds/${rejectedRefundId}/reject`,
    'consultation-finance',
    { reason: 'Refund details require correction', expectedReviewHash }
  );
  expect(rejectedRefund.status, http.logs()).toBe(200);
  const closureProgressEffects = await consultationFeeEffects(http.pool, requestId, true);
  const closureReplay = await post(`${root}/paid-reject`, 'consultation-finance', {
    idempotencyKey: savedClosure[0]!.metadata.idempotencyKey,
    reason: savedClosure[0]!.metadata.reason,
    expectedReviewHash: savedClosure[0]!.metadata.financialReview.hash,
  });
  expect(closureReplay.status, http.logs()).toBe(200);
  expect(await closureReplay.json()).toEqual(rejectedBody);
  expect(await consultationFeeEffects(http.pool, requestId, true)).toEqual(closureProgressEffects);
  const staffDetail = await fetch(`${http.base}${root}`, {
    headers: headers['consultation-finance']!,
  });
  expect(staffDetail.status, http.logs()).toBe(200);
  expect(await staffDetail.json()).toMatchObject({
    request: { uncovered_credit: rejectedRefundAmount },
  });
  const creditCount = (
    await http.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM invoices WHERE consultation_id=$1 AND adjustment_kind='credit'",
      [requestId]
    )
  ).rows[0]!.count;
  const recoveryInput = { idempotencyKey: randomUUID(), reason: 'Corrected refund request' };
  await http.pool.query('UPDATE staff_roles SET permissions=$1 WHERE role_id=$2', [
    JSON.stringify(resolutionPermissions.filter((item) => item !== 'invoices:write')),
    'consultation-payment-staff',
  ]);
  const recoveryPreview = await post(`${root}/paid-resolution-review`, 'consultation-finance', {
    action: 'recover_refund',
    reason: recoveryInput.reason,
  });
  await http.pool.query('UPDATE staff_roles SET permissions=$1 WHERE role_id=$2', [
    JSON.stringify(resolutionPermissions),
    'consultation-payment-staff',
  ]);
  expect(recoveryPreview.status, http.logs()).toBe(200);
  const recoveryReview = (await recoveryPreview.json()) as {
    hash: string;
    data: { uncoveredCreditBefore: string; totalCredit: string; totalRefund: string };
  };
  expect(recoveryReview.data).toMatchObject({
    uncoveredCreditBefore: rejectedRefundAmount,
    totalCredit: '0',
    totalRefund: rejectedRefundAmount,
  });
  const recovery = await resolvePaid(
    `${root}/refund-recovery`,
    'consultation-finance',
    recoveryInput
  );
  expect(recovery.status, http.logs()).toBe(200);
  const recovered = (await recovery.json()) as {
    refundIds: string[];
    financialReview: { hash: string };
  };
  expect(recovered.refundIds).toHaveLength(1);
  expect(recovered.financialReview.hash).toBe(recoveryReview.hash);
  expect(
    (await resolvePaid(`${root}/refund-recovery`, 'consultation-finance', recoveryInput)).status
  ).toBe(200);
  expect(
    (
      await http.pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM invoices WHERE consultation_id=$1 AND adjustment_kind='credit'",
        [requestId]
      )
    ).rows[0]!.count
  ).toBe(creditCount);
  const recoveredDetail = await fetch(`${http.base}${root}`, {
    headers: headers['consultation-finance']!,
  });
  expect(await recoveredDetail.json()).toMatchObject({ request: { uncovered_credit: '0' } });
  const recoveredRefundReview = await post(
    `/api/admin/wallet-refunds/${recovered.refundIds[0]}/reject/review`,
    'consultation-finance',
    { reason: 'Recovered refund requires correction' }
  );
  expect(recoveredRefundReview.status, http.logs()).toBe(200);
  const recoveredRefundHash = ((await recoveredRefundReview.json()) as { hash: string }).hash;
  const progressedRecovery = await post(
    `/api/admin/wallet-refunds/${recovered.refundIds[0]}/reject`,
    'consultation-finance',
    { reason: 'Recovered refund requires correction', expectedReviewHash: recoveredRefundHash }
  );
  expect(progressedRecovery.status, http.logs()).toBe(200);
  const recoveryProgressEffects = await consultationFeeEffects(http.pool, requestId, true);
  const recoveryReplay = await post(`${root}/refund-recovery`, 'consultation-finance', {
    ...recoveryInput,
    expectedReviewHash: recoveryReview.hash,
  });
  expect(recoveryReplay.status, http.logs()).toBe(200);
  expect(await recoveryReplay.json()).toEqual(recovered);
  expect(await consultationFeeEffects(http.pool, requestId, true)).toEqual(recoveryProgressEffects);
}, 30_000);

it('cancels an unpaid revised charge and requests a refund for the prior paid consultation', async () => {
  const { requestId, invoiceId, root } = await offer();
  expect(
    (await decide(`/api/consultations/requests/${requestId}/accept`, 'consultation-payer')).status
  ).toBe(200);
  await pay(invoiceId);
  const validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const revised = await adjustFee(`${root}/paid-fee`, 'consultation-finance', {
    idempotencyKey: randomUUID(),
    fee: '600000',
    reason: 'Additional review',
    validUntil,
  });
  expect(revised.status, http.logs()).toBe(200);
  const revisedInvoiceId = ((await revised.json()) as { invoiceId: string }).invoiceId;
  for (const [route, body, fields] of [
    [`${root}/paid-resolution-review`, { action: 'cancel', reason: '' }, ['reason']],
    [
      `${root}/paid-cancel`,
      { idempotencyKey: randomUUID(), expectedReviewHash: 'a'.repeat(64), reason: '' },
      ['reason'],
    ],
    [
      `${root}/paid-cancel`,
      { idempotencyKey: 'PRIVATE', expectedReviewHash: 'a'.repeat(64), reason: '' },
      undefined,
    ],
  ] as const) {
    const before = await consultationFeeEffects(http.pool, requestId);
    const invalid = await post(route, 'consultation-finance', body);
    expect(invalid.status, http.logs()).toBe(400);
    const error = await invalid.json();
    if (fields) expect(error).toHaveProperty('error.fields', [...fields]);
    else expect(error).not.toHaveProperty('error.fields');
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
    expect(await consultationFeeEffects(http.pool, requestId)).toEqual(before);
  }
  const input = { idempotencyKey: randomUUID(), reason: 'Customer cancelled the consultation' };
  const closePreview = await post(`${root}/paid-resolution-review`, 'consultation-finance', {
    action: 'cancel',
    reason: input.reason,
  });
  expect(closePreview.status, http.logs()).toBe(200);
  expect(
    (
      await post(`${root}/paid-resolution-review`, 'consultation-payer', {
        action: 'cancel',
        reason: input.reason,
      })
    ).status
  ).toBe(403);
  const closeReview = (await closePreview.json()) as {
    hash: string;
    data: { cancelInvoiceId: string; totalCredit: string; totalRefund: string };
  };
  expect(closeReview.data).toMatchObject({
    cancelInvoiceId: revisedInvoiceId,
    totalCredit: '500000',
    totalRefund: '500000',
  });
  expect((await post(`${root}/paid-cancel`, 'consultation-finance', input)).status).toBe(400);
  await http.pool.query("UPDATE invoices SET state='Overdue' WHERE id=$1", [revisedInvoiceId]);
  expect(
    (
      await post(`${root}/paid-cancel`, 'consultation-finance', {
        ...input,
        expectedReviewHash: closeReview.hash,
      })
    ).status
  ).toBe(409);
  const closed = await resolvePaid(`${root}/paid-cancel`, 'consultation-finance', input);
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
  expect((await resolvePaid(`${root}/paid-cancel`, 'consultation-finance', input)).status).toBe(
    200
  );
  expect(
    (
      await resolvePaid(`${root}/paid-cancel`, 'consultation-finance', {
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
  const refundReview = await post(
    `/api/admin/wallet-refunds/${result.refundIds[0]}/reject/review`,
    'consultation-finance',
    { reason: 'Cancelled refund needs correction' }
  );
  expect(refundReview.status, http.logs()).toBe(200);
  const refundHash = ((await refundReview.json()) as { hash: string }).hash;
  expect(
    (
      await post(
        `/api/admin/wallet-refunds/${result.refundIds[0]}/reject`,
        'consultation-finance',
        { reason: 'Cancelled refund needs correction', expectedReviewHash: refundHash }
      )
    ).status,
    http.logs()
  ).toBe(200);
  const cancellationProgressEffects = await consultationFeeEffects(http.pool, requestId, true);
  const savedCancellationReplay = await post(`${root}/paid-cancel`, 'consultation-finance', {
    ...input,
    expectedReviewHash: resolutionHashes.get(input.idempotencyKey),
  });
  expect(savedCancellationReplay.status, http.logs()).toBe(200);
  expect(await savedCancellationReplay.json()).toEqual(result);
  expect(await consultationFeeEffects(http.pool, requestId, true)).toEqual(
    cancellationProgressEffects
  );
});

it('declines an offer and cancels its unpaid invoice', async () => {
  const { requestId, invoiceId } = await offer();
  const preview = await post(
    `/api/consultations/requests/${requestId}/offer-review`,
    'consultation-payer',
    { decision: 'decline' }
  );
  expect(preview.status, http.logs()).toBe(200);
  const review = (await preview.json()) as {
    hash: string;
    data: { outcome: string; invoice: { id: string; totalAmount: string } };
  };
  expect(review.data).toMatchObject({
    outcome: 'cancel_unpaid_invoice',
    invoice: { id: invoiceId, totalAmount: '500000' },
  });
  const declined = await post(
    `/api/consultations/requests/${requestId}/decline`,
    'consultation-payer',
    { reason: 'The proposed scope is not needed', expectedReviewHash: review.hash }
  );
  expect(declined.status, http.logs()).toBe(200);
  expect(await declined.json()).toMatchObject({
    status: 'offer_declined',
    financialReview: { hash: review.hash },
  });
  const audit = await http.pool.query(
    `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='consultation.request.changed'
     AND metadata::jsonb->>'requestId'=$1 AND metadata::jsonb->>'action'='offer_declined'`,
    [requestId]
  );
  expect(audit.rows[0].metadata.financialReview.hash).toBe(review.hash);
  expect(
    (await http.pool.query('SELECT state FROM invoices WHERE id=$1', [invoiceId])).rows[0]
  ).toMatchObject({ state: 'Cancelled' });
  expect(
    (await decide(`/api/consultations/requests/${requestId}/accept`, 'consultation-payer')).status
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
  const accepted = await decide(
    `/api/consultations/requests/${requestId}/accept`,
    'consultation-payer',
    {}
  );
  expect(accepted.status, http.logs()).toBe(200);
  expect(await accepted.json()).toMatchObject({ status: 'offer_accepted', paymentRequired: false });
});
