import { runWalletRefund } from '@barghsa/db/refund-processing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractService } from './contract.service.js';
import type { ContractCancellationService } from './contract-cancellation.service.js';
type Contract = Awaited<ReturnType<ContractService['get']>>;
type Intent = Awaited<ReturnType<ContractCancellationService['get']>>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const [user, role] of [
    ['cancel-legal', 'role-legal-contracts'],
    ['cancel-finance', 'role-finance'],
    ['cancel-reviewer', 'role-finance'],
    ['cancel-support', 'role-customer-support'],
  ]) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',true)",
      [user]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')",
      [session, user, csrf, randomUUID()]
    );
    headers[user!] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await threshold(0);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id LIKE 'cancel-%'"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('cancel-finance','role-finance'),('cancel-legal','role-legal-contracts') ON CONFLICT DO NOTHING"
  );
  await http.pool.query(
    "DELETE FROM user_roles WHERE user_id='cancel-legal' AND role_id='role-finance'"
  );
});
async function threshold(value: unknown) {
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('finance.dual_approval_threshold',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [JSON.stringify({ threshold_irr: value })]
  );
}
function send(path: string, body?: unknown, user = 'cancel-legal') {
  return fetch(http.base + '/api/admin/' + path, {
    method: body ? 'POST' : 'GET',
    headers: headers[user]!,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function fixture(serviceType = 'electricity', paid = '100', state = 'Paid') {
  const user = randomUUID(),
    profile = randomUUID(),
    invoice = randomUUID();
  await http.pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
    user,
  ]);
  await http.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [profile]);
  const response = await send('contracts', {
    profileId: profile,
    serviceType,
    content: { termMonths: 12 },
    changeDescription: 'Initial draft',
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  const contract = (await response.json()) as Contract;
  await http.pool.query(
    'INSERT INTO invoices(id,profile_id,contract_id,state,total_amount,paid_amount) VALUES($1,$2,$3,$4,100,$5)',
    [invoice, profile, contract.id, state, paid]
  );
  const preview = (await (
    await send(`contracts/${contract.id}/cancellation-preview`)
  ).json()) as Awaited<ReturnType<ContractService['cancellationPreview']>>;
  const body = {
    expectedVersionId: contract.currentVersionId,
    expectedFingerprint: preview.fingerprint,
    reason: 'Customer ended service',
    refundDecision: { mode: 'full_wallet' },
    idempotencyKey: randomUUID(),
  };
  return { contract, invoice, profile, body };
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await send(`contracts/${f.contract.id}/cancellations`, f.body);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as Intent;
}
function execute(f: Awaited<ReturnType<typeof fixture>>, intent: Intent, key = randomUUID()) {
  return send(`contracts/${f.contract.id}/cancellations/execute`, {
    intentId: intent.id,
    idempotencyKey: key,
  });
}
it.each([
  ['Paid', '100'],
  ['PartiallyFunded', '40'],
])(
  'creates exact mandatory obligations for %s funds and replays without duplicates',
  async (state, paid) => {
    const f = await fixture('electricity', paid, state),
      intent = await prepare(f);
    expect(intent.status).toBe('ready');
    expect((await prepare(f)).id).toBe(intent.id);
    const key = randomUUID(),
      response = await execute(f, intent, key);
    expect(response.status, await response.clone().text()).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({
      state: 'Cancelled',
      financiallyClosed: false,
      refunds: [{ invoiceId: f.invoice, amount: paid, destination: 'wallet' }],
    });
    expect(await (await execute(f, intent, key)).json()).toEqual(result);
    expect(
      (
        await http.pool.query(
          'SELECT count(*)::int AS count FROM contract_refund_obligations WHERE contract_id=$1',
          [f.contract.id]
        )
      ).rows[0].count
    ).toBe(1);
    expect((await send(`contracts/${f.contract.id}/cancellations/${intent.id}`)).status).toBe(200);
  }
);
it('cancels an unpaid invoice without inventing a refund', async () => {
  const f = await fixture('electricity', '0', 'Unpaid'),
    intent = await prepare(f),
    response = await execute(f, intent);
  expect(response.status, await response.clone().text()).toBe(201);
  expect(await response.json()).toMatchObject({
    state: 'Cancelled',
    refunds: [],
    financiallyClosed: true,
  });
  expect(
    (await http.pool.query('SELECT state FROM invoices WHERE id=$1', [f.invoice])).rows[0].state
  ).toBe('Cancelled');
});
it('requires a current second financial approval and reads fresh status on prepare retry', async () => {
  await threshold(100);
  const f = await fixture(),
    intent = await prepare(f);
  expect(intent.status).toBe('awaiting_approval');
  expect((await execute(f, intent)).status).toBe(409);
  const approval = await send(
    `approval-requests/${intent.approvalRequestId}/approve`,
    {},
    'cancel-finance'
  );
  expect(approval.status, await approval.clone().text()).toBe(200);
  expect((await prepare(f)).status).toBe('ready');
  expect((await execute(f, intent)).status).toBe(201);
});
it('rejects a reviewer whose finance permission was revoked', async () => {
  await threshold(100);
  const f = await fixture(),
    intent = await prepare(f);
  expect(
    (await send(`approval-requests/${intent.approvalRequestId}/approve`, {}, 'cancel-finance'))
      .status
  ).toBe(200);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='cancel-finance'");
  expect((await execute(f, intent)).status).toBe(409);
});
it('invalidates prepared decisions when paid funds or approval policy change', async () => {
  const f = await fixture('electricity', '40', 'PartiallyFunded'),
    intent = await prepare(f);
  await http.pool.query('UPDATE invoices SET paid_amount=50 WHERE id=$1', [f.invoice]);
  expect((await execute(f, intent)).status).toBe(409);
  const next = await fixture(),
    ready = await prepare(next);
  await threshold(100);
  expect((await execute(next, ready)).status).toBe(409);
});
it('requires finance permission for discretionary refunds and forbids partial electricity returns', async () => {
  const electricity = await fixture();
  expect(
    (
      await send(`contracts/${electricity.contract.id}/cancellations`, {
        ...electricity.body,
        refundDecision: { mode: 'custom', refunds: [] },
      })
    ).status
  ).toBe(400);
  const solar = await fixture('solar');
  expect((await send(`contracts/${solar.contract.id}/cancellations`, solar.body)).status).toBe(403);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('cancel-legal','role-finance')"
  );
  const response = await send(`contracts/${solar.contract.id}/cancellations`, {
    ...solar.body,
    refundDecision: {
      mode: 'custom',
      refunds: [{ invoiceId: solar.invoice, amount: '40', destination: 'wallet' }],
    },
  });
  expect(response.status, await response.clone().text()).toBe(201);
});
it('enforces staff permission, CSRF and fresh step-up', async () => {
  const f = await fixture(),
    path = `contracts/${f.contract.id}/cancellations`;
  expect((await send(path, f.body, 'cancel-support')).status).toBe(403);
  expect(
    (
      await fetch(http.base + '/api/admin/' + path, {
        method: 'POST',
        headers: { ...headers['cancel-legal'], 'X-CSRF-Token': 'wrong' },
        body: JSON.stringify(f.body),
      })
    ).status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='cancel-legal'"
  );
  expect((await send(path, f.body)).status).toBe(403);
});
it('rolls back cancellation and obligations when the final audit fails', async () => {
  const f = await fixture(),
    intent = await prepare(f);
  await http.pool.query(
    "CREATE FUNCTION fail_cancellation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contract.cancelled' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_cancellation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_cancellation_audit()"
  );
  try {
    expect((await execute(f, intent)).status).toBe(500);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_cancellation_audit ON audit_log; DROP FUNCTION fail_cancellation_audit()'
    );
  }
  expect(
    (await http.pool.query('SELECT state FROM contracts WHERE id=$1', [f.contract.id])).rows[0]
      .state
  ).toBe('Draft');
  expect(
    (
      await http.pool.query('SELECT count(*)::int AS count FROM refunds WHERE invoice_id=$1', [
        f.invoice,
      ])
    ).rows[0].count
  ).toBe(0);
  expect((await execute(f, intent)).status).toBe(201);
});
it('prevents generic creation of unbound cancellation approvals', async () => {
  await threshold(100);
  expect(
    (
      await send(
        'approval-requests',
        {
          actionType: 'contract_cancellation',
          amountIrR: 100,
          reason: 'Cannot bind arbitrary data',
        },
        'cancel-finance'
      )
    ).status
  ).toBe(400);
});

it('serializes concurrent executions and rejects stale contract versions', async () => {
  const f = await fixture(),
    intent = await prepare(f);
  const responses = await Promise.all([execute(f, intent), execute(f, intent)]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  const next = await fixture(),
    ready = await prepare(next);
  const edited = await fetch(http.base + `/api/admin/contracts/${next.contract.id}`, {
    method: 'PATCH',
    headers: headers['cancel-legal']!,
    body: JSON.stringify({
      expectedVersionId: next.contract.currentVersionId,
      content: { termMonths: 6 },
      changeDescription: 'Changed term',
      idempotencyKey: randomUUID(),
    }),
  });
  expect(edited.status).toBe(200);
  expect((await execute(next, ready)).status).toBe(409);
});
it('rejects conflicting retry payloads, unknown intents and invalid decisions', async () => {
  const f = await fixture();
  await prepare(f);
  expect(
    (
      await send(`contracts/${f.contract.id}/cancellations`, {
        ...f.body,
        reason: 'Changed reason',
      })
    ).status
  ).toBe(409);
  expect(
    (
      await send(`contracts/${f.contract.id}/cancellations/execute`, {
        intentId: randomUUID(),
        idempotencyKey: randomUUID(),
      })
    ).status
  ).toBe(404);
  expect((await send(`contracts/${f.contract.id}/cancellations/${randomUUID()}`)).status).toBe(404);
  expect(
    (
      await send(`contracts/${f.contract.id}/cancellations`, {
        ...f.body,
        expectedFingerprint: 'invalid',
      })
    ).status
  ).toBe(400);
  const solar = await fixture('solar');
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('cancel-legal','role-finance')"
  );
  for (const refunds of [
    [{ invoiceId: solar.invoice, amount: '101', destination: 'wallet' }],
    [{ invoiceId: randomUUID(), amount: '1', destination: 'wallet' }],
    [
      { invoiceId: solar.invoice, amount: '40', destination: 'wallet' },
      { invoiceId: solar.invoice, amount: '40', destination: 'wallet' },
    ],
  ])
    expect(
      (
        await send(`contracts/${solar.contract.id}/cancellations`, {
          ...solar.body,
          refundDecision: { mode: 'custom', refunds },
        })
      ).status
    ).toBe(400);
});
it('blocks cancellation while refunds or payment review remain unresolved', async () => {
  const f = await fixture();
  await http.pool.query(
    "INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,40,'wallet',$3)",
    [f.invoice, f.profile, randomUUID()]
  );
  const snapshot = (await (
    await send(`contracts/${f.contract.id}/cancellation-preview`)
  ).json()) as { fingerprint: string };
  expect(
    (
      await send(`contracts/${f.contract.id}/cancellations`, {
        ...f.body,
        expectedFingerprint: snapshot.fingerprint,
      })
    ).status
  ).toBe(409);
  const reviewing = await fixture('electricity', '0', 'PaymentUnderReview');
  expect(
    (await send(`contracts/${reviewing.contract.id}/cancellations`, reviewing.body)).status
  ).toBe(409);
});

it.each([
  ['Paid', '100'],
  ['PartiallyFunded', '40'],
])(
  'fulfills %s cancellation debt exactly once after authority and policy change',
  async (state, paid) => {
    const f = await fixture('electricity', paid, state),
      intent = await prepare(f);
    const response = await execute(f, intent);
    expect(response.status).toBe(201);
    const result = (await response.json()) as { refunds: Array<{ id: string; state: string }> };
    const refund = result.refunds[0]!;
    expect(refund.state).toBe('Processing');
    await http.pool.query("DELETE FROM user_roles WHERE user_id='cancel-legal'");
    await threshold(1);
    const outcomes = await Promise.all([
      runWalletRefund(http.pool, refund.id),
      runWalletRefund(http.pool, refund.id),
    ]);
    expect(outcomes.sort()).toEqual(['completed', 'deferred']);
    expect(await runWalletRefund(http.pool, refund.id)).toBe('deferred');
    expect(
      (await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [f.profile]))
        .rows[0].posted_balance
    ).toBe(paid);
    expect(
      (await http.pool.query('SELECT state,refunded_amount FROM invoices WHERE id=$1', [f.invoice]))
        .rows[0]
    ).toEqual({ state: 'Refunded', refunded_amount: paid });
    expect(
      (
        await http.pool.query('SELECT state FROM refund_transactions WHERE refund_id=$1', [
          refund.id,
        ])
      ).rows[0].state
    ).toBe('Completed');
    expect(
      (
        await http.pool.query(
          "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='refund.completed' AND metadata::jsonb->>'refundId'=$1",
          [refund.id]
        )
      ).rows[0].metadata
    ).toMatchObject({ contractId: f.contract.id, intentId: intent.id, actorType: 'system' });
  }
);

it('keeps failed cancellation debt visible after bounded retries without posting a partial credit', async () => {
  const f = await fixture(),
    intent = await prepare(f),
    response = await execute(f, intent);
  expect(response.status).toBe(201);
  const result = (await response.json()) as { refunds: Array<{ id: string }> },
    refund = result.refunds[0]!;
  await http.pool.query(
    "CREATE FUNCTION fail_contract_return() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='refund.completed' THEN RAISE EXCEPTION 'test posting failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_contract_return BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_contract_return()"
  );
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await runWalletRefund(http.pool, refund.id)).toBe(
        attempt === 5 ? 'exhausted' : 'failed'
      );
      if (attempt < 5)
        await http.pool.query(
          "UPDATE refund_retry_jobs SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE refund_id=$1",
          [refund.id]
        );
    }
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_contract_return ON audit_log; DROP FUNCTION fail_contract_return()'
    );
  }
  expect(await runWalletRefund(http.pool, refund.id)).toBe('deferred');
  expect(
    (await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [f.profile]))
      .rows[0].posted_balance
  ).toBe('0');
  expect(
    (await http.pool.query('SELECT state,refunded_amount FROM invoices WHERE id=$1', [f.invoice]))
      .rows[0]
  ).toEqual({ state: 'Paid', refunded_amount: '0' });
  expect(
    (await http.pool.query('SELECT state FROM refunds WHERE id=$1', [refund.id])).rows[0].state
  ).toBe('Failed');
  expect(await (await send(`contracts/${f.contract.id}/cancellation-status`)).json()).toMatchObject(
    { financialStatus: 'needs_attention', financiallyClosed: false, returnedAmount: '0' }
  );
  expect(
    (
      await http.pool.query(
        'SELECT attempts,exhausted_at FROM refund_retry_jobs WHERE refund_id=$1',
        [refund.id]
      )
    ).rows[0]
  ).toMatchObject({ attempts: 5, exhausted_at: expect.any(Date) });
  expect(
    (
      await http.pool.query(
        'SELECT localized_content FROM in_app_notifications WHERE delivery_key=$1',
        [`refund:${refund.id}:Failed`]
      )
    ).rows[0].localized_content.en.body
  ).toContain('contact support');
  expect(
    (
      await send(
        `wallet-refunds/${refund.id}/cancel`,
        { reason: 'Cannot dismiss this debt' },
        'cancel-finance'
      )
    ).status
  ).toBe(409);
  expect(
    (
      await http.pool.query('SELECT * FROM contract_refund_obligations WHERE refund_id=$1', [
        refund.id,
      ])
    ).rowCount
  ).toBe(1);
});

it('detects submitted receipts even when the invoice has not entered review, then blocks new payments after cancellation', async () => {
  const f = await fixture(),
    intent = await prepare(f),
    receipt = randomUUID();
  const insert =
    "INSERT INTO bank_receipts(id,invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key) VALUES($1,$2,$3,10,'2026-09-01','reference',$4)";
  await http.pool.query(insert, [receipt, f.invoice, f.profile, randomUUID()]);
  const preview = (await (
    await send(`contracts/${f.contract.id}/cancellation-preview`)
  ).json()) as { blockers: string[] };
  expect(preview.blockers).toContain('payment_in_progress');
  expect((await execute(f, intent)).status).toBe(409);
  await http.pool.query(
    "UPDATE bank_receipts SET state='Rejected',rejection_reason='Duplicate receipt' WHERE id=$1",
    [receipt]
  );
  expect((await execute(f, intent)).status).toBe(201);
  await expect(
    http.pool.query(insert, [randomUUID(), f.invoice, f.profile, randomUUID()])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query('UPDATE invoices SET paid_amount=paid_amount+1 WHERE id=$1', [f.invoice])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query('UPDATE invoices SET contract_id=NULL WHERE id=$1', [f.invoice])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query(
      "INSERT INTO invoices(profile_id,contract_id,state,total_amount) VALUES($1,$2,'Unpaid',100)",
      [f.profile, f.contract.id]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query(
      "INSERT INTO wallet_transactions(wallet_id,type,amount,state,ref_id,idempotency_key) VALUES($1,'payment',-10,'Pending',$2,$3)",
      [f.profile, f.invoice, randomUUID()]
    )
  ).rejects.toMatchObject({ code: '23514' });
});
it('retries cancellation when a concurrent payment owns the invoice lock', async () => {
  const f = await fixture(),
    intent = await prepare(f),
    client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [f.invoice]);
    expect((await execute(f, intent)).status).toBe(409);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await execute(f, intent)).status).toBe(201);
});

it.each([
  ['Paid', '100'],
  ['PartiallyFunded', '40'],
])(
  'fulfills a %s discretionary bank obligation only after separate reconciliation',
  async (state, paid) => {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES('cancel-legal','role-finance')"
    );
    const f = await fixture('solar', paid, state);
    const prepared = await send(`contracts/${f.contract.id}/cancellations`, {
      ...f.body,
      refundDecision: {
        mode: 'custom',
        refunds: [{ invoiceId: f.invoice, amount: paid, destination: 'external_bank' }],
      },
    });
    expect(prepared.status).toBe(201);
    const intent = (await prepared.json()) as Intent;
    const executed = await execute(f, intent);
    expect(executed.status).toBe(201);
    const result = (await executed.json()) as { refunds: Array<{ id: string; state: string }> };
    const refund = result.refunds[0]!;
    expect(refund.state).toBe('Approved');
    const bankReference = randomUUID();
    expect(
      (
        await send(
          `external-refunds/${refund.id}/record-transfer`,
          { bankReference },
          'cancel-finance'
        )
      ).status
    ).toBe(200);
    expect(
      (await http.pool.query('SELECT refunded_amount FROM invoices WHERE id=$1', [f.invoice]))
        .rows[0].refunded_amount
    ).toBe('0');
    expect(
      (await send(`external-refunds/${refund.id}/reconcile`, { bankReference }, 'cancel-finance'))
        .status
    ).toBe(403);
    const reconciled = await send(
      `external-refunds/${refund.id}/reconcile`,
      { bankReference },
      'cancel-reviewer'
    );
    expect(reconciled.status, await reconciled.clone().text()).toBe(200);
    expect(
      (await http.pool.query('SELECT state,refunded_amount FROM invoices WHERE id=$1', [f.invoice]))
        .rows[0]
    ).toEqual({ state: 'Refunded', refunded_amount: paid });
    expect(
      (await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [f.profile]))
        .rows[0].posted_balance
    ).toBe('0');
  }
);

it('reports financial closure only after obligations settle and scopes customer reads to published owned contracts', async () => {
  const f = await fixture();
  const owner = (await http.pool.query('SELECT user_id FROM profiles WHERE id=$1', [f.profile]))
    .rows[0].user_id as string;
  await http.pool.query('UPDATE profiles SET is_default=true WHERE id=$1', [f.profile]);
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, owner, csrf, randomUUID()]
  );
  const customer = (id: string) =>
    fetch(http.base + `/api/contracts/${id}/cancellation-status`, {
      headers: { Cookie: `barghsa_session=${session}` },
    });
  expect((await customer(f.contract.id)).status).toBe(404);
  const command = { expectedVersionId: f.contract.currentVersionId, idempotencyKey: randomUUID() };
  expect((await send(`contracts/${f.contract.id}/submit`, command)).status).toBe(200);
  expect(
    (await send(`contracts/${f.contract.id}/publish`, { ...command, idempotencyKey: randomUUID() }))
      .status
  ).toBe(200);
  const before = await customer(f.contract.id);
  expect(before.status).toBe(200);
  expect(await before.json()).toMatchObject({
    financialStatus: 'not_cancelled',
    financiallyClosed: false,
  });
  const preview = (await (
    await send(`contracts/${f.contract.id}/cancellation-preview`)
  ).json()) as { fingerprint: string };
  f.body.expectedFingerprint = preview.fingerprint;
  const intent = await prepare(f),
    executed = await execute(f, intent);
  expect(executed.status).toBe(201);
  const result = (await executed.json()) as { refunds: Array<{ id: string }> };
  const pending = await (await customer(f.contract.id)).json();
  expect(pending).toMatchObject({
    financialStatus: 'refunds_pending',
    financiallyClosed: false,
    refundAmount: '100',
    returnedAmount: '0',
  });
  expect(JSON.stringify(pending)).not.toContain('authorizedBy');
  expect((await customer((await fixture()).contract.id)).status).toBe(404);
  expect(await runWalletRefund(http.pool, result.refunds[0]!.id)).toBe('completed');
  expect(await (await customer(f.contract.id)).json()).toMatchObject({
    financialStatus: 'closed',
    financiallyClosed: true,
    returnedAmount: '100',
  });
  expect(await (await send(`contracts/${f.contract.id}/cancellation-status`)).json()).toMatchObject(
    { financialStatus: 'closed', financiallyClosed: true }
  );
  expect(
    (await fetch(http.base + `/api/contracts/${f.contract.id}/cancellation-status`)).status
  ).toBe(401);
  expect((await send('contracts/not-a-uuid/cancellation-status')).status).toBe(400);
});
