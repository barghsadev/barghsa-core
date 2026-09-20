import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { refundRetryJobs } from './index';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import {
  latestRefundApproval,
  requireRefundApproval,
  requireRefundFinancePermission,
  refundRequiresApproval,
  runWalletRefund,
  retryDueWalletRefunds,
  type RefundProcessingRow,
} from './refund-processing';
import { notifyRefundOutcome } from './refund-notifications';
import {
  postWalletCredit,
  validateWalletCredit,
  type WalletCreditReference,
} from './wallet-credit';

let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
const finance = randomUUID(),
  reviewer = randomUUID(),
  admin = randomUUID(),
  support = randomUUID();
beforeAll(async () => {
  db = await createMigratedTestDb();
  for (const id of [finance, reviewer, admin, support])
    await db.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_admin) VALUES($1,$1,$1,$2)',
      [id, id === admin]
    );
  for (const id of [finance, reviewer])
    await db.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,'role-finance')", [id]);
  await db.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES($1,'role-customer-support')",
    [support]
  );
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await policy(0);
});
it('exports the migrated retry schema and protects processing authority and attempt history', async () => {
  const row = await refund();
  const [job] = await db.db
    .select()
    .from(refundRetryJobs)
    .where(eq(refundRetryJobs.refundId, row.id));
  expect(job).toMatchObject({ executorUserId: finance, attempts: 0, maxAttempts: 5 });
  expect(getTableConfig(refundRetryJobs).indexes.map((index) => index.config.name)).toContain(
    'refund_retry_jobs_due_idx'
  );
  for (const assignment of [
    "executor_user_id = 'other'",
    'max_attempts = 6',
    'attempts = -1',
    'attempts = 6',
    'next_attempt_at = NULL',
  ]) {
    await expect(
      db.pool.query(`UPDATE refund_retry_jobs SET ${assignment} WHERE refund_id=$1`, [row.id])
    ).rejects.toMatchObject({ code: '23514' });
  }
  await expect(
    db.pool.query('DELETE FROM refund_retry_jobs WHERE refund_id=$1', [row.id])
  ).rejects.toMatchObject({ code: '23514' });
});
async function policy(value: unknown) {
  await db.pool.query(
    "INSERT INTO app_config(key,value) VALUES('finance.dual_approval_threshold',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [JSON.stringify({ threshold_irr: value })]
  );
}
async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
async function refund(amount = '40', paid = '100', destination = 'wallet', maxAttempts = 5) {
  const profile = randomUUID(),
    invoice = randomUUID();
  await db.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, finance]);
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,'Paid',$3,$3)",
    [invoice, profile, paid]
  );
  const row = (
    await db.pool.query<RefundProcessingRow>(
      'INSERT INTO refunds(invoice_id,profile_id,amount,destination,staff_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [invoice, profile, amount, destination, finance, randomUUID()]
    )
  ).rows[0]!;
  await db.pool.query("UPDATE refunds SET state='Processing' WHERE id=$1", [row.id]);
  row.state = 'Processing';
  if (destination === 'wallet')
    await db.pool.query(
      'INSERT INTO refund_retry_jobs(refund_id,executor_user_id,max_attempts) VALUES($1,$2,$3)',
      [row.id, finance, maxAttempts]
    );
  return row;
}
async function approval(row: RefundProcessingRow, overrides: Record<string, unknown> = {}) {
  const value = {
    action_type: 'refund',
    amount: row.amount,
    initiator: finance,
    reviewer,
    status: 'approved',
    details: {
      refundId: row.id,
      invoiceId: row.invoice_id,
      profileId: row.profile_id,
      destination: row.destination,
    },
    ...overrides,
  };
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO approval_requests(id,action_type,amount_irr,initiator_id,reviewer_id,reason,review_reason,status,reviewed_at,details) VALUES($1,$2,$3,$4,$5,'test','test',$6,now(),$7::jsonb)",
    [
      id,
      value.action_type,
      value.amount,
      value.initiator,
      value.reviewer,
      value.status,
      JSON.stringify(value.details),
    ]
  );
  await db.pool.query(
    "INSERT INTO audit_log(id,user_id,event,metadata) VALUES($1,$2,'refund.approval_requested',$3)",
    [randomUUID(), finance, JSON.stringify({ refundId: row.id, approvalRequestId: id })]
  );
  return id;
}
const job = async (id: string) =>
  (await db.pool.query('SELECT * FROM refund_retry_jobs WHERE refund_id=$1', [id])).rows[0];
const due = (id: string) =>
  db.pool.query('UPDATE refund_retry_jobs SET next_attempt_at=now() WHERE refund_id=$1', [id]);

it('posts exact partial and full credits once through the production migration and durable queue', async () => {
  const partial = await refund();
  expect(await runWalletRefund(db.pool, partial.id)).toBe('completed');
  expect(await runWalletRefund(db.pool, partial.id)).toBe('deferred');
  expect(
    (
      await db.pool.query('SELECT state,refunded_amount FROM invoices WHERE id=$1', [
        partial.invoice_id,
      ])
    ).rows[0]
  ).toEqual({ state: 'PartiallyRefunded', refunded_amount: '40' });
  const full = await refund('9007199254740993', '9007199254740993');
  expect(await runWalletRefund(db.pool, full.id)).toBe('completed');
  expect(
    (
      await db.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [
        full.profile_id,
      ])
    ).rows[0].posted_balance
  ).toBe('9007199254740993');
  expect((await job(full.id)).completed_at).toBeInstanceOf(Date);
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS count FROM in_app_notifications WHERE profile_id=$1',
        [full.profile_id]
      )
    ).rows[0].count
  ).toBe(1);
  await expect(
    db.pool.query(
      'UPDATE refund_retry_jobs SET completed_at=NULL,next_attempt_at=now() WHERE refund_id=$1',
      [full.id]
    )
  ).rejects.toThrow();
});

it('honors due times, advisory claims and the absence of a wallet processing request', async () => {
  expect(await runWalletRefund(db.pool, randomUUID())).toBe('deferred');
  const row = await refund();
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `refund-run:${row.id}`,
    ]);
    expect(await runWalletRefund(db.pool, row.id)).toBe('deferred');
  });
  await db.pool.query(
    "UPDATE refund_retry_jobs SET next_attempt_at=now()+interval '1 day' WHERE refund_id=$1",
    [row.id]
  );
  expect(await runWalletRefund(db.pool, row.id)).toBe('deferred');
  await due(row.id);
  expect(await retryDueWalletRefunds(db.pool, 0)).toContain('completed');
  const external = await refund('40', '100', 'external_bank');
  expect(await runWalletRefund(db.pool, external.id)).toBe('deferred');
  await expect(
    db.pool.query('INSERT INTO refund_retry_jobs(refund_id,executor_user_id) VALUES($1,$2)', [
      external.id,
      finance,
    ])
  ).rejects.toThrow();
});

it('persists safe failures and stops at the bound with finance-only, nonduplicated alerts', async () => {
  const row = await refund('40', '100', 'wallet', 2);
  await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [row.profile_id]);
  expect(await runWalletRefund(db.pool, row.id)).toBe('failed');
  expect(await job(row.id)).toMatchObject({
    attempts: 1,
    last_error_code: 'profile_archived',
    exhausted_at: null,
  });
  await due(row.id);
  expect(await runWalletRefund(db.pool, row.id)).toBe('exhausted');
  expect(await runWalletRefund(db.pool, row.id)).toBe('deferred');
  const alerts = (
    await db.pool.query(
      'SELECT recipient_user_id FROM in_app_notifications WHERE delivery_key LIKE $1',
      [`refund-exhausted:${row.id}:%`]
    )
  ).rows.map((r) => r.recipient_user_id);
  expect(alerts.sort()).toEqual([admin, finance, reviewer].sort());
  expect((await job(row.id)).next_attempt_at).toBeNull();
  await expect(
    db.pool.query('UPDATE refund_retry_jobs SET attempts=0 WHERE refund_id=$1', [row.id])
  ).rejects.toThrow();
  await expect(
    db.pool.query('DELETE FROM refund_retry_jobs WHERE refund_id=$1', [row.id])
  ).rejects.toThrow();
});

it('fails safely for changed invoice/policy state and recovers only when the policy permits', async () => {
  const row = await refund();
  await policy('corrupt');
  expect(await runWalletRefund(db.pool, row.id)).toBe('failed');
  expect((await job(row.id)).last_error_code).toBe('invalid_policy');
  await policy(0);
  await due(row.id);
  await db.pool.query("UPDATE invoices SET state='Cancelled' WHERE id=$1", [row.invoice_id]);
  expect(await runWalletRefund(db.pool, row.id)).toBe('failed');
  expect((await job(row.id)).last_error_code).toBe('invoice_not_refundable');
  await db.pool.query("UPDATE invoices SET state='Paid' WHERE id=$1", [row.invoice_id]);
  await due(row.id);
  expect(await runWalletRefund(db.pool, row.id)).toBe('completed');
});

it('rolls back the entire attempt if failure history cannot be persisted', async () => {
  const row = await refund();
  await policy('corrupt');
  expect(await runWalletRefund(db.pool, row.id)).toBe('failed');
  await due(row.id);
  await db.pool.query(
    "CREATE FUNCTION fail_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='refund.processing' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_retry_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_retry_audit()"
  );
  try {
    await expect(runWalletRefund(db.pool, row.id)).rejects.toThrow('audit failure');
    expect((await job(row.id)).attempts).toBe(1);
  } finally {
    await db.pool.query(
      'DROP TRIGGER fail_retry_audit ON audit_log; DROP FUNCTION fail_retry_audit()'
    );
  }
  await policy(0);
  expect(await runWalletRefund(db.pool, row.id)).toBe('completed');
});

it('requires current finance authority and a canonical, still-valid second approval', async () => {
  await transaction(async (c) => {
    await requireRefundFinancePermission(c, admin);
    await requireRefundFinancePermission(c, finance);
    await expect(requireRefundFinancePermission(c, support)).rejects.toThrow('finance permission');
    await expect(requireRefundFinancePermission(c, randomUUID())).rejects.toThrow(
      'finance permission'
    );
  });
  const row = await refund();
  await policy(40);
  await transaction(async (c) => {
    expect(await refundRequiresApproval(c, '39')).toBe(false);
    expect(await refundRequiresApproval(c, '40')).toBe(true);
    await expect(requireRefundApproval(c, row)).rejects.toThrow('second finance');
  });
  await approval(row);
  await transaction((c) => requireRefundApproval(c, row));
  expect(await runWalletRefund(db.pool, row.id)).toBe('completed');
});

it.each([
  { action_type: 'manual_adjustment' },
  { amount: '41' },
  { initiator: reviewer },
  { reviewer: null },
  { reviewer: finance },
  { status: 'pending' },
  { status: 'rejected' },
  { field: 'refundId' },
  { field: 'invoiceId' },
  { field: 'profileId' },
  { field: 'destination' },
])('rejects mismatched or unresolved approval evidence: %j', async (change) => {
  const row = await refund();
  await policy(1);
  const overrides: Record<string, unknown> = { ...change };
  if ('field' in change)
    overrides.details = {
      refundId: row.id,
      invoiceId: row.invoice_id,
      profileId: row.profile_id,
      destination: row.destination,
      [change.field!]: randomUUID(),
    };
  await approval(row, overrides);
  await transaction((c) => expect(requireRefundApproval(c, row)).rejects.toThrow());
  await db.pool.query(
    "UPDATE refund_retry_jobs SET next_attempt_at=now()+interval '1 day' WHERE refund_id=$1",
    [row.id]
  );
});

it('does not substitute an unbound approval when the bound request is absent', async () => {
  const row = await refund();
  await db.pool.query(
    "INSERT INTO audit_log(id,user_id,event,metadata) VALUES($1,$2,'refund.approval_requested',$3)",
    [randomUUID(), finance, JSON.stringify({ refundId: row.id, approvalRequestId: randomUUID() })]
  );
  await transaction((c) => expect(latestRefundApproval(c, row)).rejects.toThrow('bound approval'));
  await db.pool.query(
    "UPDATE refund_retry_jobs SET next_attempt_at=now()+interval '1 day' WHERE refund_id=$1",
    [row.id]
  );
});

it('renders customer notices for both destinations and rejection without losing exact amounts', async () => {
  const row = await refund();
  await transaction(async (c) => {
    await notifyRefundOutcome(c, { ...row, destination: 'external_bank', state: 'Completed' });
    await notifyRefundOutcome(c, { ...row, destination: 'wallet', state: 'Rejected' });
    const notices = (
      await c.query('SELECT localized_content FROM in_app_notifications WHERE profile_id=$1', [
        row.profile_id,
      ])
    ).rows;
    expect(notices[0].localized_content.en.body).toContain('bank refund');
    expect(notices[1].localized_content.en.body).toContain('rejected');
    await expect(
      notifyRefundOutcome(c, {
        ...row,
        profile_id: randomUUID(),
        destination: 'wallet',
        state: 'Completed',
      })
    ).rejects.toThrow('owner');
  });
  expect(await runWalletRefund(db.pool, row.id)).toBe('completed');
});

it('shares credit replay identity and rejects malformed or colliding commands', async () => {
  const row = await refund();
  await db.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [row.profile_id]);
  await transaction(async (c) => {
    const profile = { id: row.profile_id, archived: false };
    const key = randomUUID();
    const ref = { type: 'refund' as const };
    const posted = await postWalletCredit(c, profile, row.profile_id, 4n, ref, key);
    expect(await postWalletCredit(c, profile, row.profile_id.toUpperCase(), 4n, ref, key)).toEqual(
      posted
    );
    await expect(postWalletCredit(c, profile, row.profile_id, 5n, ref, key)).rejects.toThrow(
      'different wallet operation'
    );
    await expect(
      postWalletCredit(c, profile, row.profile_id, 4n, { ...ref, refId: 'other' }, key)
    ).rejects.toThrow('different wallet operation');
    await expect(
      postWalletCredit(c, { ...profile, id: randomUUID() }, row.profile_id, 4n, ref, randomUUID())
    ).rejects.toThrow('profile changed');
    await expect(
      postWalletCredit(c, { ...profile, archived: true }, row.profile_id, 4n, ref, randomUUID())
    ).rejects.toThrow('Archived');
    await expect(postWalletCredit(c, profile, randomUUID(), 4n, ref, randomUUID())).rejects.toThrow(
      'Wallet not found'
    );
    const other = await refund();
    await c.query('INSERT INTO wallets(profile_id) VALUES($1)', [other.profile_id]);
    await expect(
      postWalletCredit(c, { id: other.profile_id, archived: false }, other.profile_id, 4n, ref, key)
    ).rejects.toThrow('different wallet');
  });
  for (const [amount, type, key] of [
    [0n, 'refund', 'key'],
    [1n, 'refund', ' '],
    [1n, 'reversal', 'key'],
    [1n, 'payment', 'key'],
  ] as const)
    expect(() =>
      validateWalletCredit(amount, { type: type as WalletCreditReference['type'] }, key)
    ).toThrow();
});

it('rolls back a ledger write when the database refuses a balance mutation', async () => {
  const row = await refund();
  await db.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [row.profile_id]);
  await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [row.profile_id]);
  await transaction((c) =>
    expect(
      postWalletCredit(
        c,
        { id: row.profile_id, archived: false },
        row.profile_id,
        4n,
        { type: 'refund' },
        randomUUID()
      )
    ).rejects.toThrow('version mismatch')
  );
  expect(
    (await db.pool.query('SELECT id FROM wallet_transactions WHERE wallet_id=$1', [row.profile_id]))
      .rows
  ).toEqual([]);
  await db.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [row.profile_id]);
});
