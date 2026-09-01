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
const ATTACHMENT_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0072_wallet_tx_receipt_attachment_unique.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(ATTACHMENT_MIGRATION, 'utf8')

/**
 * Drift guard + real-PostgreSQL enforcement for the bank-receipt
 * attachment unique index (T-04.2.02.03).
 */
describe('wallet_transactions receipt_attachment_key schema (T-04.2.02.03)', () => {
  it('Drizzle schema declares the nullable receiptAttachmentKey column', () => {
    const byName = Object.fromEntries(
      getTableConfig(walletTransactions).columns.map((column) => [column.name, column]),
    )
    expect(byName.receipt_attachment_key).toBeDefined()
    expect(byName.receipt_attachment_key?.notNull).toBe(false)
    expect(byName.receipt_attachment_key?.getSQLType()).toBe('text')
  })

  it('Drizzle schema declares the partial unique index', () => {
    const { indexes } = getTableConfig(walletTransactions)
    const unique = indexes.find((idx) => idx.config.name === 'uq_wallet_tx_receipt_attachment')
    expect(unique).toBeDefined()
    expect(unique!.config.unique).toBe(true)
  })

  it('migration 0072 still declares the column and partial unique index', () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS receipt_attachment_key TEXT')
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_tx_receipt_attachment',
    )
    expect(MIGRATION).toMatch(
      /ON wallet_transactions \(receipt_attachment_key\)[\s\S]*WHERE receipt_attachment_key IS NOT NULL/,
    )
  })

  it('migration 0072 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0072_wallet_tx_receipt_attachment_unique',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(72)
    const prior = journal.entries.find(
      (row) => row.tag === '0071_wallet_topup_callback_events_processing_status',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('wallet_transactions receipt_attachment_key PostgreSQL enforcement (T-04.2.02.03)', () => {
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
    await ctx.pool.query(readFileSync(ATTACHMENT_MIGRATION, 'utf-8').trim())
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

  async function insertTopUp(opts: {
    idempotencyKey: string
    receiptAttachmentKey?: string | null
  }) {
    return ctx.pool.query(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, receipt_attachment_key)
       VALUES ($1, 'topup', 1000, 'Pending', $2, $3)`,
      [walletId, opts.idempotencyKey, opts.receiptAttachmentKey ?? null],
    )
  }

  it('refuses a second top-up that reuses the same receipt attachment', async () => {
    const key = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
    await insertTopUp({ idempotencyKey: 'receipt-unique-a', receiptAttachmentKey: key })
    await expect(
      insertTopUp({ idempotencyKey: 'receipt-unique-b', receiptAttachmentKey: key }),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('allows multiple NULL receipt_attachment_key rows (online top-ups)', async () => {
    await insertTopUp({ idempotencyKey: 'online-a' })
    await insertTopUp({ idempotencyKey: 'online-b' })
    const count = await ctx.db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n
      FROM wallet_transactions
      WHERE receipt_attachment_key IS NULL
    `)
    expect(Number(count.rows[0]?.n)).toBeGreaterThanOrEqual(2)
  })
})
