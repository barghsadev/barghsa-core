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
const REVERSAL_CHECK_MIGRATION = resolve(
  __dirname,
  '../../drizzle/0077_wallet_tx_reversal_original_check.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(REVERSAL_MIGRATION, 'utf8')
const CHECK_MIGRATION = readFileSync(REVERSAL_CHECK_MIGRATION, 'utf8')

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

  it('Drizzle schema declares the reversal-original CHECK', () => {
    const found = getTableConfig(walletTransactions).checks.find(
      (item) => String(item.name) === 'chk_wallet_tx_reversal_original',
    )
    expect(found).toBeDefined()
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

  it('migration 0077 still declares the reversal-original CHECK as NOT VALID', () => {
    expect(CHECK_MIGRATION).toContain('chk_wallet_tx_reversal_original')
    expect(CHECK_MIGRATION).toMatch(
      /type = 'reversal' AND reverses_transaction_id IS NOT NULL/,
    )
    expect(CHECK_MIGRATION).toMatch(
      /type <> 'reversal' AND reverses_transaction_id IS NULL/,
    )
    expect(CHECK_MIGRATION).toContain("column_name = 'reverses_transaction_id'")
    expect(CHECK_MIGRATION).toContain('NOT VALID')
    expect(CHECK_MIGRATION).toMatch(/\) NOT VALID;/)
    expect(CHECK_MIGRATION).toContain('wallet_tx_reversal_check_violations')
  })

  it('migration 0077 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0077_wallet_tx_reversal_original_check',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(77)
    const prior = journal.entries.find(
      (row) => row.tag === '0076_wallet_tx_online_pending_expiry_idx',
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
    await ctx.pool.query(readFileSync(REVERSAL_CHECK_MIGRATION, 'utf-8').trim())
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

  it('refuses a reversal row without an original pointer', async () => {
    await expect(
      insertLedger({
        type: 'reversal',
        amount: -1000,
        idempotencyKey: 'rev-missing-original',
      }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('refuses a non-reversal row that points at an original', async () => {
    const original = await insertLedger({
      type: 'topup',
      amount: 1000,
      idempotencyKey: 'orig-pointer-forbidden',
    })
    await expect(
      insertLedger({
        type: 'compensating',
        amount: -1000,
        idempotencyKey: 'comp-with-pointer',
        reversesTransactionId: original.rows[0]!.id,
      }),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('adds the reversal-original CHECK as NOT VALID', async () => {
    const row = await ctx.pool.query<{ convalidated: boolean }>(
      `SELECT convalidated
         FROM pg_constraint
        WHERE conname = 'chk_wallet_tx_reversal_original'
          AND conrelid = 'wallet_transactions'::regclass`,
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]!.convalidated).toBe(false)
  })
})

/**
 * Upgrade-path test: `type = 'reversal'` rows without
 * `reverses_transaction_id` were legal under 0074 / WalletService.
 * Migration 0077 must not fail on them: it reports the rows and adds
 * the CHECK as NOT VALID so new writes are still enforced.
 */
describe('wallet_transactions reversal CHECK upgrade from 0074 rows (T-04.2.04.01)', () => {
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

  it('reports legacy unlinked reversals and does not fail the migration', async () => {
    const legacy = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, reverses_transaction_id)
       VALUES ($1, 'reversal', -1000, 'Completed', 'legacy-unlinked-reversal', NULL)
       RETURNING id`,
      [walletId],
    )
    const legacyId = legacy.rows[0]!.id

    await expect(
      ctx.pool.query(readFileSync(REVERSAL_CHECK_MIGRATION, 'utf-8').trim()),
    ).resolves.toBeDefined()

    const stillThere = await ctx.pool.query<{ id: string; type: string }>(
      `SELECT id, type FROM wallet_transactions WHERE id = $1`,
      [legacyId],
    )
    expect(stillThere.rows[0]).toEqual({ id: legacyId, type: 'reversal' })

    const reported = await ctx.pool.query<{ transaction_id: string; type: string }>(
      `SELECT transaction_id, type
         FROM wallet_tx_reversal_check_violations
        WHERE transaction_id = $1`,
      [legacyId],
    )
    expect(reported.rows).toHaveLength(1)
    expect(reported.rows[0]!.type).toBe('reversal')

    const constraint = await ctx.pool.query<{ convalidated: boolean }>(
      `SELECT convalidated
         FROM pg_constraint
        WHERE conname = 'chk_wallet_tx_reversal_original'
          AND conrelid = 'wallet_transactions'::regclass`,
    )
    expect(constraint.rows[0]!.convalidated).toBe(false)

    await expect(
      ctx.pool.query(
        `INSERT INTO wallet_transactions
           (wallet_id, type, amount, state, idempotency_key)
         VALUES ($1, 'reversal', -500, 'Completed', 'new-unlinked-reversal')`,
        [walletId],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      ctx.pool.query(readFileSync(REVERSAL_CHECK_MIGRATION, 'utf-8').trim()),
    ).resolves.toBeDefined()
    const again = await ctx.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM wallet_tx_reversal_check_violations`,
    )
    expect(Number(again.rows[0]?.n)).toBe(1)
  })
})
