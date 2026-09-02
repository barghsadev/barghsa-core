import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { idempotencyKeys } from './idempotency-keys.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const MIGRATION_PATH = resolve(__dirname, '../../drizzle/0073_create_idempotency_keys.sql')
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')

/**
 * Drift guard + real-PostgreSQL enforcement for idempotency_keys
 * (T-04.2.03.03).
 */
describe('idempotency_keys schema (T-04.2.03.03)', () => {
  it('Drizzle table has the unique (idempotencyKey, entityType) index', () => {
    const config = getTableConfig(idempotencyKeys)
    expect(config.name).toBe('idempotency_keys')
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'idempotency_key',
      'entity_type',
      'entity_id',
      'response',
      'expires_at',
      'created_at',
      'updated_at',
    ])
    const unique = config.indexes.find(
      (idx) => idx.config.name === 'uq_idempotency_keys_key_entity_type',
    )
    expect(unique).toBeDefined()
    expect(unique!.config.unique).toBe(true)
  })

  it('migration 0073 still declares the unique index on (idempotency_key, entity_type)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS idempotency_keys')
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_key_entity_type',
    )
    expect(MIGRATION).toMatch(/ON idempotency_keys \(idempotency_key, entity_type\)/)
    expect(MIGRATION).toContain('response JSONB')
    expect(MIGRATION).toContain('entity_type TEXT NOT NULL')
  })

  it('migration 0073 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find((row) => row.tag === '0073_create_idempotency_keys')
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(73)
    const prior = journal.entries.find(
      (row) => row.tag === '0072_wallet_tx_receipt_attachment_unique',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('idempotency_keys PostgreSQL enforcement (T-04.2.03.03)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()
    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(MIGRATION_PATH, 'utf-8').trim())
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('refuses a second row with the same (idempotency_key, entity_type)', async () => {
    await ctx.pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type, entity_id, response)
       VALUES ('pay-1', 'invoice_wallet_payment', 'inv-a', '{"ok":true}'::jsonb)`,
    )
    await expect(
      ctx.pool.query(
        `INSERT INTO idempotency_keys (idempotency_key, entity_type, entity_id)
         VALUES ('pay-1', 'invoice_wallet_payment', 'inv-b')`,
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('allows the same idempotency key under a different entity_type', async () => {
    await ctx.pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type)
       VALUES ('pay-shared', 'invoice_wallet_payment')`,
    )
    await ctx.pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type)
       VALUES ('pay-shared', 'wallet_topup')`,
    )
    const count = await ctx.db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n
      FROM idempotency_keys
      WHERE idempotency_key = 'pay-shared'
    `)
    expect(Number(count.rows[0]?.n)).toBe(2)
  })

  it('rejects a blank idempotency_key or entity_type', async () => {
    await expect(
      ctx.pool.query(
        `INSERT INTO idempotency_keys (idempotency_key, entity_type)
         VALUES ('   ', 'invoice_wallet_payment')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      ctx.pool.query(
        `INSERT INTO idempotency_keys (idempotency_key, entity_type)
         VALUES ('pay-blank-type', '  ')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
