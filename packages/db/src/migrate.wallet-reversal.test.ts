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
 * Proves production `migrate()` applies migration 0074. Hand-running the
 * SQL file is not enough: drizzle-orm only executes tags listed in
 * `drizzle/meta/_journal.json`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const WALLET_TX_MIGRATION = resolve(DRIZZLE_FOLDER, '0068_create_wallet_transactions.sql')
const TAG = '0074_wallet_tx_reverses_transaction'
/** `when` of journal tag 0073 — last entry before 0074 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1789257600000

describe('drizzle migrate() applies wallet reversal original pointer (T-04.2.04.01)', () => {
  let ctx: IsolatedTestDb
  let migrationWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const entry = journal.entries.find((row) => row.tag === TAG)
    if (!entry) {
      throw new Error(`${TAG} is missing from drizzle/meta/_journal.json`)
    }
    if (entry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${TAG} journal 'when' (${entry.when}) must be after 0073 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    migrationWhen = entry.when

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
      ['prior-journal-head-0073', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('adds reverses_transaction_id through the journaled migrate() path', async () => {
    const columns = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'wallet_transactions'
        AND column_name = 'reverses_transaction_id'
    `)
    expect(columns.rows).toHaveLength(1)
  })

  it('records 0074 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(migrationWhen)
  })

  it('creates the partial unique index on reverses_transaction_id', async () => {
    const indexes = await ctx.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'uq_wallet_tx_reverses_transaction'`,
    )
    expect(indexes.rows).toHaveLength(1)
    expect(indexes.rows[0]?.indexdef).toMatch(/UNIQUE/i)
    expect(indexes.rows[0]?.indexdef).toMatch(/reverses_transaction_id/)
    expect(indexes.rows[0]?.indexdef).toMatch(/WHERE/)
  })
})
