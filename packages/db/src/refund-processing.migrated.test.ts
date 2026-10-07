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
  const failureNotices = () =>
    db.pool.query(
      'SELECT profile_id,operating_context,localized_content,link_route FROM in_app_notifications WHERE delivery_key=$1',
      [`refund:${row.id}:Failed`]
    );
  const firstNotice = (await failureNotices()).rows;
  expect(firstNotice).toHaveLength(1);
  expect(firstNotice[0]).toMatchObject({
    profile_id: row.profile_id,
    operating_context: 'customer',
    link_route: `/invoices/${row.invoice_id}`,
  });
  expect(firstNotice[0].localized_content.en.body).toContain('40 IRR');
  expect(firstNotice[0].localized_content.en.body).toContain('contact support');
  expect(firstNotice[0].localized_content.fa.body).toContain('۴۰');
  await due(row.id);
  expect(await runWalletRefund(db.pool, row.id)).toBe('exhausted');
  expect(await runWalletRefund(db.pool, row.id)).toBe('deferred');
  expect((await failureNotices()).rows).toEqual(firstNotice);
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

it('rolls back a failed attempt when its customer notice cannot be persisted', async () => {
  const row = await refund();
  await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [row.profile_id]);
  await db.pool.query(
    "CREATE FUNCTION fail_refund_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.delivery_key LIKE 'refund:%:Failed' THEN RAISE EXCEPTION 'notice unavailable'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_refund_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_refund_notice()"
  );
  try {
    await expect(runWalletRefund(db.pool, row.id)).rejects.toThrow('notice unavailable');
    expect(await job(row.id)).toMatchObject({ attempts: 0, exhausted_at: null });
    expect(
      (await db.pool.query('SELECT state FROM refunds WHERE id=$1', [row.id])).rows[0].state
    ).toBe('Processing');
    expect(
      (await db.pool.query('SELECT refunded_amount FROM invoices WHERE id=$1', [row.invoice_id]))
        .rows[0].refunded_amount
    ).toBe('0');
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM wallet_transactions WHERE ref_id=$1',
          [row.id]
        )
      ).rows[0].count
    ).toBe(0);
  } finally {
    await db.pool.query(
      'DROP TRIGGER fail_refund_notice ON in_app_notifications; DROP FUNCTION fail_refund_notice()'
    );
  }
  await expect(runWalletRefund(db.pool, row.id)).resolves.toBe('failed');
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

async function completedManifest(row: RefundProcessingRow) {
  const inbox = (
    await db.pool.query('SELECT * FROM in_app_notifications WHERE delivery_key=$1', [
      `refund:${row.id}:Completed`,
    ])
  ).rows[0];
  expect(inbox).toMatchObject({
    recipient_user_id: finance,
    profile_id: row.profile_id,
    type: 'general',
  });
  const outbox = (
    await db.pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='payment.refund_completed' AND payload->>'refundId'=$1",
      [row.id]
    )
  ).rows;
  expect(outbox).toHaveLength(1);
  expect(outbox[0]).toMatchObject({
    user_id: finance,
    profile_id: row.profile_id,
    channels: ['in_app', 'email'],
    status: 'queued',
    payload: {
      inboxId: inbox.id,
      refundId: row.id,
      invoiceId: row.invoice_id,
      amount: row.amount,
      destination: row.destination,
      link_route: `/invoices/${row.invoice_id}`,
    },
  });
  expect(JSON.stringify(outbox[0].payload)).not.toContain('authorized_by');
  expect(
    (
      await db.pool.query(
        'SELECT channel,status,priority,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [outbox[0].id]
      )
    ).rows
  ).toEqual([
    { channel: 'email', status: 'queued', priority: 'urgent', attempts: 0, provider_ref: null },
    { channel: 'in_app', status: 'done', priority: 'urgent', attempts: 1, provider_ref: inbox.id },
  ]);
  expect(
    (
      await db.pool.query(
        'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
        [outbox[0].id]
      )
    ).rows
  ).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox.id },
  ]);
  return { inbox, outbox: outbox[0] };
}

it('attaches one canonical urgent completion delivery to the original exact bigint receipt and preserves read history on replay', async () => {
  const row = await refund('9007199254740993', '9007199254740993');
  expect(await runWalletRefund(db.pool, row.id)).toBe('completed');
  const first = await completedManifest(row);
  await db.pool.query('UPDATE in_app_notifications SET is_read=true,read_at=now() WHERE id=$1', [
    first.inbox.id,
  ]);
  const before = (
    await db.pool.query('SELECT * FROM in_app_notifications WHERE id=$1', [first.inbox.id])
  ).rows;
  await transaction((c) =>
    notifyRefundOutcome(c, { ...row, destination: 'wallet', state: 'Completed' })
  );
  expect(
    (await db.pool.query('SELECT * FROM in_app_notifications WHERE id=$1', [first.inbox.id])).rows
  ).toEqual(before);
  expect((await completedManifest(row)).outbox).toEqual(first.outbox);
  expect(await runWalletRefund(db.pool, row.id)).toBe('deferred');
});

it('does not resend an existing historical receipt, attach a rejection or attach a failed warning', async () => {
  const row = await refund();
  await db.pool.query(
    "INSERT INTO in_app_notifications(recipient_user_id,profile_id,operating_context,type,title_i18n_key,body_i18n_key,delivery_key,localized_content,is_read,read_at) VALUES($1,$2,'customer','general','notifications.legacy.title','notifications.legacy.body',$3,$4,true,now())",
    [
      finance,
      row.profile_id,
      `refund:${row.id}:Completed`,
      { fa: { title: 'سابق', body: 'سابق' }, en: { title: 'Historical', body: 'Historical' } },
    ]
  );
  const before = (
    await db.pool.query('SELECT * FROM in_app_notifications WHERE profile_id=$1', [row.profile_id])
  ).rows;
  await transaction(async (c) => {
    await notifyRefundOutcome(c, { ...row, destination: 'wallet', state: 'Completed' });
    await notifyRefundOutcome(c, { ...row, destination: 'wallet', state: 'Rejected' });
    await notifyRefundOutcome(c, { ...row, destination: 'wallet', state: 'Failed' });
    expect(
      (await c.query('SELECT * FROM notification_outbox WHERE profile_id=$1', [row.profile_id]))
        .rows
    ).toEqual([]);
  });
  expect(
    (
      await db.pool.query('SELECT * FROM in_app_notifications WHERE profile_id=$1', [
        row.profile_id,
      ])
    ).rows
  ).toEqual(before);
});

const completionSinks = [
  ['in_app_notifications', "NEW.delivery_key LIKE 'refund:%:Completed'"],
  ['notification_outbox', "NEW.event_key='payment.refund_completed'"],
  [
    'notification_job',
    "NEW.channel='in_app' AND EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.outbox_id AND o.event_key='payment.refund_completed')",
  ],
  ['notification_job', "NEW.channel='email'"],
  [
    'notification_delivery_log',
    "NEW.channel='in_app' AND EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.notification_id AND o.event_key='payment.refund_completed')",
  ],
] as const;
it.each(
  completionSinks.flatMap(([table, guard]) =>
    ['raise', 'silent'].map((mode) => ({ table, guard, mode }))
  )
)(
  'rolls back completion money and all new delivery legs after $mode in $table ($guard), then recovers once',
  async ({ table, guard, mode }) => {
    const row = await refund();
    await db.pool.query(
      `CREATE FUNCTION fail_completion_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${guard} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'completion delivery unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_completion_delivery BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_completion_delivery()`
    );
    try {
      expect(await runWalletRefund(db.pool, row.id)).toBe('failed');
      expect(
        (
          await db.pool.query('SELECT state,refunded_amount FROM invoices WHERE id=$1', [
            row.invoice_id,
          ])
        ).rows
      ).toEqual([{ state: 'Paid', refunded_amount: '0' }]);
      expect(
        (await db.pool.query('SELECT * FROM wallet_transactions WHERE ref_id=$1', [row.id])).rows
      ).toEqual([]);
      expect(
        (await db.pool.query('SELECT * FROM wallets WHERE profile_id=$1', [row.profile_id])).rows
      ).toEqual([]);
      expect((await db.pool.query('SELECT state FROM refunds WHERE id=$1', [row.id])).rows).toEqual(
        [{ state: 'Failed' }]
      );
      expect(await job(row.id)).toMatchObject({
        attempts: 1,
        last_error_code: 'posting_failed',
        completed_at: null,
        exhausted_at: null,
      });
      expect(
        (
          await db.pool.query('SELECT * FROM in_app_notifications WHERE delivery_key=$1', [
            `refund:${row.id}:Completed`,
          ])
        ).rows
      ).toEqual([]);
      expect(
        (
          await db.pool.query('SELECT * FROM notification_outbox WHERE profile_id=$1', [
            row.profile_id,
          ])
        ).rows
      ).toEqual([]);
      expect(
        (
          await db.pool.query(
            "SELECT * FROM audit_log WHERE event='refund.completed' AND metadata::jsonb->>'refundId'=$1",
            [row.id]
          )
        ).rows
      ).toEqual([]);
    } finally {
      await db.pool.query(
        `DROP TRIGGER fail_completion_delivery ON ${table}; DROP FUNCTION fail_completion_delivery()`
      );
    }
    await due(row.id);
    expect(await runWalletRefund(db.pool, row.id)).toBe('completed');
    await completedManifest(row);
    expect(await runWalletRefund(db.pool, row.id)).toBe('deferred');
    expect(
      (await db.pool.query('SELECT amount FROM wallet_transactions WHERE ref_id=$1', [row.id])).rows
    ).toEqual([{ amount: '40' }]);
  }
);

async function failureManifests(row: RefundProcessingRow, attempt: number) {
  const records = (
    await db.pool.query(
      "SELECT o.id,o.user_id,o.profile_id,o.channels,o.payload,n.id AS inbox_id,n.operating_context,n.type,n.link_route,n.localized_content,n.is_read FROM notification_outbox o JOIN in_app_notifications n ON n.delivery_key='outbox:'||o.id::text WHERE o.event_key='payment.refund_failed' AND o.payload->>'refundId'=$1 AND o.payload->>'attempt'=$2 ORDER BY o.user_id",
      [row.id, String(attempt)]
    )
  ).rows;
  expect(records.map((r) => r.user_id).sort()).toEqual([admin, finance, reviewer].sort());
  for (const record of records) {
    expect(record).toMatchObject({
      profile_id: null,
      operating_context: 'staff',
      type: 'payment.refund_failed',
      channels: ['in_app'],
      payload: { refundId: row.id, invoiceId: row.invoice_id, amount: row.amount, attempt },
      link_route: `/admin/invoices?invoiceId=${row.invoice_id}#wallet-refunds-panel`,
    });
    expect(record.localized_content.en.body).toContain('finance workspace');
    expect(record.localized_content.fa.body).toContain('بخش مالی');
    expect(
      (
        await db.pool.query(
          "SELECT event,metadata::jsonb->>'refundId' AS refund FROM audit_log WHERE id=$1",
          [record.payload.auditId]
        )
      ).rows
    ).toEqual([{ event: 'refund.failed', refund: row.id }]);
    expect(
      (
        await db.pool.query(
          'SELECT channel,status,priority,attempts,provider_ref FROM notification_job WHERE outbox_id=$1',
          [record.id]
        )
      ).rows
    ).toEqual([
      {
        channel: 'in_app',
        status: 'done',
        priority: 'urgent',
        attempts: 1,
        provider_ref: record.inbox_id,
      },
    ]);
    expect(
      (
        await db.pool.query(
          'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
          [record.id]
        )
      ).rows
    ).toEqual([
      { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: record.inbox_id },
    ]);
  }
  return records;
}
it('notifies active finance privately for each audited failed attempt before and at exhaustion while retaining the original stop alert/customer history', async () => {
  const row = await refund('9007199254740993', '9007199254740993', 'wallet', 2);
  await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [row.profile_id]);
  expect(await runWalletRefund(db.pool, row.id)).toBe('failed');
  const first = await failureManifests(row, 1);
  await db.pool.query('UPDATE in_app_notifications SET is_read=true,read_at=now() WHERE id=$1', [
    first[0].inbox_id,
  ]);
  const history = (
    await db.pool.query('SELECT * FROM in_app_notifications WHERE id=$1', [first[0].inbox_id])
  ).rows;
  expect(
    (
      await db.pool.query('SELECT id FROM in_app_notifications WHERE delivery_key LIKE $1', [
        `refund-exhausted:${row.id}:%`,
      ])
    ).rows
  ).toEqual([]);
  await due(row.id);
  expect(await runWalletRefund(db.pool, row.id)).toBe('exhausted');
  await failureManifests(row, 2);
  expect(
    (await db.pool.query('SELECT * FROM in_app_notifications WHERE id=$1', [first[0].inbox_id]))
      .rows
  ).toEqual(history);
  expect(
    (
      await db.pool.query(
        'SELECT recipient_user_id FROM in_app_notifications WHERE delivery_key LIKE $1',
        [`refund-exhausted:${row.id}:%`]
      )
    ).rows
      .map((r) => r.recipient_user_id)
      .sort()
  ).toEqual([admin, finance, reviewer].sort());
  expect(
    (
      await db.pool.query('SELECT id FROM in_app_notifications WHERE delivery_key=$1', [
        `refund:${row.id}:Failed`,
      ])
    ).rows
  ).toHaveLength(1);
  expect(await runWalletRefund(db.pool, row.id)).toBe('deferred');
  expect(
    (
      await db.pool.query(
        "SELECT id FROM notification_outbox WHERE event_key='payment.refund_failed' AND payload->>'refundId'=$1",
        [row.id]
      )
    ).rows
  ).toHaveLength(6);
});
async function failureRowsSnapshot() {
  const tables = (
    await db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    )
  ).rows;
  const snapshot: Record<string, unknown> = {};
  for (const { tablename } of tables)
    snapshot[tablename] = (
      await db.pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${tablename}" t`
      )
    ).rows[0].rows;
  return snapshot;
}
it.each(
  [
    ['audit_log', "NEW.event='refund.failed'"],
    ['notification_outbox', "NEW.event_key='payment.refund_failed'"],
    ['in_app_notifications', "NEW.type='payment.refund_failed'"],
    [
      'notification_job',
      "EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.outbox_id AND o.event_key='payment.refund_failed')",
    ],
    [
      'notification_delivery_log',
      "EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.notification_id AND o.event_key='payment.refund_failed')",
    ],
  ].flatMap(([table, guard]) => ['raise', 'silent'].map((mode) => ({ table, guard, mode })))
)(
  'rolls the whole failed attempt back after $mode in $table, then recovers one private audit-bound fanout',
  async ({ table, guard, mode }) => {
    const row = await refund('40', '100', 'wallet', 1);
    await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [row.profile_id]);
    const before = await failureRowsSnapshot();
    await db.pool.query(
      `CREATE FUNCTION fail_internal_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${guard} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'failure delivery unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_internal_refund BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_internal_refund()`
    );
    try {
      await expect(runWalletRefund(db.pool, row.id)).rejects.toThrow();
      expect(await failureRowsSnapshot()).toEqual(before);
    } finally {
      await db.pool.query(
        `DROP TRIGGER fail_internal_refund ON ${table}; DROP FUNCTION fail_internal_refund()`
      );
    }
    expect(await runWalletRefund(db.pool, row.id)).toBe('exhausted');
    await failureManifests(row, 1);
    expect(await job(row.id)).toMatchObject({
      attempts: 1,
      completed_at: null,
      last_error_code: 'profile_archived',
    });
    expect(await runWalletRefund(db.pool, row.id)).toBe('deferred');
  }
);

it('selects only current valid finance/admin recipients and excludes support,malformed roles,disabled and pending activation accounts', async () => {
  const candidates: string[] = [],
    eligible: string[] = [];
  try {
    for (const [permissions, disabled, pending, isAdmin] of [
      ['["admin:financial:edit"]', false, false, false],
      ['["*"]', false, false, false],
      ['["tickets:read"]', false, false, false],
      ['{"admin:financial:edit":true}', false, false, false],
      ['["admin:financial:edit",7]', false, false, false],
      ['["admin:financial:edit"]', true, false, false],
      ['["admin:financial:edit"]', false, true, false],
      ['[]', false, true, true],
    ] as const) {
      const user = randomUUID(),
        role = randomUUID();
      candidates.push(user);
      await db.pool.query(
        "INSERT INTO users(user_id,username,password_hash,is_admin,disabled_at,activation_token) VALUES($1,$1,'fixture',$2,CASE WHEN $3 THEN now() END,CASE WHEN $4 THEN $1 END)",
        [user, isAdmin, disabled, pending]
      );
      await db.pool.query(
        "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES($1,$1,'fixture',$2)",
        [role, permissions]
      );
      await db.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
      if (
        !disabled &&
        !pending &&
        (permissions === '["admin:financial:edit"]' || permissions === '["*"]')
      )
        eligible.push(user);
    }
    const row = await refund();
    await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [row.profile_id]);
    expect(await runWalletRefund(db.pool, row.id)).toBe('failed');
    const received = (
      await db.pool.query(
        "SELECT user_id FROM notification_outbox WHERE event_key='payment.refund_failed' AND payload->>'refundId'=$1",
        [row.id]
      )
    ).rows.map((r) => r.user_id);
    expect(received.sort()).toEqual([admin, finance, reviewer, ...eligible].sort());
    expect(received).not.toContain(support);
  } finally {
    await db.pool.query('UPDATE users SET disabled_at=now() WHERE user_id=ANY($1)', [candidates]);
  }
});
it('uses NOWAIT for recipient authority so an actor lock cannot deadlock the original invoice processing order', async () => {
  const row = await refund();
  await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [row.profile_id]);
  const before = await failureRowsSnapshot(),
    held = await db.pool.connect();
  try {
    await held.query('BEGIN');
    await held.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [reviewer]);
    await expect(runWalletRefund(db.pool, row.id)).rejects.toMatchObject({ code: '55P03' });
    expect(await failureRowsSnapshot()).toEqual(before);
  } finally {
    await held.query('ROLLBACK');
    held.release();
  }
  expect(await runWalletRefund(db.pool, row.id)).toBe('failed');
  await failureManifests(row, 1);
});
