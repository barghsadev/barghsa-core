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
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0069. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0068 (wallets exists without the
 * available-balance CHECK). `migrate()` must then pick up 0069 and add
 * `chk_wallets_available_balance_nonneg`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const WALLET_TX_MIGRATION = resolve(DRIZZLE_FOLDER, '0068_create_wallet_transactions.sql')
const WALLET_CHECK_TAG = '0069_wallet_available_balance_check'
/** `when` of journal tag 0068 — last entry before 0069 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788825600000

describe('drizzle migrate() applies wallets available-balance CHECK (T-04.2.01.07)', () => {
  let ctx: IsolatedTestDb
  let checkWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const checkEntry = journal.entries.find((entry) => entry.tag === WALLET_CHECK_TAG)
    if (!checkEntry) {
      throw new Error(
        `${WALLET_CHECK_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (checkEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${WALLET_CHECK_TAG} journal 'when' (${checkEntry.when}) must be after 0068 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    checkWhen = checkEntry.when

    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)

    // Pre-0069 wallets table: same columns as migration 0068, no CHECK.
    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS wallets (
        profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
        posted_balance BIGINT NOT NULL DEFAULT 0,
        reserved_balance BIGINT NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    // 0068 also created wallet_transactions. Later journal tags (0070)
    // FK that table, so a post-0068 schema must include it.
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
      ['prior-journal-head-0068', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('adds chk_wallets_available_balance_nonneg through the journaled migrate() path', async () => {
    const rows = await ctx.db.execute<{ conname: string; def: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'wallets'::regclass
        AND conname = 'chk_wallets_available_balance_nonneg'
    `)
    expect(rows.rows).toHaveLength(1)
    const def = rows.rows[0]!.def.replace(/\s+/g, ' ')
    expect(def).toContain('CHECK')
    expect(def).toContain('posted_balance - reserved_balance')
    expect(def).toContain('>= 0')
  })

  it('does not add a stored available_balance column', async () => {
    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'wallets'
      ORDER BY ordinal_position
    `)
    expect(cols.rows.map((row) => row.column_name)).toEqual([
      'profile_id',
      'posted_balance',
      'reserved_balance',
      'version',
      'updated_at',
    ])
  })

  it('records 0069 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(checkWhen)
  })
})
