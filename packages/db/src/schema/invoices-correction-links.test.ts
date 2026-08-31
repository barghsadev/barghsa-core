import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const AMOUNT_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const CORRECTION_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0064_add_invoice_correction_self_references.sql',
)

/**
 * Real-PostgreSQL enforcement tests for invoice correction self-references
 * (T-04.1.05.01).
 *
 * Runs migration 0064 against an isolated Testcontainers schema and proves:
 *   - `replaces_invoice_id` and `adjustment_for_invoice_id` are nullable
 *     UUID columns;
 *   - both are real self-FKs to invoices(id) with ON DELETE RESTRICT;
 *   - existing invoices remain valid with NULL (expand);
 *   - a replacement / adjustment can point at a real predecessor;
 *   - a dangling id is rejected (SQLSTATE 23503);
 *   - deleting an original that still has a correction is rejected;
 *   - the lookup indexes exist;
 *   - the migration is idempotent (re-runnable).
 */
describe('invoice correction self-references migration (T-04.1.05.01)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TYPE invoice_state AS ENUM (
        'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
        'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
      )
    `)
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)

    const amountSql = readFileSync(AMOUNT_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(amountSql)

    await ctx.db.execute(sql`INSERT INTO profiles (id) VALUES (uuid_generate_v7())`)

    const correctionSql = readFileSync(CORRECTION_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(correctionSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function insertInvoice(): Promise<string> {
    const row = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoices (profile_id, total_amount)
      VALUES ((SELECT id FROM profiles LIMIT 1), 1000000)
      RETURNING id
    `)
    return row.rows[0]!.id
  }

  it('adds both columns as nullable UUIDs', async () => {
    const cols = await ctx.db.execute<{
      column_name: string
      is_nullable: string
      data_type: string
      udt_name: string
    }>(sql`
      SELECT column_name, is_nullable, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name IN ('replaces_invoice_id', 'adjustment_for_invoice_id')
      ORDER BY column_name
    `)
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'adjustment_for_invoice_id',
      'replaces_invoice_id',
    ])
    for (const r of cols.rows) {
      expect(r.is_nullable).toBe('YES')
      expect(r.udt_name).toBe('uuid')
    }
  })

  it('declares RESTRICT self-FKs to invoices(id)', async () => {
    const fks = await ctx.db.execute<{
      column: string
      referenced: string
      confdeltype: string
    }>(sql`
      SELECT a.attname AS column,
             c.confrelid::regclass::text AS referenced,
             c.confdeltype
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attnum = ANY (c.conkey) AND a.attrelid = c.conrelid
      WHERE c.conrelid = 'invoices'::regclass
        AND c.contype = 'f'
        AND a.attname IN ('replaces_invoice_id', 'adjustment_for_invoice_id')
      ORDER BY a.attname
    `)
    expect(fks.rows).toHaveLength(2)
    for (const row of fks.rows) {
      expect(row.referenced).toBe('invoices')
      // 'r' = RESTRICT (PostgreSQL stores RESTRICT and NO ACTION as 'r'/'a';
      // inline REFERENCES ... ON DELETE RESTRICT is 'r').
      expect(row.confdeltype).toBe('r')
    }
    expect(fks.rows.map((r) => r.column)).toEqual([
      'adjustment_for_invoice_id',
      'replaces_invoice_id',
    ])
  })

  it('allows an invoice with both correction links NULL (expand path)', async () => {
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (profile_id, total_amount)
        VALUES ((SELECT id FROM profiles LIMIT 1), 500000)
      `),
    ).resolves.toBeDefined()
  })

  it('stores a cancel+replace link to a real predecessor', async () => {
    const originalId = await insertInvoice()
    const replacement = await ctx.db.execute<{
      id: string
      replaces_invoice_id: string | null
    }>(sql`
      INSERT INTO invoices (profile_id, total_amount, replaces_invoice_id)
      VALUES ((SELECT id FROM profiles LIMIT 1), 1100000, ${originalId})
      RETURNING id, replaces_invoice_id
    `)
    expect(replacement.rows).toHaveLength(1)
    expect(replacement.rows[0]!.replaces_invoice_id).toBe(originalId)
  })

  it('stores an adjustment link to a real predecessor', async () => {
    const originalId = await insertInvoice()
    const adjustment = await ctx.db.execute<{
      id: string
      adjustment_for_invoice_id: string | null
    }>(sql`
      INSERT INTO invoices (profile_id, total_amount, adjustment_for_invoice_id)
      VALUES ((SELECT id FROM profiles LIMIT 1), 250000, ${originalId})
      RETURNING id, adjustment_for_invoice_id
    `)
    expect(adjustment.rows).toHaveLength(1)
    expect(adjustment.rows[0]!.adjustment_for_invoice_id).toBe(originalId)
  })

  it('rejects a dangling replaces_invoice_id (FK 23503)', async () => {
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (profile_id, total_amount, replaces_invoice_id)
        VALUES (
          (SELECT id FROM profiles LIMIT 1),
          100000,
          '00000000-0000-0000-0000-000000000001'::uuid
        )
      `),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects a dangling adjustment_for_invoice_id (FK 23503)', async () => {
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (profile_id, total_amount, adjustment_for_invoice_id)
        VALUES (
          (SELECT id FROM profiles LIMIT 1),
          100000,
          '00000000-0000-0000-0000-000000000002'::uuid
        )
      `),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('RESTRICT prevents deleting an original that still has a replacement', async () => {
    const originalId = await insertInvoice()
    await ctx.db.execute(sql`
      INSERT INTO invoices (profile_id, total_amount, replaces_invoice_id)
      VALUES ((SELECT id FROM profiles LIMIT 1), 1100000, ${originalId})
    `)
    await expect(
      ctx.db.execute(sql`DELETE FROM invoices WHERE id = ${originalId}`),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('creates the correction-chain lookup indexes', async () => {
    const idx = await ctx.db.execute<{ index_name: string }>(sql`
      SELECT indexname AS index_name FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'invoices'
        AND indexname IN (
          'idx_invoices_replaces_invoice_id',
          'idx_invoices_adjustment_for_invoice_id'
        )
    `)
    expect(idx.rows.map((r) => r.index_name)).toEqual(
      expect.arrayContaining([
        'idx_invoices_replaces_invoice_id',
        'idx_invoices_adjustment_for_invoice_id',
      ]),
    )
  })

  it('migration 0064 is idempotent — re-running is a no-op', async () => {
    const correctionSql = readFileSync(CORRECTION_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(correctionSql)).resolves.toBeDefined()

    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name IN ('replaces_invoice_id', 'adjustment_for_invoice_id')
    `)
    expect(cols.rows).toHaveLength(2)
  })
})
