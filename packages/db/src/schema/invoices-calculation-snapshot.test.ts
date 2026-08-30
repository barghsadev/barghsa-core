import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { InvoiceCalculationSnapshot } from './invoice-calculation-snapshot'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const SNAPSHOT_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0058_add_invoice_calculation_snapshot.sql',
)

/**
 * Real-PostgreSQL enforcement tests for the invoice calculation snapshot
 * (T-04.1.02.08).
 *
 * Runs migration 0058 against an isolated Testcontainers schema and proves:
 *   - `invoice_calculation_snapshot` is added as a nullable JSONB column;
 *   - existing rows remain valid with a NULL snapshot (expand/migrate);
 *   - a structured snapshot round-trips (inputs, rounding steps, totals);
 *   - bigint-as-string money values survive JSONB storage;
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

    // Base invoices table as it exists BEFORE migration 0058: origin +
    // type + metadata, but no calculation snapshot column.
    await ctx.db.execute(sql`
      CREATE TABLE invoices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        contract_id TEXT,
        consultation_id TEXT,
        type TEXT,
        state invoice_state NOT NULL DEFAULT 'Draft',
        total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
        metadata JSONB
      )
    `)

    await ctx.db.execute(sql`INSERT INTO profiles (id) VALUES (uuid_generate_v7())`)

    // Pre-0058 row: must remain valid after ADD COLUMN (NULL snapshot).
    await ctx.db.execute(sql`
      INSERT INTO invoices (profile_id, type, total_amount, metadata)
      VALUES ((SELECT id FROM profiles LIMIT 1), 'manual', 100000, '{"source":"manual"}'::jsonb)
    `)

    const migrationSql = readFileSync(SNAPSHOT_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function profileId(): Promise<string> {
    const r = await ctx.db.execute<{ id: string }>(sql`
      SELECT id FROM profiles LIMIT 1
    `)
    return r.rows[0]!.id
  }

  /** Canonical 10% VAT on 55,055 IRR → 5,505.5 → 5,506 (exact half-up). */
  function halfUpSnapshot(): InvoiceCalculationSnapshot {
    return {
      version: 1,
      rounding: 'half-up-to-nearest-IRR',
      vatScale: 10_000,
      source: 'manual',
      inputs: {
        lines: [
          {
            description: 'canonical half-up',
            quantity: 1,
            unitPrice: '55055',
            vatRate: 1000,
            isTaxable: true,
          },
        ],
        orderDiscount: '0',
      },
      steps: [
        {
          lineIndex: 0,
          description: 'canonical half-up',
          quantity: 1,
          unitPrice: '55055',
          gross: '55055',
          discount: '0',
          remainingDiscountBefore: '0',
          remainingDiscountAfter: '0',
          lineTotal: '55055',
          vat: {
            isTaxable: true,
            rateBps: 1000,
            numerator: '55055000',
            denominator: '10000',
            truncated: '5505',
            remainder: '5000',
            exactHalf: true,
            rounded: '5506',
          },
        },
      ],
      totals: {
        subtotal: '55055',
        totalVat: '5506',
        totalDiscount: '0',
        totalAmount: '60561',
      },
    }
  }

  it('adds a nullable JSONB invoice_calculation_snapshot column', async () => {
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

  it('leaves existing rows with a NULL snapshot (expand/migrate)', async () => {
    const rows = await ctx.db.execute<{
      snapshot: InvoiceCalculationSnapshot | null
    }>(sql`
      SELECT invoice_calculation_snapshot AS snapshot FROM invoices
    `)
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]!.snapshot).toBeNull()
  })

  it('round-trips inputs, rounding steps, and totals through JSONB', async () => {
    const profile = await profileId()
    const snapshot = halfUpSnapshot()

    await ctx.pool.query(
      `INSERT INTO invoices (profile_id, type, total_amount, invoice_calculation_snapshot)
       VALUES ($1, 'manual', 60561, $2::jsonb)`,
      [profile, JSON.stringify(snapshot)],
    )

    const rows = await ctx.db.execute<{
      snapshot: InvoiceCalculationSnapshot
    }>(sql`
      SELECT invoice_calculation_snapshot AS snapshot FROM invoices
      WHERE total_amount = 60561
    `)
    expect(rows.rows).toHaveLength(1)
    const stored = rows.rows[0]!.snapshot
    expect(stored.version).toBe(1)
    expect(stored.rounding).toBe('half-up-to-nearest-IRR')
    expect(stored.vatScale).toBe(10_000)
    expect(stored.inputs.lines[0]!.unitPrice).toBe('55055')
    expect(stored.steps[0]!.vat.exactHalf).toBe(true)
    expect(stored.steps[0]!.vat.rounded).toBe('5506')
    expect(stored.totals.totalAmount).toBe('60561')
    // JSONB does not coerce decimal strings into numbers.
    expect(typeof stored.totals.totalAmount).toBe('string')
    expect(typeof stored.steps[0]!.vat.numerator).toBe('string')
  })

  it('allows querying snapshot totals without losing string IRR values', async () => {
    const row = await ctx.db.execute<{ total: string }>(sql`
      SELECT invoice_calculation_snapshot -> 'totals' ->> 'totalAmount' AS total
      FROM invoices
      WHERE total_amount = 60561
    `)
    expect(row.rows[0]!.total).toBe('60561')
  })

  it('migration 0058 is idempotent — re-running is a no-op', async () => {
    const migrationSql = readFileSync(SNAPSHOT_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name = 'invoice_calculation_snapshot'
    `)
    expect(cols.rows).toHaveLength(1)
  })
})
