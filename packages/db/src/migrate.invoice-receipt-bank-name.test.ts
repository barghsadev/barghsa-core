import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createIsolatedTestDb, dropTestSchema } from './test/testDb.js';
import type { IsolatedTestDb } from './test/testDb.js';

const migration = readFileSync(
  resolve(__dirname, '../drizzle/production/0188_invoice_receipt_bank_name.sql'),
  'utf8'
);

describe('invoice receipt bank-name expansion', () => {
  let ctx: IsolatedTestDb;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb();
    await ctx.pool.query(`CREATE TABLE bank_receipts (id uuid PRIMARY KEY)`);
    await ctx.pool.query(`INSERT INTO bank_receipts (id) VALUES ($1)`, [
      '11111111-1111-4111-8111-111111111111',
    ]);
    await ctx.pool.query(migration);
  });

  afterAll(async () => {
    await ctx.pool.end();
    await dropTestSchema(ctx.schemaName);
  });

  it('preserves legacy receipts and accepts a new bank name', async () => {
    const old = await ctx.pool.query<{ bank_name: string | null }>(
      `SELECT bank_name FROM bank_receipts WHERE id = $1`,
      ['11111111-1111-4111-8111-111111111111']
    );
    expect(old.rows[0]?.bank_name).toBeNull();
    await ctx.pool.query(`UPDATE bank_receipts SET bank_name = $1`, ['بانک ملی']);
    const updated = await ctx.pool.query<{ bank_name: string }>(
      `SELECT bank_name FROM bank_receipts`
    );
    expect(updated.rows[0]?.bank_name).toBe('بانک ملی');
  });

  it('rejects blank or oversized bank names', async () => {
    for (const name of ['   ', 'x'.repeat(129)]) {
      await expect(
        ctx.pool.query(`UPDATE bank_receipts SET bank_name = $1`, [name])
      ).rejects.toMatchObject({
        code: '23514',
      });
    }
  });
});
