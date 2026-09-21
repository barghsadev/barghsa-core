import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { SessionService } from '../session/session.service.js';
import type { WalletPaymentReview } from '@barghsa/shared/finance';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup missing');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
}, 40_000);
afterAll(async () => {
  await http?.close();
});
async function fixture(
  options: { state?: string; paid?: string; posted?: string; reserved?: string } = {}
) {
  const userId = randomUUID(),
    profileId = randomUUID(),
    invoiceId = randomUUID(),
    sessionId = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,'test-only')",
    [userId, `${userId}@example.test`]
  );
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,is_default,profile_type) VALUES($1,$2,true,'LEGAL')",
    [profileId, userId]
  );
  await http.pool.query(
    'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES($1,$2,$3)',
    [profileId, options.posted ?? '150000', options.reserved ?? '0']
  );
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,payable_from) VALUES($1,$2,$3,100000,$4,NOW()-INTERVAL '1 day')",
    [invoiceId, profileId, options.state ?? 'Unpaid', options.paid ?? '0']
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$1,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')",
    [sessionId, userId, csrf]
  );
  const result = {
    userId,
    profileId,
    invoiceId,
    sessionId,
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
  };
  const review = await fetch(`${http.base}/api/invoices/${invoiceId}/wallet-payment`, {
    headers: result.headers,
  });
  const value = review.ok ? ((await review.json()) as { review: { hash: string } }) : null;
  return { ...result, reviewHash: value?.review.hash ?? '0'.repeat(64) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture, invoiceId: string = f.invoiceId) {
  return fetch(`${http.base}/api/invoices/${invoiceId}/wallet-payment`, { headers: f.headers });
}
function pay(
  f: Fixture,
  body: unknown = { idempotencyKey: randomUUID(), expectedRemainingAmount: '100000' },
  headers: Record<string, string> = f.headers,
  invoiceId: string = f.invoiceId
) {
  return fetch(`${http.base}/api/invoices/${invoiceId}/wallet-payment`, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      body && typeof body === 'object' && !Array.isArray(body)
        ? { expectedReviewHash: f.reviewHash, ...body }
        : body
    ),
  });
}
async function snapshot(f: Fixture) {
  return {
    wallet: (
      await http.pool.query(
        'SELECT posted_balance,reserved_balance,version FROM wallets WHERE profile_id=$1',
        [f.profileId]
      )
    ).rows[0],
    invoice: (
      await http.pool.query('SELECT state,paid_amount FROM invoices WHERE id=$1', [f.invoiceId])
    ).rows[0],
    ledger: (
      await http.pool.query(
        'SELECT amount,type,state,ref_id FROM wallet_transactions WHERE wallet_id=$1 ORDER BY id',
        [f.profileId]
      )
    ).rows,
    cache: (
      await http.pool.query(
        'SELECT idempotency_key,response FROM idempotency_keys WHERE entity_id=$1',
        [f.invoiceId]
      )
    ).rows,
    audits: (
      await http.pool.query(
        "SELECT event,user_id FROM audit_log WHERE metadata::jsonb->>'invoiceId'=$1 ORDER BY event",
        [f.invoiceId]
      )
    ).rows,
  };
}

it('requires an exact review and persists it through cache and durable-ledger replay', async () => {
  const f = await fixture();
  const body = { idempotencyKey: randomUUID(), expectedRemainingAmount: '100000' };
  expect((await pay(f, { ...body, expectedReviewHash: undefined })).status).toBe(400);
  expect((await pay(f, { ...body, expectedReviewHash: 'invalid' })).status).toBe(400);
  expect((await pay(f, { ...body, expectedReviewHash: '0'.repeat(64) })).status).toBe(409);
  await http.pool.query('UPDATE wallets SET posted_balance=160000 WHERE profile_id=$1', [
    f.profileId,
  ]);
  const before = await snapshot(f);
  expect((await pay(f, body)).status).toBe(409);
  expect(await snapshot(f)).toEqual(before);
  const quote = (await (await context(f)).json()) as { review: { hash: string; data: unknown } };
  f.reviewHash = quote.review.hash;
  const response = await pay(f, body);
  expect(response.status).toBe(200);
  const paid = (await response.json()) as { walletTransactionId: string; reviewHash: string };
  expect(paid.reviewHash).toBe(quote.review.hash);
  const ledger = (
    await http.pool.query('SELECT metadata FROM wallet_transactions WHERE id=$1', [
      paid.walletTransactionId,
    ])
  ).rows[0];
  expect(ledger.metadata.financialReview).toEqual(quote.review);
  expect((await pay(f, body)).status).toBe(200);
  expect((await pay(f, { ...body, expectedReviewHash: 'f'.repeat(64) })).status).toBe(409);
  await http.pool.query('DELETE FROM idempotency_keys WHERE entity_id=$1', [f.invoiceId]);
  const replay = await pay(f, body);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({
    walletTransactionId: paid.walletTransactionId,
    reviewHash: paid.reviewHash,
  });
  expect((await snapshot(f)).wallet.posted_balance).toBe('60000');
  expect((await snapshot(f)).ledger).toHaveLength(1);
  await http.pool.query('DELETE FROM idempotency_keys WHERE entity_id=$1', [f.invoiceId]);
  expect((await pay(f, { ...body, expectedReviewHash: 'f'.repeat(64) })).status).toBe(409);
});

it('shows the issued line breakdown and rejects a changed profile or invoice date', async () => {
  const f = await fixture();
  await http.pool.query(
    `INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,vat_rate,vat_amount,is_taxable,position)
     VALUES($1,$2,'Electricity',2,60000,100000,0,0,false,0)`,
    [randomUUID(), f.invoiceId]
  );
  const quote = (await (await context(f)).json()) as {
    review: { hash: string; data: Record<string, unknown> };
  };
  expect(quote.review.data).toMatchObject({
    currency: 'IRR',
    profile: { id: f.profileId, type: 'LEGAL' },
    invoice: { id: f.invoiceId, totalAmount: '100000', remainingAmount: '100000' },
    lines: [
      {
        description: 'Electricity',
        quantity: 2,
        unitPrice: '60000',
        discount: '20000',
        subtotal: '100000',
        vatAmount: '0',
      },
    ],
    totals: { subtotal: '100000', discount: '20000', vat: '0' },
    payment: { source: 'wallet', availableBefore: '150000', availableAfter: '50000' },
    cancellation: 'separate_review_required',
  });
  f.reviewHash = quote.review.hash;
  await http.pool.query("UPDATE profiles SET title='Updated customer' WHERE id=$1", [f.profileId]);
  expect((await pay(f)).status).toBe(409);
  f.reviewHash = ((await (await context(f)).json()) as { review: { hash: string } }).review.hash;
  await http.pool.query("UPDATE invoices SET due_at=NOW()+INTERVAL '2 days' WHERE id=$1", [
    f.invoiceId,
  ]);
  expect((await pay(f)).status).toBe(409);
  expect((await snapshot(f)).ledger).toHaveLength(0);
});

it.each(['electricity', 'solar'])(
  'binds published %s contract conditions without exposing drafts',
  async (serviceType) => {
    const f = await fixture();
    await http.pool.query('UPDATE users SET is_staff=true WHERE user_id=$1', [f.userId]);
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES($1,'role-legal-contracts')",
      [f.userId]
    );
    const command = (path: string, body: unknown, method = 'POST') =>
      fetch(http.base + '/api/admin/contracts' + path, {
        method,
        headers: f.headers,
        body: JSON.stringify(body),
      });
    const created = await command('', {
      profileId: f.profileId,
      serviceType,
      content: { title: 'Customer terms', text: 'Published terms' },
      changeDescription: 'Initial terms',
      idempotencyKey: randomUUID(),
      activationContext: { initialInvoiceId: null, serviceStartsAt: '2026-10-01T00:00:00.000Z' },
    });
    expect(created.status).toBe(201);
    let contract = (await created.json()) as { id: string; currentVersionId: string };
    await http.pool.query('UPDATE invoices SET contract_id=$2 WHERE id=$1', [
      f.invoiceId,
      contract.id,
    ]);
    const linked = await command(
      `/${contract.id}`,
      {
        expectedVersionId: contract.currentVersionId,
        content: { title: 'Customer terms', text: 'Published terms' },
        changeDescription: 'Link initial invoice',
        idempotencyKey: randomUUID(),
        activationContext: {
          initialInvoiceId: f.invoiceId,
          serviceStartsAt: '2026-10-01T00:00:00.000Z',
        },
      },
      'PATCH'
    );
    expect(linked.status, await linked.clone().text()).toBe(200);
    contract = (await linked.json()) as { id: string; currentVersionId: string };
    const draft = (await (await context(f)).json()) as { review: WalletPaymentReview };
    expect(draft.review.data.contracts).toEqual([]);
    for (const action of ['submit', 'publish']) {
      const response = await command(`/${contract.id}/${action}`, {
        expectedVersionId: contract.currentVersionId,
        idempotencyKey: randomUUID(),
      });
      expect(response.status).toBe(200);
    }
    const quote = (await (await context(f)).json()) as { review: WalletPaymentReview };
    expect(quote.review.data.contracts).toEqual([
      expect.objectContaining({
        id: contract.id,
        versionId: contract.currentVersionId,
        state: 'AwaitingCustomerAcceptance',
        serviceType,
        initialInvoice: true,
        signatureRequired: serviceType === 'solar',
        cancellationRefund: serviceType === 'electricity' ? 'full_wallet' : 'staff_decision',
        serviceStartsAt: '2026-10-01T00:00:00.000Z',
      }),
    ]);
    expect((await pay(f)).status).toBe(409);
    f.reviewHash = quote.review.hash;
    const paid = await pay(f);
    expect(paid.status).toBe(200);
    const result = (await paid.json()) as { walletTransactionId: string };
    const ledger = (
      await http.pool.query('SELECT metadata FROM wallet_transactions WHERE id=$1', [
        result.walletTransactionId,
      ])
    ).rows[0];
    expect(ledger.metadata.financialReview).toEqual(quote.review);
  }
);

it.each([
  { unit: '100000', line: '90000' },
  { unit: '50000', line: '100000' },
])('refuses an inconsistent invoice breakdown: %j', async ({ unit, line }) => {
  const f = await fixture();
  await http.pool.query(
    `INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,vat_rate,vat_amount,is_taxable)
     VALUES($1,$2,'Invalid breakdown',1,$3,$4,0,0,false)`,
    [randomUUID(), f.invoiceId, unit, line]
  );
  expect((await context(f)).status).toBe(409);
  expect((await pay(f)).status).toBe(409);
  expect((await snapshot(f)).ledger).toHaveLength(0);
});

it('commits the exact reviewed taxable total including non-zero VAT', async () => {
  const f = await fixture();
  await http.pool.query('UPDATE invoices SET total_amount=109000 WHERE id=$1', [f.invoiceId]);
  await http.pool.query(
    `INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,vat_rate,vat_amount,is_taxable)
     VALUES($1,$2,'Taxable electricity',1,100000,100000,900,9000,true)`,
    [randomUUID(), f.invoiceId]
  );
  const quote = (await (await context(f)).json()) as { review: WalletPaymentReview };
  expect(quote.review.data.totals).toEqual({ subtotal: '100000', discount: '0', vat: '9000' });
  expect(quote.review.data.lines[0]).toMatchObject({
    vatRate: 900,
    vatAmount: '9000',
    taxable: true,
  });
  f.reviewHash = quote.review.hash;
  const response = await pay(f, {
    idempotencyKey: randomUUID(),
    expectedRemainingAmount: '109000',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ amount: '109000', reviewHash: quote.review.hash });
  expect((await snapshot(f)).wallet.posted_balance).toBe('41000');
});

it.each(['Unpaid', 'PartiallyFunded', 'Overdue'])(
  'pays exact remaining %s amount once across retries',
  async (state) => {
    const partial = state !== 'Unpaid',
      f = await fixture({ state, paid: partial ? '20000' : '0' }),
      amount = partial ? '80000' : '100000',
      body = { idempotencyKey: randomUUID(), expectedRemainingAmount: amount };
    const review = await context(f, f.invoiceId.toUpperCase());
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({
      invoiceId: f.invoiceId,
      profileId: f.profileId,
      remainingAmount: amount,
      availableBalance: '150000',
      canPay: true,
    });
    const replies = await Promise.all([pay(f, body), pay(f, body)]);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    const first = await replies[0]!.json();
    expect(await replies[1]!.json()).toEqual(first);
    expect(first).toMatchObject({
      invoiceId: f.invoiceId,
      profileId: f.profileId,
      idempotencyKey: body.idempotencyKey,
      state: 'Paid',
      amount,
      walletTransactionId: expect.any(String),
      auditId: expect.any(String),
    });
    const after = await snapshot(f);
    expect(after.wallet.posted_balance).toBe((150000n - BigInt(amount)).toString());
    expect(after.invoice).toEqual({ state: 'Paid', paid_amount: '100000' });
    expect(after.ledger).toEqual([
      { amount: `-${amount}`, type: 'payment', state: 'Completed', ref_id: f.invoiceId },
    ]);
    expect(after.audits).toEqual([
      { event: 'invoice.pay_from_wallet', user_id: f.userId },
      { event: 'wallet.invoice_payment', user_id: f.userId },
    ]);
    expect((await pay(f, { ...body, expectedRemainingAmount: '1' })).status).toBe(409);
    await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
      f.sessionId,
    ]);
    expect((await pay(f, body)).status).toBe(401);
    expect(await snapshot(f)).toEqual(after);
  }
);

it('rejects altered confirmation amounts and balances reduced after review without writes', async () => {
  const f = await fixture(),
    before = await snapshot(f),
    body = { idempotencyKey: randomUUID(), expectedRemainingAmount: '99999' };
  expect((await pay(f, body)).status).toBe(409);
  expect(await snapshot(f)).toEqual(before);
  expect(await (await context(f)).json()).toMatchObject({ canPay: true });
  await http.pool.query('UPDATE wallets SET reserved_balance=60000 WHERE profile_id=$1', [
    f.profileId,
  ]);
  const reserved = await snapshot(f);
  expect(await (await context(f)).json()).toMatchObject({
    availableBalance: '90000',
    canPay: false,
  });
  expect((await pay(f, { ...body, expectedRemainingAmount: '100000' })).status).toBe(400);
  expect(await snapshot(f)).toEqual(reserved);
});

it('requires fresh session/CSRF/verification, rejects forged fields, and isolates other profiles and Finance agents', async () => {
  const f = await fixture(),
    other = await fixture(),
    before = await snapshot(f),
    body = { idempotencyKey: randomUUID(), expectedRemainingAmount: '100000' };
  expect((await pay(f, body, { ...f.headers, Cookie: '' })).status).toBe(401);
  expect((await pay(f, body, { ...f.headers, 'X-CSRF-Token': 'wrong' })).status).toBe(403);
  expect((await pay(f, { ...body, profileId: other.profileId })).status).toBe(400);
  expect((await pay(f, { ...body, actorUserId: other.userId })).status).toBe(400);
  for (const amount of ['0', '1.5', 'abc', '9223372036854775808', 100000])
    expect((await pay(f, { ...body, expectedRemainingAmount: amount })).status).toBe(400);
  expect((await pay(other, body, other.headers, f.invoiceId)).status).toBe(404);
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Finance')",
    [f.profileId, other.userId]
  );
  await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
    other.userId,
    f.profileId,
  ]);
  expect((await context(other, f.invoiceId)).status).toBe(404);
  expect((await pay(other, body, other.headers, f.invoiceId)).status).toBe(404);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    f.sessionId,
  ]);
  expect((await pay(f, body)).status).toBe(403);
  expect(await snapshot(f)).toEqual(before);
});

it('rejects a profile switch while a payment waits for its profile lock', async () => {
  const f = await fixture(),
    alternate = randomUUID();
  await http.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [alternate, f.userId]);
  const before = await snapshot(f);
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.profileId]);
    pending = pay(f);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id, archived FROM profiles%'"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await http.pool.query('INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)', [
      f.userId,
      alternate,
    ]);
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(409);
    expect(await snapshot(f)).toEqual(before);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});

it('rolls wallet, invoice, ledger, cache and audits back together after an audit failure', async () => {
  const f = await fixture(),
    before = await snapshot(f);
  await http.pool.query(
    "CREATE OR REPLACE FUNCTION reject_customer_wallet_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test payment audit failure'; END $$; CREATE TRIGGER reject_customer_wallet_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='invoice.pay_from_wallet') EXECUTE FUNCTION reject_customer_wallet_audit()"
  );
  try {
    expect((await pay(f)).status).toBe(500);
    expect(await snapshot(f)).toEqual(before);
  } finally {
    await http.pool.query('DROP TRIGGER reject_customer_wallet_audit ON audit_log');
  }
});

it.each(['session', 'step-up'] as const)(
  'rolls the payment and its cache back if %s expires during the write',
  async (expiry) => {
    const f = await fixture(),
      before = await snapshot(f),
      blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE audit_log IN SHARE MODE');
      await http.pool.query(
        expiry === 'session'
          ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1"
          : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-($2::double precision*INTERVAL '1 millisecond')+INTERVAL '2 seconds' WHERE session_id=$1",
        expiry === 'session' ? [f.sessionId] : [f.sessionId, SessionService.STEP_UP_WINDOW_MS]
      );
      pending = pay(f);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO audit_log%'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                expiry === 'session'
                  ? 'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1'
                  : "SELECT step_up_verified_at+($2::double precision*INTERVAL '1 millisecond')<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1",
                expiry === 'session'
                  ? [f.sessionId]
                  : [f.sessionId, SessionService.STEP_UP_WINDOW_MS]
              )
            ).rows[0].expired,
          { timeout: 5000 }
        )
        .toBe(true);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(expiry === 'session' ? 401 : 403);
      expect(await snapshot(f)).toEqual(before);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  }
);
