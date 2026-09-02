import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0067. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * Journal bookkeeping is seeded through 0066 so migrate() must pick up
 * 0067 and add `adjustment_kind` / generated `accounting_amount`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const AMOUNT_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0052_add_invoice_amount_check_constraints.sql',
)
const CORRECTION_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0064_add_invoice_correction_self_references.sql',
)
const ADJUSTMENT_KIND_TAG = '0067_invoice_adjustment_kind_accounting_amount'
/** `when` of journal tag 0066 — last entry before 0067 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788652800000

describe('drizzle migrate() applies invoice adjustment kind (T-04.1.05.03)', () => {
  let ctx: IsolatedTestDb
  let rewriteWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const rewriteEntry = journal.entries.find((entry) => entry.tag === ADJUSTMENT_KIND_TAG)
    if (!rewriteEntry) {
      throw new Error(
        `${ADJUSTMENT_KIND_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (rewriteEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${ADJUSTMENT_KIND_TAG} journal 'when' (${rewriteEntry.when}) must be after 0066 (${PRIOR_JOURNAL_HEAD_WHEN})`,
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
    // 0078 (bank_receipts) is journaled after this head and needs users.
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)

    await ctx.pool.query(readFileSync(AMOUNT_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(CORRECTION_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0066', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('adds adjustment_kind and generated accounting_amount through migrate()', async () => {
    const cols = await ctx.db.execute<{
      column_name: string
      is_nullable: string
    }>(sql`
      SELECT column_name, is_nullable
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'invoices'
         AND column_name IN ('adjustment_kind', 'accounting_amount')
       ORDER BY column_name
    `)
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'accounting_amount',
      'adjustment_kind',
    ])

    const generated = await ctx.pool.query<{ attgenerated: string }>(
      `SELECT a.attgenerated
         FROM pg_attribute a
        WHERE a.attrelid = 'invoices'::regclass
          AND a.attname = 'accounting_amount'`,
    )
    expect(generated.rows[0]!.attgenerated).toBe('s')
  })

  it('adds the kind/link CHECK as NOT VALID through migrate()', async () => {
    const row = await ctx.pool.query<{ convalidated: boolean }>(
      `SELECT convalidated
         FROM pg_constraint
        WHERE conname = 'ck_invoices_adjustment_kind_matches_link'
          AND conrelid = 'invoices'::regclass`,
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]!.convalidated).toBe(false)
  })

  it('records 0067 in the migrator bookkeeping table', async () => {
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
