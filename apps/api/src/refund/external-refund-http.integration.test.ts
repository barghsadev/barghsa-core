import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { RefundDto } from './refund.service.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const sessions: Record<string, string> = {};
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Missing PostgreSQL');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  for (const [user, role] of [
    ['refund-finance', 'role-finance'],
    ['refund-reviewer', 'role-finance'],
    ['refund-support', 'role-customer-support'],
  ]) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$1,'test-only',true)",
      [user]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [user, role]);
    const session = randomUUID(),
      csrf = randomUUID();
    sessions[user!] = session;
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')",
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
    "UPDATE sessions SET revoked_at=NULL,expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes',step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id IN ('refund-finance','refund-reviewer')"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('refund-reviewer','role-finance') ON CONFLICT DO NOTHING"
  );
});
async function threshold(value: unknown) {
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES ('finance.dual_approval_threshold',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [JSON.stringify({ threshold_irr: value })]
  );
}
async function invoice(amount = '100') {
  const owner = randomUUID(),
    profile = randomUUID(),
    id = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,'test-only')",
    [owner]
  );
  await http.pool.query('INSERT INTO profiles(id,user_id) VALUES ($1,$2)', [profile, owner]);
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES ($1)', [profile]);
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES ($1,$2,'Paid',$3,$3)",
    [id, profile, amount]
  );
  await http.pool.query(
    "INSERT INTO bank_receipts(invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key,state,confirmed_by,confirmed_at) VALUES ($1,$2,$3,'2026-09-01','reference',$4,'Confirmed','refund-finance',NOW())",
    [id, profile, amount, randomUUID()]
  );
  return { id, profile, owner };
}
function post(path: string, body: unknown = {}, user = 'refund-finance') {
  return fetch(`${http.base}/api/admin/${path}`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify(body),
  });
}
function requestBody(invoiceId: string, amount = '100') {
  return {
    invoiceId,
    amount,
    idempotencyKey: randomUUID(),
    reason: 'Customer requested a wallet return',
  };
}
async function request(body: ReturnType<typeof requestBody>) {
  const response = await post('external-refunds', body);
  expect(response.status).toBe(201);
  return (await response.json()) as RefundDto;
}
const decide = (id: string, action: string, body: unknown = {}, user = 'refund-finance') =>
  post(`external-refunds/${id}/${action}`, body, user);
async function balances(f: Awaited<ReturnType<typeof invoice>>) {
  return (
    await http.pool.query(
      'SELECT i.refunded_amount,i.state,w.posted_balance FROM invoices i JOIN wallets w ON w.profile_id=i.profile_id WHERE i.id=$1',
      [f.id]
    )
  ).rows[0];
}

it('records a transfer without settling until a second staff member reconciles it', async () => {
  const f = await invoice(),
    refund = await request(requestBody(f.id, '40')),
    bankReference = randomUUID();
  expect(refund.destination).toBe('external_bank');
  expect((await decide(refund.id, 'record-transfer', { bankReference })).status).toBe(409);
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  for (let retry = 0; retry < 2; retry++) {
    const response = await decide(refund.id, 'record-transfer', { bankReference });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: 'Processing',
      bankReference,
      reconciliationStatus: 'Pending',
    });
  }
  expect(await balances(f)).toEqual({ refunded_amount: '0', state: 'Paid', posted_balance: '0' });
  expect((await decide(refund.id, 'reconcile', { bankReference })).status).toBe(403);
  for (const action of ['cancel', 'reject'])
    expect(
      (await decide(refund.id, action, { reason: 'No dismissal after transfer' })).status
    ).toBe(409);
  expect(
    (await decide(refund.id, 'reconcile', { bankReference: 'different' }, 'refund-reviewer')).status
  ).toBe(409);
  for (let retry = 0; retry < 2; retry++)
    expect(
      (await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status
    ).toBe(200);
  expect(await balances(f)).toEqual({
    refunded_amount: '40',
    state: 'PartiallyRefunded',
    posted_balance: '0',
  });
  expect(
    (await http.pool.query('SELECT id FROM wallet_transactions WHERE ref_id=$1', [refund.id])).rows
  ).toEqual([]);
  const audit = (
    await http.pool.query(
      "SELECT event,user_id FROM audit_log WHERE metadata::jsonb->>'refundId'=$1 AND event IN ('refund.bank_transfer_recorded','refund.bank_reconciled','refund.completed') ORDER BY created_at,id",
      [refund.id]
    )
  ).rows;
  expect(audit).toEqual([
    { event: 'refund.bank_transfer_recorded', user_id: 'refund-finance' },
    { event: 'refund.bank_reconciled', user_id: 'refund-reviewer' },
    { event: 'refund.completed', user_id: 'refund-reviewer' },
  ]);
  const walletResponse = await post('wallet-refunds', requestBody(f.id, '60'));
  expect(walletResponse.status).toBe(201);
  const wallet = (await walletResponse.json()) as RefundDto;
  expect((await post(`wallet-refunds/${wallet.id}/approve`)).status).toBe(200);
  expect((await post(`wallet-refunds/${wallet.id}/process`)).status).toBe(200);
  expect(await balances(f)).toEqual({
    refunded_amount: '100',
    state: 'Refunded',
    posted_balance: '60',
  });
});

it('validates external references and isolates destination-specific actions', async () => {
  const f = await invoice(),
    refund = await request(requestBody(f.id));
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  for (const bankReference of [undefined, '', '   ', 'a'.repeat(201), 'bank\nreference'])
    expect((await decide(refund.id, 'record-transfer', { bankReference })).status).toBe(400);
  expect((await decide(refund.id, 'process')).status).toBe(400);
  expect((await post(`wallet-refunds/${refund.id}/process`)).status).toBe(404);
  const g = await invoice(),
    response = await post('wallet-refunds', requestBody(g.id));
  const wallet = (await response.json()) as RefundDto;
  expect((await decide(wallet.id, 'approve')).status).toBe(404);
  expect((await post('external-refunds', requestBody(g.id), 'refund-support')).status).toBe(403);
});

it('does not let the same bank transfer settle two refunds', async () => {
  const f = await invoice(),
    g = await invoice(),
    a = await request(requestBody(f.id)),
    b = await request(requestBody(g.id)),
    bankReference = randomUUID();
  expect((await decide(a.id, 'approve')).status).toBe(200);
  expect((await decide(b.id, 'approve')).status).toBe(200);
  const responses = await Promise.all([
    decide(a.id, 'record-transfer', { bankReference }),
    decide(b.id, 'record-transfer', { bankReference }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await http.pool.query('SELECT id FROM refunds WHERE bank_reference=$1', [bankReference])).rows
  ).toHaveLength(1);
});

it('binds high-value approval to the external destination and preserves exact amounts', async () => {
  await threshold(100);
  const f = await invoice('9007199254740993'),
    refund = await request(requestBody(f.id, '9007199254740993')),
    bankReference = randomUUID();
  expect(refund.approvalRequestId).toBeTruthy();
  expect((await decide(refund.id, 'approve')).status).toBe(409);
  expect(
    (
      await http.pool.query('SELECT details FROM approval_requests WHERE id=$1', [
        refund.approvalRequestId,
      ])
    ).rows[0].details.destination
  ).toBe('external_bank');
  expect(
    (await post(`approval-requests/${refund.approvalRequestId}/approve`, {}, 'refund-reviewer'))
      .status
  ).toBe(200);
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  expect((await decide(refund.id, 'record-transfer', { bankReference })).status).toBe(200);
  expect((await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status).toBe(
    200
  );
  expect(await balances(f)).toEqual({
    refunded_amount: '9007199254740993',
    state: 'Refunded',
    posted_balance: '0',
  });
});

it.each([100, 'broken'])(
  'reconciles an already recorded transfer when the later policy becomes %s',
  async (policy) => {
    const f = await invoice(),
      body = requestBody(f.id),
      refund = await request(body),
      bankReference = randomUUID();
    expect((await decide(refund.id, 'approve')).status).toBe(200);
    expect((await decide(refund.id, 'record-transfer', { bankReference })).status).toBe(200);
    await threshold(policy);
    const replay = await request(body);
    expect(replay.id).toBe(refund.id);
    expect(replay.approvalRequestId).toBeNull();
    expect(
      (await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status
    ).toBe(200);
    expect(await balances(f)).toEqual({
      refunded_amount: '100',
      state: 'Refunded',
      posted_balance: '0',
    });
  }
);

it('rolls reconciliation back if the completion audit fails', async () => {
  const f = await invoice(),
    refund = await request(requestBody(f.id)),
    bankReference = randomUUID();
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  expect((await decide(refund.id, 'record-transfer', { bankReference })).status).toBe(200);
  await http.pool.query(
    "CREATE FUNCTION fail_external_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='refund.completed' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_external_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_external_audit()"
  );
  try {
    expect(
      (await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status
    ).toBe(500);
    expect(await balances(f)).toEqual({ refunded_amount: '0', state: 'Paid', posted_balance: '0' });
    expect(
      (
        await http.pool.query('SELECT state,reconciliation_status FROM refunds WHERE id=$1', [
          refund.id,
        ])
      ).rows
    ).toEqual([{ state: 'Processing', reconciliation_status: 'Pending' }]);
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE event='refund.bank_reconciled' AND metadata::jsonb->>'refundId'=$1",
          [refund.id]
        )
      ).rows
    ).toEqual([]);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_external_audit ON audit_log; DROP FUNCTION fail_external_audit()'
    );
  }
  expect((await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status).toBe(
    200
  );
});

it('requires current reconciler authority without invalidating an offboarded recorder history', async () => {
  const f = await invoice(),
    refund = await request(requestBody(f.id)),
    bankReference = randomUUID();
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  expect((await decide(refund.id, 'record-transfer', { bankReference })).status).toBe(200);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='refund-reviewer'");
  expect((await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status).toBe(
    403
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('refund-reviewer','role-finance')"
  );
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status).toBe(
    409
  );
  await http.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [f.profile]);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='refund-finance'");
  try {
    expect(
      (await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status
    ).toBe(200);
  } finally {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('refund-finance','role-finance')"
    );
  }
});

it('notifies only the profile owner in both languages once per committed outcome', async () => {
  const f = await invoice(),
    refund = await request(requestBody(f.id)),
    bankReference = randomUUID();
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  expect((await decide(refund.id, 'record-transfer', { bankReference })).status).toBe(200);
  expect(
    (await http.pool.query('SELECT id FROM in_app_notifications WHERE profile_id=$1', [f.profile]))
      .rows
  ).toEqual([]);
  for (let retry = 0; retry < 2; retry++)
    expect(
      (await decide(refund.id, 'reconcile', { bankReference }, 'refund-reviewer')).status
    ).toBe(200);
  const notices = (
    await http.pool.query(
      'SELECT recipient_user_id,profile_id,localized_content,link_route FROM in_app_notifications WHERE profile_id=$1',
      [f.profile]
    )
  ).rows;
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    recipient_user_id: f.owner,
    profile_id: f.profile,
    link_route: `/invoices/${f.id}`,
    localized_content: {
      en: { title: 'Refund completed', body: expect.stringContaining('100 IRR') },
      fa: { title: 'بازپرداخت انجام شد', body: expect.stringContaining('۱۰۰') },
    },
  });
  const g = await invoice(),
    rejected = await request(requestBody(g.id));
  for (let retry = 0; retry < 2; retry++)
    expect(
      (await decide(rejected.id, 'reject', { reason: 'Private internal reason' })).status
    ).toBe(200);
  const rejection = (
    await http.pool.query(
      'SELECT recipient_user_id,localized_content FROM in_app_notifications WHERE profile_id=$1',
      [g.profile]
    )
  ).rows;
  expect(rejection).toHaveLength(1);
  expect(rejection[0]).toMatchObject({
    recipient_user_id: g.owner,
    localized_content: {
      en: { title: 'Refund request rejected' },
      fa: { title: 'درخواست بازپرداخت رد شد' },
    },
  });
  expect(JSON.stringify(rejection)).not.toContain('Private internal reason');
});

it('rolls wallet completion back if its customer notice cannot be persisted', async () => {
  const f = await invoice(),
    response = await post('wallet-refunds', requestBody(f.id));
  const refund = (await response.json()) as RefundDto;
  expect((await post(`wallet-refunds/${refund.id}/approve`)).status).toBe(200);
  await http.pool.query(
    "CREATE FUNCTION fail_refund_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.profile_id IS NOT NULL THEN RAISE EXCEPTION 'test notice unavailable'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_refund_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_refund_notice()"
  );
  try {
    const failed = await post(`wallet-refunds/${refund.id}/process`);
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ state: 'Failed', retry: { attempts: 1 } });
    expect(await balances(f)).toEqual({ refunded_amount: '0', state: 'Paid', posted_balance: '0' });
    expect(
      (await http.pool.query('SELECT state FROM refunds WHERE id=$1', [refund.id])).rows
    ).toEqual([{ state: 'Failed' }]);
    expect(
      (await http.pool.query('SELECT id FROM wallet_transactions WHERE ref_id=$1', [refund.id]))
        .rows
    ).toEqual([]);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_refund_notice ON in_app_notifications; DROP FUNCTION fail_refund_notice()'
    );
  }
  await http.pool.query('UPDATE refund_retry_jobs SET next_attempt_at=now() WHERE refund_id=$1', [
    refund.id,
  ]);
  for (let retry = 0; retry < 2; retry++)
    expect((await post(`wallet-refunds/${refund.id}/process`)).status).toBe(200);
  const notices = (
    await http.pool.query(
      'SELECT localized_content FROM in_app_notifications WHERE profile_id=$1',
      [f.profile]
    )
  ).rows;
  expect(notices).toHaveLength(1);
  expect(notices[0].localized_content.en.body).toContain('returned to your wallet');
});
