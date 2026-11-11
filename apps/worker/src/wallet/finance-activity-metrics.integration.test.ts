import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db.js';
import { postWalletCredit } from '../../../../packages/db/src/wallet-credit.js';
import { collectFinanceActivityMetrics } from './finance-activity-metrics.js';
import { exportWorkerMetrics } from '../notifications/worker-metrics.js';

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
const user = 'finance-metrics-fixture';
const profile = randomUUID();
const invoice = randomUUID();

beforeAll(async () => {
  fixture = await createMigratedTestDb();
  await fixture.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,$1)', [
    user,
  ]);
  await fixture.pool.query('INSERT INTO profiles(id,user_id) VALUES ($1,$2)', [profile, user]);
  await fixture.pool.query('INSERT INTO wallets(profile_id) VALUES ($1)', [profile]);
  await fixture.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES ($1,$2,'Paid',1000,1000)",
    [invoice, profile]
  );
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});

async function audit(event: string, data: Record<string, unknown> | string, hoursAgo = 0) {
  await fixture.pool.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,created_at)
     VALUES ($1,$2,$3,$4,now()-($5::int * INTERVAL '1 hour'))`,
    [randomUUID(), user, event, typeof data === 'string' ? data : JSON.stringify(data), hoursAgo]
  );
}

async function pendingTopup(): Promise<string> {
  const id = randomUUID();
  await fixture.pool.query(
    `INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,metadata)
     VALUES ($1::uuid,$2,'topup',100,'Pending',$1::text,'{"channel":"online"}')`,
    [id, profile]
  );
  await fixture.pool.query("UPDATE wallet_transactions SET state='Failed' WHERE id=$1", [id]);
  return id;
}

async function refund(amount: string, destination: 'wallet' | 'external_bank') {
  const id = randomUUID();
  await fixture.pool.query(
    `INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key)
     VALUES ($1::uuid,$2,$3,$4,$5,$1::text)`,
    [id, invoice, profile, amount, destination]
  );
  return id;
}

it('deduplicates committed payment outcomes and sums only durable completed refunds', async () => {
  await collectFinanceActivityMetrics(fixture.pool);
  expect(await exportWorkerMetrics()).toContain('finance_activity_collection_success 1\n');
  expect(await exportWorkerMetrics()).toContain(
    'finance_refunds_completed_1h{destination="wallet"} 0\n'
  );

  const late = await pendingTopup();
  await pendingTopup();
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    await postWalletCredit(
      client,
      { id: profile, archived: false },
      profile,
      100n,
      { type: 'topup', metadata: { channel: 'online', pendingTransactionId: late } },
      `fixture-credit:${late}`
    );
    await client.query('COMMIT');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const reviewed = randomUUID();
  await audit('invoice.bank_receipt.rejected', { receiptId: reviewed });
  await audit('invoice.bank_receipt.confirmed', { receiptId: reviewed });
  await audit('invoice.bank_receipt.rejected', { receiptId: randomUUID() });
  await audit('invoice.bank_receipt.confirmed', { receiptId: randomUUID() }, 2);
  await audit('wallet.invoice_payment', { walletTransactionId: randomUUID() });
  await audit('wallet.bank_receipt.confirmed', { transactionId: randomUUID() });
  await audit('wallet.bank_receipt.rejected', '{invalid');

  const credit = await refund('250', 'wallet');
  const bank = await refund('450', 'external_bank');
  const pending = await refund('50', 'wallet');
  const refundClient = await fixture.pool.connect();
  try {
    await refundClient.query('BEGIN');
    await refundClient.query("UPDATE refunds SET state='Processing' WHERE id=ANY($1::uuid[])", [
      [credit, bank],
    ]);
    await postWalletCredit(
      refundClient,
      { id: profile, archived: false },
      profile,
      250n,
      { type: 'refund', refId: credit },
      `refund-wallet-credit:${credit}`
    );
    await refundClient.query("UPDATE refunds SET state='Completed' WHERE id=$1", [credit]);
    await refundClient.query(
      "UPDATE refunds SET state='Completed',bank_reference='fixture-reference',reconciliation_status='Confirmed' WHERE id=$1",
      [bank]
    );
    await refundClient.query('COMMIT');
  } finally {
    await refundClient.query('ROLLBACK');
    refundClient.release();
  }
  await audit('refund.completed', { refundId: credit, amount: '9999999' });
  await audit('refund.completed', { refundId: credit });
  await audit('refund.completed', { refundId: bank });
  await audit('refund.completed', { refundId: pending });
  await audit('refund.completed', { refundId: 'not-a-refund-id' });

  await collectFinanceActivityMetrics(fixture.pool);
  const metrics = await exportWorkerMetrics();
  expect(metrics).toContain('finance_activity_collection_success 1\n');
  for (const operation of ['online_topup', 'invoice_bank_receipt']) {
    expect(metrics).toContain(
      `finance_payment_outcomes_1h{operation="${operation}",outcome="completed"} 1\n`
    );
    expect(metrics).toContain(
      `finance_payment_outcomes_1h{operation="${operation}",outcome="unsuccessful"} 1\n`
    );
  }
  for (const operation of ['wallet_invoice_payment', 'wallet_bank_topup']) {
    expect(metrics).toContain(
      `finance_payment_outcomes_1h{operation="${operation}",outcome="completed"} 1\n`
    );
  }
  expect(metrics).not.toContain('operation="wallet_invoice_payment",outcome="unsuccessful"');
  expect(metrics).toContain('finance_refunds_completed_1h{destination="wallet"} 1\n');
  expect(metrics).toContain('finance_refunds_completed_1h{destination="external_bank"} 1\n');
  expect(metrics).toContain('finance_refunds_completed_irr_1h{destination="wallet"} 250\n');
  expect(metrics).toContain('finance_refunds_completed_irr_1h{destination="external_bank"} 450\n');
  for (const privateValue of [profile, late, credit, 'fixture-reference', '9999999'])
    expect(metrics).not.toContain(privateValue);

  const read = vi
    .spyOn(fixture.pool, 'query')
    .mockRejectedValueOnce(new Error('fixture unavailable'));
  try {
    await Promise.all([
      collectFinanceActivityMetrics(fixture.pool),
      collectFinanceActivityMetrics(fixture.pool),
    ]);
    expect(read).toHaveBeenCalledOnce();
    const unavailable = await exportWorkerMetrics();
    expect(unavailable).toContain('finance_activity_collection_success 0\n');
    expect(unavailable).not.toMatch(/^finance_(?:payment_outcomes|refunds_completed).*\{/m);
  } finally {
    read.mockRestore();
  }
  await collectFinanceActivityMetrics(fixture.pool);
  expect(await exportWorkerMetrics()).toContain('finance_activity_collection_success 1\n');
}, 30_000);
