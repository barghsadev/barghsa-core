import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrationPrefix } from './test/migration-prefix';

const name = `test_financial_retention_${randomUUID().replaceAll('-', '')}`;
const profile = randomUUID();
const walletEntry = randomUUID();
const issuedInvoice = randomUUID();
const draftInvoice = randomUUID();
const receipt = randomUUID();
const callback = randomUUID();
const chargeback = randomUUID();
let management: Pool;
let pool: Pool;

const historyQueries = [
  'SELECT * FROM wallet_transactions ORDER BY id',
  'SELECT * FROM invoices ORDER BY id',
  'SELECT * FROM bank_receipts ORDER BY id',
  'SELECT * FROM bank_receipt_status_events ORDER BY id',
  'SELECT * FROM wallet_topup_callback_events ORDER BY id',
  'SELECT * FROM wallet_chargeback_events ORDER BY id',
];

const history = () => Promise.all(historyQueries.map(async (sql) => (await pool.query(sql)).rows));

beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${name}`;
  const connection = { pgdirectUrl: url.toString() };
  expect(
    await runMigrationPrefix('0291_notification_outbox_trace_parent', { connection })
  ).toMatchObject({ ok: true });
  pool = new Pool({ connectionString: url.toString() });
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('retention-owner','retention@example.test','fixture')"
  );
  await pool.query("INSERT INTO profiles(id,user_id) VALUES($1,'retention-owner')", [profile]);
  await pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [profile]);
  await pool.query(
    `INSERT INTO wallet_transactions(id,wallet_id,type,amount,idempotency_key,created_at)
     VALUES($1,$2,'topup',1000,'retention-wallet-entry',NOW()-INTERVAL '11 years')`,
    [walletEntry, profile]
  );
  await pool.query(
    `INSERT INTO invoices(id,profile_id,state,total_amount,issued_at)
     VALUES($1,$3,'Unpaid',1000,NOW()-INTERVAL '9 years'),($2,$3,'Draft',1000,NULL)`,
    [issuedInvoice, draftInvoice, profile]
  );
  await pool.query(
    `INSERT INTO bank_receipts(id,invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key)
     VALUES($1,$2,$3,1000,'2026-09-01','retention-fixture',$4)`,
    [receipt, issuedInvoice, profile, `uploads/document/${receipt}.pdf`]
  );
  await pool.query(
    `INSERT INTO wallet_topup_callback_events(id,event_id,pending_transaction_id,wallet_id,status)
     VALUES($1,'retention-callback',$2,$3,'unpaid')`,
    [callback, walletEntry, profile]
  );
  await pool.query(
    "INSERT INTO wallet_chargeback_events(id,event_id,status) VALUES($1,'retention-chargeback','unmatched')",
    [chargeback]
  );

  const before = await history();
  const journal = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
  const target = '0292_financial_evidence_retention';
  expect(await runMigrationPrefix(target, { connection })).toEqual({ ok: true, applied: [target] });
  expect(await history()).toEqual(before);
  expect(
    (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
      0,
      journal.length
    )
  ).toEqual(journal);
  expect(await runMigrationPrefix(target, { connection })).toEqual({ ok: true, applied: [] });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  if (!management) return;
  try {
    await management.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await management.end();
  }
});

it.each([
  ['DELETE FROM wallet_transactions WHERE id=$1', walletEntry],
  ['DELETE FROM invoices WHERE id=$1', issuedInvoice],
  ['DELETE FROM bank_receipts WHERE id=$1', receipt],
  ['DELETE FROM bank_receipt_status_events WHERE receipt_id=$1', receipt],
  ["UPDATE bank_receipt_status_events SET state='Rejected' WHERE receipt_id=$1", receipt],
  ['DELETE FROM wallet_topup_callback_events WHERE id=$1', callback],
  ['DELETE FROM wallet_chargeback_events WHERE id=$1', chargeback],
])('retains stored financial evidence against %s', async (sql, id) => {
  const before = await history();
  await expect(pool.query(sql, [id])).rejects.toMatchObject({ code: '55000' });
  expect(await history()).toEqual(before);
});

it.each([
  'TRUNCATE wallet_transactions CASCADE',
  'TRUNCATE invoices CASCADE',
  'TRUNCATE bank_receipts CASCADE',
  'TRUNCATE bank_receipt_status_events',
  'TRUNCATE wallet_topup_callback_events',
  'TRUNCATE wallet_chargeback_events',
  'TRUNCATE refunds CASCADE',
  'TRUNCATE refund_transactions',
  'TRUNCATE refund_retry_jobs',
])('blocks destructive bulk retention changes through %s', async (sql) => {
  const before = await history();
  await expect(pool.query(sql)).rejects.toMatchObject({ code: '55000' });
  expect(await history()).toEqual(before);
});

it('continues to record normal state transitions and permits deleting an unissued draft', async () => {
  expect(
    (await pool.query("UPDATE wallet_transactions SET state='Failed' WHERE id=$1", [walletEntry]))
      .rowCount
  ).toBe(1);
  expect(
    (await pool.query("UPDATE bank_receipts SET state='UnderReview' WHERE id=$1", [receipt]))
      .rowCount
  ).toBe(1);
  expect(
    (
      await pool.query(
        'SELECT state FROM bank_receipt_status_events WHERE receipt_id=$1 ORDER BY occurred_at',
        [receipt]
      )
    ).rows
  ).toEqual([{ state: 'Submitted' }, { state: 'UnderReview' }]);
  expect((await pool.query('DELETE FROM invoices WHERE id=$1', [draftInvoice])).rowCount).toBe(1);
});
