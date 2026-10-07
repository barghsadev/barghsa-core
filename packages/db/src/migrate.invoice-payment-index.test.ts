import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';

const tag = '0261_invoice_payment_lookup';
const folder = resolve(__dirname, '../drizzle/production');
let pool: Pool, management: Pool, scratch: string, connection: string;
const database = `test_invoice_index_${randomUUID().replaceAll('-', '')}`;
const profile = randomUUID(),
  invoice = randomUUID();
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  connection = url.toString();
  scratch = mkdtempSync(resolve(tmpdir(), 'barghsa-invoice-index-'));
  cpSync(folder, scratch, { recursive: true });
  const journal = JSON.parse(readFileSync(resolve(scratch, 'meta/_journal.json'), 'utf8'));
  expect(journal.entries.at(-1).tag).toBe(tag);
  journal.entries = journal.entries.slice(0, -1);
  writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));
  const base = await runMigrations({
    connection: { pgdirectUrl: connection },
    migrationsFolder: scratch,
  });
  expect(base).toMatchObject({ ok: true });
  pool = new Pool({ connectionString: connection });
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('index-owner','index-owner','fixture')"
  );
  await pool.query("INSERT INTO profiles(id,user_id) VALUES($1,'index-owner')", [profile]);
  await pool.query('INSERT INTO wallets(profile_id,posted_balance) VALUES($1,500)', [profile]);
  await pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,'PartiallyFunded',1000,500)",
    [invoice, profile]
  );
  await pool.query(
    "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key,ref_id) VALUES($1,'topup',1000,'Completed','index-credit',NULL),($1,'payment',-500,'Completed','index-payment',$2)",
    [profile, invoice.toUpperCase()]
  );
}, 60000);
afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE "${database}"`);
    await management.end();
  }
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});
async function financialRows() {
  return Object.fromEntries(
    await Promise.all(
      ['invoices', 'wallets', 'wallet_transactions'].map(async (table) => [
        table,
        (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      ])
    )
  );
}
it('upgrades the actual prior journal without changing financial rows, preserves uppercase legacy lookup and retries idempotently', async () => {
  expect(
    (
      await pool.query(
        "SELECT indexname FROM pg_indexes WHERE indexname='idx_wallet_tx_invoice_payment_ref'"
      )
    ).rows
  ).toEqual([]);
  const before = await financialRows();
  const upgraded = await runMigrations({ connection: { pgdirectUrl: connection } });
  expect(upgraded).toEqual({ ok: true, applied: [tag] });
  const indexes = (
    await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname='idx_wallet_tx_invoice_payment_ref'"
    )
  ).rows;
  expect(indexes).toHaveLength(1);
  expect(indexes[0].indexdef).toContain('lower(ref_id)');
  expect(indexes[0].indexdef).toContain('wallet_id');
  expect(indexes[0].indexdef).toContain("type = 'payment'");
  expect(indexes[0].indexdef).toContain("state = 'Completed'");
  expect(
    (
      await pool.query(
        "SELECT amount::text FROM wallet_transactions WHERE lower(ref_id)=$1 AND type='payment' AND state='Completed'",
        [invoice]
      )
    ).rows
  ).toEqual([{ amount: '-500' }]);
  expect(await financialRows()).toEqual(before);
  expect(await runMigrations({ connection: { pgdirectUrl: connection } })).toEqual({
    ok: true,
    applied: [],
  });
  expect(await financialRows()).toEqual(before);
});
it('uses the partial lookup index for a targeted invoice amid unrelated immutable payments', async () => {
  // Matching credit/debit pairs retain the zero net balance of the extra fixtures.
  await pool.query(
    `INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key,ref_id)
    SELECT $1::uuid,'topup',1,'Completed','noise-credit-'||n,NULL FROM generate_series(1,10000) n
    UNION ALL SELECT $1::uuid,'payment',-1,'Completed','noise-payment-'||n,'unrelated-'||n FROM generate_series(1,10000) n`,
    [profile]
  );
  await pool.query('ANALYZE wallet_transactions');
  const plan = await pool.query(
    "EXPLAIN (FORMAT JSON) SELECT amount FROM wallet_transactions WHERE lower(ref_id)=$1 AND type='payment' AND state='Completed'",
    [invoice]
  );
  expect(JSON.stringify(plan.rows)).toContain('idx_wallet_tx_invoice_payment_ref');
  expect(
    (
      await pool.query(
        "SELECT amount::text FROM wallet_transactions WHERE lower(ref_id)=$1 AND type='payment' AND state='Completed'",
        [invoice]
      )
    ).rows
  ).toEqual([{ amount: '-500' }]);
});
