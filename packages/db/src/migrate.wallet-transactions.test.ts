import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0068. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0067 and already has `profiles`
 * (wallets FK target). `migrate()` must then pick up 0068 from the
 * journal and create `wallet_transactions`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const WALLET_TX_TAG = '0068_create_wallet_transactions'
/** `when` of journal tag 0067 — last entry before 0068 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1788739200000

describe('drizzle migrate() applies wallet_transactions (T-04.2.01.02)', () => {
  let ctx: IsolatedTestDb
  let walletTxWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const walletTxEntry = journal.entries.find((entry) => entry.tag === WALLET_TX_TAG)
    if (!walletTxEntry) {
      throw new Error(
        `${WALLET_TX_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (walletTxEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${WALLET_TX_TAG} journal 'when' (${walletTxEntry.when}) must be after 0067 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    walletTxWhen = walletTxEntry.when

    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0067', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('creates wallet_transactions through the journaled migrate() path', async () => {
    const cols = await ctx.db.execute<{
      column_name: string
      udt_name: string
      is_nullable: string
      column_default: string | null
    }>(sql`
      SELECT column_name, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'wallet_transactions'
      ORDER BY ordinal_position
    `)
    expect(
      cols.rows.map((row) => ({
        column_name: row.column_name,
        udt_name: row.udt_name,
        is_nullable: row.is_nullable,
      })),
    ).toEqual([
      { column_name: 'id', udt_name: 'uuid', is_nullable: 'NO' },
      { column_name: 'wallet_id', udt_name: 'uuid', is_nullable: 'NO' },
      { column_name: 'type', udt_name: 'text', is_nullable: 'NO' },
      { column_name: 'amount', udt_name: 'int8', is_nullable: 'NO' },
      { column_name: 'state', udt_name: 'text', is_nullable: 'NO' },
      { column_name: 'idempotency_key', udt_name: 'text', is_nullable: 'NO' },
      { column_name: 'ref_id', udt_name: 'text', is_nullable: 'YES' },
      { column_name: 'description', udt_name: 'text', is_nullable: 'YES' },
      { column_name: 'metadata', udt_name: 'jsonb', is_nullable: 'NO' },
      { column_name: 'created_at', udt_name: 'timestamptz', is_nullable: 'NO' },
      { column_name: 'updated_at', udt_name: 'timestamptz', is_nullable: 'NO' },
      { column_name: 'receipt_attachment_key', udt_name: 'text', is_nullable: 'YES' },
      { column_name: 'reverses_transaction_id', udt_name: 'uuid', is_nullable: 'YES' },
    ])
    const byName = Object.fromEntries(cols.rows.map((row) => [row.column_name, row]))
    expect(byName.id?.column_default).toContain('uuid_generate_v7')
    expect(byName.state?.column_default).toContain('Pending')
    expect(byName.metadata?.column_default).toContain('{}')

    const walletPk = await ctx.db.execute<{
      column_name: string
      udt_name: string
    }>(sql`
      SELECT column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'wallets'
        AND column_name = 'profile_id'
    `)
    expect(walletPk.rows[0]).toEqual({ column_name: 'profile_id', udt_name: 'uuid' })
  })

  it('enforces type/state/amount CHECKs and unique idempotency via migrate()', async () => {
    const checks = await ctx.pool.query<{ conname: string }>(
      `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = current_schema()
         AND rel.relname = 'wallet_transactions'
         AND con.contype = 'c'
       ORDER BY con.conname`,
    )
    expect(checks.rows.map((row) => row.conname)).toEqual([
      'chk_wallet_transactions_amount_nonzero',
      'chk_wallet_transactions_state',
      'chk_wallet_transactions_type',
      'chk_wallet_tx_reversal_original',
    ])

    const indexes = await ctx.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema()
         AND tablename = 'wallet_transactions'
         AND indexname IN (
           'idx_wallet_tx_wallet_id',
           'idx_wallet_tx_state',
           'idx_wallet_tx_type',
           'idx_wallet_tx_idempotency'
         )
       ORDER BY indexname`,
    )
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'idx_wallet_tx_idempotency',
      'idx_wallet_tx_state',
      'idx_wallet_tx_type',
      'idx_wallet_tx_wallet_id',
    ])
  })

  it('records 0068 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(walletTxWhen)
  })
})
