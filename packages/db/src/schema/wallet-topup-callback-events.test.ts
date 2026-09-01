import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { walletTopupCallbackEvents } from './wallet-topup-callback-events.js'
import { walletTransactions, wallets } from './wallets.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const WALLET_TX_MIGRATION = resolve(__dirname, '../../drizzle/0068_create_wallet_transactions.sql')
const MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0070_create_wallet_topup_callback_events.sql',
)
const PROCESSING_MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0071_wallet_topup_callback_events_processing_status.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')
const PROCESSING_MIGRATION = readFileSync(PROCESSING_MIGRATION_PATH, 'utf8')

describe('wallet_topup_callback_events schema (T-04.2.02.02)', () => {
  it('Drizzle table has the event-id unique index and FKs', () => {
    const config = getTableConfig(walletTopupCallbackEvents)
    expect(config.name).toBe('wallet_topup_callback_events')
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'event_id',
      'pending_transaction_id',
      'wallet_id',
      'status',
      'raw',
      'created_at',
    ])
    const unique = config.indexes.find(
      (idx) => idx.config.name === 'uq_wallet_topup_callback_event_id',
    )
    expect(unique).toBeDefined()
    expect(unique!.config.unique).toBe(true)
    const pendingFk = config.foreignKeys.find(
      (fk) => fk.reference().foreignTable === walletTransactions,
    )
    const walletFk = config.foreignKeys.find((fk) => fk.reference().foreignTable === wallets)
    expect(pendingFk?.onDelete).toBe('restrict')
    expect(walletFk?.onDelete).toBe('restrict')
  })

  it('migration 0070 is idempotent and registered in the journal', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS wallet_topup_callback_events')
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_callback_event_id')
    expect(MIGRATION).toContain("CHECK (status IN ('credited', 'unpaid', 'duplicate'))")
    expect(PROCESSING_MIGRATION).toContain(
      "CHECK (status IN ('processing', 'credited', 'unpaid', 'duplicate'))",
    )
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find((row) => row.tag === '0070_create_wallet_topup_callback_events')
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(70)
    expect(entry!.when).toBeGreaterThan(1788912000000)
    const processing = journal.entries.find(
      (row) => row.tag === '0071_wallet_topup_callback_events_processing_status',
    )
    expect(processing).toBeDefined()
    expect(processing!.idx).toBe(71)
    expect(processing!.when).toBeGreaterThan(entry!.when)
  })
})

describe('wallet_topup_callback_events PostgreSQL enforcement (T-04.2.02.02)', () => {
  let ctx: IsolatedTestDb
  const profileId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()
    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(MIGRATION_PATH, 'utf-8').trim())
    await ctx.pool.query(readFileSync(PROCESSING_MIGRATION_PATH, 'utf-8').trim())
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1)`, [profileId])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [profileId])
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('rejects a duplicate event_id', async () => {
    const tx = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key)
       VALUES ($1, 'topup', 1000, 'Pending', 'cb-schema-1')
       RETURNING id`,
      [profileId],
    )
    const pendingId = tx.rows[0]!.id
    await ctx.db.execute(sql`
      INSERT INTO wallet_topup_callback_events
        (event_id, pending_transaction_id, wallet_id, status)
      VALUES ('evt-dup', ${pendingId}::uuid, ${profileId}::uuid, 'credited')
    `)
    await expect(
      ctx.db.execute(sql`
        INSERT INTO wallet_topup_callback_events
          (event_id, pending_transaction_id, wallet_id, status)
        VALUES ('evt-dup', ${pendingId}::uuid, ${profileId}::uuid, 'credited')
      `),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('accepts a processing claim status after migration 0071', async () => {
    const tx = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key)
       VALUES ($1, 'topup', 1000, 'Pending', 'cb-schema-processing')
       RETURNING id`,
      [profileId],
    )
    await expect(
      ctx.db.execute(sql`
        INSERT INTO wallet_topup_callback_events
          (event_id, pending_transaction_id, wallet_id, status)
        VALUES ('evt-processing', ${tx.rows[0]!.id}::uuid, ${profileId}::uuid, 'processing')
      `),
    ).resolves.toBeTruthy()
  })
})
