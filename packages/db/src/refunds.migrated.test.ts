import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { refunds } from './schema/refunds';
import type { Pool, PoolClient } from 'pg';
import { postWalletCredit } from './wallet-credit';

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});

async function invoice(paid = '100', returned = '0') {
  const user = randomUUID();
  const profile = randomUUID();
  const id = randomUUID();
  await fixture.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,$1)', [
    user,
  ]);
  await fixture.pool.query('INSERT INTO profiles(id,user_id) VALUES ($1,$2)', [profile, user]);
  await fixture.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,refunded_amount) VALUES ($1,$2,'Paid',$3,$3,$4)",
    [id, profile, paid, returned]
  );
  return { user, profile, id };
}
type Invoice = Awaited<ReturnType<typeof invoice>>;
async function request(owner: Invoice, amount: string, destination = 'wallet') {
  return (
    await fixture.pool.query(
      'INSERT INTO refunds(invoice_id,profile_id,amount,destination,staff_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [owner.id, owner.profile, amount, destination, owner.user, randomUUID()]
    )
  ).rows[0] as { id: string; idempotency_key: string; amount: string; state: string };
}
async function credit(id: string, client: Pool | PoolClient) {
  const row = (await client.query('SELECT * FROM refunds WHERE id=$1', [id])).rows[0];
  await client.query('INSERT INTO wallets(profile_id) VALUES($1) ON CONFLICT DO NOTHING', [
    row.profile_id,
  ]);
  await postWalletCredit(
    client,
    { id: row.profile_id, archived: false },
    row.profile_id,
    BigInt(row.amount),
    { type: 'refund', refId: row.id },
    `refund-wallet-credit:${row.id}`
  );
}
async function setState(id: string, state: string) {
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query('SELECT state FROM refunds WHERE id=$1', [id])).rows[0];
    if (state === 'Completed' && row.state === 'Processing') await credit(id, client);
    const result = await client.query('UPDATE refunds SET state=$2 WHERE id=$1', [id, state]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

it('creates the schema through the production journal and preserves exact int8 amounts', async () => {
  const owner = await invoice('9007199254740993');
  const [row] = await fixture.db
    .insert(refunds)
    .values({
      invoiceId: owner.id,
      profileId: owner.profile,
      amount: 9007199254740993n,
      destination: 'wallet',
      idempotencyKey: randomUUID(),
    })
    .returning();
  expect(row).toMatchObject({ amount: 9007199254740993n, state: 'Requested', staffId: null });
  expect(row?.createdAt).toBeInstanceOf(Date);
  expect(row?.updatedAt).toBeInstanceOf(Date);
});

it('rejects invalid amounts, cross-profile ownership, missing staff, and duplicate keys', async () => {
  const owner = await invoice();
  const other = await invoice();
  for (const amount of ['0', '-1', '101']) await expect(request(owner, amount)).rejects.toThrow();
  await expect(request({ ...owner, profile: other.profile }, '1')).rejects.toThrow();
  await expect(request({ ...owner, user: randomUUID() }, '1')).rejects.toThrow();
  const row = await request(owner, '40');
  await expect(
    fixture.pool.query(
      "INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key) VALUES ($1,$2,1,'wallet',$3)",
      [owner.id, owner.profile, row.idempotency_key]
    )
  ).rejects.toThrow();
  await expect(
    fixture.pool.query(
      "INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key) VALUES ($1,$2,1,'wallet',' ')",
      [owner.id, owner.profile]
    )
  ).rejects.toThrow();
});

it('reserves failed requests and releases rejected/cancelled requests', async () => {
  const owner = await invoice();
  const first = await request(owner, '70');
  await setState(first.id, 'Processing');
  await setState(first.id, 'Failed');
  await expect(request(owner, '31')).rejects.toThrow();
  const other = await invoice();
  const cancelled = await request(other, '100');
  await setState(cancelled.id, 'Cancelled');
  const second = await request(other, '100');
  await setState(second.id, 'Rejected');
  await expect(request(other, '100')).resolves.toMatchObject({ amount: '100' });
});

it('counts legacy refunds and increments the invoice exactly once on completion', async () => {
  const owner = await invoice('100', '10');
  await expect(request(owner, '91')).rejects.toThrow();
  const row = await request(owner, '90');
  await expect(setState(row.id, 'Completed')).rejects.toThrow();
  await setState(row.id, 'Processing');
  await setState(row.id, 'Completed');
  await setState(row.id, 'Completed');
  expect(
    (await fixture.pool.query('SELECT refunded_amount FROM invoices WHERE id=$1', [owner.id])).rows
  ).toEqual([{ refunded_amount: '100' }]);
  await expect(request(owner, '1')).rejects.toThrow();
  await expect(setState(row.id, 'Requested')).rejects.toThrow();
  await expect(
    fixture.pool.query('UPDATE invoices SET refunded_amount=0 WHERE id=$1', [owner.id])
  ).rejects.toThrow();
});

it('completes multiple refunds per invoice in one statement without double counting retries', async () => {
  const owner = await invoice('100', '10');
  const other = await invoice('50');
  const first = await request(owner, '40');
  const second = await request(owner, '50');
  const third = await request(other, '30');
  const ids = [first.id, second.id, third.id];
  await fixture.pool.query("UPDATE refunds SET state='Processing' WHERE id=ANY($1::uuid[])", [ids]);
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const id of ids) await credit(id, fixture.pool);
    await fixture.pool.query("UPDATE refunds SET state='Completed' WHERE id=ANY($1::uuid[])", [
      ids,
    ]);
    const counters = await fixture.pool.query(
      'SELECT id, refunded_amount FROM invoices WHERE id=ANY($1::uuid[])',
      [[owner.id, other.id]]
    );
    expect(counters.rows).toEqual(
      expect.arrayContaining([
        { id: owner.id, refunded_amount: '100' },
        { id: other.id, refunded_amount: '30' },
      ])
    );
  }
  expect(
    (await fixture.pool.query('SELECT state FROM refunds WHERE id=ANY($1::uuid[])', [ids])).rows
  ).toEqual([{ state: 'Completed' }, { state: 'Completed' }, { state: 'Completed' }]);
  await expect(request(owner, '1')).rejects.toThrow();
  await expect(request(other, '20')).resolves.toMatchObject({ amount: '20' });
});

it('protects reservations against invoice edits and rolls back completion with its transaction', async () => {
  const owner = await invoice();
  const row = await request(owner, '70');
  await expect(
    fixture.pool.query('UPDATE invoices SET paid_amount=60 WHERE id=$1', [owner.id])
  ).rejects.toThrow();
  await expect(
    fixture.pool.query('UPDATE invoices SET refunded_amount=40 WHERE id=$1', [owner.id])
  ).rejects.toThrow();
  await setState(row.id, 'Processing');
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    await credit(row.id, client);
    await client.query("UPDATE refunds SET state='Completed' WHERE id=$1", [row.id]);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  expect(
    (await fixture.pool.query('SELECT refunded_amount FROM invoices WHERE id=$1', [owner.id])).rows
  ).toEqual([{ refunded_amount: '0' }]);
  expect(
    (await fixture.pool.query('SELECT state FROM refunds WHERE id=$1', [row.id])).rows
  ).toEqual([{ state: 'Processing' }]);
});

it('serializes competing requests without over-reserving the invoice', async () => {
  const owner = await invoice();
  const outcomes = await Promise.allSettled([request(owner, '70'), request(owner, '70')]);
  expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(
    (
      await fixture.pool.query(
        'SELECT SUM(amount)::text AS amount FROM refunds WHERE invoice_id=$1',
        [owner.id]
      )
    ).rows
  ).toEqual([{ amount: '70' }]);
});

it('retains immutable request identity and terminal history', async () => {
  const owner = await invoice();
  const row = await request(owner, '20');
  for (const change of [
    'amount=10',
    "idempotency_key='changed'",
    "destination='external_bank'",
    'staff_id=NULL',
  ]) {
    await expect(
      fixture.pool.query(`UPDATE refunds SET ${change} WHERE id=$1`, [row.id])
    ).rejects.toThrow();
  }
  await expect(fixture.pool.query('DELETE FROM refunds WHERE id=$1', [row.id])).rejects.toThrow();
  await setState(row.id, 'Cancelled');
  await expect(setState(row.id, 'Requested')).rejects.toThrow();
});

it('rejects a stale repeatable-read reservation instead of spending the same balance twice', async () => {
  const owner = await invoice();
  const first = await fixture.pool.connect();
  const second = await fixture.pool.connect();
  try {
    for (const client of [first, second]) {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SELECT paid_amount FROM invoices WHERE id=$1', [owner.id]);
    }
    const query =
      "INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key) VALUES ($1,$2,70,'wallet',$3)";
    await first.query(query, [owner.id, owner.profile, randomUUID()]);
    const competing = second
      .query(query, [owner.id, owner.profile, randomUUID()])
      .catch((error: unknown) => error);
    await first.query('COMMIT');
    expect(await competing).toMatchObject({ code: '40001' });
    await second.query('ROLLBACK');
    expect(
      (
        await fixture.pool.query(
          'SELECT SUM(amount)::text AS amount FROM refunds WHERE invoice_id=$1',
          [owner.id]
        )
      ).rows
    ).toEqual([{ amount: '70' }]);
  } finally {
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
    first.release();
    second.release();
  }
});

it('requires reconciliation and a bank reference before an external refund can complete', async () => {
  const owner = await invoice();
  const row = await request(owner, '50', 'external_bank');
  await setState(row.id, 'Processing');
  await expect(setState(row.id, 'Completed')).rejects.toThrow();
  await expect(
    fixture.pool.query("UPDATE refunds SET reconciliation_status='Confirmed' WHERE id=$1", [row.id])
  ).rejects.toThrow();
  await fixture.pool.query("UPDATE refunds SET bank_reference='BANK-1' WHERE id=$1", [row.id]);
  await expect(setState(row.id, 'Completed')).rejects.toThrow();
  await fixture.pool.query("UPDATE refunds SET reconciliation_status='Confirmed' WHERE id=$1", [
    row.id,
  ]);
  await setState(row.id, 'Completed');
  await expect(
    fixture.pool.query("UPDATE refunds SET bank_reference='BANK-2' WHERE id=$1", [row.id])
  ).rejects.toThrow();
  const wallet = await request(owner, '10');
  await expect(
    fixture.pool.query("UPDATE refunds SET bank_reference='BANK-3' WHERE id=$1", [wallet.id])
  ).rejects.toThrow();
});
