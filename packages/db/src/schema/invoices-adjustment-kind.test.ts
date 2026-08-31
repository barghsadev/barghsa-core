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
const ADJUSTMENT_KIND_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0067_invoice_adjustment_kind_accounting_amount.sql',
)

/**
 * Real-PostgreSQL enforcement tests for first-class credit-note columns
 * (T-04.1.05.03).
 *
 * Runs 0064 + 0067 against an isolated schema and proves:
 *   - ordinary invoices keep NULL kind and accounting_amount = total;
 *   - a credit stores adjustment_kind='credit' and negative accounting_amount;
 *   - a charge stores positive accounting_amount equal to total;
 *   - kind without a link (and a link without kind) are rejected;
 *   - the migration is idempotent.
 */
describe('invoice adjustment kind and accounting amount (T-04.1.05.03)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
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

    await ctx.pool.query(readFileSync(AMOUNT_MIGRATION, 'utf-8').trim())
    await ctx.db.execute(sql`INSERT INTO profiles (id) VALUES (uuid_generate_v7())`)
    await ctx.pool.query(readFileSync(CORRECTION_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ADJUSTMENT_KIND_MIGRATION, 'utf-8').trim())
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function insertInvoice(values: {
    total: number
    adjustmentFor?: string
    kind?: string
    state?: string
  }): Promise<string> {
    const row = await ctx.pool.query<{ id: string }>(
      `INSERT INTO invoices
         (profile_id, total_amount, adjustment_for_invoice_id, adjustment_kind, state)
       VALUES (
         (SELECT id FROM profiles LIMIT 1),
         $1, $2, $3, $4::invoice_state
       )
       RETURNING id`,
      [
        values.total,
        values.adjustmentFor ?? null,
        values.kind ?? null,
        values.state ?? 'Draft',
      ],
    )
    return row.rows[0]!.id
  }

  it('backfills ordinary invoices with accounting_amount = total_amount', async () => {
    const id = await insertInvoice({ total: 1_000_000 })
    const row = await ctx.pool.query<{
      adjustment_kind: string | null
      accounting_amount: string
      total_amount: string
    }>(
      `SELECT adjustment_kind, accounting_amount::text, total_amount::text
         FROM invoices WHERE id = $1`,
      [id],
    )
    expect(row.rows[0]!.adjustment_kind).toBeNull()
    expect(row.rows[0]!.accounting_amount).toBe('1000000')
    expect(row.rows[0]!.total_amount).toBe('1000000')
  })

  it('stores a credit as negative accounting_amount without changing total_amount', async () => {
    const originalId = await insertInvoice({ total: 1_090_000, state: 'Paid' })
    const creditId = await insertInvoice({
      total: 80_000,
      adjustmentFor: originalId,
      kind: 'credit',
      state: 'Unpaid',
    })
    const row = await ctx.pool.query<{
      adjustment_kind: string
      accounting_amount: string
      total_amount: string
    }>(
      `SELECT adjustment_kind, accounting_amount::text, total_amount::text
         FROM invoices WHERE id = $1`,
      [creditId],
    )
    expect(row.rows[0]!.adjustment_kind).toBe('credit')
    expect(row.rows[0]!.total_amount).toBe('80000')
    expect(row.rows[0]!.accounting_amount).toBe('-80000')
  })

  it('stores a charge with accounting_amount equal to total_amount', async () => {
    const originalId = await insertInvoice({ total: 1_090_000, state: 'Paid' })
    const chargeId = await insertInvoice({
      total: 250_000,
      adjustmentFor: originalId,
      kind: 'charge',
      state: 'Unpaid',
    })
    const row = await ctx.pool.query<{ accounting_amount: string }>(
      `SELECT accounting_amount::text FROM invoices WHERE id = $1`,
      [chargeId],
    )
    expect(row.rows[0]!.accounting_amount).toBe('250000')
  })

  it('rejects an adjustment link without a kind (CHECK 23514)', async () => {
    const originalId = await insertInvoice({ total: 500_000, state: 'Paid' })
    await expect(
      insertInvoice({ total: 10_000, adjustmentFor: originalId }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a kind without an adjustment link (CHECK 23514)', async () => {
    await expect(
      insertInvoice({ total: 10_000, kind: 'credit' }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects an unknown adjustment_kind (CHECK 23514)', async () => {
    const originalId = await insertInvoice({ total: 500_000, state: 'Paid' })
    await expect(
      insertInvoice({
        total: 10_000,
        adjustmentFor: originalId,
        kind: 'refund',
      }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('migration 0067 is idempotent — re-running is a no-op', async () => {
    const sqlText = readFileSync(ADJUSTMENT_KIND_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(sqlText)).resolves.toBeDefined()

    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name IN ('adjustment_kind', 'accounting_amount')
    `)
    expect(cols.rows).toHaveLength(2)
  })
})
