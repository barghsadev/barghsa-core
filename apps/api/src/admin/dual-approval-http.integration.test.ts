import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { bankReceiptConfirmationLockKeys } from '../wallet/bank-receipt-confirmation.service.js';
import { invoiceBankReceiptConfirmationLockKeys } from '../invoice/invoice-bank-receipt-confirmation.service.js';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  for (const [user, role] of [
    ['initiator', 'role-finance'],
    ['reviewer', 'role-finance'],
    ['support', 'role-customer-support'],
  ]) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)',
      [user, `${user}@example.test`, 'test-only']
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [user, role]);
    const id = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [id, user, csrf, randomUUID()]
    );
    headers[user!] = {
      Cookie: `barghsa_session=${id}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function seed() {
  return (
    await http.pool.query(`INSERT INTO approval_requests(action_type,amount_irr,initiator_id,reason)
  VALUES ('bank_payment_confirmation',100000,'initiator','Verified bank deposit') RETURNING id`)
  ).rows[0].id as string;
}
async function decide(user: string, id: string, action = 'approve') {
  return fetch(`${http.base}/api/admin/approval-requests/${id}/${action}`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify({ reason: 'Rejected after review' }),
  });
}

for (const action of ['create', 'approve', 'reject'] as const) {
  for (const change of ['revoke', 'csrf', 'step-up', 'role'] as const) {
    it(`approval ${action} holds ${change} authority while its write waits`, async () => {
      await http.pool.query(
        "UPDATE sessions SET revoked_at=NULL,csrf_token=$1,step_up_verified_at=NOW(),expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes' WHERE user_id='reviewer'",
        [headers.reviewer!['X-CSRF-Token']]
      );
      await http.pool.query(
        `INSERT INTO app_config(key,value) VALUES ('finance.dual_approval_threshold','{"threshold_irr":100000}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`
      );
      const id = await seed(),
        reason = randomUUID();
      const client = await http.pool.connect();
      let pending: Promise<Response> | undefined, mutation: Promise<unknown> | undefined;
      try {
        await client.query('BEGIN');
        if (action === 'create') await client.query('LOCK TABLE approval_requests IN SHARE MODE');
        else await client.query('SELECT id FROM approval_requests WHERE id=$1 FOR UPDATE', [id]);
        pending =
          action === 'create'
            ? fetch(`${http.base}/api/admin/approval-requests`, {
                method: 'POST',
                headers: headers.reviewer!,
                body: JSON.stringify({
                  action_type: 'bank_payment_confirmation',
                  amount_irr: 100000,
                  reason,
                }),
              })
            : decide('reviewer', id, action);
        await expect
          .poll(async () =>
            Number(
              (
                await http.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%approval_requests%'"
                )
              ).rows[0].count
            )
          )
          .toBe(1);
        const query =
          change === 'revoke'
            ? "UPDATE sessions SET revoked_at=NOW() WHERE user_id='reviewer'"
            : change === 'csrf'
              ? "UPDATE sessions SET csrf_token='changed' WHERE user_id='reviewer'"
              : change === 'step-up'
                ? "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '16 minutes' WHERE user_id='reviewer'"
                : "DELETE FROM user_roles WHERE user_id='reviewer'";
        let changed = false;
        mutation = http.pool.query(query).then((value) => {
          changed = true;
          return value;
        });
        await expect
          .poll(async () =>
            Number(
              (
                await http.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query=$1",
                  [query]
                )
              ).rows[0].count
            )
          )
          .toBe(1);
        expect(changed).toBe(false);
        await client.query('COMMIT');
        expect((await pending).status).toBe(action === 'create' ? 201 : 200);
        await mutation;
        expect(changed).toBe(true);
        expect(
          (await http.pool.query('SELECT status FROM approval_requests WHERE id=$1', [id])).rows
        ).toEqual([
          {
            status:
              action === 'create' ? 'pending' : action === 'approve' ? 'approved' : 'rejected',
          },
        ]);
        if (action === 'create')
          expect(
            (await http.pool.query('SELECT id FROM approval_requests WHERE reason=$1', [reason]))
              .rows
          ).toHaveLength(1);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await pending;
        await mutation;
        await http.pool.query(
          "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance') ON CONFLICT DO NOTHING"
        );
        await http.pool.query(
          "UPDATE sessions SET revoked_at=NULL,csrf_token=$1,step_up_verified_at=NOW() WHERE user_id='reviewer'",
          [headers.reviewer!['X-CSRF-Token']]
        );
      }
    });
  }
  for (const expiry of ['session', 'step-up'] as const) {
    it(`approval ${action} rolls back if ${expiry} expires during its audit write`, async () => {
      const id = await seed(),
        reason = randomUUID();
      await http.pool.query(
        `INSERT INTO app_config(key,value) VALUES ('finance.dual_approval_threshold','{"threshold_irr":100000}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`
      );
      const before = (await http.pool.query('SELECT count(*) FROM notifications')).rows;
      const audits = (await http.pool.query('SELECT count(*) FROM audit_log')).rows;
      await http.pool.query(
        'CREATE FUNCTION delay_approval_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$'
      );
      await http.pool.query(
        'CREATE TRIGGER delay_approval_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_approval_audit()'
      );
      try {
        await http.pool.query(
          "UPDATE sessions SET revoked_at=NULL,expires_at=clock_timestamp()+INTERVAL '1 day',idle_deadline=clock_timestamp()+INTERVAL '30 minutes',step_up_verified_at=clock_timestamp() WHERE user_id='reviewer'"
        );
        await http.pool.query(
          expiry === 'session'
            ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '800 milliseconds' WHERE user_id='reviewer'"
            : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '800 milliseconds' WHERE user_id='reviewer'"
        );
        const pending =
          action === 'create'
            ? fetch(`${http.base}/api/admin/approval-requests`, {
                method: 'POST',
                headers: headers.reviewer!,
                body: JSON.stringify({
                  action_type: 'bank_payment_confirmation',
                  amount_irr: 100000,
                  reason,
                }),
              })
            : decide('reviewer', id, action);
        await expect
          .poll(async () =>
            Number(
              (
                await http.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'"
                )
              ).rows[0].count
            )
          )
          .toBe(1);
        expect((await pending).status).toBe(expiry === 'session' ? 401 : 403);
        expect(
          (await http.pool.query('SELECT status FROM approval_requests WHERE id=$1', [id])).rows
        ).toEqual([{ status: 'pending' }]);
        expect(
          (await http.pool.query('SELECT id FROM approval_requests WHERE reason=$1', [reason])).rows
        ).toEqual([]);
        expect((await http.pool.query('SELECT count(*) FROM notifications')).rows).toEqual(before);
        expect((await http.pool.query('SELECT count(*) FROM audit_log')).rows).toEqual(audits);
      } finally {
        await http.pool.query('DROP TRIGGER delay_approval_audit ON audit_log');
        await http.pool.query('DROP FUNCTION delay_approval_audit()');
        await http.pool.query(
          "UPDATE sessions SET revoked_at=NULL,expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes',step_up_verified_at=NOW() WHERE user_id='reviewer'"
        );
      }
    });
  }
}
it('requires recent step-up for financial approval and rejection, preserving pending requests', async () => {
  for (const action of ['approve', 'reject']) {
    const id = await seed();
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='reviewer'");
    const response = await decide('reviewer', id, action);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTHZ:STEP_UP_REQUIRED' },
    });
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '16 minutes' WHERE user_id='reviewer'"
    );
    expect((await decide('reviewer', id, action)).status).toBe(403);
    expect(
      (await http.pool.query('SELECT status FROM approval_requests WHERE id=$1', [id])).rows[0]
        .status
    ).toBe('pending');
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='reviewer'");
    expect((await decide('reviewer', id, action)).status).toBe(200);
    expect(
      (await http.pool.query('SELECT status,reviewer_id FROM approval_requests WHERE id=$1', [id]))
        .rows[0]
    ).toEqual({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewer_id: 'reviewer',
    });
    expect((await decide('reviewer', id, action)).status).toBe(409);
  }
});
it('requires a different currently eligible reviewer even after step-up', async () => {
  const id = await seed();
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW()');
  expect((await decide('initiator', id)).status).toBe(403);
  expect((await decide('support', id)).status).toBe(403);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='reviewer'");
  expect((await decide('reviewer', id)).status).toBe(403);
  expect(
    (await http.pool.query('SELECT status FROM approval_requests WHERE id=$1', [id])).rows[0].status
  ).toBe('pending');
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance')"
  );
});
it('requires step-up to initiate and permits queue reads without it', async () => {
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='initiator'");
  expect(
    (
      await fetch(`${http.base}/api/admin/approval-requests`, {
        headers: headers.initiator!,
      })
    ).status
  ).toBe(200);
  const response = await fetch(`${http.base}/api/admin/approval-requests`, {
    method: 'POST',
    headers: headers.initiator!,
    body: '{}',
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: 'AUTHZ:STEP_UP_REQUIRED' },
  });
});

async function walletReceipt(amount = 100000n) {
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,status) VALUES ('initiator','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES ($1)', [profile]);
  const id = randomUUID(),
    attachment = `uploads/document/${randomUUID()}.pdf`;
  await http.pool.query(
    `INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,metadata,receipt_attachment_key)
    VALUES ($1::uuid,$2,'topup',$3,'Pending',$1::text,$4::jsonb,$5)`,
    [
      id,
      profile,
      amount.toString(),
      JSON.stringify({
        channel: 'bank_receipt',
        receipt: {
          paymentDate: '2026-09-01',
          payerReference: 'verified-slip',
          attachmentKey: attachment,
          customerNote: null,
        },
      }),
      attachment,
    ]
  );
  return { id, profile };
}
async function confirmWallet(user: string, id: string, body: unknown = {}) {
  return fetch(`${http.base}/api/admin/wallet/bank-receipt-top-ups/${id}/confirm`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify(body),
  });
}
it('parks threshold wallet receipts and settles once after a distinct finance confirmation', async () => {
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW()');
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES ('finance.dual_approval_threshold','{"threshold_irr":100000}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`
  );
  const receipt = await walletReceipt();
  const first = await confirmWallet('initiator', receipt.id);
  expect(first.status, await first.clone().text()).toBe(200);
  const pending = (await first.json()) as {
    dualApproval: { requestId: string };
    state: string;
  };
  expect(pending.state).toBe('Pending');
  expect(pending.dualApproval.requestId).toBeTruthy();
  expect(
    (
      await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        receipt.profile,
      ])
    ).rows[0].posted_balance
  ).toBe('0');
  expect((await confirmWallet('initiator', receipt.id)).status).toBe(200);
  expect((await confirmWallet('support', receipt.id)).status).toBe(403);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => confirmWallet('reviewer', receipt.id))
  );
  for (const result of results) expect(result.status, await result.text()).toBe(200);
  expect(
    (
      await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        receipt.profile,
      ])
    ).rows[0].posted_balance
  ).toBe('100000');
  expect(
    (
      await http.pool.query('SELECT status,reviewer_id FROM approval_requests WHERE id=$1', [
        pending.dualApproval.requestId,
      ])
    ).rows[0]
  ).toEqual({ status: 'approved', reviewer_id: 'reviewer' });
});
it('refuses changed receipt evidence or destination after approval initiation', async () => {
  const receipt = await walletReceipt();
  expect((await confirmWallet('initiator', receipt.id)).status).toBe(200);
  expect((await confirmWallet('reviewer', receipt.id, { invoiceId: randomUUID() })).status).toBe(
    409
  );
  await http.pool.query('UPDATE wallet_transactions SET amount=amount+1 WHERE id=$1', [receipt.id]);
  expect((await confirmWallet('reviewer', receipt.id)).status).toBe(409);
  expect(
    (
      await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        receipt.profile,
      ])
    ).rows[0].posted_balance
  ).toBe('0');
});
it('respects generic rejection and revoked reviewer permissions before wallet settlement', async () => {
  for (const action of ['reject', 'approve']) {
    const receipt = await walletReceipt();
    const pending = (await (await confirmWallet('initiator', receipt.id)).json()) as {
      dualApproval: { requestId: string };
    };
    expect((await decide('reviewer', pending.dualApproval.requestId, action)).status).toBe(200);
    if (action === 'approve')
      await http.pool.query("DELETE FROM user_roles WHERE user_id='reviewer'");
    expect((await confirmWallet('initiator', receipt.id)).status).toBe(
      action === 'reject' ? 409 : 403
    );
    expect(
      (
        await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
          receipt.profile,
        ])
      ).rows[0].posted_balance
    ).toBe('0');
  }
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance')"
  );
});

for (const kind of ['wallet', 'invoice'] as const) {
  for (const other of ['initiator', 'reviewer'] as const) {
    for (const change of ['role', 'account'] as const) {
      it(`${kind} settlement retains the other ${other} ${change} authority while money waits`, async () => {
        await resetReceiptReviewer();
        await http.pool.query(
          "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='initiator'"
        );
        await http.pool.query(
          `UPDATE app_config SET value='{"threshold_irr":100000}' WHERE key='finance.dual_approval_threshold'`
        );
        const receipt = kind === 'wallet' ? await walletReceipt() : await invoiceReceipt();
        const confirm = kind === 'wallet' ? confirmWallet : confirmInvoice;
        const first = await confirm('initiator', receipt.id);
        expect(first.status, await first.clone().text()).toBe(200);
        const parked = (await first.json()) as {
          dualApproval: { requestId: string };
          dualApprovalRequestId: string;
        };
        const requestId =
          kind === 'wallet' ? parked.dualApproval.requestId : parked.dualApprovalRequestId;
        if (other === 'reviewer') expect((await decide('reviewer', requestId)).status).toBe(200);
        await http.pool.query(
          'INSERT INTO wallets(profile_id) VALUES ($1) ON CONFLICT DO NOTHING',
          [receipt.profile]
        );
        const client = await http.pool.connect();
        let pending: Promise<Response> | undefined, mutation: Promise<unknown> | undefined;
        try {
          await client.query('BEGIN');
          await client.query('SELECT profile_id FROM wallets WHERE profile_id=$1 FOR UPDATE', [
            receipt.profile,
          ]);
          pending = confirm(other === 'initiator' ? 'reviewer' : 'initiator', receipt.id);
          await expect
            .poll(async () =>
              Number(
                (
                  await http.pool.query(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%wallets%' "
                  )
                ).rows[0].count
              )
            )
            .toBe(1);
          const sql =
            change === 'role'
              ? 'DELETE FROM user_roles WHERE user_id=$1'
              : 'UPDATE users SET disabled_at=NOW() WHERE user_id=$1';
          mutation = http.pool.query(sql, [other]);
          await expect
            .poll(
              async () =>
                Number(
                  (
                    await http.pool.query(
                      "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query=$1",
                      [sql]
                    )
                  ).rows[0].count
                ),
              { timeout: 1000 }
            )
            .toBe(1);
          await client.query('COMMIT');
          expect((await pending).status).toBe(200);
          await mutation;
          const snapshot = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
          expect(snapshot.receipt[0].state).toBe(kind === 'wallet' ? 'Released' : 'Confirmed');
          expect(
            kind === 'wallet'
              ? snapshot.wallets[0].posted_balance
              : snapshot.invoices[0].paid_amount
          ).toBe('100000');
        } finally {
          await client.query('ROLLBACK');
          client.release();
          await pending;
          await mutation;
          await http.pool.query('UPDATE users SET disabled_at=NULL WHERE user_id=$1', [other]);
          await http.pool.query(
            "INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-finance') ON CONFLICT DO NOTHING",
            [other]
          );
        }
      });
    }
  }
}

for (const kind of ['wallet', 'invoice'] as const) {
  it(`${kind} settlement refuses busy reviewer authority without money or audit changes`, async () => {
    await resetReceiptReviewer();
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='initiator'"
    );
    await http.pool.query(
      `UPDATE app_config SET value='{"threshold_irr":100000}' WHERE key='finance.dual_approval_threshold'`
    );
    const receipt = kind === 'wallet' ? await walletReceipt() : await invoiceReceipt();
    const confirm = kind === 'wallet' ? confirmWallet : confirmInvoice;
    const parked = (await (await confirm('initiator', receipt.id)).json()) as {
      dualApproval: { requestId: string };
      dualApprovalRequestId: string;
    };
    const requestId =
      kind === 'wallet' ? parked.dualApproval.requestId : parked.dualApprovalRequestId;
    expect((await decide('reviewer', requestId)).status).toBe(200);
    const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
    const client = await http.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='reviewer' FOR UPDATE");
      const response = await confirm('initiator', receipt.id);
      expect(response.status, await response.text()).toBe(409);
      expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect((await confirm('initiator', receipt.id)).status).toBe(200);
  });
}

for (const kind of ['wallet', 'invoice'] as const) {
  for (const decision of ['confirm', 'reject'] as const) {
    it(`${kind} approval ${decision} audit retains the HTTP session and correlation`, async () => {
      await resetReceiptReviewer();
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='initiator'"
      );
      await http.pool.query(
        `UPDATE app_config SET value='{"threshold_irr":100000}' WHERE key='finance.dual_approval_threshold'`
      );
      const receipt = kind === 'wallet' ? await walletReceipt() : await invoiceReceipt();
      const correlations = [randomUUID(), randomUUID()];
      for (const [index, user] of ['initiator', 'reviewer'].entries()) {
        const previous = (await http.pool.query('SELECT id FROM audit_log')).rows.map(
          (row) => row.id
        );
        const response = await fetch(
          `${http.base}/api/admin/${kind === 'wallet' ? 'wallet/bank-receipt-top-ups' : 'invoices/bank-receipts'}/${receipt.id}/${index === 0 ? 'confirm' : decision}`,
          {
            method: 'POST',
            headers: { ...headers[user]!, 'X-Correlation-ID': correlations[index]! },
            body: JSON.stringify({ reason: 'Receipt does not match' }),
          }
        );
        expect(response.status, await response.text()).toBe(200);
        const audits = (
          await http.pool.query(
            `SELECT event,user_id,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE NOT(id=ANY($1::text[])) AND (metadata::jsonb->>'receiptId'=$2 OR metadata::jsonb->>'transactionId'=$2 OR event IN ('approval_request_approved','approval_request_rejected'))`,
            [previous, receipt.id]
          )
        ).rows;
        expect(audits.length).toBeGreaterThan(0);
        for (const audit of audits)
          expect(audit).toMatchObject({
            user_id: user,
            correlation_id: correlations[index],
            metadata: { sessionId: headers[user]!.Cookie!.split('=')[1] },
          });
      }
    });
  }
}

async function pendingEmergencyReceipt(kind: 'wallet' | 'invoice') {
  await resetReceiptReviewer();
  await http.pool.query(
    "UPDATE sessions SET revoked_at=NULL,expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes',step_up_verified_at=NOW() WHERE user_id='initiator'"
  );
  await http.pool.query(
    `UPDATE app_config SET value='{"threshold_irr":100000}' WHERE key='finance.dual_approval_threshold'`
  );
  const receipt = kind === 'wallet' ? await walletReceipt() : await invoiceReceipt();
  const first = await (kind === 'wallet' ? confirmWallet : confirmInvoice)('initiator', receipt.id);
  expect(first.status, await first.clone().text()).toBe(200);
  return receipt;
}
function emergencyReceipt(
  kind: 'wallet' | 'invoice',
  id: string,
  reason: unknown = 'Second reviewer unavailable; settlement deadline',
  correlation = randomUUID()
) {
  return fetch(
    `${http.base}/api/admin/${kind === 'wallet' ? 'wallet/bank-receipt-top-ups' : 'invoices/bank-receipts'}/${id}/confirm`,
    {
      method: 'POST',
      headers: { ...headers.initiator!, 'X-Correlation-ID': correlation },
      body: JSON.stringify({ emergencyOverrideReason: reason }),
    }
  );
}
for (const kind of ['wallet', 'invoice'] as const) {
  it.each(['', '  ', null, 42, 'x'.repeat(10001)])(
    `${kind} emergency override rejects invalid reason %j`,
    async (reason) => {
      const receipt = await pendingEmergencyReceipt(kind);
      const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
      expect((await emergencyReceipt(kind, receipt.id, reason)).status).toBe(400);
      expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
    }
  );
  it(`${kind} ordinary finance cannot use the emergency override`, async () => {
    const receipt = await pendingEmergencyReceipt(kind);
    const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
    expect((await emergencyReceipt(kind, receipt.id)).status).toBe(403);
    expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
  });
  it(`${kind} emergency override settles only its pending receipt with an immediate private alert and audit`, async () => {
    const receipt = await pendingEmergencyReceipt(kind);
    const other = await pendingEmergencyReceipt(kind);
    const untouched = await receiptWriteSnapshot(kind, other.id, other.profile);
    const correlation = randomUUID(),
      reason = 'Second reviewer unavailable; bank closing';
    await http.pool.query("UPDATE users SET is_admin=true WHERE user_id='initiator'");
    try {
      const response = await emergencyReceipt(kind, receipt.id, reason, correlation);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toMatchObject({
        state: kind === 'wallet' ? 'Released' : 'Confirmed',
      });
      const approval = (
        await http.pool.query("SELECT * FROM approval_requests WHERE details->>'receiptId'=$1", [
          receipt.id,
        ])
      ).rows[0];
      expect(approval).toMatchObject({
        status: 'approved',
        initiator_id: 'initiator',
        reviewer_id: 'initiator',
        review_reason: reason,
        details: { emergencyOverride: { actorUserId: 'initiator', reason } },
      });
      expect(approval.details.emergencyOverride.sessionId).toBeUndefined();
      const audit = (
        await http.pool.query(
          'SELECT user_id,event,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE id=$1',
          [approval.details.emergencyOverride.auditId]
        )
      ).rows[0];
      expect(audit).toMatchObject({
        user_id: 'initiator',
        event: 'financial.receipt.emergency_override',
        correlation_id: correlation,
        metadata: {
          requestId: approval.id,
          receiptId: receipt.id,
          reason,
          sessionId: headers.initiator!.Cookie!.split('=')[1],
        },
      });
      const notices = (
        await http.pool.query(
          "SELECT recipient_user_id,profile_id,localized_content FROM in_app_notifications WHERE localized_content->'en'->>'title'='Emergency bank receipt confirmation' AND localized_content->'en'->>'body' LIKE $1 ORDER BY recipient_user_id",
          ['%' + approval.id + '%']
        )
      ).rows;
      expect(notices.map((row) => row.recipient_user_id)).toEqual(['initiator', 'reviewer']);
      for (const notice of notices) {
        expect(notice.profile_id).toBeNull();
        expect(notice.localized_content.en.body).toContain(reason);
        expect(notice.localized_content.fa.body).toContain(reason);
      }
      const after = await receiptWriteSnapshot(kind, other.id, other.profile);
      expect({ ...after, counts: untouched.counts }).toEqual(untouched);
      expect(
        (
          await http.pool.query(
            "SELECT value FROM app_config WHERE key='finance.dual_approval_threshold'"
          )
        ).rows[0].value
      ).toEqual({ threshold_irr: 100000 });
      const settled = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
      expect((await emergencyReceipt(kind, receipt.id, reason)).status).toBe(200);
      expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(settled);
    } finally {
      await http.pool.query("UPDATE users SET is_admin=false WHERE user_id='initiator'");
    }
  });
  for (const failure of ['audit', 'alert'] as const) {
    it(`${kind} emergency override rolls back settlement and approval if its ${failure} fails`, async () => {
      const receipt = await pendingEmergencyReceipt(kind);
      const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
      await http.pool.query("UPDATE users SET is_admin=true WHERE user_id='initiator'");
      const table = failure === 'audit' ? 'audit_log' : 'in_app_notifications';
      const condition =
        failure === 'audit'
          ? "NEW.event='financial.receipt.emergency_override'"
          : "NEW.localized_content->'en'->>'title'='Emergency bank receipt confirmation'";
      await http.pool.query(
        `CREATE FUNCTION fail_emergency() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'test emergency failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_emergency BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_emergency()`
      );
      try {
        expect((await emergencyReceipt(kind, receipt.id)).status).toBe(500);
        expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
      } finally {
        await http.pool.query(
          `DROP TRIGGER fail_emergency ON ${table}; DROP FUNCTION fail_emergency()`
        );
        await http.pool.query("UPDATE users SET is_admin=false WHERE user_id='initiator'");
      }
    });
  }
  it(`${kind} emergency override cannot replace rejected approval or changed evidence`, async () => {
    for (const invalid of ['rejected', 'evidence']) {
      const receipt = await pendingEmergencyReceipt(kind);
      if (invalid === 'rejected') {
        const request = (
          await http.pool.query("SELECT id FROM approval_requests WHERE details->>'receiptId'=$1", [
            receipt.id,
          ])
        ).rows[0];
        expect((await decide('reviewer', request.id, 'reject')).status).toBe(200);
      } else
        await http.pool.query(
          `UPDATE ${kind === 'wallet' ? 'wallet_transactions' : 'bank_receipts'} SET amount=amount+1 WHERE id=$1`,
          [receipt.id]
        );
      const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
      await http.pool.query("UPDATE users SET is_admin=true WHERE user_id='initiator'");
      try {
        expect((await emergencyReceipt(kind, receipt.id)).status).toBe(409);
        expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
      } finally {
        await http.pool.query("UPDATE users SET is_admin=false WHERE user_id='initiator'");
      }
    }
  });
}

for (const kind of ['wallet', 'invoice'] as const) {
  for (const expiry of ['session', 'step-up'] as const) {
    it(`${kind} emergency override rolls back when ${expiry} expires during its audit`, async () => {
      const receipt = await pendingEmergencyReceipt(kind);
      const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
      await http.pool.query("UPDATE users SET is_admin=true WHERE user_id='initiator'");
      await http.pool.query(
        `CREATE FUNCTION delay_emergency() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='financial.receipt.emergency_override' THEN PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$; CREATE TRIGGER delay_emergency BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_emergency()`
      );
      try {
        await http.pool.query(
          expiry === 'session'
            ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '800 milliseconds' WHERE user_id='initiator'"
            : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '800 milliseconds' WHERE user_id='initiator'"
        );
        expect((await emergencyReceipt(kind, receipt.id)).status).toBe(
          expiry === 'session' ? 401 : 403
        );
        expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
      } finally {
        await http.pool.query(
          'DROP TRIGGER delay_emergency ON audit_log; DROP FUNCTION delay_emergency()'
        );
        await http.pool.query("UPDATE users SET is_admin=false WHERE user_id='initiator'");
        await http.pool.query(
          "UPDATE sessions SET revoked_at=NULL,expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes',step_up_verified_at=NOW() WHERE user_id='initiator'"
        );
      }
    });
  }
  it(`${kind} emergency override returns a retryable conflict if an alert recipient is busy`, async () => {
    const receipt = await pendingEmergencyReceipt(kind);
    const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
    await http.pool.query("UPDATE users SET is_admin=true WHERE user_id='initiator'");
    const client = await http.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='reviewer' FOR UPDATE");
      expect((await emergencyReceipt(kind, receipt.id)).status).toBe(409);
      expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
      await client.query('ROLLBACK');
      expect((await emergencyReceipt(kind, receipt.id)).status).toBe(200);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await http.pool.query("UPDATE users SET is_admin=false WHERE user_id='initiator'");
    }
  });
}

for (const kind of ['wallet', 'invoice'] as const) {
  it(`${kind} emergency override accepts an explicit current grant without platform admin`, async () => {
    const receipt = await pendingEmergencyReceipt(kind);
    await http.pool.query(
      `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('receipt-emergency','Receipt emergency','Test explicit override grant','["admin:financial:emergency-override"]') ON CONFLICT DO NOTHING`
    );
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('initiator','receipt-emergency')"
    );
    try {
      expect((await emergencyReceipt(kind, receipt.id)).status).toBe(200);
    } finally {
      await http.pool.query("DELETE FROM user_roles WHERE role_id='receipt-emergency'");
    }
  });
}

it('applies below-threshold, disabled and corrupt configuration without bypassing saved requests', async () => {
  const below = await walletReceipt(99999n);
  expect((await confirmWallet('initiator', below.id)).status).toBe(200);
  expect(
    (
      await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        below.profile,
      ])
    ).rows[0].posted_balance
  ).toBe('99999');
  const pending = await walletReceipt();
  expect((await confirmWallet('initiator', pending.id)).status).toBe(200);
  await http.pool.query(
    `UPDATE app_config SET value='{"threshold_irr":0}' WHERE key='finance.dual_approval_threshold'`
  );
  expect((await confirmWallet('initiator', pending.id)).status).toBe(200);
  expect(
    (
      await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        pending.profile,
      ])
    ).rows[0].posted_balance
  ).toBe('0');
  const disabled = await walletReceipt();
  expect((await confirmWallet('initiator', disabled.id)).status).toBe(200);
  const corrupt = await walletReceipt();
  await http.pool.query(
    `UPDATE app_config SET value='{"threshold_irr":"broken"}' WHERE key='finance.dual_approval_threshold'`
  );
  expect((await confirmWallet('initiator', corrupt.id)).status).toBe(409);
  expect(
    (
      await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        corrupt.profile,
      ])
    ).rows[0].posted_balance
  ).toBe('0');
});

it('returns and audits large IRR approval amounts without numeric rounding', async () => {
  const amount = '10000000000000001';
  const id = await seed();
  await http.pool.query('UPDATE approval_requests SET amount_irr=$2 WHERE id=$1', [id, amount]);
  const response = await decide('reviewer', id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ amountIrR: amount });
  const audit = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='approval_request_approved' AND metadata::jsonb->>'requestId'=$1",
      [id]
    )
  ).rows[0];
  expect(audit.metadata.amountIrR).toBe(amount);
});

async function invoiceReceipt() {
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,status) VALUES ('initiator','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  const invoice = (
    await http.pool.query(
      `INSERT INTO invoices(profile_id,order_id,replaces_invoice_id,adjustment_for_invoice_id,state,total_amount)
    VALUES ($1,NULL,NULL,NULL,'Overdue',100000) RETURNING id`,
      [profile]
    )
  ).rows[0].id;
  const id = (
    await http.pool.query(
      `INSERT INTO bank_receipts(invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key)
    VALUES ($1,$2,100000,'2026-09-01','verified-slip',$3) RETURNING id`,
      [invoice, profile, `sealed/${randomUUID()}.pdf`]
    )
  ).rows[0].id as string;
  return { id, invoice, profile };
}
async function confirmInvoice(user: string, id: string) {
  return fetch(`${http.base}/api/admin/invoices/bank-receipts/${id}/confirm`, {
    method: 'POST',
    headers: headers[user]!,
    body: '{}',
  });
}
it('requires invoice-owned approval evidence and rejects changed receipt evidence', async () => {
  await http.pool.query(
    `UPDATE app_config SET value='{"threshold_irr":100000}' WHERE key='finance.dual_approval_threshold'`
  );
  for (const changed of [false, true]) {
    const receipt = await invoiceReceipt();
    const first = await confirmInvoice('initiator', receipt.id);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await first.json()).toMatchObject({ state: 'UnderReview', dualApprovalPending: true });
    if (changed)
      await http.pool.query(
        "UPDATE bank_receipts SET payer_reference='different-slip' WHERE id=$1",
        [receipt.id]
      );
    const second = await confirmInvoice('reviewer', receipt.id);
    expect(second.status, await second.text()).toBe(changed ? 409 : 200);
    const invoice = (
      await http.pool.query('SELECT paid_amount,state FROM invoices WHERE id=$1', [receipt.invoice])
    ).rows[0];
    expect(invoice).toEqual(
      changed ? { paid_amount: '0', state: 'Overdue' } : { paid_amount: '100000', state: 'Paid' }
    );
  }
});
it('cannot use a generic approval for an invoice receipt or an approval from a revoked reviewer', async () => {
  const forged = await invoiceReceipt();
  const fake = await seed();
  await http.pool.query(`UPDATE approval_requests SET details=$2::jsonb WHERE id=$1`, [
    fake,
    JSON.stringify({
      receiptId: forged.id,
      invoiceId: forged.invoice,
      profileId: forged.profile,
      entityType: 'invoice_bank_receipt',
    }),
  ]);
  expect((await decide('reviewer', fake)).status).toBe(200);
  expect((await confirmInvoice('initiator', forged.id)).status).toBe(409);
  const receipt = await invoiceReceipt();
  const pending = (await (await confirmInvoice('initiator', receipt.id)).json()) as {
    dualApprovalRequestId: string;
  };
  expect((await decide('reviewer', pending.dualApprovalRequestId)).status).toBe(200);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='reviewer'");
  expect((await confirmInvoice('initiator', receipt.id)).status).toBe(403);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance')"
  );
  expect(
    (await http.pool.query('SELECT paid_amount FROM invoices WHERE id=$1', [receipt.invoice]))
      .rows[0].paid_amount
  ).toBe('0');
});

it('rejects the receipt and its approval together and preserves a generic rejection reason', async () => {
  for (const generic of [false, true]) {
    const receipt = await walletReceipt();
    const pending = (await (await confirmWallet('initiator', receipt.id)).json()) as {
      dualApproval: { requestId: string };
    };
    const rejectReceipt = (user: string) =>
      fetch(`${http.base}/api/admin/wallet/bank-receipt-top-ups/${receipt.id}/reject`, {
        method: 'POST',
        headers: headers[user]!,
        body: JSON.stringify({ reason: 'Receipt is illegible' }),
      });
    if (generic)
      expect((await decide('reviewer', pending.dualApproval.requestId, 'reject')).status).toBe(200);
    else expect((await rejectReceipt('initiator')).status).toBe(403);
    const result = await rejectReceipt('reviewer');
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toMatchObject({
      state: 'Rejected',
      staffDecision: { reason: generic ? 'Rejected after review' : 'Receipt is illegible' },
    });
    expect(
      (
        await http.pool.query('SELECT status FROM approval_requests WHERE id=$1', [
          pending.dualApproval.requestId,
        ])
      ).rows[0].status
    ).toBe('rejected');
    expect((await confirmWallet('initiator', receipt.id)).status).toBe(409);
    expect(
      (
        await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
          receipt.profile,
        ])
      ).rows[0].posted_balance
    ).toBe('0');
  }
});

it('commits bilingual private approval notices with the decision and rolls back on notice failure', async () => {
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW()');
  const id = await seed();
  expect((await decide('reviewer', id)).status).toBe(200);
  const notice = (
    await http.pool.query(
      `SELECT recipient_user_id,profile_id,localized_content,link_route FROM in_app_notifications
    WHERE recipient_user_id='initiator' AND localized_content::text LIKE $1`,
      [`%${id}%`]
    )
  ).rows;
  expect(notice).toHaveLength(1);
  expect(notice[0]).toMatchObject({
    recipient_user_id: 'initiator',
    profile_id: null,
    link_route: '/admin/approval-requests',
    localized_content: { fa: { title: 'درخواست تأیید شد' }, en: { title: 'Request approved' } },
  });
  expect((await decide('reviewer', id)).status).toBe(409);
  const pending = await seed();
  await http.pool
    .query(`CREATE FUNCTION fail_approval_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.recipient_user_id='initiator' THEN RAISE EXCEPTION 'test notification failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_approval_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_approval_notice()`);
  try {
    expect((await decide('reviewer', pending)).status).toBe(500);
    expect(
      (await http.pool.query('SELECT status FROM approval_requests WHERE id=$1', [pending])).rows[0]
        .status
    ).toBe('pending');
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE event='approval_request_approved' AND metadata::jsonb->>'requestId'=$1",
          [pending]
        )
      ).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_approval_notice ON in_app_notifications; DROP FUNCTION fail_approval_notice()'
    );
  }
  expect((await decide('reviewer', pending)).status).toBe(200);
});

it('notifies eligible reviewers exactly once for receipt-created approvals and rolls back failed notices', async () => {
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW()');
  await http.pool.query(
    `UPDATE app_config SET value='{"threshold_irr":100000}' WHERE key='finance.dual_approval_threshold'`
  );
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_staff,disabled_at,activation_token)
    VALUES ('notice-disabled','notice-disabled@example.test','test-only',true,NOW(),NULL),
           ('notice-unactivated','notice-unactivated@example.test','test-only',true,NULL,$1)`,
    ['f'.repeat(64)]
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('notice-disabled','role-finance'),('notice-unactivated','role-finance')"
  );
  for (const kind of ['wallet', 'invoice'] as const) {
    const receipt =
      kind === 'wallet' ? await walletReceipt(9007199254740993n) : await invoiceReceipt();
    const confirm = () =>
      kind === 'wallet'
        ? confirmWallet('initiator', receipt.id)
        : confirmInvoice('initiator', receipt.id);
    const noticesBefore = (
      await http.pool.query('SELECT count(*)::int AS count FROM in_app_notifications')
    ).rows[0].count;
    await http.pool
      .query(`CREATE FUNCTION fail_receipt_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.recipient_user_id='reviewer' THEN RAISE EXCEPTION 'test receipt notice failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_receipt_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_receipt_notice()`);
    try {
      expect((await confirm()).status).toBe(500);
      expect(
        (
          await http.pool.query(
            "SELECT count(*)::int AS count FROM approval_requests WHERE details->>'receiptId'=$1",
            [receipt.id]
          )
        ).rows[0].count
      ).toBe(0);
      expect(
        (await http.pool.query('SELECT count(*)::int AS count FROM in_app_notifications')).rows[0]
          .count
      ).toBe(noticesBefore);
      if (kind === 'wallet') {
        expect(
          (
            await http.pool.query('SELECT state,metadata FROM wallet_transactions WHERE id=$1', [
              receipt.id,
            ])
          ).rows[0]
        ).toMatchObject({ state: 'Pending' });
        expect(
          (
            await http.pool.query(
              "SELECT metadata->'dualApproval' AS binding FROM wallet_transactions WHERE id=$1",
              [receipt.id]
            )
          ).rows[0].binding
        ).toBeNull();
      } else
        expect(
          (await http.pool.query('SELECT state FROM bank_receipts WHERE id=$1', [receipt.id]))
            .rows[0].state
        ).toBe('Submitted');
    } finally {
      await http.pool.query(
        'DROP TRIGGER fail_receipt_notice ON in_app_notifications; DROP FUNCTION fail_receipt_notice()'
      );
    }
    const responses = await Promise.all([confirm(), confirm()]);
    for (const response of responses)
      expect(response.status, await response.clone().text()).toBe(200);
    const requests = (
      await http.pool.query(
        "SELECT id,amount_irr FROM approval_requests WHERE details->>'receiptId'=$1",
        [receipt.id]
      )
    ).rows;
    expect(requests).toHaveLength(1);
    const requestId = requests[0].id;
    const notices = (
      await http.pool.query(
        `SELECT recipient_user_id,profile_id,localized_content,link_route FROM in_app_notifications
      WHERE localized_content::text LIKE $1`,
        [`%${requestId}%`]
      )
    ).rows;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      recipient_user_id: 'reviewer',
      profile_id: null,
      link_route: '/admin/approval-requests',
      localized_content: { en: { title: 'Financial approval requested' } },
    });
    expect(notices[0].localized_content.fa.title).toBe('درخواست تأیید دومرحله‌ای جدید');
    if (kind === 'wallet') {
      expect(requests[0].amount_irr).toBe('9007199254740993');
      expect(notices[0].localized_content.en.body).toContain('9,007,199,254,740,993 IRR');
    }
  }
}, 20000);

it('commits direct receipt decision notices with settlement or rejection and retries without duplicate notices', async () => {
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW()');
  for (const kind of ['wallet', 'invoice'] as const)
    for (const decision of ['approve', 'reject'] as const) {
      const receipt = kind === 'wallet' ? await walletReceipt() : await invoiceReceipt();
      const start = await (kind === 'wallet'
        ? confirmWallet('initiator', receipt.id)
        : confirmInvoice('initiator', receipt.id));
      expect(start.status, await start.clone().text()).toBe(200);
      const request = (
        await http.pool.query("SELECT id FROM approval_requests WHERE details->>'receiptId'=$1", [
          receipt.id,
        ])
      ).rows[0];
      const perform = () =>
        decision === 'approve'
          ? kind === 'wallet'
            ? confirmWallet('reviewer', receipt.id)
            : confirmInvoice('reviewer', receipt.id)
          : fetch(
              `${http.base}/api/admin/${kind === 'wallet' ? 'wallet/bank-receipt-top-ups' : 'invoices/bank-receipts'}/${receipt.id}/reject`,
              {
                method: 'POST',
                headers: headers.reviewer!,
                body: JSON.stringify({ reason: 'Receipt could not be verified' }),
              }
            );
      await http.pool
        .query(`CREATE FUNCTION fail_receipt_decision_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.recipient_user_id='initiator' THEN RAISE EXCEPTION 'test decision notice failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_receipt_decision_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_receipt_decision_notice()`);
      try {
        expect((await perform()).status).toBe(500);
        expect(
          (await http.pool.query('SELECT status FROM approval_requests WHERE id=$1', [request.id]))
            .rows[0].status
        ).toBe('pending');
        if (kind === 'wallet') {
          expect(
            (
              await http.pool.query('SELECT state FROM wallet_transactions WHERE id=$1', [
                receipt.id,
              ])
            ).rows[0].state
          ).toBe('Pending');
          expect(
            (
              await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
                receipt.profile,
              ])
            ).rows[0].posted_balance
          ).toBe('0');
        } else {
          expect(
            (await http.pool.query('SELECT state FROM bank_receipts WHERE id=$1', [receipt.id]))
              .rows[0].state
          ).toBe('UnderReview');
          expect(
            (
              await http.pool.query('SELECT paid_amount FROM invoices WHERE id=$1', [
                (receipt as { invoice: string }).invoice,
              ])
            ).rows[0].paid_amount
          ).toBe('0');
        }
        expect(
          (
            await http.pool.query(
              "SELECT count(*)::int AS count FROM audit_log WHERE event IN ('approval_request_approved','approval_request_rejected') AND metadata::jsonb->>'requestId'=$1",
              [request.id]
            )
          ).rows[0].count
        ).toBe(0);
      } finally {
        await http.pool.query(
          'DROP TRIGGER fail_receipt_decision_notice ON in_app_notifications; DROP FUNCTION fail_receipt_decision_notice()'
        );
      }
      const retried = await perform();
      expect(retried.status, await retried.clone().text()).toBe(200);
      await perform();
      const notices = (
        await http.pool.query(
          `SELECT recipient_user_id,profile_id,localized_content FROM in_app_notifications
      WHERE recipient_user_id='initiator' AND localized_content::text LIKE $1`,
          [`%${request.id}%`]
        )
      ).rows;
      expect(notices).toHaveLength(1);
      expect(notices[0].profile_id).toBeNull();
      expect(notices[0].localized_content.en.title).toBe(
        decision === 'approve' ? 'Request approved' : 'Request rejected'
      );
      if (decision === 'reject')
        expect(notices[0].localized_content.en.body).toContain('Receipt could not be verified');
    }
}, 20000);

it('rechecks invoice receipt authority after waiting for the actor lock', async () => {
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='reviewer'");
  for (const action of ['confirm', 'reject']) {
    const receipt = await invoiceReceipt();
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='reviewer' FOR UPDATE");
      pending = fetch(`${http.base}/api/admin/invoices/bank-receipts/${receipt.id}/${action}`, {
        method: 'POST',
        headers: headers.reviewer!,
        body: JSON.stringify({ reason: 'Receipt does not match' }),
      });
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%' OR query LIKE 'SELECT u.user_id FROM users u JOIN sessions%')"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query("DELETE FROM user_roles WHERE user_id='reviewer'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(
        (await http.pool.query('SELECT state FROM bank_receipts WHERE id=$1', [receipt.id])).rows[0]
          .state
      ).toBe('Submitted');
      expect(
        (await http.pool.query('SELECT paid_amount FROM invoices WHERE id=$1', [receipt.invoice]))
          .rows[0].paid_amount
      ).toBe('0');
      expect(
        (
          await http.pool.query('SELECT id FROM wallet_transactions WHERE wallet_id=$1', [
            receipt.profile,
          ])
        ).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance') ON CONFLICT DO NOTHING"
      );
    }
  }
});

it('rechecks wallet receipt authority after waiting for the actor lock', async () => {
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='reviewer'");
  for (const action of ['confirm', 'reject']) {
    const receipt = await walletReceipt();
    const client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='reviewer' FOR UPDATE");
      pending = fetch(
        `${http.base}/api/admin/wallet/bank-receipt-top-ups/${receipt.id}/${action}`,
        {
          method: 'POST',
          headers: headers.reviewer!,
          body: JSON.stringify({ reason: 'Receipt does not match' }),
        }
      );
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%' OR query LIKE 'SELECT u.user_id FROM users u JOIN sessions%')"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      await client.query("DELETE FROM user_roles WHERE user_id='reviewer'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(
        (await http.pool.query('SELECT state FROM wallet_transactions WHERE id=$1', [receipt.id]))
          .rows[0].state
      ).toBe('Pending');
      expect(
        (
          await http.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
            receipt.profile,
          ])
        ).rows[0].posted_balance
      ).toBe('0');
      expect(
        (
          await http.pool.query(
            "SELECT id FROM wallet_transactions WHERE wallet_id=$1 AND state='Completed'",
            [receipt.profile]
          )
        ).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance') ON CONFLICT DO NOTHING"
      );
    }
  }
});

it('holds current authority through staff due-date overrides', async () => {
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='reviewer'");
  const receipt = await invoiceReceipt();
  const request = () =>
    fetch(`${http.base}/api/admin/invoices/${receipt.invoice}/due-at`, {
      method: 'POST',
      headers: headers.reviewer!,
      body: JSON.stringify({
        dueAt: '2027-01-01T00:00:00Z',
        reason: 'Extension agreed with customer',
      }),
    });
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='reviewer' FOR UPDATE");
    pending = request();
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE '%activation_pending%ORDER BY user_id FOR UPDATE%' OR query LIKE 'SELECT u.user_id FROM users u JOIN sessions%')"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query("DELETE FROM user_roles WHERE user_id='reviewer'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect(
      (await http.pool.query('SELECT due_at FROM invoices WHERE id=$1', [receipt.invoice])).rows[0]
        .due_at
    ).toBeNull();
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('reviewer','role-finance') ON CONFLICT DO NOTHING"
    );
  }
  expect((await request()).status).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT event FROM audit_log WHERE event='invoice.due_at.override' AND metadata::jsonb->>'invoiceId'=$1",
        [receipt.invoice]
      )
    ).rows
  ).toHaveLength(1);
});

async function resetReceiptReviewer() {
  await http.pool.query(
    "UPDATE sessions SET revoked_at=NULL,csrf_token=$1,step_up_verified_at=NOW(),expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes' WHERE user_id='reviewer'",
    [headers.reviewer!['X-CSRF-Token']]
  );
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES ('finance.dual_approval_threshold','{"threshold_irr":0}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`
  );
}
function receiptDecision(kind: 'wallet' | 'invoice', action: string, id: string) {
  return fetch(
    `${http.base}/api/admin/${kind === 'wallet' ? 'wallet/bank-receipt-top-ups' : 'invoices/bank-receipts'}/${id}/${action}`,
    {
      method: 'POST',
      headers: headers.reviewer!,
      body: JSON.stringify({ reason: 'Payer reference mismatch' }),
    }
  );
}
async function receiptWriteSnapshot(kind: 'wallet' | 'invoice', id: string, profile: string) {
  return {
    receipt: (
      await http.pool.query(
        `SELECT * FROM ${kind === 'wallet' ? 'wallet_transactions' : 'bank_receipts'} WHERE id=$1`,
        [id]
      )
    ).rows,
    wallets: (await http.pool.query('SELECT * FROM wallets WHERE profile_id=$1', [profile])).rows,
    invoices: (
      await http.pool.query('SELECT * FROM invoices WHERE profile_id=$1 ORDER BY id', [profile])
    ).rows,
    ledger: (
      await http.pool.query('SELECT * FROM wallet_transactions WHERE wallet_id=$1 ORDER BY id', [
        profile,
      ])
    ).rows,
    counts: (
      await http.pool.query(
        'SELECT (SELECT count(*) FROM audit_log) audits,(SELECT count(*) FROM notification_outbox) outbox,(SELECT count(*) FROM approval_requests) approvals,(SELECT count(*) FROM notifications) notifications'
      )
    ).rows,
  };
}
for (const kind of ['wallet', 'invoice'] as const) {
  for (const action of ['confirm', 'reject'] as const) {
    for (const change of ['revoke', 'csrf', 'step-up'] as const) {
      it(`receipt ${kind} ${action} refuses ${change} after its guard while waiting for the receipt lock`, async () => {
        await resetReceiptReviewer();
        const receipt = kind === 'wallet' ? await walletReceipt() : await invoiceReceipt();
        const keys =
          kind === 'wallet'
            ? bankReceiptConfirmationLockKeys(receipt.id)
            : invoiceBankReceiptConfirmationLockKeys(receipt.id);
        const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
        const blocker = await http.pool.connect();
        let pending: Promise<Response> | undefined;
        try {
          await blocker.query('SELECT pg_advisory_lock($1,$2)', keys);
          pending = receiptDecision(kind, action, receipt.id);
          await expect
            .poll(async () =>
              Number(
                (
                  await http.pool.query(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_lock%'"
                  )
                ).rows[0].count
              )
            )
            .toBe(1);
          await http.pool.query(
            change === 'revoke'
              ? "UPDATE sessions SET revoked_at=NOW() WHERE user_id='reviewer'"
              : change === 'csrf'
                ? "UPDATE sessions SET csrf_token='changed' WHERE user_id='reviewer'"
                : "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '16 minutes' WHERE user_id='reviewer'"
          );
          await blocker.query('SELECT pg_advisory_unlock($1,$2)', keys);
          expect((await pending).status).toBe(change === 'revoke' ? 401 : 403);
          expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
        } finally {
          await blocker.query('SELECT pg_advisory_unlock($1,$2)', keys);
          blocker.release();
          await pending;
          await resetReceiptReviewer();
        }
      });
    }
    for (const expiry of ['session', 'step-up'] as const) {
      it(`receipt ${kind} ${action} rolls back money, decision and notices when ${expiry} expires during audit`, async () => {
        await resetReceiptReviewer();
        const receipt = kind === 'wallet' ? await walletReceipt() : await invoiceReceipt();
        const before = await receiptWriteSnapshot(kind, receipt.id, receipt.profile);
        await http.pool.query(
          'CREATE FUNCTION delay_receipt_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$'
        );
        await http.pool.query(
          'CREATE TRIGGER delay_receipt_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_receipt_audit()'
        );
        let pending: Promise<Response> | undefined;
        try {
          await http.pool.query(
            expiry === 'session'
              ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '800 milliseconds' WHERE user_id='reviewer'"
              : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '800 milliseconds' WHERE user_id='reviewer'"
          );
          pending = receiptDecision(kind, action, receipt.id);
          await expect
            .poll(async () =>
              Number(
                (
                  await http.pool.query(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'"
                  )
                ).rows[0].count
              )
            )
            .toBe(1);
          expect((await pending).status).toBe(expiry === 'session' ? 401 : 403);
          expect(await receiptWriteSnapshot(kind, receipt.id, receipt.profile)).toEqual(before);
        } finally {
          await pending;
          await http.pool.query('DROP TRIGGER delay_receipt_audit ON audit_log');
          await http.pool.query('DROP FUNCTION delay_receipt_audit()');
          await resetReceiptReviewer();
        }
      });
    }
  }
}

function setThresholdHttp(user: string, amount: number) {
  return fetch(`${http.base}/api/admin/config/dual-approval-threshold`, {
    method: 'PUT',
    headers: headers[user]!,
    body: JSON.stringify({ threshold_irr: amount }),
  });
}
for (const expiry of ['session', 'step-up'] as const) {
  it(`threshold change rolls back config, version and audit when ${expiry} expires during its audit`, async () => {
    await resetReceiptReviewer();
    const config = (
      await http.pool.query("SELECT * FROM app_config WHERE key='finance.dual_approval_threshold'")
    ).rows;
    const version = (await http.pool.query('SELECT * FROM config_version')).rows;
    const audits = (await http.pool.query('SELECT count(*) FROM audit_log')).rows;
    await http.pool.query(
      'CREATE FUNCTION delay_threshold_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$'
    );
    await http.pool.query(
      'CREATE TRIGGER delay_threshold_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_threshold_audit()'
    );
    let pending: Promise<Response> | undefined;
    try {
      await http.pool.query(
        expiry === 'session'
          ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '800 milliseconds' WHERE user_id='reviewer'"
          : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '800 milliseconds' WHERE user_id='reviewer'"
      );
      pending = setThresholdHttp('reviewer', 500000);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'"
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      expect((await pending).status).toBe(expiry === 'session' ? 401 : 403);
      expect(
        (
          await http.pool.query(
            "SELECT * FROM app_config WHERE key='finance.dual_approval_threshold'"
          )
        ).rows
      ).toEqual(config);
      expect((await http.pool.query('SELECT * FROM config_version')).rows).toEqual(version);
      expect((await http.pool.query('SELECT count(*) FROM audit_log')).rows).toEqual(audits);
    } finally {
      await pending;
      await http.pool.query('DROP TRIGGER delay_threshold_audit ON audit_log');
      await http.pool.query('DROP FUNCTION delay_threshold_audit()');
      await resetReceiptReviewer();
    }
  });
}
it('threshold concurrent first writes preserve the complete previous value and version audit chain', async () => {
  await resetReceiptReviewer();
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='initiator'");
  await http.pool.query("DELETE FROM app_config WHERE key='finance.dual_approval_threshold'");
  const before = Number(
    (await http.pool.query('SELECT version FROM config_version')).rows[0].version
  );
  const blocker = await http.pool.connect();
  const correlation1 = randomUUID(),
    correlation2 = randomUUID();
  let writes: Promise<Response>[] = [];
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE app_config IN SHARE MODE');
    writes = ['reviewer', 'initiator'].map((user, i) =>
      fetch(`${http.base}/api/admin/config/dual-approval-threshold`, {
        method: 'PUT',
        headers: { ...headers[user]!, 'X-Correlation-ID': i === 0 ? correlation1 : correlation2 },
        body: JSON.stringify({ threshold_irr: i === 0 ? 123000 : 456000 }),
      })
    );
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE '%app_config%' OR query LIKE '%pg_advisory_xact_lock%')"
            )
          ).rows[0].count
        )
      )
      .toBe(2);
    await blocker.query('COMMIT');
    expect((await Promise.all(writes)).map((r) => r.status)).toEqual([200, 200]);
    const audit = (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='config_change' AND metadata::jsonb->>'key'='finance.dual_approval_threshold' AND (metadata::jsonb->'newValue'->>'threshold_irr')::bigint IN (123000,456000) ORDER BY (metadata::jsonb->>'version')::int"
      )
    ).rows.map((row) => row.metadata);
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ previousValue: null, previousVersion: 0, version: 1 });
    expect(audit[1]).toMatchObject({
      previousValue: audit[0].newValue,
      previousVersion: 1,
      version: 2,
    });
    expect(
      Number((await http.pool.query('SELECT version FROM config_version')).rows[0].version)
    ).toBe(before + 2);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await Promise.all(writes);
  }
});
for (const kind of ['wallet', 'invoice', 'generic'] as const) {
  it(`threshold change waits for the policy used by an in-flight ${kind} decision`, async () => {
    await resetReceiptReviewer();
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='initiator'"
    );
    if (kind === 'generic')
      await http.pool.query(
        `UPDATE app_config SET value='{"threshold_irr":1}' WHERE key='finance.dual_approval_threshold'`
      );
    const receipt = kind === 'wallet' ? await walletReceipt() : await invoiceReceipt();
    await http.pool.query('INSERT INTO wallets(profile_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      receipt.profile,
    ]);
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined, update: Promise<Response> | undefined;
    let changed = false;
    try {
      await blocker.query('BEGIN');
      if (kind === 'generic') await blocker.query('LOCK TABLE approval_requests IN SHARE MODE');
      else
        await blocker.query('SELECT profile_id FROM wallets WHERE profile_id=$1 FOR UPDATE', [
          receipt.profile,
        ]);
      pending =
        kind === 'generic'
          ? fetch(`${http.base}/api/admin/approval-requests`, {
              method: 'POST',
              headers: headers.reviewer!,
              body: JSON.stringify({
                action_type: 'bank_payment_confirmation',
                amount_irr: 100000,
                reason: 'Policy snapshot test',
              }),
            })
          : receiptDecision(kind, 'confirm', receipt.id);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
                [kind === 'generic' ? '%approval_requests%' : '%wallets%']
              )
            ).rows[0].count
          )
        )
        .toBe(1);
      update = setThresholdHttp('initiator', 50000).then((r) => {
        changed = true;
        return r;
      });
      await expect
        .poll(
          async () =>
            changed ||
            Number(
              (
                await http.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'"
                )
              ).rows[0].count
            ) === 1
        )
        .toBe(true);
      expect(changed).toBe(false);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(kind === 'generic' ? 201 : 200);
      expect((await update).status).toBe(200);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
      await update;
    }
  });
}
