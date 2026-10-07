import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { reconcileInvoicePayments } from './reconciliation-scanner.js';

let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
const owner = 'invoice-reconciliation-owner';
const actor = 'invoice-reconciliation-staff';
beforeAll(async () => {
  db = await createMigratedTestDb();
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture'),($2,$2,'fixture')",
    [owner, actor]
  );
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  // Fixture reset only; the scanner must retain every financial row below.
  await db.pool.query(
    'TRUNCATE reconciliation_exceptions, invoices, wallets, wallet_transactions, bank_receipts, profiles CASCADE'
  );
});

async function profile() {
  const id = randomUUID();
  await db.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [id, owner]);
  await db.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [id]);
  return id;
}
async function invoice(profileId: string, paid = '0', total = '9007199254741999') {
  const id = randomUUID();
  await db.pool.query(
    'INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,$3,$4,$5)',
    [
      id,
      profileId,
      BigInt(paid) === 0n ? 'Unpaid' : BigInt(paid) === BigInt(total) ? 'Paid' : 'PartiallyFunded',
      total,
      paid,
    ]
  );
  return id;
}
async function receipt(
  invoiceId: string,
  profileId: string,
  amount: string,
  excess?: string,
  metadata?: Record<string, unknown>,
  uppercaseReferences = false
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO bank_receipts(id,invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key,state,confirmed_by,confirmed_at) VALUES($1,$2,$3,$4,'2026-09-01','bank-reference',$5,'Confirmed',$6,NOW())",
    [id, invoiceId, profileId, amount, `uploads/${id}.pdf`, actor]
  );
  if (excess) {
    await db.pool.query(
      "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key,ref_id,metadata) VALUES($1,'topup',$2,'Completed',$3,$4,$5::jsonb)",
      [
        profileId,
        excess,
        `invoice-bank-receipt-overpayment-credit:${id}`,
        uppercaseReferences ? id.toUpperCase() : id,
        JSON.stringify(
          metadata ?? {
            channel: 'invoice_bank_receipt',
            purpose: 'overpayment',
            receiptId: id,
            invoiceId,
            invoiceAllocation: (BigInt(amount) - BigInt(excess)).toString(),
            walletCreditAmount: excess,
          }
        ),
      ]
    );
    await db.pool.query(
      'UPDATE wallets SET posted_balance=posted_balance+$2::bigint WHERE profile_id=$1',
      [profileId, excess]
    );
  }
  return id;
}
async function payment(invoiceId: string, profileId: string, amount: string, state = 'Completed') {
  const id = randomUUID();
  if (state === 'Completed')
    await db.pool.query(
      "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key) VALUES($1,'topup',$2,'Completed',$3)",
      [profileId, amount, `fixture-funding:${id}`]
    );
  await db.pool.query(
    "INSERT INTO wallet_transactions(id,wallet_id,type,amount,state,idempotency_key,ref_id) VALUES($1::uuid,$2,'payment',$3,$4,$1::uuid::text,$5)",
    [id, profileId, `-${amount}`, state, invoiceId]
  );
  return id;
}
async function financialSnapshot() {
  return Object.fromEntries(
    await Promise.all(
      ['invoices', 'wallets', 'wallet_transactions', 'bank_receipts'].map(async (table) => [
        table,
        (await db.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
      ])
    )
  );
}
async function rows() {
  return (
    await db.pool.query(
      'SELECT exception_type,severity,status,details FROM reconciliation_exceptions ORDER BY id'
    )
  ).rows;
}

it('reports missing invoice funding without changing any financial record', async () => {
  const p = await profile();
  const i = await invoice(p, '9007199254740993');
  const before = await financialSnapshot();
  const result = await reconcileInvoicePayments({ pool: db.pool });
  expect(result.errors).toEqual([]);
  expect(result.reported).toBe(1);
  expect(await rows()).toEqual([
    {
      exception_type: 'payment_mismatch',
      severity: 'high',
      status: 'open',
      details: expect.objectContaining({
        source: 'invoice_payments',
        invoiceId: i,
        walletId: p,
        paidAmount: '9007199254740993',
        recordedFunding: '0',
        delta: '9007199254740993',
      }),
    },
  ]);
  expect(await financialSnapshot()).toEqual(before);
});

it('counts applied receipt allocation, not a face amount that includes a wallet excess', async () => {
  const p = await profile();
  const i = await invoice(p, '500');
  await receipt(i, p, '1000', '500');
  const before = await financialSnapshot();
  expect((await reconcileInvoicePayments({ pool: db.pool })).reported).toBe(0);
  expect(await rows()).toEqual([]);
  expect(await financialSnapshot()).toEqual(before);
});
it('retains legacy excess credit identities without requiring newer optional metadata', async () => {
  const p = await profile();
  const i = await invoice(p, '500');
  await receipt(i, p, '1000', '500', {});
  expect((await reconcileInvoicePayments({ pool: db.pool })).reported).toBe(0);
});
it('compares legacy UUID case and zero-padded integer metadata by value', async () => {
  const p = await profile();
  const i = await invoice(p, '500');
  await receipt(
    i,
    p,
    '1000',
    '500',
    { invoiceId: i.toUpperCase(), invoiceAllocation: '000500', walletCreditAmount: '000500' },
    true
  );
  expect((await reconcileInvoicePayments({ pool: db.pool })).reported).toBe(0);
});
it.each([
  ['null', null],
  ['empty', ''],
  ['invalid', 'not-money'],
  ['oversized', '1'.repeat(150000)],
] as const)(
  'reports malformed excess metadata without an unsafe numeric cast (%s)',
  async (_label, value) => {
    const p = await profile();
    const i = await invoice(p, '500');
    await receipt(i, p, '1000', '500', { invoiceAllocation: value });
    const result = await reconcileInvoicePayments({ pool: db.pool });
    expect(result.errors).toEqual([]);
    expect(result.reported).toBe(1);
    expect((await rows())[0].details.invalidReceiptCredits).toBe('1');
  }
);
it('flags inconsistent excess-credit provenance without copying private metadata into the queue', async () => {
  const p = await profile();
  const i = await invoice(p, '500');
  await receipt(i, p, '1000', '500', {
    invoiceAllocation: '501',
    providerSecret: 'private-fixture-value',
  });
  expect((await reconcileInvoicePayments({ pool: db.pool })).reported).toBe(1);
  const exceptions = await rows();
  expect(exceptions[0].details).toMatchObject({
    paidAmount: '500',
    recordedFunding: '500',
    delta: '0',
    invalidReceiptCredits: '1',
  });
  expect(JSON.stringify(exceptions)).not.toContain('private-fixture-value');
});

it('combines exact receipt and wallet funds, ignoring pending payments and another invoice', async () => {
  const p = await profile();
  const i = await invoice(p, '9007199254740993');
  await receipt(i, p, '1000');
  await payment(i.toUpperCase(), p, '9007199254739993');
  await payment(i, p, '20', 'Pending');
  const other = await invoice(p, '5');
  await payment(other, p, '5');
  expect((await reconcileInvoicePayments({ pool: db.pool })).reported).toBe(0);
  expect(await rows()).toEqual([]);
});

it('flags a cross-profile payment even when the correct profile already paid the exact invoice amount', async () => {
  const p = await profile();
  const other = await profile();
  const i = await invoice(p, '100');
  await payment(i, p, '100');
  await payment(i, other, '100');
  expect((await reconcileInvoicePayments({ pool: db.pool })).reported).toBe(1);
  expect((await rows())[0].details).toMatchObject({
    invoiceId: i,
    paidAmount: '100',
    recordedFunding: '100',
    delta: '0',
    invalidWalletPayments: '1',
  });
});

it('retains unbounded numeric sums when recorded wallet payments exceed int8', async () => {
  const p = await profile();
  const i = await invoice(p, '100');
  await payment(i, p, '9223372036854775807');
  await payment(i, p, '9223372036854775807');
  const result = await reconcileInvoicePayments({ pool: db.pool });
  expect(result.errors).toEqual([]);
  expect(result.reported).toBe(1);
  expect((await rows())[0].details).toMatchObject({
    invoiceId: i,
    recordedFunding: '18446744073709551614',
    delta: '-18446744073709551514',
  });
});

it('deduplicates active incidents, drains a bounded batch and reports new drift after resolution', async () => {
  const p = await profile();
  const first = await invoice(p, '100');
  const second = await invoice(p, '200');
  const one = await reconcileInvoicePayments({ pool: db.pool, batchSize: 1 });
  expect(one).toMatchObject({ reported: 1, truncated: true });
  expect((await reconcileInvoicePayments({ pool: db.pool, batchSize: 1 })).reported).toBe(1);
  expect((await reconcileInvoicePayments({ pool: db.pool, batchSize: 1 })).reported).toBe(0);
  expect(new Set((await rows()).map((row) => row.details.invoiceId))).toEqual(
    new Set([first, second])
  );
  await db.pool.query(
    "UPDATE reconciliation_exceptions SET status='resolved',resolution_note='Investigated' WHERE details->>'invoiceId'=$1",
    [first]
  );
  expect((await reconcileInvoicePayments({ pool: db.pool })).reported).toBe(1);
});

it('skips invoice locks held by finance operations and serializes simultaneous scanner instances', async () => {
  const p = await profile();
  const i = await invoice(p, '100');
  const lock = await db.pool.connect();
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [i]);
    const result = await reconcileInvoicePayments({ pool: db.pool });
    expect(result).toMatchObject({ reported: 0, skipped: 1, errors: [] });
    expect(await rows()).toEqual([]);
    await lock.query('COMMIT');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  const result = await Promise.all([
    reconcileInvoicePayments({ pool: db.pool }),
    reconcileInvoicePayments({ pool: db.pool }),
  ]);
  expect(result.flatMap((x) => x.errors)).toEqual([]);
  expect(result.reduce((sum, x) => sum + x.reported, 0)).toBe(1);
  expect(await rows()).toHaveLength(1);
});
