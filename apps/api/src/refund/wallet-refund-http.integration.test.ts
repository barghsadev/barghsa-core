import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { WalletRefundDto } from './wallet-refund.service.js';
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
  const response = await post('wallet-refunds', body);
  expect(response.status).toBe(201);
  return (await response.json()) as WalletRefundDto;
}
const decide = (id: string, action: string, body: unknown = {}) =>
  post(`wallet-refunds/${id}/${action}`, body);
async function balances(f: Awaited<ReturnType<typeof invoice>>) {
  return (
    await http.pool.query(
      'SELECT i.refunded_amount,i.state,w.posted_balance FROM invoices i JOIN wallets w ON w.profile_id=i.profile_id WHERE i.id=$1',
      [f.id]
    )
  ).rows[0];
}

it('posts partial and full refunds once and links their original payment evidence', async () => {
  const f = await invoice(),
    body = requestBody(f.id, '40');
  const refund = await request(body),
    replay = await request(body);
  expect(replay.id).toBe(refund.id);
  expect(refund.approvalRequestId).toBeNull();
  expect((await decide(refund.id, 'process')).status).toBe(409);
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await decide(refund.id, 'process');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'Completed', amount: '40' });
  }
  expect(await balances(f)).toEqual({
    refunded_amount: '40',
    state: 'PartiallyRefunded',
    posted_balance: '40',
  });
  const audit = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='refund.requested' AND metadata::jsonb->>'refundId'=$1",
      [refund.id]
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0].metadata.paymentSources).toEqual([
    expect.objectContaining({ source: 'bank_receipt', amount: '100' }),
  ]);
  const next = await request(requestBody(f.id, '60'));
  expect((await decide(next.id, 'approve')).status).toBe(200);
  expect((await decide(next.id, 'process')).status).toBe(200);
  expect(await balances(f)).toEqual({
    refunded_amount: '100',
    state: 'Refunded',
    posted_balance: '100',
  });
  expect((await post('wallet-refunds', requestBody(f.id, '1'))).status).toBe(409);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM wallet_transactions WHERE wallet_id=$1 AND type='refund'",
        [f.profile]
      )
    ).rows
  ).toHaveLength(2);
});

it('preserves bigint amounts and validates requests before writing', async () => {
  const f = await invoice('9007199254740993');
  for (const amount of ['0', '-1', '1.5', '9223372036854775808', 100])
    expect((await post('wallet-refunds', { ...requestBody(f.id), amount })).status).toBe(400);
  expect(
    (await post('wallet-refunds', { ...requestBody(f.id), destination: 'external_bank' })).status
  ).toBe(400);
  const refund = await request(requestBody(f.id, '9007199254740993'));
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  expect((await decide(refund.id, 'process')).status).toBe(200);
  expect(await balances(f)).toEqual({
    refunded_amount: '9007199254740993',
    state: 'Refunded',
    posted_balance: '9007199254740993',
  });
});

it('requires finance permission, CSRF and recent step-up', async () => {
  const f = await invoice(),
    body = requestBody(f.id);
  expect((await post('wallet-refunds', body, 'refund-support')).status).toBe(403);
  expect(
    (
      await fetch(`${http.base}/api/admin/wallet-refunds`, {
        method: 'POST',
        headers: { Cookie: headers['refund-finance']!.Cookie!, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '16 minutes' WHERE user_id='refund-finance'"
  );
  expect((await post('wallet-refunds', body)).status).toBe(403);
  expect(
    (await http.pool.query('SELECT id FROM refunds WHERE invoice_id=$1', [f.id])).rows
  ).toEqual([]);
});

it('serializes competing reservations and rejects changed idempotent requests', async () => {
  const f = await invoice(),
    body = requestBody(f.id, '70');
  const competing = requestBody(f.id, '70');
  const responses = await Promise.all([
    post('wallet-refunds', body),
    post('wallet-refunds', competing),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  const accepted = responses[0]!.status === 201 ? body : competing;

  expect((await post('wallet-refunds', { ...accepted, amount: '60' })).status).toBe(409);
  expect(
    (
      await http.pool.query('SELECT SUM(amount)::text AS amount FROM refunds WHERE invoice_id=$1', [
        f.id,
      ])
    ).rows
  ).toEqual([{ amount: '70' }]);
});

it('requires the bound second approval at the exact threshold and ignores substitute approvals', async () => {
  await threshold(100);
  const f = await invoice(),
    refund = await request(requestBody(f.id));
  expect(refund.approvalRequestId).toBeTruthy();
  expect((await decide(refund.id, 'approve')).status).toBe(409);
  expect((await post(`approval-requests/${refund.approvalRequestId}/approve`)).status).toBe(403);
  await http.pool.query(
    "INSERT INTO approval_requests(action_type,amount_irr,initiator_id,reason,details,status,reviewer_id,reviewed_at) SELECT action_type,amount_irr,initiator_id,reason,details,'approved','refund-reviewer',NOW() FROM approval_requests WHERE id=$1",
    [refund.approvalRequestId]
  );
  expect((await decide(refund.id, 'approve')).status).toBe(409);
  expect(
    (await post(`approval-requests/${refund.approvalRequestId}/approve`, {}, 'refund-reviewer'))
      .status
  ).toBe(200);
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  expect((await decide(refund.id, 'process')).status).toBe(200);
  expect(await balances(f)).toEqual({
    refunded_amount: '100',
    state: 'Refunded',
    posted_balance: '100',
  });
});

it('rechecks reviewer authority and fails closed on corrupt policy', async () => {
  await threshold(100);
  const f = await invoice(),
    refund = await request(requestBody(f.id));
  expect(
    (await post(`approval-requests/${refund.approvalRequestId}/approve`, {}, 'refund-reviewer'))
      .status
  ).toBe(200);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='refund-reviewer'");
  expect((await decide(refund.id, 'approve')).status).toBe(403);
  await threshold('broken');
  expect((await decide(refund.id, 'approve')).status).toBe(409);
  expect(await balances(f)).toEqual({ refunded_amount: '0', state: 'Paid', posted_balance: '0' });
});

it('keeps rejected reviews binding and releases cancelled or rejected reservations', async () => {
  await threshold(100);
  const f = await invoice(),
    refund = await request(requestBody(f.id));
  expect(
    (
      await post(
        `approval-requests/${refund.approvalRequestId}/reject`,
        { reason: 'Not authorized' },
        'refund-reviewer'
      )
    ).status
  ).toBe(200);
  await threshold(0);
  expect((await decide(refund.id, 'approve')).status).toBe(409);
  expect((await decide(refund.id, 'reject')).status).toBe(400);
  expect((await decide(refund.id, 'reject', { reason: 'Finance rejected' })).status).toBe(200);
  expect((await decide(refund.id, 'process')).status).toBe(409);
  const second = await request(requestBody(f.id));
  expect((await decide(second.id, 'cancel', { reason: 'Customer withdrew request' })).status).toBe(
    200
  );
  expect((await decide(second.id, 'approve')).status).toBe(409);
  expect((await request(requestBody(f.id))).state).toBe('Requested');
});

it('requires a fresh review when policy increases before processing', async () => {
  const f = await invoice(),
    body = requestBody(f.id),
    refund = await request(body);
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  await threshold(100);
  expect((await decide(refund.id, 'process')).status).toBe(409);
  const replay = await request(body);
  expect(replay.id).toBe(refund.id);
  expect(replay.approvalRequestId).toBeTruthy();
  expect(
    (await post(`approval-requests/${replay.approvalRequestId}/approve`, {}, 'refund-reviewer'))
      .status
  ).toBe(200);
  expect((await decide(refund.id, 'process')).status).toBe(200);
});

it('rolls the credit and invoice counter back when the completion audit fails', async () => {
  const f = await invoice(),
    refund = await request(requestBody(f.id));
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  await http.pool.query(
    "CREATE FUNCTION fail_refund_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='refund.completed' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_refund_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_refund_audit()"
  );
  try {
    expect((await decide(refund.id, 'process')).status).toBe(500);
    expect(await balances(f)).toEqual({ refunded_amount: '0', state: 'Paid', posted_balance: '0' });
    expect(
      (await http.pool.query('SELECT state FROM refunds WHERE id=$1', [refund.id])).rows
    ).toEqual([{ state: 'Approved' }]);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_refund_audit ON audit_log; DROP FUNCTION fail_refund_audit()'
    );
  }
  const responses = await Promise.all([
    decide(refund.id, 'process'),
    post(`wallet-refunds/${refund.id}/process`, {}, 'refund-reviewer'),
  ]);
  expect(responses.some((response) => response.status === 200)).toBe(true);
  for (const response of responses) {
    expect([200, 409]).toContain(response.status);
    if (response.status === 409) {
      expect(await response.json()).toMatchObject({
        error: { code: 'CONFLICT:INVALID_STATE' },
      });
      expect((await decide(refund.id, 'process')).status).toBe(200);
    }
  }
  expect(
    (
      await http.pool.query(
        "SELECT id FROM wallet_transactions WHERE ref_id=$1 AND type='refund'",
        [refund.id]
      )
    ).rows
  ).toHaveLength(1);
});

it('blocks new balance changes for archived profiles but permits completed replay', async () => {
  const f = await invoice(),
    refund = await request(requestBody(f.id));
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await decide(refund.id, 'process')).status).toBe(409);
  await http.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [f.profile]);
  expect((await decide(refund.id, 'process')).status).toBe(200);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await decide(refund.id, 'process')).status).toBe(200);
  expect(await balances(f)).toEqual({
    refunded_amount: '100',
    state: 'Refunded',
    posted_balance: '100',
  });
});

it('creates the destination wallet for a customer who paid only by bank receipt', async () => {
  const f = await invoice();
  await http.pool.query('DELETE FROM wallets WHERE profile_id=$1', [f.profile]);
  const refund = await request(requestBody(f.id));
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  expect((await decide(refund.id, 'process')).status).toBe(200);
  expect(await balances(f)).toEqual({
    refunded_amount: '100',
    state: 'Refunded',
    posted_balance: '100',
  });
});

it('rolls back a credit if the staff session expires while processing waits', async () => {
  const f = await invoice(),
    refund = await request(requestBody(f.id));
  expect((await decide(refund.id, 'approve')).status).toBe(200);
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM wallets WHERE profile_id=$1 FOR UPDATE', [f.profile]);
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
      [sessions['refund-finance']]
    );
    pending = decide(refund.id, 'process');
    await expect
      .poll(
        async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM wallets%'"
              )
            ).rows[0].count
          ),
        { timeout: 5000 }
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE session_id=$1',
              [sessions['refund-finance']]
            )
          ).rows[0].expired,
        { timeout: 5000 }
      )
      .toBe(true);
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(401);
    expect(await balances(f)).toEqual({ refunded_amount: '0', state: 'Paid', posted_balance: '0' });
    expect(
      (await http.pool.query('SELECT state FROM refunds WHERE id=$1', [refund.id])).rows
    ).toEqual([{ state: 'Approved' }]);
    expect(
      (await http.pool.query('SELECT id FROM wallet_transactions WHERE ref_id=$1', [refund.id]))
        .rows
    ).toEqual([]);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});
