import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import {
  WALLET_TRANSACTION_STATES,
  WALLET_TRANSACTION_TYPES,
  walletTransactions,
  wallets,
} from './wallets.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0068_create_wallet_transactions.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')

/**
 * Drift guard + real-PostgreSQL enforcement for wallet_transactions
 * (T-04.2.01.02).
 *
 * CHECKs, the unique idempotency index, lookup indexes, and the
 * `updated_at` trigger live in migration 0068. This file asserts the
 * migration still declares them, that the Drizzle schema matches the
 * S-04.2.01 column set, and that PostgreSQL actually enforces the
 * invariants.
 */
describe('wallet_transactions schema (T-04.2.01.02)', () => {
  it('declares the domain columns expected by WalletService', () => {
    const columns = Object.keys(walletTransactions)
    for (const column of [
      'id',
      'walletId',
      'type',
      'amount',
      'state',
      'idempotencyKey',
      'refId',
      'description',
      'metadata',
      'createdAt',
      'updatedAt',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('maps id and walletId as UUID columns matching migration 0068', () => {
    const byName = Object.fromEntries(
      getTableConfig(walletTransactions).columns.map((column) => [column.name, column]),
    )
    expect(byName.id?.getSQLType()).toBe('uuid')
    expect(byName.wallet_id?.getSQLType()).toBe('uuid')
    expect(byName.amount?.getSQLType()).toBe('bigint')
    expect(byName.metadata?.getSQLType()).toBe('jsonb')
  })

  it('exports the closed type and state enumerations', () => {
    expect(WALLET_TRANSACTION_TYPES).toEqual([
      'topup',
      'payment',
      'refund',
      'reservation',
      'release',
      'reversal',
      'compensating',
    ])
    expect(WALLET_TRANSACTION_STATES).toEqual([
      'Pending',
      'Reserved',
      'Completed',
      'Failed',
      'Rejected',
      'Released',
      'Reversed',
    ])
  })

  it('Drizzle schema mirrors the SQL column set', () => {
    const names = getTableConfig(walletTransactions).columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'wallet_id',
        'type',
        'amount',
        'state',
        'idempotency_key',
        'ref_id',
        'description',
        'metadata',
        'created_at',
        'updated_at',
      ]),
    )
  })

  it('wallet_id references wallets with RESTRICT', () => {
    const fks = getTableConfig(walletTransactions).foreignKeys
    const walletFk = fks.find((fk) => fk.reference().foreignTable === wallets)
    expect(walletFk).toBeDefined()
    expect(walletFk!.onDelete).toBe('restrict')
  })

  it('Drizzle schema declares the unique idempotency index', () => {
    const { indexes } = getTableConfig(walletTransactions)
    const unique = indexes.find((idx) => idx.config.name === 'idx_wallet_tx_idempotency')
    expect(unique).toBeDefined()
    expect(unique!.config.unique).toBe(true)
  })

  it('migration 0068 still declares the constraints the table relies on', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS wallet_transactions')
    expect(MIGRATION).toContain(
      "CHECK (type IN ('topup', 'payment', 'refund', 'reservation', 'release', 'reversal', 'compensating'))",
    )
    expect(MIGRATION).toContain(
      "CHECK (state IN ('Pending', 'Reserved', 'Completed', 'Failed', 'Rejected', 'Released', 'Reversed'))",
    )
    expect(MIGRATION).toContain('CHECK (amount <> 0)')
    expect(MIGRATION).toContain('chk_wallet_transactions_type')
    expect(MIGRATION).toContain('chk_wallet_transactions_state')
    expect(MIGRATION).toContain('chk_wallet_transactions_amount_nonzero')
    expect(MIGRATION).toContain('REFERENCES wallets(profile_id) ON DELETE RESTRICT')
    expect(MIGRATION).toContain('DEFAULT uuid_generate_v7()')
    expect(MIGRATION).toContain("metadata JSONB NOT NULL DEFAULT '{}'::jsonb")
    expect(MIGRATION).toContain('trg_wallet_transactions_updated_at')
    expect(MIGRATION).toContain('idx_wallet_tx_wallet_id')
    expect(MIGRATION).toContain('idx_wallet_tx_state')
    expect(MIGRATION).toContain('idx_wallet_tx_type')
    expect(MIGRATION).toContain('idx_wallet_tx_idempotency')
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idempotency')
  })

  it('migration 0068 is idempotent (matching sibling migrations)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS wallet_transactions')
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS wallets')
    expect(MIGRATION).toContain('DROP TRIGGER IF EXISTS trg_wallet_transactions_updated_at')
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id')
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idempotency')
  })

  it('migration 0068 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find((row) => row.tag === '0068_create_wallet_transactions')
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(68)
    const prior = journal.entries.find(
      (row) => row.tag === '0067_invoice_adjustment_kind_accounting_amount',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('wallet_transactions PostgreSQL enforcement (T-04.2.01.02)', () => {
  let ctx: IsolatedTestDb
  let walletId: string
  let keySeq = 0

  function nextKey(): string {
    keySeq += 1
    return `idem-${keySeq}`
  }

  async function insertTx(opts: {
    walletId?: string
    type?: string
    amount?: bigint | number
    state?: string
    idempotencyKey?: string
    refId?: string | null
    description?: string | null
  } = {}): Promise<string> {
    const result = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, ref_id, description)
       VALUES ($1, $2, $3::bigint, $4, $5, $6, $7)
       RETURNING id`,
      [
        opts.walletId ?? walletId,
        opts.type ?? 'topup',
        opts.amount ?? 1_000_000,
        opts.state ?? 'Pending',
        opts.idempotencyKey ?? nextKey(),
        opts.refId === undefined ? null : opts.refId,
        opts.description === undefined ? null : opts.description,
      ],
    )
    return result.rows[0]!.id
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.db.execute(sql`INSERT INTO profiles (id) VALUES (uuid_generate_v7())`)

    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(migrationSql)

    const inserted = await ctx.db.execute<{ profile_id: string }>(sql`
      INSERT INTO wallets (profile_id)
      VALUES ((SELECT id FROM profiles LIMIT 1))
      RETURNING profile_id
    `)
    walletId = inserted.rows[0]!.profile_id
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('accepts a valid credit top-up in Pending', async () => {
    const id = await insertTx({ type: 'topup', amount: 2_000_000, state: 'Pending' })
    const row = await ctx.db.execute<{
      type: string
      amount: string
      state: string
      metadata: unknown
    }>(sql`
      SELECT type, amount::text AS amount, state, metadata
      FROM wallet_transactions
      WHERE id = ${id}
    `)
    expect(row.rows[0]).toMatchObject({
      type: 'topup',
      amount: '2000000',
      state: 'Pending',
      metadata: {},
    })
  })

  it('accepts a negative debit payment and optional ref/description', async () => {
    const id = await insertTx({
      type: 'payment',
      amount: -500_000,
      state: 'Completed',
      refId: 'inv-1',
      description: 'invoice settlement',
    })
    const row = await ctx.db.execute<{
      amount: string
      ref_id: string | null
      description: string | null
    }>(sql`
      SELECT amount::text AS amount, ref_id, description
      FROM wallet_transactions
      WHERE id = ${id}
    `)
    expect(row.rows[0]).toMatchObject({
      amount: '-500000',
      ref_id: 'inv-1',
      description: 'invoice settlement',
    })
  })

  it('defaults state to Pending and metadata to {} when omitted', async () => {
    const result = await ctx.pool.query<{
      state: string
      metadata: unknown
      id: string
    }>(
      `INSERT INTO wallet_transactions (wallet_id, type, amount, idempotency_key)
       VALUES ($1, 'refund', 100, $2)
       RETURNING id, state, metadata`,
      [walletId, nextKey()],
    )
    expect(result.rows[0]).toMatchObject({ state: 'Pending', metadata: {} })
    expect(result.rows[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('accepts every canonical type and state', async () => {
    for (const type of WALLET_TRANSACTION_TYPES) {
      await expect(insertTx({ type, amount: 1 })).resolves.toBeTruthy()
    }
    for (const state of WALLET_TRANSACTION_STATES) {
      await expect(insertTx({ type: 'topup', state, amount: 1 })).resolves.toBeTruthy()
    }
  })

  it('rejects an unknown type', async () => {
    await expect(insertTx({ type: 'chargeback' })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_wallet_transactions_type'),
    })
  })

  it('rejects an unknown state', async () => {
    await expect(insertTx({ state: 'Settled' })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_wallet_transactions_state'),
    })
  })

  it('rejects a zero amount', async () => {
    await expect(insertTx({ amount: 0 })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_wallet_transactions_amount_nonzero'),
    })
  })

  it('rejects a missing wallet (FK)', async () => {
    await expect(
      insertTx({ walletId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('restricts deleting a wallet that still has ledger rows', async () => {
    await insertTx({ type: 'topup', amount: 1 })
    await expect(
      ctx.db.execute(sql`DELETE FROM wallets WHERE profile_id = ${walletId}`),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects a duplicate idempotency key', async () => {
    const key = nextKey()
    await insertTx({ idempotencyKey: key })
    await expect(insertTx({ idempotencyKey: key })).rejects.toMatchObject({
      code: '23505',
    })
  })

  it('creates the lookup indexes, unique idempotency index, and updated_at trigger', async () => {
    const indexes = await ctx.db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = ${ctx.schemaName}
        AND indexname IN (
          'idx_wallet_tx_wallet_id',
          'idx_wallet_tx_state',
          'idx_wallet_tx_type',
          'idx_wallet_tx_idempotency'
        )
      ORDER BY indexname
    `)
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'idx_wallet_tx_idempotency',
      'idx_wallet_tx_state',
      'idx_wallet_tx_type',
      'idx_wallet_tx_wallet_id',
    ])

    const id = await insertTx({ type: 'reservation', amount: 10, state: 'Reserved' })
    const before = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM wallet_transactions WHERE id = ${id}
    `)
    await ctx.db.execute(sql`
      UPDATE wallet_transactions SET state = 'Released' WHERE id = ${id}
    `)
    const after = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM wallet_transactions WHERE id = ${id}
    `)
    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.rows[0]!.updated_at).getTime(),
    )
  })

  it('migration 0068 is idempotent — re-running keeps enforcement', async () => {
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    await expect(insertTx({ type: 'wire' })).rejects.toMatchObject({
      code: '23514',
    })
    await expect(insertTx({ amount: 0 })).rejects.toMatchObject({
      code: '23514',
    })
  })
})
