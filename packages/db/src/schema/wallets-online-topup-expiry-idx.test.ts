import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { walletTransactions } from './wallets.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const TABLE_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0068_create_wallet_transactions.sql',
)
const EXPIRY_IDX_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0076_wallet_tx_online_pending_expiry_idx.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(EXPIRY_IDX_MIGRATION, 'utf8')

/**
 * Drift guard + real-PostgreSQL enforcement for the online Pending
 * top-up expiry candidate index (T-04.2.02.07).
 */
describe('wallet_transactions online pending expiry index schema (T-04.2.02.07)', () => {
  it('Drizzle schema declares the partial expiry candidate index', () => {
    const { indexes } = getTableConfig(walletTransactions)
    const idx = indexes.find((entry) => entry.config.name === 'idx_wallet_tx_online_pending_created')
    expect(idx).toBeDefined()
    expect(idx!.config.unique).toBe(false)
  })

  it('migration 0076 still declares the partial index predicate', () => {
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_wallet_tx_online_pending_created')
    expect(MIGRATION).toMatch(
      /ON wallet_transactions \(created_at ASC, id ASC\)[\s\S]*WHERE type = 'topup'[\s\S]*AND state = 'Pending'[\s\S]*AND metadata->>'channel' = 'online'/,
    )
  })

  it('migration 0076 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0076_wallet_tx_online_pending_expiry_idx',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(76)
    const prior = journal.entries.find((row) => row.tag === '0075_create_wallet_chargeback_events')
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('wallet_transactions online pending expiry index PostgreSQL (T-04.2.02.07)', () => {
  let ctx: IsolatedTestDb
  let walletId: string

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()
    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(TABLE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(EXPIRY_IDX_MIGRATION, 'utf-8').trim())
    const profile = await ctx.pool.query<{ id: string }>(
      `INSERT INTO profiles DEFAULT VALUES RETURNING id`,
    )
    walletId = profile.rows[0]!.id
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [walletId])
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('creates the partial index covering online Pending top-ups only', async () => {
    const indexes = await ctx.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'idx_wallet_tx_online_pending_created'`,
    )
    expect(indexes.rows).toHaveLength(1)
    expect(indexes.rows[0]?.indexdef).toMatch(/created_at/)
    expect(indexes.rows[0]?.indexdef).toMatch(/WHERE/)
    expect(indexes.rows[0]?.indexdef).toMatch(/topup/)
    expect(indexes.rows[0]?.indexdef).toMatch(/Pending/)
    expect(indexes.rows[0]?.indexdef).toMatch(/channel/)
  })

  it('still allows bank-receipt and non-Pending top-ups (predicate excludes them)', async () => {
    await ctx.pool.query(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, metadata)
       VALUES
         ($1, 'topup', 1000, 'Pending', 'online-pending', '{"channel":"online"}'::jsonb),
         ($1, 'topup', 1000, 'Pending', 'bank-pending', '{"channel":"bank_receipt"}'::jsonb),
         ($1, 'topup', 1000, 'Rejected', 'online-rejected', '{"channel":"online"}'::jsonb)`,
      [walletId],
    )
    const count = await ctx.db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM wallet_transactions
    `)
    expect(Number(count.rows[0]?.n)).toBe(3)
  })
})
