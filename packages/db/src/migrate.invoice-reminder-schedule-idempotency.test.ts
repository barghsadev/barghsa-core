import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0061. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0060 and already has
 * `invoice_reminder_schedule`. `migrate()` must then pick up 0061 from
 * the journal and create the unique (invoice_id, offset, channel) index.
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
const IDEMPOTENCY_TAG = '0061_add_invoice_reminder_schedule_idempotency'
/** `when` of journal tag 0060 — last entry before 0061 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788134400000

describe('drizzle migrate() applies reminder-schedule unique index (T-04.1.04.04)', () => {
  let ctx: IsolatedTestDb
  let idempotencyWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const idempotencyEntry = journal.entries.find((entry) => entry.tag === IDEMPOTENCY_TAG)
    if (!idempotencyEntry) {
      throw new Error(
        `${IDEMPOTENCY_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (idempotencyEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${IDEMPOTENCY_TAG} journal 'when' (${idempotencyEntry.when}) must be after 0060 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    idempotencyWhen = idempotencyEntry.when

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
      ['prior-journal-head-0060', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('creates the unique index through the journaled migrate() path', async () => {
    const idx = await ctx.db.execute<{ index_name: string }>(sql`
      SELECT indexname AS index_name FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'invoice_reminder_schedule'
        AND indexname = 'uq_invoice_reminder_schedule_invoice_offset_channel'
    `)
    expect(idx.rows).toHaveLength(1)
  })

  it('records 0061 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(idempotencyWhen)
  })
})
