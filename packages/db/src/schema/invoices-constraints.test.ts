import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const INVOICE_CONSTRAINTS_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0052_add_invoice_amount_check_constraints.sql',
)

/**
 * Real-PostgreSQL enforcement tests for the invoice amount CHECK
 * constraints (T-04.1.01.04).
 *
 * Runs migration 0052 against an isolated Testcontainers schema and proves
 * PostgreSQL rejects the two money-safety violations:
 *   - paid_amount   > total_amount
 *   - refunded_amount > paid_amount
 * It also verifies the migration is idempotent (re-runnable) and that the
 * backfill path adds the constraints to a legacy table that predates them.
 */
describe('invoice amount CHECK constraints (T-04.1.01.04)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    // Pre-requisite DDL: uuid_generate_v7(), the invoice_state enum, and
    // minimal FK targets (profiles, orders) that production migrations
    // assume already exist (they are created by the app bootstrap).
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

    // The insert helper below uses a profile row as the FK target.
    await ctx.db.execute(sql`
      INSERT INTO profiles (id) VALUES (uuid_generate_v7())
    `)

    const migrationSql = readFileSync(INVOICE_CONSTRAINTS_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function insertInvoice(values: {
    total: bigint | number
    paid: bigint | number
    refunded: bigint | number
  }) {
    await ctx.db.execute(sql`
      INSERT INTO invoices (profile_id, total_amount, paid_amount, refunded_amount)
      VALUES (
        (SELECT id FROM profiles LIMIT 1),
        ${values.total},
        ${values.paid},
        ${values.refunded}
      )
    `)
  }

  it('accepts a valid invoice (paid <= total, refunded <= paid)', async () => {
    await expect(insertInvoice({ total: 1_000_000, paid: 750_000, refunded: 250_000 })).resolves.not.toThrow()
    await expect(insertInvoice({ total: 1_000_000, paid: 1_000_000, refunded: 0 })).resolves.not.toThrow()
    await expect(insertInvoice({ total: 0, paid: 0, refunded: 0 })).resolves.not.toThrow()
  })

  it('rejects an invoice whose paidAmount exceeds totalAmount', async () => {
    await expect(insertInvoice({ total: 100_000, paid: 100_001, refunded: 0 })).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('rejects an invoice whose refundedAmount exceeds paidAmount', async () => {
    await expect(insertInvoice({ total: 100_000, paid: 50_000, refunded: 50_001 })).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('rejects negative amounts (inline column CHECKs preserved)', async () => {
    await expect(insertInvoice({ total: -1, paid: 0, refunded: 0 })).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('migration 0052 is idempotent — re-running is a no-op', async () => {
    const migrationSql = readFileSync(INVOICE_CONSTRAINTS_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()
    // Constraints still enforced after the re-run.
    await expect(insertInvoice({ total: 100, paid: 101, refunded: 0 })).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('backfill path adds the constraints to a legacy invoices table', async () => {
    // Simulate a legacy invoices table created before migration 0052: same
    // full column set (so the migration's indexes apply), but WITHOUT the two
    // named CHECK constraints. The DO-block backfill must add them.
    await ctx.db.execute(sql`DROP TABLE IF EXISTS invoices CASCADE`)
    await ctx.db.execute(sql`
      CREATE TABLE invoices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        contract_id TEXT,
        state invoice_state NOT NULL DEFAULT 'Draft',
        total_amount BIGINT NOT NULL,
        paid_amount BIGINT NOT NULL DEFAULT 0,
        refunded_amount BIGINT NOT NULL DEFAULT 0,
        issued_at TIMESTAMPTZ,
        payable_from TIMESTAMPTZ,
        due_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const migrationSql = readFileSync(INVOICE_CONSTRAINTS_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(migrationSql)

    // Constraints now exist and are enforced.
    const constraints = await ctx.db.execute<{ name: string }>(sql`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid = 'invoices'::regclass
        AND conname IN ('ck_paid_not_exceeds_total', 'ck_refund_not_exceeds_paid')
      ORDER BY conname
    `)
    expect(constraints.rows.map((r) => r.name)).toEqual([
      'ck_paid_not_exceeds_total',
      'ck_refund_not_exceeds_paid',
    ])

    await expect(insertInvoice({ total: 100, paid: 200, refunded: 0 })).rejects.toMatchObject({
      code: '23514',
    })
    await expect(insertInvoice({ total: 100, paid: 50, refunded: 100 })).rejects.toMatchObject({
      code: '23514',
    })
  })
})