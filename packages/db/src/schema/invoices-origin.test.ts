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
const ORIGIN_MIGRATION = resolve(__dirname, '../../drizzle/0056_add_invoice_origin_links.sql')

/**
 * Real-PostgreSQL enforcement tests for the invoice origin-link migration
 * (T-04.1.02.05).
 *
 * Runs migration 0056 against an isolated Testcontainers schema and proves:
 *   - `consultation_id` is added as a nullable column;
 *   - `contract_id` and `consultation_id` are usable origin references
 *     (the contracts / consultations tables are TBD, so these are deferred
 *     text FKs — not real constraints yet);
 *   - `order_id` remains a real nullable FK to orders;
 *   - the contract/consultation lookup indexes are created;
 *   - the migration is idempotent (re-runnable).
 */
describe('invoice origin links migration (T-04.1.02.05)', () => {
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

    // Base invoices table (with the amount constraints) — the table that
    // migration 0056 adds origin columns to.
    const amountSql = readFileSync(AMOUNT_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(amountSql)

    // Seed FK targets.
    await ctx.db.execute(sql`
      INSERT INTO profiles (id) VALUES (uuid_generate_v7())
    `)
    await ctx.db.execute(sql`
      INSERT INTO orders (id) VALUES (uuid_generate_v7())
    `)

    const originSql = readFileSync(ORIGIN_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(originSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('adds consultation_id as a nullable column alongside contract_id and order_id', async () => {
    const cols = await ctx.db.execute<{ column_name: string; is_nullable: string }>(sql`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name IN ('order_id', 'contract_id', 'consultation_id')
      ORDER BY column_name
    `)
    const rows = cols.rows
    expect(rows.map((r) => r.column_name)).toEqual([
      'consultation_id',
      'contract_id',
      'order_id',
    ])
    for (const r of rows) {
      expect(r.is_nullable).toBe('YES')
    }
  })

  it('keeps order_id as a real nullable FK to orders', async () => {
    const fk = await ctx.db.execute<{ column: string; referenced: string }>(sql`
      SELECT a.attname AS column, c.confrelid::regclass::text AS referenced
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attnum = ANY (c.conkey) AND a.attrelid = c.conrelid
      WHERE c.conrelid = 'invoices'::regclass
        AND c.contype = 'f'
        AND a.attname = 'order_id'
    `)
    expect(fk.rows.length).toBe(1)
    expect(fk.rows[0]!.referenced).toBe('orders')
  })

  it('allows storing origin references (order + deferred contract/consultation)', async () => {
    await ctx.db.execute(sql`
      INSERT INTO invoices (profile_id, order_id, contract_id, consultation_id, total_amount)
      VALUES (
        (SELECT id FROM profiles LIMIT 1),
        (SELECT id FROM orders LIMIT 1),
        'contract-001',
        'consultation-001',
        1_000_000
      )
    `)

    const row = await ctx.db.execute<{
      order_id: string | null
      contract_id: string | null
      consultation_id: string | null
    }>(sql`
      SELECT order_id, contract_id, consultation_id FROM invoices
      WHERE contract_id = 'contract-001' AND consultation_id = 'consultation-001'
    `)
    expect(row.rows).toHaveLength(1)
    const r0 = row.rows[0]!
    expect(r0.order_id).not.toBeNull()
    expect(r0.contract_id).toBe('contract-001')
    expect(r0.consultation_id).toBe('consultation-001')
  })

  it('allows an invoice with no origin (all three nullable)', async () => {
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (profile_id, total_amount)
        VALUES ((SELECT id FROM profiles LIMIT 1), 500_000)
      `),
    ).resolves.toBeDefined()
  })

  it('creates the contract and consultation lookup indexes', async () => {
    const idx = await ctx.db.execute<{ index_name: string }>(sql`
      SELECT indexname AS index_name FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'invoices'
        AND indexname IN ('idx_invoices_contract_id', 'idx_invoices_consultation_id')
    `)
    const names = idx.rows.map((r) => r.index_name)
    expect(names).toEqual(
      expect.arrayContaining(['idx_invoices_contract_id', 'idx_invoices_consultation_id']),
    )
  })

  it('migration 0056 is idempotent — re-running is a no-op', async () => {
    const originSql = readFileSync(ORIGIN_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(originSql)).resolves.toBeDefined()

    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices' AND column_name = 'consultation_id'
    `)
    expect(cols.rows).toHaveLength(1)
  })
})
