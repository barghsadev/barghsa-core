import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createIsolatedTestDb,
  dropTestSchema,
  seedBankReceiptsPrerequisites,
} from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` applies migration 0070. Hand-running the
 * SQL file is not enough: drizzle-orm only executes tags listed in
 * `drizzle/meta/_journal.json`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const WALLET_TX_MIGRATION = resolve(DRIZZLE_FOLDER, '0068_create_wallet_transactions.sql')
const CALLBACK_TAG = '0070_create_wallet_topup_callback_events'
const PROCESSING_TAG = '0071_wallet_topup_callback_events_processing_status'
/** `when` of journal tag 0069 — last entry before 0070 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788912000000

describe('drizzle migrate() applies wallet_topup_callback_events (T-04.2.02.02)', () => {
  let ctx: IsolatedTestDb
  let callbackWhen: number
  let processingWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const entry = journal.entries.find((row) => row.tag === CALLBACK_TAG)
    if (!entry) {
      throw new Error(`${CALLBACK_TAG} is missing from drizzle/meta/_journal.json`)
    }
    if (entry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${CALLBACK_TAG} journal 'when' (${entry.when}) must be after 0069 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    const processing = journal.entries.find((row) => row.tag === PROCESSING_TAG)
    if (!processing) {
      throw new Error(`${PROCESSING_TAG} is missing from drizzle/meta/_journal.json`)
    }
    if (processing.when <= entry.when) {
      throw new Error(
        `${PROCESSING_TAG} journal 'when' (${processing.when}) must be after 0070 (${entry.when})`,
      )
    }
    callbackWhen = entry.when
    processingWhen = processing.when

    ctx = await createIsolatedTestDb()
    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await seedBankReceiptsPrerequisites(ctx.pool)

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0069', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('creates wallet_topup_callback_events through the journaled migrate() path', async () => {
    const tables = await ctx.db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'wallet_topup_callback_events'
    `)
    expect(tables.rows).toHaveLength(1)
  })

  it('records 0070 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(callbackWhen)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(processingWhen)
  })

  it('widens the status CHECK so processing claims are allowed', async () => {
    const check = await ctx.pool.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc
         FROM pg_constraint
        WHERE conname = 'chk_wallet_topup_callback_events_status'
          AND conrelid = 'wallet_topup_callback_events'::regclass`,
    )
    expect(check.rows[0]?.consrc).toContain('processing')
  })
})
