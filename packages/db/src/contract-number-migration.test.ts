import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createIsolatedTestDb, dropTestSchema } from './test/testDb';
import type { IsolatedTestDb } from './test/testDb';

const migration = readFileSync(
  resolve(__dirname, '../drizzle/production/0192_contract_numbers.sql'),
  'utf8'
);
let ctx: IsolatedTestDb;

beforeAll(async () => {
  ctx = await createIsolatedTestDb();
  await ctx.pool.query(
    'CREATE TABLE contracts (id uuid PRIMARY KEY, created_at timestamptz NOT NULL)'
  );
});

afterAll(async () => {
  await ctx?.pool.end();
  if (ctx) await dropTestSchema(ctx.schemaName);
});

it('backfills existing contracts in creation order and continues numbering new contracts', async () => {
  const older = randomUUID();
  const newer = randomUUID();
  await ctx.pool.query('INSERT INTO contracts (id, created_at) VALUES ($1, $2), ($3, $4)', [
    newer,
    '2026-02-01T00:00:00Z',
    older,
    '2026-01-01T00:00:00Z',
  ]);
  await ctx.pool.query(migration);

  const third = randomUUID();
  await ctx.pool.query('INSERT INTO contracts (id, created_at) VALUES ($1, NOW())', [third]);
  const { rows } = await ctx.pool.query<{ id: string; contract_number: string }>(
    'SELECT id, contract_number FROM contracts ORDER BY contract_number'
  );
  expect(rows).toEqual([
    { id: older, contract_number: '1' },
    { id: newer, contract_number: '2' },
    { id: third, contract_number: '3' },
  ]);
  await expect(
    ctx.pool.query('UPDATE contracts SET contract_number=0 WHERE id=$1', [third])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    ctx.pool.query('UPDATE contracts SET contract_number=1 WHERE id=$1', [third])
  ).rejects.toMatchObject({ code: '23505' });
});
