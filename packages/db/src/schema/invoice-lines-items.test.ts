import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { invoiceLines } from './invoice-lines'
import { invoiceItems } from './invoice-items'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const INVOICE_LINES_ITEMS_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0054_create_invoice_lines_and_items.sql',
)

/**
 * Real-PostgreSQL enforcement tests for the invoice_lines / invoice_items
 * tables (T-04.1.02.01).
 *
 * Runs migration 0054 against an isolated Testcontainers schema and proves:
 *   - FK enforcement: lines/items cannot reference a missing invoice; items
 *     cannot reference a missing product.
 *   - Referential actions: deleting an invoice CASCADEs to its lines and
 *     items; deleting a referenced product is RESTRICTed.
 *   - CHECK enforcement: quantity > 0, unit_price >= 0, vat_rate 0..10000,
 *     line_total >= 0, vat_amount >= 0, and non-taxable lines carry zero VAT.
 *   - updated_at triggers and lookup indexes exist and work.
 *   - Migration is idempotent (re-runnable).
 *   - Drizzle schema mirrors the spec column set (drift guard).
 */
describe('invoice_lines & invoice_items schema (T-04.1.02.01)', () => {
  let ctx: IsolatedTestDb

  async function insertInvoice(): Promise<string> {
    const result = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoices (profile_id, total_amount)
      VALUES ((SELECT id FROM profiles LIMIT 1), 1000000)
      RETURNING id
    `)
    return result.rows[0]!.id
  }

  async function insertProduct(): Promise<string> {
    const result = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO products (id) VALUES (uuid_generate_v7()) RETURNING id
    `)
    return result.rows[0]!.id
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    // Pre-requisite DDL: uuid_generate_v7(), the invoice_state enum, the
    // base invoices table (0052 — with minimal profiles/orders FK targets),
    // and a minimal products table (the full one is created by migration
    // 0014 and needs product_type/product_status enums; the FK only
    // requires the table and primary key).
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
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)

    await ctx.db.execute(sql`
      INSERT INTO profiles (id) VALUES (uuid_generate_v7())
    `)

    const invoicesSql = readFileSync(INVOICES_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(invoicesSql)

    const migrationSql = readFileSync(INVOICE_LINES_ITEMS_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  // ---- Happy path ---------------------------------------------------------

  it('accepts valid line and item rows', async () => {
    const invoiceId = await insertInvoice()
    const productId = await insertProduct()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines
          (invoice_id, description, quantity, unit_price, line_total, vat_rate, vat_amount, is_taxable)
        VALUES
          (${invoiceId}, 'برق مصرفی — دوره اردیبهشت', 2, 500000, 1000000, 900, 90000, TRUE)
      `),
    ).resolves.toBeDefined()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_items
          (invoice_id, product_id, product_title, quantity, unit_price, vat_rate)
        VALUES
          (${invoiceId}, ${productId}, '{"fa": "برق حرارتی", "en": "Thermal Electricity"}', 2, 500000, 900)
      `),
    ).resolves.toBeDefined()
  })

  // ---- FK enforcement -----------------------------------------------------

  it('rejects a line referencing a missing invoice (FK)', async () => {
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total)
        VALUES (uuid_generate_v7(), 'orphan', 1, 1000, 1000)
      `),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects an item referencing a missing invoice or product (FK)', async () => {
    const invoiceId = await insertInvoice()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price)
        VALUES (${invoiceId}, uuid_generate_v7(), 1, 1000)
      `),
    ).rejects.toMatchObject({ code: '23503' })

    const productId = await insertProduct()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price)
        VALUES (uuid_generate_v7(), ${productId}, 1, 1000)
      `),
    ).rejects.toMatchObject({ code: '23503' })
  })

  // ---- Referential actions ------------------------------------------------

  it('cascades: deleting an invoice deletes its lines and items', async () => {
    const invoiceId = await insertInvoice()
    const productId = await insertProduct()
    await ctx.db.execute(sql`
      INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total)
      VALUES (${invoiceId}, 'line-a', 1, 1000, 1000)
    `)
    await ctx.db.execute(sql`
      INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price)
      VALUES (${invoiceId}, ${productId}, 1, 1000)
    `)

    await ctx.db.execute(sql`DELETE FROM invoices WHERE id = ${invoiceId}`)

    const lines = await ctx.db.execute(sql`
      SELECT COUNT(*)::int AS n FROM invoice_lines WHERE invoice_id = ${invoiceId}
    `)
    const items = await ctx.db.execute(sql`
      SELECT COUNT(*)::int AS n FROM invoice_items WHERE invoice_id = ${invoiceId}
    `)
    expect(lines.rows[0]!.n).toBe(0)
    expect(items.rows[0]!.n).toBe(0)
  })

  it('restricts: a product referenced by an invoice item cannot be deleted', async () => {
    const invoiceId = await insertInvoice()
    const productId = await insertProduct()
    await ctx.db.execute(sql`
      INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price)
      VALUES (${invoiceId}, ${productId}, 1, 1000)
    `)

    await expect(
      ctx.db.execute(sql`DELETE FROM products WHERE id = ${productId}`),
    ).rejects.toMatchObject({ code: '23503' })
  })

  // ---- CHECK constraints (invoice_lines) ----------------------------------

  it('rejects a line with quantity <= 0', async () => {
    const invoiceId = await insertInvoice()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total)
        VALUES (${invoiceId}, 'zero qty', 0, 1000, 1000)
      `),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('ck_invoice_lines_quantity_positive') })
  })

  it('rejects a line with a negative unit price or negative line total', async () => {
    const invoiceId = await insertInvoice()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total)
        VALUES (${invoiceId}, 'neg price', 1, -1, -1000)
      `),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a line whose VAT rate is outside 0..10000 basis points', async () => {
    const invoiceId = await insertInvoice()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total, vat_rate)
        VALUES (${invoiceId}, 'vat too high', 1, 1000, 1000, 10001)
      `),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('ck_invoice_lines_vat_rate_range') })
  })

  it('rejects a line with a negative VAT amount', async () => {
    const invoiceId = await insertInvoice()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total, vat_amount)
        VALUES (${invoiceId}, 'neg vat', 1, 1000, 1000, -1)
      `),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('ck_invoice_lines_vat_amount_non_negative') })
  })

  it('rejects a non-taxable line that carries VAT', async () => {
    const invoiceId = await insertInvoice()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines
          (invoice_id, description, quantity, unit_price, line_total, vat_amount, is_taxable)
        VALUES
          (${invoiceId}, 'non-taxable with vat', 1, 1000, 1000, 90, FALSE)
      `),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('ck_invoice_lines_non_taxable_zero_vat') })
  })

  // ---- CHECK constraints (invoice_items) ----------------------------------

  it('rejects an item with quantity <= 0, negative price, or bad VAT rate', async () => {
    const invoiceId = await insertInvoice()
    const productId = await insertProduct()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price)
        VALUES (${invoiceId}, ${productId}, 0, 1000)
      `),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('ck_invoice_items_quantity_positive') })

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price)
        VALUES (${invoiceId}, ${productId}, 1, -1)
      `),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('ck_invoice_items_unit_price_non_negative') })

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, vat_rate)
        VALUES (${invoiceId}, ${productId}, 1, 1000, -1)
      `),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('ck_invoice_items_vat_rate_range') })
  })

  // ---- Indexes & triggers -------------------------------------------------

  it('creates the lookup indexes', async () => {
    const indexes = await ctx.db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = ${ctx.schemaName}
        AND indexname IN (
          'idx_invoice_lines_invoice_id',
          'idx_invoice_items_invoice_id',
          'idx_invoice_items_product_id'
        )
      ORDER BY indexname
    `)
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'idx_invoice_items_invoice_id',
      'idx_invoice_items_product_id',
      'idx_invoice_lines_invoice_id',
    ])
  })

  it('maintains updated_at through the database trigger', async () => {
    const invoiceId = await insertInvoice()
    const result = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total)
      VALUES (${invoiceId}, 'trg', 1, 1000, 1000)
      RETURNING id
    `)
    const lineId = result.rows[0]!.id

    const before = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM invoice_lines WHERE id = ${lineId}
    `)
    // Direct SQL write bypasses Drizzle's $onUpdate — the trigger must stamp it.
    await ctx.db.execute(sql`
      UPDATE invoice_lines SET description = 'trg-updated' WHERE id = ${lineId}
    `)
    const after = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM invoice_lines WHERE id = ${lineId}
    `)

    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.rows[0]!.updated_at).getTime(),
    )
  })

  // ---- Idempotency --------------------------------------------------------

  it('migration 0054 is idempotent — re-running is a no-op and keeps enforcement', async () => {
    const migrationSql = readFileSync(INVOICE_LINES_ITEMS_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    const invoiceId = await insertInvoice()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total)
        VALUES (${invoiceId}, 'still enforced', 1, 1000, 0)
      `),
    ).resolves.toBeDefined()
    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, line_total)
        VALUES (${invoiceId}, 'still enforced', 0, 1000, 0)
      `),
    ).rejects.toMatchObject({ code: '23514' })
  })

  // ---- Drizzle schema drift guard -----------------------------------------

  it('Drizzle schema mirrors the S-04.1.02 spec column set', () => {
    const lineColumns = getTableConfig(invoiceLines).columns.map((c) => c.name)
    expect(lineColumns).toEqual(
      expect.arrayContaining([
        'id',
        'invoice_id',
        'description',
        'quantity',
        'unit_price',
        'line_total',
        'vat_rate',
        'vat_amount',
        'is_taxable',
        'created_at',
        'updated_at',
      ]),
    )

    const itemColumns = getTableConfig(invoiceItems).columns.map((c) => c.name)
    expect(itemColumns).toEqual(
      expect.arrayContaining([
        'id',
        'invoice_id',
        'product_id',
        'product_title',
        'quantity',
        'unit_price',
        'vat_rate',
        'created_at',
        'updated_at',
      ]),
    )
  })
})