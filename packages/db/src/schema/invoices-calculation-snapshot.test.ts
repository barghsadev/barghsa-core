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
const SNAPSHOT_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0058_add_invoice_calculation_snapshot.sql',
)

/**
 * Real-PostgreSQL enforcement tests for the invoice calculation snapshot
 * column (T-04.1.02.08).
 *
 * Runs migration 0058 against an isolated Testcontainers schema and proves:
 *   - `invoice_calculation_snapshot` is added as a nullable JSONB column;
 *   - existing invoices remain valid with a NULL snapshot (expand);
 *   - a full snapshot document (inputs, rounding steps, totals) round-trips;
 *   - JSON numbers are not required — money is stored as decimal-digit
 *     strings so int8 IRR survives JSON;
 *   - the migration is idempotent (re-runnable).
 */
describe('invoice calculation snapshot migration (T-04.1.02.08)', () => {
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

    const snapshotSql = readFileSync(SNAPSHOT_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(snapshotSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('adds invoice_calculation_snapshot as a nullable JSONB column', async () => {
    const cols = await ctx.db.execute<{
      column_name: string
      is_nullable: string
      data_type: string
    }>(sql`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name = 'invoice_calculation_snapshot'
    `)
    expect(cols.rows).toHaveLength(1)
    expect(cols.rows[0]!.is_nullable).toBe('YES')
    expect(cols.rows[0]!.data_type).toBe('jsonb')
  })

  it('allows an invoice with a NULL snapshot (legacy / expand path)', async () => {
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (profile_id, total_amount)
        VALUES ((SELECT id FROM profiles LIMIT 1), 500000)
      `),
    ).resolves.toBeDefined()
  })

  it('round-trips a snapshot with string IRR amounts, steps, and totals', async () => {
    const snapshot = {
      version: 1,
      source: 'manual',
      rounding: { rule: 'half-up-to-nearest-IRR', vatScale: 10000 },
      inputs: {
        lines: [
          {
            description: 'برق مصرفی',
            quantity: 1,
            unitPrice: '1000000',
            vatRate: 900,
            isTaxable: true,
          },
        ],
        orderDiscount: '0',
      },
      steps: [
        {
          lineIndex: 0,
          gross: '1000000',
          discount: '0',
          remainingDiscountAfter: '0',
          lineTotal: '1000000',
          vat: {
            lineIndex: 0,
            operation: 'vat',
            netAmount: '1000000',
            vatRate: 900,
            isTaxable: true,
            numerator: '900000000',
            denominator: '10000',
            truncatedQuotient: '90000',
            remainder: '0',
            roundedUp: false,
            result: '90000',
          },
        },
      ],
      totals: {
        subtotal: '1000000',
        totalVat: '90000',
        totalDiscount: '0',
        totalAmount: '1090000',
      },
    }

    await ctx.pool.query(
      `INSERT INTO invoices (profile_id, total_amount, invoice_calculation_snapshot)
       VALUES ((SELECT id FROM profiles LIMIT 1), 1090000, $1::jsonb)`,
      [JSON.stringify(snapshot)],
    )

    const row = await ctx.db.execute<{ invoice_calculation_snapshot: typeof snapshot }>(sql`
      SELECT invoice_calculation_snapshot FROM invoices
      WHERE total_amount = 1090000 AND invoice_calculation_snapshot IS NOT NULL
      LIMIT 1
    `)
    expect(row.rows).toHaveLength(1)
    const stored = row.rows[0]!.invoice_calculation_snapshot
    expect(stored.version).toBe(1)
    expect(stored.source).toBe('manual')
    expect(stored.rounding.rule).toBe('half-up-to-nearest-IRR')
    expect(stored.inputs.lines[0]!.unitPrice).toBe('1000000')
    expect(stored.steps[0]!.vat.numerator).toBe('900000000')
    expect(stored.steps[0]!.vat.result).toBe('90000')
    expect(stored.totals.totalAmount).toBe('1090000')
  })

  it('migration 0058 is idempotent — re-running is a no-op', async () => {
    const snapshotSql = readFileSync(SNAPSHOT_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(snapshotSql)).resolves.toBeDefined()

    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name = 'invoice_calculation_snapshot'
    `)
    expect(cols.rows).toHaveLength(1)
  })
})
