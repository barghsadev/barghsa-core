import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIsolatedTestDb, dropTestSchema, type IsolatedTestDb } from './test/testDb.js';

const migration = readFileSync(
  resolve(__dirname, '../drizzle/production/0190_bank_receipt_status_events.sql'),
  'utf8'
);

describe('bank receipt status history migration', () => {
  let ctx: IsolatedTestDb;
  const oldReceipt = randomUUID();

  beforeAll(async () => {
    ctx = await createIsolatedTestDb();
    await ctx.pool.query(
      readFileSync(resolve(__dirname, '../drizzle/0000_init_uuidv7_function.sql'), 'utf8')
    );
    await ctx.pool.query(`
      CREATE TABLE bank_receipts (
        id uuid PRIMARY KEY,
        state text NOT NULL DEFAULT 'Submitted',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        confirmed_at timestamptz
      )
    `);
    await ctx.pool.query(
      `INSERT INTO bank_receipts(id,state,created_at,updated_at)
       VALUES ($1,'Rejected','2026-09-01T10:00:00Z','2026-09-03T12:00:00Z')`,
      [oldReceipt]
    );
    await ctx.pool.query(migration);
  });

  afterAll(async () => {
    await ctx?.pool.end();
    if (ctx) await dropTestSchema(ctx.schemaName);
  });

  it('preserves the known endpoints of an older receipt and marks their times as recovered', async () => {
    const result = await ctx.pool.query<{
      state: string;
      occurred_at: Date;
      backfilled: boolean;
    }>(
      `SELECT state,occurred_at,backfilled FROM bank_receipt_status_events
        WHERE receipt_id=$1 ORDER BY occurred_at,id`,
      [oldReceipt]
    );
    expect(result.rows.map((row) => row.state)).toEqual(['Submitted', 'Rejected']);
    expect(result.rows.map((row) => row.occurred_at.toISOString())).toEqual([
      '2026-09-01T10:00:00.000Z',
      '2026-09-03T12:00:00.000Z',
    ]);
    expect(result.rows.every((row) => row.backfilled)).toBe(true);
  });

  it('records new transitions exactly once and rolls history back with the receipt update', async () => {
    const receiptId = randomUUID();
    await ctx.pool.query('INSERT INTO bank_receipts(id) VALUES($1)', [receiptId]);
    await ctx.pool.query("UPDATE bank_receipts SET state='UnderReview' WHERE id=$1", [receiptId]);
    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE bank_receipts SET state='Rejected' WHERE id=$1", [receiptId]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    await ctx.pool.query("UPDATE bank_receipts SET state='Rejected' WHERE id=$1", [receiptId]);
    await ctx.pool.query("UPDATE bank_receipts SET state='Rejected' WHERE id=$1", [receiptId]);
    const rows = await ctx.pool.query<{ state: string; backfilled: boolean }>(
      'SELECT state,backfilled FROM bank_receipt_status_events WHERE receipt_id=$1 ORDER BY occurred_at,id',
      [receiptId]
    );
    expect(rows.rows.map((row) => row.state)).toEqual(['Submitted', 'UnderReview', 'Rejected']);
    expect(rows.rows.every((row) => !row.backfilled)).toBe(true);
  });
});
