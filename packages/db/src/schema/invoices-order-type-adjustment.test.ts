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
const IDEMPOTENCY_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0057_add_invoice_type_idempotency.sql',
)
const CORRECTION_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0064_add_invoice_correction_self_references.sql',
)
const REPLACEMENT_INDEX_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0065_invoice_order_type_unique_exclude_replacements.sql',
)
const ADJUSTMENT_INDEX_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0066_invoice_order_type_unique_exclude_adjustments.sql',
)

/**
 * Real-PostgreSQL enforcement tests for the adjustment-safe unique index
 * (T-04.1.05.03).
 *
 * Runs 0057 + 0064 + 0065 + 0066 against an isolated schema and proves:
 *   - two ordinary invoices of the same type still collide per order;
 *   - an adjustment row (adjustment_for_invoice_id set) of type 'manual'
 *     does not collide with an order-linked original of type 'manual';
 *   - two adjustments on the same order do not collide with each other;
 *   - paid originals still occupy the ordinary uniqueness slot;
 *   - the migration is idempotent.
 */
describe('invoice order-type unique index excludes adjustments (T-04.1.05.03)', () => {
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
    await ctx.pool.query(readFileSync(IDEMPOTENCY_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(CORRECTION_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(REPLACEMENT_INDEX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ADJUSTMENT_INDEX_MIGRATION, 'utf-8').trim())

    await ctx.db.execute(sql`INSERT INTO profiles (id) VALUES (uuid_generate_v7())`)
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function freshOrder(): Promise<string> {
    const r = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO orders (id) VALUES (uuid_generate_v7()) RETURNING id
    `)
    return r.rows[0]!.id
  }

  async function profileId(): Promise<string> {
    const r = await ctx.db.execute<{ id: string }>(sql`
      SELECT id FROM profiles LIMIT 1
    `)
    return r.rows[0]!.id
  }

  it('rewrites uq_invoices_order_id_type to exclude both correction FKs', async () => {
    const def = await ctx.db.execute<{ indexdef: string }>(sql`
      SELECT indexdef
        FROM pg_indexes
       WHERE schemaname = current_schema()
         AND tablename = 'invoices'
         AND indexname = 'uq_invoices_order_id_type'
    `)
    expect(def.rows).toHaveLength(1)
    expect(def.rows[0]!.indexdef.toLowerCase()).toContain('unique')
    expect(def.rows[0]!.indexdef).toMatch(/replaces_invoice_id IS NULL/i)
    expect(def.rows[0]!.indexdef).toMatch(/adjustment_for_invoice_id IS NULL/i)
  })

  it('still rejects a second ordinary invoice of the same type for the same order', async () => {
    const orderId = await freshOrder()
    const profile = await profileId()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000)
      `),
    ).resolves.toBeDefined()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000)
      `),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('allows an adjustment of type manual next to an order-linked original of type manual', async () => {
    const orderId = await freshOrder()
    const profile = await profileId()

    const original = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoices (id, profile_id, order_id, type, total_amount, state)
      VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'manual', 100000, 'Paid')
      RETURNING id
    `)
    const originalId = original.rows[0]!.id

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (
          id, profile_id, order_id, type, total_amount, adjustment_for_invoice_id
        ) VALUES (
          uuid_generate_v7(), ${profile}, ${orderId}, 'manual', 20000, ${originalId}
        )
      `),
    ).resolves.toBeDefined()
  })

  it('allows two adjustments on the same order without colliding', async () => {
    const orderId = await freshOrder()
    const profile = await profileId()

    const original = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO invoices (id, profile_id, order_id, type, total_amount, state)
      VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000, 'Paid')
      RETURNING id
    `)
    const originalId = original.rows[0]!.id

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (
          id, profile_id, order_id, type, total_amount, adjustment_for_invoice_id
        ) VALUES (
          uuid_generate_v7(), ${profile}, ${orderId}, 'manual', 20000, ${originalId}
        )
      `),
    ).resolves.toBeDefined()

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (
          id, profile_id, order_id, type, total_amount, adjustment_for_invoice_id
        ) VALUES (
          uuid_generate_v7(), ${profile}, ${orderId}, 'manual', 15000, ${originalId}
        )
      `),
    ).resolves.toBeDefined()
  })

  it('paid ordinary originals still block a second ordinary invoice of the same type', async () => {
    const orderId = await freshOrder()
    const profile = await profileId()

    await ctx.db.execute(sql`
      INSERT INTO invoices (id, profile_id, order_id, type, total_amount, state)
      VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000, 'Paid')
    `)

    await expect(
      ctx.db.execute(sql`
        INSERT INTO invoices (id, profile_id, order_id, type, total_amount)
        VALUES (uuid_generate_v7(), ${profile}, ${orderId}, 'auto', 100000)
      `),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('migration 0066 is idempotent — re-running is a no-op', async () => {
    const migrationSql = readFileSync(ADJUSTMENT_INDEX_MIGRATION, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    const idx = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
        FROM pg_indexes
       WHERE schemaname = current_schema()
         AND tablename = 'invoices'
         AND indexname = 'uq_invoices_order_id_type'
    `)
    expect(idx.rows[0]!.n).toBe(1)
  })
})
