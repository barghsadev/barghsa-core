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
