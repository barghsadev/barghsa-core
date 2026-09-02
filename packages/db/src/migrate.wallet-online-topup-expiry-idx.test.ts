import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` applies migration 0076. Hand-running the
 * SQL file is not enough: drizzle-orm only executes tags listed in
 * `drizzle/meta/_journal.json`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const WALLET_TX_MIGRATION = resolve(DRIZZLE_FOLDER, '0068_create_wallet_transactions.sql')
const TAG = '0076_wallet_tx_online_pending_expiry_idx'
/** `when` of journal tag 0075 — last entry before 0076 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1789430400000

describe('drizzle migrate() applies online top-up expiry index (T-04.2.02.07)', () => {
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
        `${TAG} journal 'when' (${entry.when}) must be after 0075 (${PRIOR_JOURNAL_HEAD_WHEN})`,
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

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0075', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('creates the partial expiry index through the journaled migrate() path', async () => {
    const indexes = await ctx.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'idx_wallet_tx_online_pending_created'`,
    )
    expect(indexes.rows).toHaveLength(1)
    expect(indexes.rows[0]?.indexdef).toMatch(/created_at/)
    expect(indexes.rows[0]?.indexdef).toMatch(/WHERE/)
    expect(indexes.rows[0]?.indexdef).toMatch(/channel/)
  })

  it('records 0076 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(migrationWhen)
  })

  it('leaves wallet_transactions in place (index-only expand)', async () => {
    const tables = await ctx.db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'wallet_transactions'
    `)
    expect(tables.rows).toHaveLength(1)
  })
})
