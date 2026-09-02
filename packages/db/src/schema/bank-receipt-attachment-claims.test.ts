import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { bankReceiptAttachmentClaims } from './bank-receipt-attachment-claims.js'

const MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0079_create_bank_receipt_attachment_claims.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')

/**
 * Drift guard + real-PostgreSQL enforcement for
 * bank_receipt_attachment_claims (T-04.3.01.02).
 */
describe('bank_receipt_attachment_claims schema (T-04.3.01.02)', () => {
  it('Drizzle schema mirrors the SQL column set', () => {
    const names = getTableConfig(bankReceiptAttachmentClaims).columns.map((c) => c.name)
    expect(names).toEqual(['storage_key', 'claim_type', 'created_at', 'updated_at'])
  })

  it('Drizzle schema declares the CHECKs and storage_key primary key', () => {
    const config = getTableConfig(bankReceiptAttachmentClaims)
    const checkNames = config.checks.map((c) => String(c.name))
    expect(checkNames).toEqual(
      expect.arrayContaining([
        'chk_bank_receipt_attachment_claims_storage_key_nonblank',
        'chk_bank_receipt_attachment_claims_type',
      ]),
    )
    const storageKey = config.columns.find((column) => column.name === 'storage_key')
    expect(storageKey?.primary).toBe(true)
  })

  it('migration 0079 still declares uniqueness, claim types, and backfill', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS bank_receipt_attachment_claims')
    expect(MIGRATION).toContain('storage_key TEXT PRIMARY KEY')
    expect(MIGRATION).toContain("CHECK (claim_type IN ('wallet_topup', 'invoice_receipt'))")
    expect(MIGRATION).toContain('chk_bank_receipt_attachment_claims_storage_key_nonblank')
    expect(MIGRATION).toContain("SELECT DISTINCT receipt_attachment_key, 'wallet_topup'")
    expect(MIGRATION).toContain("SELECT DISTINCT attachment_key, 'invoice_receipt'")
    expect(MIGRATION).toContain(
      'storage_key already claimed by both wallet_transactions and bank_receipts',
    )
    expect(MIGRATION).toContain('trg_bank_receipt_attachment_claims_updated_at')
    expect(MIGRATION).toContain('ON CONFLICT (storage_key) DO NOTHING')
  })

  it('migration 0079 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0079_create_bank_receipt_attachment_claims',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(79)
    const prior = journal.entries.find((row) => row.tag === '0078_create_bank_receipts')
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('bank_receipt_attachment_claims PostgreSQL enforcement (T-04.3.01.02)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()
    await ctx.pool.query(readFileSync(MIGRATION_PATH, 'utf-8').trim())
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('rejects a second claim for the same storage_key', async () => {
    await ctx.pool.query(
      `INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
       VALUES ('uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf', 'wallet_topup')`,
    )
    await expect(
      ctx.pool.query(
        `INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
         VALUES ('uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf', 'invoice_receipt')`,
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('rejects an unknown claim_type or a blank storage_key', async () => {
    await expect(
      ctx.pool.query(
        `INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
         VALUES ('uploads/document/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf', 'other')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      ctx.pool.query(
        `INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
         VALUES ('   ', 'wallet_topup')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('bank_receipt_attachment_claims backfill (T-04.3.01.02)', () => {
  it('claims existing wallet and invoice attachment keys', async () => {
    const ctx = await createIsolatedTestDb()
    try {
      await ctx.pool.query(`
        CREATE TABLE wallet_transactions (
          receipt_attachment_key TEXT
        )
      `)
      await ctx.pool.query(`
        CREATE TABLE bank_receipts (
          attachment_key TEXT NOT NULL
        )
      `)
      await ctx.pool.query(
        `INSERT INTO wallet_transactions (receipt_attachment_key) VALUES ($1)`,
        ['uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-wallet000000.pdf'],
      )
      await ctx.pool.query(`INSERT INTO bank_receipts (attachment_key) VALUES ($1)`, [
        'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-invoice00000.pdf',
      ])
      await ctx.pool.query(readFileSync(MIGRATION_PATH, 'utf-8').trim())

      const rows = await ctx.pool.query<{ storage_key: string; claim_type: string }>(
        `SELECT storage_key, claim_type
           FROM bank_receipt_attachment_claims
          ORDER BY claim_type`,
      )
      expect(rows.rows).toEqual([
        {
          storage_key: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-invoice00000.pdf',
          claim_type: 'invoice_receipt',
        },
        {
          storage_key: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-wallet000000.pdf',
          claim_type: 'wallet_topup',
        },
      ])
    } finally {
      await ctx.pool.end()
      await dropTestSchema(ctx.schemaName)
    }
  }, 60_000)

  it('fails closed when the same key already backs both flows', async () => {
    const ctx = await createIsolatedTestDb()
    try {
      await ctx.pool.query(`
        CREATE TABLE wallet_transactions (
          receipt_attachment_key TEXT
        )
      `)
      await ctx.pool.query(`
        CREATE TABLE bank_receipts (
          attachment_key TEXT NOT NULL
        )
      `)
      const shared = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-shared000000.pdf'
      await ctx.pool.query(
        `INSERT INTO wallet_transactions (receipt_attachment_key) VALUES ($1)`,
        [shared],
      )
      await ctx.pool.query(`INSERT INTO bank_receipts (attachment_key) VALUES ($1)`, [shared])

      await expect(ctx.pool.query(readFileSync(MIGRATION_PATH, 'utf-8').trim())).rejects.toThrow(
        /already claimed by both wallet_transactions and bank_receipts/,
      )
    } finally {
      await ctx.pool.end()
      await dropTestSchema(ctx.schemaName)
    }
  }, 60_000)
})
