import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0064. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0063 and already has `invoices`.
 * `migrate()` must then pick up 0064 from the journal and add the
 * correction self-reference columns.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const AMOUNT_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0052_add_invoice_amount_check_constraints.sql',
)
const CORRECTION_TAG = '0064_add_invoice_correction_self_references'
/** `when` of journal tag 0063 — last entry before 0064 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788393600000

describe('drizzle migrate() applies invoice correction self-references (T-04.1.05.01)', () => {
  let ctx: IsolatedTestDb
  let correctionWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const correctionEntry = journal.entries.find((entry) => entry.tag === CORRECTION_TAG)
    if (!correctionEntry) {
      throw new Error(
        `${CORRECTION_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (correctionEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${CORRECTION_TAG} journal 'when' (${correctionEntry.when}) must be after 0063 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    correctionWhen = correctionEntry.when

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
    // 0078 (bank_receipts) is journaled after this head and needs users.
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)

    const amountSql = readFileSync(AMOUNT_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(amountSql)

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0063', PRIOR_JOURNAL_HEAD_WHEN],
    )

    await migrate(ctx.db, {
      migrationsFolder: DRIZZLE_FOLDER,
      migrationsSchema: ctx.schemaName,
    })
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('adds the correction self-reference columns through the journaled migrate() path', async () => {
    const cols = await ctx.db.execute<{
      column_name: string
      is_nullable: string
      udt_name: string
    }>(sql`
      SELECT column_name, is_nullable, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name IN ('replaces_invoice_id', 'adjustment_for_invoice_id')
      ORDER BY column_name
    `)
    expect(cols.rows.map((row) => row.column_name)).toEqual([
      'adjustment_for_invoice_id',
      'replaces_invoice_id',
    ])
    for (const row of cols.rows) {
      expect(row.is_nullable).toBe('YES')
      expect(row.udt_name).toBe('uuid')
    }
  })

  it('records 0064 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(correctionWhen)
  })
})
