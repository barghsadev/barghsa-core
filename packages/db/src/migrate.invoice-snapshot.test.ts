import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0058. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0028 (the previous journal head) and
 * already has `invoices` from 0052 / drizzle-kit push. `migrate()` must
 * then pick up 0058 from the journal and add the snapshot column.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const AMOUNT_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0052_add_invoice_amount_check_constraints.sql',
)
const SNAPSHOT_TAG = '0058_add_invoice_calculation_snapshot'
/** `when` of journal tag 0028 — last entry before 0058 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1721200000000

describe('drizzle migrate() applies invoice_calculation_snapshot (T-04.1.02.08)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const snapshotEntry = journal.entries.find((entry) => entry.tag === SNAPSHOT_TAG)
    if (!snapshotEntry) {
      throw new Error(
        `${SNAPSHOT_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (snapshotEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${SNAPSHOT_TAG} journal 'when' (${snapshotEntry.when}) must be after 0028 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }

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
    // 0059 (service_due_periods) and 0060 (invoice_reminder_schedule)
    // are journaled after 0058; migrate() will also apply them and needs
    // the users FK target (invoices already exist from 0052 above).
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)

    const amountSql = readFileSync(AMOUNT_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(amountSql)

    // Bookkeeping lives in the isolated schema so parallel tests cannot
    // race on the global `drizzle.__drizzle_migrations` table.
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0028', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('adds invoice_calculation_snapshot through the journaled migrate() path', async () => {
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

  it('records 0058 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(1750000000000)
  })
})
