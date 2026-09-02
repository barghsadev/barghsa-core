import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` applies migration 0078. Hand-running the
 * SQL file is not enough: drizzle-orm only executes tags listed in
 * `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0077 and already has `invoices`,
 * `profiles`, and `users` (FK targets). `migrate()` must then pick up
 * 0078 from the journal and create `bank_receipts`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const INVOICES_MIGRATION = resolve(
  DRIZZLE_FOLDER,
  '0052_add_invoice_amount_check_constraints.sql',
)
const TAG = '0078_create_bank_receipts'
/** `when` of journal tag 0077 — last entry before 0078 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1789603200000

describe('drizzle migrate() applies bank_receipts (T-04.3.01.01)', () => {
  let ctx: IsolatedTestDb
  let migrationWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const entry = journal.entries.find((row) => row.tag === TAG)
    if (!entry) {
      throw new Error(`${TAG} is missing from drizzle/meta/_journal.json`)
    }
    if (entry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${TAG} journal 'when' (${entry.when}) must be after 0077 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    migrationWhen = entry.when

    ctx = await createIsolatedTestDb()
    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)
    await ctx.pool.query(`
      CREATE TYPE invoice_state AS ENUM (
        'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
        'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0077', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('creates bank_receipts through the journaled migrate() path', async () => {
    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'bank_receipts'
      ORDER BY ordinal_position
    `)
    expect(cols.rows.map((row) => row.column_name)).toEqual([
      'id',
      'invoice_id',
      'profile_id',
      'amount',
      'payment_date',
      'payer_reference',
      'attachment_key',
      'customer_note',
      'state',
      'confirmed_by',
      'confirmed_at',
      'rejection_reason',
      'created_at',
      'updated_at',
    ])
  })

  it('records 0078 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(migrationWhen)
  })

  it('creates the unique attachment index, confirmed_by FK, and invoice-profile composite FK', async () => {
    const indexes = await ctx.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'uq_bank_receipts_attachment_key'`,
    )
    expect(indexes.rows).toHaveLength(1)
    expect(indexes.rows[0]?.indexdef).toMatch(/UNIQUE/i)
    expect(indexes.rows[0]?.indexdef).toMatch(/attachment_key/)

    const fks = await ctx.pool.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE conrelid = 'bank_receipts'::regclass
          AND conname IN (
            'fk_bank_receipts_confirmed_by',
            'fk_bank_receipts_invoice_profile'
          )
        ORDER BY conname`,
    )
    expect(fks.rows.map((row) => row.conname)).toEqual([
      'fk_bank_receipts_confirmed_by',
      'fk_bank_receipts_invoice_profile',
    ])

    const invoiceUnique = await ctx.pool.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE conrelid = 'invoices'::regclass
          AND conname = 'uq_invoices_id_profile_id'`,
    )
    expect(invoiceUnique.rows).toHaveLength(1)
  })
})

describe('drizzle migrate() fails closed when bank_receipts FKs are missing', () => {
  it('does not record 0078 when invoices are absent', async () => {
    const ctx = await createIsolatedTestDb()
    try {
      await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
      await ctx.pool.query(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `)
      await ctx.pool.query(
        `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        ['prior-journal-head-0077', PRIOR_JOURNAL_HEAD_WHEN],
      )

      await expect(
        migrate(ctx.db, {
          migrationsFolder: DRIZZLE_FOLDER,
          migrationsSchema: ctx.schemaName,
        }),
      ).rejects.toThrow()

      const recorded = await ctx.pool.query<{ created_at: string }>(
        `SELECT created_at::text AS created_at
           FROM __drizzle_migrations
          WHERE created_at > $1`,
        [PRIOR_JOURNAL_HEAD_WHEN],
      )
      expect(recorded.rows).toHaveLength(0)

      const rel = await ctx.pool.query<{ rel: string | null }>(
        `SELECT to_regclass('bank_receipts')::text AS rel`,
      )
      expect(rel.rows[0]?.rel).toBeNull()
    } finally {
      await ctx.pool.end()
      await dropTestSchema(ctx.schemaName)
    }
  }, 60_000)
})
