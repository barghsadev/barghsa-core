import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0063. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0062 and already has `invoices` plus
 * `invoice_reminder_schedule`. `migrate()` must then pick up 0063 from
 * the journal and install the stop-state cancel trigger.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const AMOUNT_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0052_add_invoice_amount_check_constraints.sql',
)
const REMINDER_TABLE_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0060_create_invoice_reminder_schedule.sql',
)
const CANCEL_TAG = '0063_cancel_reminders_on_invoice_stop_state'
/** `when` of journal tag 0062 — last entry before 0063 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788307200000

describe('drizzle migrate() applies reminder cancel-on-stop-state (T-04.1.04.06)', () => {
  let ctx: IsolatedTestDb
  let cancelWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const cancelEntry = journal.entries.find((entry) => entry.tag === CANCEL_TAG)
    if (!cancelEntry) {
      throw new Error(
        `${CANCEL_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (cancelEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${CANCEL_TAG} journal 'when' (${cancelEntry.when}) must be after 0062 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    cancelWhen = cancelEntry.when

    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)
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
    const tableSql = readFileSync(REMINDER_TABLE_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(tableSql)

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0062', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('installs the stop-state cancel trigger through the journaled migrate() path', async () => {
    const triggers = await ctx.db.execute<{ tgname: string }>(sql`
      SELECT t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname = 'invoices'
        AND t.tgname = 'trg_cancel_invoice_reminders_on_stop_state'
        AND NOT t.tgisinternal
    `)
    expect(triggers.rows).toHaveLength(1)

    const fn = await ctx.db.execute<{ proname: string }>(sql`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = current_schema()
        AND p.proname = 'cancel_future_invoice_reminders'
    `)
    expect(fn.rows).toHaveLength(1)
  })

  it('records 0063 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(cancelWhen)
  })
})
