import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { refundTransactions } from './index';
import { postWalletCredit } from './wallet-credit';

const database = `refund_intents_${randomUUID().replaceAll('-', '')}`;
let pool: Pool, management: Pool;
let legacy: Array<{ id: string; profile: string; amount: string }>;
async function request(destination = 'wallet', amount = '9007199254740993') {
  const user = randomUUID(),
    profile = randomUUID(),
    invoice = randomUUID();
  await pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,$1)', [user]);
  await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  await pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,'Paid',$3,$3)",
    [invoice, profile, amount]
  );
  const row = (
    await pool.query(
      'INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [invoice, profile, amount, destination, randomUUID()]
    )
  ).rows[0];
  return { id: row.id as string, profile, amount };
}
const state = (id: string, value: string) =>
  pool.query('UPDATE refunds SET state=$2 WHERE id=$1', [id, value]);
const intent = async (id: string) =>
  (
    await drizzle(pool).select().from(refundTransactions).where(eq(refundTransactions.refundId, id))
  )[0];

beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  const folder = mkdtempSync(join(tmpdir(), 'refund-pre-intent-'));
  try {
    const production = resolve(__dirname, '../drizzle/production');
    cpSync(production, folder, { recursive: true });
    const path = join(folder, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(path, 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 137);
    writeFileSync(path, JSON.stringify(journal));
    expect(
      (
        await runMigrations({
          connection: { pgdirectUrl: url.toString() },
          migrationsFolder: folder,
        })
      ).ok
    ).toBe(true);
    legacy = [];
    for (const value of ['Approved', 'Processing', 'Failed', 'Completed', 'Requested']) {
      const row = await request();
      legacy.push(row);
      if (value === 'Completed') await state(row.id, 'Processing');
      await state(row.id, value);
    }
    expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
    // Idempotent deployment rerun cannot duplicate financial intents.
    expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 60_000);
afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${database}"`);
    await management.end();
  }
});

it('upgrades unpaid legacy refunds without inventing historical credits or approvals', async () => {
  for (const row of legacy.slice(0, 3))
    expect(await intent(row.id)).toMatchObject({ state: 'Pending', walletTransactionId: null });
  for (const row of legacy.slice(3)) expect(await intent(row.id)).toBeUndefined();
  expect((await pool.query('SELECT count(*) FROM wallet_transactions')).rows[0].count).toBe('0');
  const config = getTableConfig(refundTransactions);
  expect(config.foreignKeys.map((key) => key.reference().foreignTable)).toHaveLength(2);
  expect(config.indexes).toHaveLength(2);
});

it.each(['wallet', 'external_bank'])(
  'creates one pending transaction on concurrent %s approval with no posted money',
  async (destination) => {
    const row = await request(destination);
    expect(await intent(row.id)).toBeUndefined();
    await Promise.all([state(row.id, 'Approved'), state(row.id, 'Approved')]);
    const first = await intent(row.id);
    expect(first).toMatchObject({ state: 'Pending', finishedAt: null, walletTransactionId: null });
    await state(row.id, 'Processing');
    await state(row.id, 'Failed');
    await state(row.id, 'Processing');
    expect(await intent(row.id)).toEqual(first);
    expect(
      (await pool.query('SELECT * FROM wallet_transactions WHERE wallet_id=$1', [row.profile])).rows
    ).toEqual([]);
  }
);

it.each(['Rejected', 'Cancelled'])(
  'closes approved %s intents without creating wallet credits',
  async (outcome) => {
    const row = await request();
    await state(row.id, 'Approved');
    const first = await intent(row.id);
    await state(row.id, outcome);
    expect(await intent(row.id)).toMatchObject({
      id: first!.id,
      state: outcome,
      walletTransactionId: null,
      finishedAt: expect.any(Date),
    });
    await expect(
      pool.query(
        "UPDATE refund_transactions SET state='Pending',finished_at=NULL WHERE refund_id=$1",
        [row.id]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM refund_transactions WHERE refund_id=$1', [row.id])
    ).rejects.toMatchObject({ code: '23514' });
    const unapproved = await request();
    await state(unapproved.id, outcome);
    expect(await intent(unapproved.id)).toBeUndefined();
  }
);

it('rejects premature or rewritten intent records and rolls back approval atomically', async () => {
  const row = await request();
  await expect(
    pool.query('INSERT INTO refund_transactions(refund_id) VALUES($1)', [row.id])
  ).rejects.toMatchObject({ code: '23514' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE refunds SET state='Approved' WHERE id=$1", [row.id]);
    expect(
      (await client.query('SELECT state FROM refund_transactions WHERE refund_id=$1', [row.id]))
        .rows
    ).toEqual([{ state: 'Pending' }]);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  expect(await intent(row.id)).toBeUndefined();
  await state(row.id, 'Approved');
  for (const assignment of [
    "state='Completed',finished_at=now()",
    "state='Rejected',finished_at=now()",
    'created_at=now()',
    'id=gen_random_uuid()',
  ])
    await expect(
      pool.query(`UPDATE refund_transactions SET ${assignment} WHERE refund_id=$1`, [row.id])
    ).rejects.toMatchObject({ code: '23514' });
});

it('requires the exact posted wallet credit and rolls back both completion and its link', async () => {
  const row = await request();
  await state(row.id, 'Approved');
  await state(row.id, 'Processing');
  const first = await intent(row.id);
  await expect(state(row.id, 'Completed')).rejects.toMatchObject({ code: '23514' });
  const client = await pool.connect();
  let posted: { id: string };
  for (const commit of [false, true]) {
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [row.profile]);
      await client.query('INSERT INTO wallets(profile_id) VALUES($1) ON CONFLICT DO NOTHING', [
        row.profile,
      ]);
      posted = (await postWalletCredit(
        client,
        { id: row.profile, archived: false },
        row.profile,
        BigInt(row.amount),
        { type: 'refund', refId: row.id },
        `refund-wallet-credit:${row.id}`
      )) as { id: string };
      await client.query("UPDATE refunds SET state='Completed' WHERE id=$1", [row.id]);
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      if (!commit) expect(await intent(row.id)).toEqual(first);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  client.release();
  expect(await intent(row.id)).toMatchObject({
    id: first!.id,
    state: 'Completed',
    walletTransactionId: posted!.id,
    finishedAt: expect.any(Date),
  });
  await state(row.id, 'Completed');
  for (const assignment of [
    'amount=1',
    "state='Pending'",
    "type='topup'",
    "ref_id='changed'",
    "idempotency_key='changed'",
  ])
    await expect(
      pool.query(`UPDATE wallet_transactions SET ${assignment} WHERE id=$1`, [posted!.id])
    ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query('DELETE FROM wallet_transactions WHERE id=$1', [posted!.id])
  ).rejects.toMatchObject({ code: '23514' });
});

it.each(['wallet', 'amount', 'type', 'reference', 'state', 'key'])(
  'rejects a posted credit with mismatched %s',
  async (field) => {
    const row = await request();
    await state(row.id, 'Approved');
    await state(row.id, 'Processing');
    const other = await request();
    const wallet = field === 'wallet' ? other.profile : row.profile;
    await pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [wallet]);
    await pool.query(
      'INSERT INTO wallet_transactions(wallet_id,amount,type,state,ref_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6)',
      [
        wallet,
        field === 'amount' ? '1' : row.amount,
        field === 'type' ? 'topup' : 'refund',
        field === 'state' ? 'Pending' : 'Completed',
        field === 'reference' ? other.id : row.id,
        field === 'key' ? randomUUID() : `refund-wallet-credit:${row.id}`,
      ]
    );
    await expect(state(row.id, 'Completed')).rejects.toMatchObject({ code: '23514' });
    expect(await intent(row.id)).toMatchObject({ state: 'Pending', walletTransactionId: null });
    expect(
      (
        await pool.query(
          'SELECT i.refunded_amount FROM invoices i JOIN refunds r ON r.invoice_id=i.id WHERE r.id=$1',
          [row.id]
        )
      ).rows
    ).toEqual([{ refunded_amount: '0' }]);
  }
);

it('completes bank transactions only after reconciliation, with no wallet link', async () => {
  const row = await request('external_bank');
  await state(row.id, 'Approved');
  const first = await intent(row.id);
  await expect(
    pool.query('UPDATE refund_transactions SET wallet_transaction_id=$2 WHERE refund_id=$1', [
      row.id,
      randomUUID(),
    ])
  ).rejects.toMatchObject({ code: '23514' });
  await state(row.id, 'Processing');
  await expect(state(row.id, 'Completed')).rejects.toMatchObject({ code: '23514' });
  await pool.query(
    "UPDATE refunds SET bank_reference=$2,reconciliation_status='Confirmed',state='Completed' WHERE id=$1",
    [row.id, randomUUID()]
  );
  expect(await intent(row.id)).toMatchObject({
    id: first!.id,
    state: 'Completed',
    walletTransactionId: null,
  });
});
