import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0066. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema already has invoices with `type`, the 0065
 * unique (order_id, type) WHERE replaces_invoice_id IS NULL index, and
 * `adjustment_for_invoice_id`. Journal bookkeeping is seeded through
 * 0065 so migrate() must pick up 0066 and rewrite the unique index
 * to also exclude adjustment rows.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const AMOUNT_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0052_add_invoice_amount_check_constraints.sql',
)
const IDEMPOTENCY_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0057_add_invoice_type_idempotency.sql',
)
const CORRECTION_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0064_add_invoice_correction_self_references.sql',
)
const REPLACEMENT_INDEX_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0065_invoice_order_type_unique_exclude_replacements.sql',
)
const ADJUSTMENT_TAG = '0066_invoice_order_type_unique_exclude_adjustments'
/** `when` of journal tag 0065 — last entry before 0066 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788566400000

describe('drizzle migrate() applies invoice order-type adjustment unique index (T-04.1.05.03)', () => {
  let ctx: IsolatedTestDb
  let rewriteWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const rewriteEntry = journal.entries.find((entry) => entry.tag === ADJUSTMENT_TAG)
    if (!rewriteEntry) {
      throw new Error(
        `${ADJUSTMENT_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (rewriteEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${ADJUSTMENT_TAG} journal 'when' (${rewriteEntry.when}) must be after 0065 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    rewriteWhen = rewriteEntry.when

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

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0065', PRIOR_JOURNAL_HEAD_WHEN],
    )

    await migrate(ctx.db, {
      migrationsFolder: DRIZZLE_FOLDER,
      migrationsSchema: ctx.schemaName,
    })
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('rewrites uq_invoices_order_id_type through the journaled migrate() path', async () => {
    const def = await ctx.db.execute<{ indexdef: string }>(sql`
      SELECT indexdef
        FROM pg_indexes
       WHERE schemaname = current_schema()
         AND tablename = 'invoices'
         AND indexname = 'uq_invoices_order_id_type'
    `)
    expect(def.rows).toHaveLength(1)
    expect(def.rows[0]!.indexdef).toMatch(/replaces_invoice_id IS NULL/i)
    expect(def.rows[0]!.indexdef).toMatch(/adjustment_for_invoice_id IS NULL/i)
  })

  it('records 0066 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(rewriteWhen)
  })
})
