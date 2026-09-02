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
const REVERSAL_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0074_wallet_tx_reverses_transaction.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(REVERSAL_MIGRATION, 'utf8')

/**
 * Drift guard + real-PostgreSQL enforcement for the reversal original
 * pointer (T-04.2.04.01).
 */
describe('wallet_transactions reverses_transaction_id schema (T-04.2.04.01)', () => {
  it('Drizzle schema declares the nullable reversesTransactionId column', () => {
    const byName = Object.fromEntries(
      getTableConfig(walletTransactions).columns.map((column) => [column.name, column]),
    )
    expect(byName.reverses_transaction_id).toBeDefined()
    expect(byName.reverses_transaction_id?.notNull).toBe(false)
    expect(byName.reverses_transaction_id?.getSQLType()).toBe('uuid')
  })

  it('Drizzle schema declares the partial unique index and self-FK', () => {
    const config = getTableConfig(walletTransactions)
    const unique = config.indexes.find(
      (idx) => idx.config.name === 'uq_wallet_tx_reverses_transaction',
    )
    expect(unique).toBeDefined()
    expect(unique!.config.unique).toBe(true)
    const named = config.foreignKeys.find((item) => {
      const ref = item.reference()
      return ref.columns[0]?.name === 'reverses_transaction_id'
    })
    expect(named).toBeDefined()
    expect(named!.onDelete).toBe('restrict')
    expect(named!.reference().foreignColumns[0]?.name).toBe('id')
  })

  it('migration 0074 still declares the column, FK, and partial unique index', () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS reverses_transaction_id UUID')
    expect(MIGRATION).toContain('fk_wallet_tx_reverses_transaction')
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_tx_reverses_transaction',
    )
    expect(MIGRATION).toMatch(
      /ON wallet_transactions \(reverses_transaction_id\)[\s\S]*WHERE reverses_transaction_id IS NOT NULL/,
    )
  })

  it('migration 0074 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0074_wallet_tx_reverses_transaction',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(74)
    const prior = journal.entries.find(
      (row) => row.tag === '0073_create_idempotency_keys',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('wallet_transactions reverses_transaction_id PostgreSQL enforcement (T-04.2.04.01)', () => {
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
    await ctx.pool.query(readFileSync(REVERSAL_MIGRATION, 'utf-8').trim())
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

  async function insertLedger(opts: {
    type: string
    amount: number
    idempotencyKey: string
    reversesTransactionId?: string | null
  }) {
    return ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, reverses_transaction_id)
       VALUES ($1, $2, $3, 'Completed', $4, $5)
       RETURNING id`,
      [
        walletId,
        opts.type,
        opts.amount,
        opts.idempotencyKey,
        opts.reversesTransactionId ?? null,
      ],
    )
  }

  it('refuses a second reversal of the same original', async () => {
    const original = await insertLedger({
      type: 'topup',
      amount: 1000,
      idempotencyKey: 'orig-unique-a',
    })
    const originalId = original.rows[0]!.id
    await insertLedger({
      type: 'reversal',
      amount: -1000,
      idempotencyKey: 'rev-unique-a',
      reversesTransactionId: originalId,
    })
    await expect(
      insertLedger({
        type: 'reversal',
        amount: -1000,
        idempotencyKey: 'rev-unique-b',
        reversesTransactionId: originalId,
      }),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('allows multiple NULL reverses_transaction_id rows', async () => {
    await insertLedger({ type: 'topup', amount: 1000, idempotencyKey: 'null-rev-a' })
    await insertLedger({ type: 'topup', amount: 2000, idempotencyKey: 'null-rev-b' })
    const count = await ctx.db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n
      FROM wallet_transactions
      WHERE reverses_transaction_id IS NULL
    `)
    expect(Number(count.rows[0]?.n)).toBeGreaterThanOrEqual(2)
  })
})
