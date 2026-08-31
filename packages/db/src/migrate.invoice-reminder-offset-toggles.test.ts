import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0062. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0061 and already has `users` (FK
 * target). `migrate()` must then pick up 0062 from the journal and
 * create `invoice_reminder_offset_toggles`. 0063 (cancel reminders on
 * stop state) is journaled after 0062 so migrate() also applies it and
 * needs `invoices` plus `invoice_reminder_schedule`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const TOGGLES_TAG = '0062_create_invoice_reminder_offset_toggles'
/** `when` of journal tag 0061 — last entry before 0062 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788220800000
const AMOUNT_MIGRATION = resolve(DRIZZLE_FOLDER, '0052_add_invoice_amount_check_constraints.sql')
const REMINDER_TABLE_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0060_create_invoice_reminder_schedule.sql',
)

describe('drizzle migrate() applies invoice_reminder_offset_toggles (T-04.1.04.05)', () => {
  let ctx: IsolatedTestDb
  let togglesWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const togglesEntry = journal.entries.find((entry) => entry.tag === TOGGLES_TAG)
    if (!togglesEntry) {
      throw new Error(
        `${TOGGLES_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (togglesEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${TOGGLES_TAG} journal 'when' (${togglesEntry.when}) must be after 0061 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    togglesWhen = togglesEntry.when

    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)
    // 0063 (cancel-on-stop-state) is journaled after 0062; migrate() will
    // also apply it and needs the invoices + reminder-schedule tables.
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
    await ctx.pool.query(readFileSync(REMINDER_TABLE_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0061', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('creates invoice_reminder_offset_toggles through the journaled migrate() path', async () => {
    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoice_reminder_offset_toggles'
      ORDER BY ordinal_position
    `)
    expect(cols.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'id',
        'service_type',
        'offset',
        'enabled',
        'updated_by',
        'created_at',
        'updated_at',
      ]),
    )
  })

  it('records 0062 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(togglesWhen)
  })
})
