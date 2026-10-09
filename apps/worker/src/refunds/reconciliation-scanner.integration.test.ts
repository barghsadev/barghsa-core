import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { postWalletCredit } from '../../../../packages/db/src/wallet-credit';
import { runMigrations } from '../../../../packages/db/src/migrate';
import {
  reconcileRefunds,
  FIND_REFUND_RECONCILIATION_CANDIDATES_SQL,
} from './reconciliation-scanner';

let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeEach(async () => {
  db = await createMigratedTestDb();
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('refund-report-owner','refund-report-owner','fixture')"
  );
}, 60000);
afterEach(async () => {
  await db?.close();
});
async function owner(paid = '100', returned = '0', kind: string | null = null) {
  const profile = randomUUID(),
    invoice = randomUUID();
  await db.pool.query("INSERT INTO profiles(id,user_id) VALUES($1,'refund-report-owner')", [
    profile,
  ]);
  await db.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [profile]);
  const parent = kind ? randomUUID() : null;
  if (parent)
    await db.pool.query(
      "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,'Paid',$3,$3)",
      [parent, profile, paid]
    );
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,refunded_amount,adjustment_kind,adjustment_for_invoice_id) VALUES($1,$2,'Paid',$3,$3,$4,$5,$6)",
    [invoice, profile, paid, returned, kind, parent]
  );
  return { profile, invoice };
}
async function request(
  o: Awaited<ReturnType<typeof owner>>,
  amount = '40',
  destination = 'wallet'
) {
  const id = randomUUID();
  await db.pool.query(
    'INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,$4,$5,$1::uuid::text)',
    [id, o.invoice, o.profile, amount, destination]
  );
  return id;
}
async function move(id: string, state: string) {
  await db.pool.query('UPDATE refunds SET state=$2 WHERE id=$1', [id, state]);
}
async function complete(id: string, metadata?: Record<string, unknown>) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = (await client.query('SELECT * FROM refunds WHERE id=$1', [id])).rows[0];
    await client.query("UPDATE refunds SET state='Processing' WHERE id=$1", [id]);
    if (r.destination === 'wallet')
      await postWalletCredit(
        client,
        { id: r.profile_id, archived: false },
        r.profile_id,
        BigInt(r.amount),
        {
          type: 'refund',
          refId: id,
          metadata: metadata ?? { refundId: id, invoiceId: r.invoice_id },
        },
        `refund-wallet-credit:${id}`
      );
    else
      await client.query(
        "UPDATE refunds SET bank_reference='PRIVATE-BANK-REFERENCE',reconciliation_status='Confirmed' WHERE id=$1",
        [id]
      );
    await client.query("UPDATE refunds SET state='Completed' WHERE id=$1", [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
/** Simulate damaged/imported data in this isolated fixture only. Restore all
 * production triggers before the scanner runs; no constraints are weakened. */
async function corrupt(sql: string, params: unknown[] = []) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role=replica');
    await client.query(sql, params);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function rows() {
  return (
    await db.pool.query('SELECT details,severity,status FROM reconciliation_exceptions ORDER BY id')
  ).rows;
}
async function snapshot() {
  return Object.fromEntries(
    await Promise.all(
      ['invoices', 'refunds', 'refund_transactions', 'wallets', 'wallet_transactions'].map(
        async (table) => [table, (await db.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows]
      )
    )
  );
}
function scan(batchSize = 200) {
  return reconcileRefunds({ pool: db.pool, batchSize });
}
async function orphan(profile: string, key = `refund-wallet-credit:${randomUUID()}`) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await postWalletCredit(
      client,
      { id: profile, archived: false },
      profile,
      11n,
      { type: 'refund', refId: randomUUID(), metadata: { privateData: 'DO-NOT-COPY' } },
      key
    );
    await client.query('COMMIT');
    const row = (
      await client.query<{ id: string }>(
        'SELECT id FROM wallet_transactions WHERE idempotency_key=$1',
        [key]
      )
    ).rows[0];
    if (!row) throw new Error('Fixture credit was not posted');
    return row.id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

it('accepts partial/full wallet refunds, external reconciliation and legitimate legacy counter residuals without changing money', async () => {
  const a = await owner(),
    b = await owner('9007199254740993', '10'),
    c = await owner();
  await complete(await request(a), {});
  await complete(await request(a, '60'));
  await complete(await request(b, '9007199254740983'));
  await complete(await request(c, '100', 'external_bank'));
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 0, errors: [] });
  expect(await snapshot()).toEqual(before);
});
it('keeps failed reservations, releases rejected/cancelled requests and accepts approval-time pending intents', async () => {
  const o = await owner('100', '10'),
    failed = await request(o, '40'),
    approved = await request(o, '10'),
    cancelled = await request(o, '10'),
    rejected = await request(o, '10');
  await move(failed, 'Processing');
  await move(failed, 'Failed');
  await move(approved, 'Approved');
  await move(cancelled, 'Cancelled');
  await move(rejected, 'Approved');
  await move(rejected, 'Rejected');
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 0, errors: [] });
  expect(await snapshot()).toEqual(before);
});
it('reports completed refunds above their cumulative counter with exact values, preserving all financial rows', async () => {
  const o = await owner('9007199254740993'),
    r = await request(o, '9007199254740993');
  await complete(r);
  await corrupt('UPDATE invoices SET refunded_amount=9007199254740992 WHERE id=$1', [o.invoice]);
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  expect((await rows())[0]).toMatchObject({
    severity: 'high',
    status: 'open',
    details: {
      completedRefunds: '9007199254740993',
      refundedAmount: '9007199254740992',
      completedExceedsCounter: true,
    },
  });
  expect(await snapshot()).toEqual(before);
});
it('sums outstanding reservations beyond int8 exactly and excludes completed/rejected/cancelled amounts', async () => {
  const o = await owner('9223372036854775807');
  await request(o, '9223372036854775807');
  await corrupt(
    "INSERT INTO refunds(invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,9223372036854775807,'wallet',$3)",
    [o.invoice, o.profile, randomUUID()]
  );
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  expect((await rows())[0].details).toMatchObject({
    outstandingReservations: '18446744073709551614',
    reservationsExceeded: true,
  });
  expect(await snapshot()).toEqual(before);
});
it.each(['Approved', 'Processing', 'Failed'])(
  'reports a missing modern %s intent even without an accounting delta',
  async (state) => {
    const o = await owner(),
      r = await request(o);
    await move(r, state);
    await corrupt('DELETE FROM refund_transactions WHERE refund_id=$1', [r]);
    const before = await snapshot();
    expect(await scan()).toMatchObject({ reported: 1, errors: [] });
    expect((await rows())[0].details).toMatchObject({
      invalidRefundCount: '1',
      invalidRefundIds: [r],
      completedExceedsCounter: false,
      reservationsExceeded: false,
    });
    expect(await snapshot()).toEqual(before);
  }
);
it.each(['amount', 'wallet', 'state', 'reference', 'refund-metadata', 'invoice-metadata'] as const)(
  'reports %s credit provenance drift without exposing metadata',
  async (mismatch) => {
    const o = await owner(),
      other = await owner(),
      r = await request(o);
    await complete(r, { refundId: r, invoiceId: o.invoice, privateData: 'DO-NOT-COPY' });
    const fields = {
      amount: ['amount=$2', '41'],
      wallet: ['wallet_id=$2', other.profile],
      state: ['state=$2', 'Pending'],
      reference: ['ref_id=$2', randomUUID()],
      'refund-metadata': ["metadata=jsonb_set(metadata,'{refundId}',$2::jsonb)", 'null'],
      'invoice-metadata': [
        "metadata=jsonb_set(metadata,'{invoiceId}',$2::jsonb)",
        JSON.stringify(randomUUID()),
      ],
    }[mismatch];
    await corrupt(`UPDATE wallet_transactions SET ${fields[0]} WHERE idempotency_key=$1`, [
      `refund-wallet-credit:${r}`,
      fields[1],
    ]);
    const before = await snapshot();
    expect(await scan()).toMatchObject({ reported: 1, errors: [] });
    expect((await rows())[0].details.invalidRefundIds).toEqual([r]);
    expect(JSON.stringify(await rows())).not.toContain('DO-NOT-COPY');
    expect(await snapshot()).toEqual(before);
  }
);
it('reports a completed modern intent that lost its credit identity, while accepting uppercase UUID references and missing legacy metadata', async () => {
  const o = await owner(),
    r = await request(o);
  await complete(r, {});
  await corrupt('UPDATE wallet_transactions SET ref_id=upper(ref_id) WHERE idempotency_key=$1', [
    `refund-wallet-credit:${r}`,
  ]);
  expect(await scan()).toMatchObject({ reported: 0, errors: [] });
  await corrupt('UPDATE refund_transactions SET wallet_transaction_id=NULL WHERE refund_id=$1', [
    r,
  ]);
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  expect((await rows())[0].details.invalidRefundCount).toBe('1');
});
it('keeps issued credit notes and independently keyed credits outside the regular refund namespace', async () => {
  const o = await owner(),
    credit = randomUUID();
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,adjustment_kind,adjustment_for_invoice_id) VALUES($1,$2,'Unpaid',50,0,'credit',$3)",
    [credit, o.profile, o.invoice]
  );
  await orphan(o.profile, `fixture-independent-credit:${randomUUID()}`);
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 0, errors: [] });
  expect(await snapshot()).toEqual(before);
});
it('reports a regular refund illegally attached to a credit note instead of treating note value as paid capacity', async () => {
  const o = await owner(),
    credit = randomUUID(),
    refund = randomUUID();
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,adjustment_kind,adjustment_for_invoice_id) VALUES($1,$2,'Unpaid',50,0,'credit',$3)",
    [credit, o.profile, o.invoice]
  );
  await corrupt(
    "INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,40,'wallet',$1::uuid::text)",
    [refund, credit, o.profile]
  );
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  expect((await rows())[0].details).toMatchObject({
    invoiceId: credit,
    refundInvoiceKind: 'credit',
    paidCapacityApplicable: true,
    paidAmount: '0',
    outstandingReservations: '40',
    reservationsExceeded: true,
    invalidRefundIds: [refund],
  });
  expect(await snapshot()).toEqual(before);
});
it('reports canonical orphan credits, keeps identifiers/amounts exact and omits their raw keys and private metadata', async () => {
  const o = await owner(),
    id = await orphan(o.profile);
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  const report = (await rows())[0].details;
  expect(report).toMatchObject({
    source: 'refund_credit',
    transactionId: id,
    walletId: o.profile,
    amount: '11',
  });
  expect(report.idempotencyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(report)).not.toContain('refund-wallet-credit:');
  expect(JSON.stringify(report)).not.toContain('DO-NOT-COPY');
  expect(await snapshot()).toEqual(before);
});
it('limits the whole pass, deduplicates active reports and reports persistent drift after resolution', async () => {
  const o = await owner(),
    r = await request(o);
  await complete(r);
  await corrupt('UPDATE invoices SET refunded_amount=39 WHERE id=$1', [o.invoice]);
  await orphan(o.profile);
  expect(await scan(1)).toMatchObject({ scanned: 1, reported: 1, truncated: true, errors: [] });
  expect(await scan(1)).toMatchObject({ scanned: 1, reported: 1, errors: [] });
  expect(await scan()).toMatchObject({ scanned: 0, reported: 0, errors: [] });
  await db.pool.query(
    "UPDATE reconciliation_exceptions SET status='resolved',resolution_note='investigated' WHERE details->>'source'='refund_accounting'"
  );
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
});
it('skips busy settlement invoices and concurrent workers report each incident once', async () => {
  const o = await owner(),
    r = await request(o);
  await complete(r);
  await corrupt('UPDATE invoices SET refunded_amount=39 WHERE id=$1', [o.invoice]);
  const blocker = await db.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [o.invoice]);
    expect(await scan()).toMatchObject({ reported: 0, skipped: 1, errors: [] });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  const runs = await Promise.all([scan(), scan()]);
  expect(runs.flatMap((r) => r.errors)).toEqual([]);
  expect(runs.reduce((n, r) => n + r.reported, 0)).toBe(1);
  expect(await rows()).toHaveLength(1);
});
it('rechecks a corrected counter after selection instead of creating a stale exception', async () => {
  const o = await owner(),
    r = await request(o);
  await complete(r);
  await corrupt('UPDATE invoices SET refunded_amount=39 WHERE id=$1', [o.invoice]);
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      const selected = await db.pool.query(sql, params);
      if (sql === FIND_REFUND_RECONCILIATION_CANDIDATES_SQL)
        await db.pool.query('UPDATE invoices SET refunded_amount=40 WHERE id=$1', [o.invoice]);
      return selected;
    },
    connect: () => db.pool.connect(),
  } as unknown as Pool;
  expect(await reconcileRefunds({ pool })).toMatchObject({
    scanned: 1,
    reported: 0,
    skipped: 1,
    errors: [],
  });
  expect(await rows()).toHaveLength(0);
});
it('rolls back one report failure, continues the orphan cohort and retries without financial mutation', async () => {
  const o = await owner(),
    r = await request(o);
  await complete(r);
  await corrupt('UPDATE invoices SET refunded_amount=39 WHERE id=$1', [o.invoice]);
  await orphan(o.profile);
  await db.pool.query(
    "CREATE FUNCTION fail_refund_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details->>'source'='refund_accounting' THEN RAISE EXCEPTION 'fixture refund report failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER fail_refund_report BEFORE INSERT ON reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION fail_refund_report()"
  );
  try {
    const before = await snapshot(),
      result = await scan();
    expect(result.reported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect((await rows())[0].details.source).toBe('refund_credit');
    expect(await snapshot()).toEqual(before);
  } finally {
    await db.pool.query(
      'DROP TRIGGER fail_refund_report ON reconciliation_exceptions;DROP FUNCTION fail_refund_report()'
    );
  }
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
});
it('bounds invalid refund identifiers while retaining the exact mismatch count and all financial history', async () => {
  const o = await owner();
  for (let n = 0; n < 25; n++)
    await complete(await request(o, '1'), { refundId: null, privateData: 'DO-NOT-COPY' });
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  const detail = (await rows())[0].details;
  expect(detail.invalidRefundCount).toBe('25');
  expect(detail.invalidRefundIds).toHaveLength(20);
  expect(detail.invalidRefundIdsTruncated).toBe(true);
  expect(JSON.stringify(detail)).not.toContain('DO-NOT-COPY');
  expect(await snapshot()).toEqual(before);
});
it('detects a refund parent belonging to another profile even when the credit matches that corrupted parent', async () => {
  const o = await owner(),
    other = await owner(),
    r = await request(o);
  await complete(r);
  await corrupt('UPDATE refunds SET profile_id=$2 WHERE id=$1', [r, other.profile]);
  await corrupt('UPDATE wallet_transactions SET wallet_id=$2 WHERE idempotency_key=$1', [
    `refund-wallet-credit:${r}`,
    other.profile,
  ]);
  const before = await snapshot();
  expect(await scan()).toMatchObject({ reported: 1, errors: [] });
  expect((await rows())[0].details.invalidRefundIds).toEqual([r]);
  expect(await snapshot()).toEqual(before);
  await expect(db.pool.query('UPDATE refunds SET amount=41 WHERE id=$1', [r])).rejects.toThrow();
});

it('preserves genuinely upgraded pre-intent completed refunds and their legacy counter residual', async () => {
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = `refund_legacy_${randomUUID().replaceAll('-', '')}`,
    folder = mkdtempSync(join(tmpdir(), 'refund-report-legacy-'));
  let pool: Pool | undefined,
    created = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    pool = new Pool({ connectionString: url.toString() });
    const production = resolve('../../packages/db/drizzle/production');
    cpSync(production, folder, { recursive: true });
    const journalPath = join(folder, 'meta/_journal.json'),
      journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 137);
    writeFileSync(journalPath, JSON.stringify(journal));
    expect(
      (
        await runMigrations({
          connection: { pgdirectUrl: url.toString() },
          migrationsFolder: folder,
        })
      ).ok
    ).toBe(true);
    const profile = randomUUID(),
      invoice = randomUUID(),
      refund = randomUUID();
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES('legacy-refund-owner','legacy-refund-owner','fixture')"
    );
    await pool.query("INSERT INTO profiles(id,user_id) VALUES($1,'legacy-refund-owner')", [
      profile,
    ]);
    await pool.query(
      "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,refunded_amount) VALUES($1,$2,'Paid',100,100,10)",
      [invoice, profile]
    );
    await pool.query(
      "INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key) VALUES($1,$2,$3,90,'wallet',$1::uuid::text)",
      [refund, invoice, profile]
    );
    await pool.query("UPDATE refunds SET state='Processing' WHERE id=$1", [refund]);
    await pool.query("UPDATE refunds SET state='Completed' WHERE id=$1", [refund]);
    expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
    expect(
      (await pool.query('SELECT * FROM refund_transactions WHERE refund_id=$1', [refund])).rows
    ).toEqual([]);
    const before = (await pool.query('SELECT * FROM refunds WHERE id=$1', [refund])).rows;
    expect(await reconcileRefunds({ pool })).toMatchObject({ reported: 0, errors: [] });
    expect(
      (await pool.query('SELECT refunded_amount FROM invoices WHERE id=$1', [invoice])).rows
    ).toEqual([{ refunded_amount: '100' }]);
    expect((await pool.query('SELECT * FROM refunds WHERE id=$1', [refund])).rows).toEqual(before);
  } finally {
    await pool?.end();
    if (created) await management.query(`DROP DATABASE "${name}"`);
    await management.end();
    rmSync(folder, { recursive: true, force: true });
  }
}, 60000);
