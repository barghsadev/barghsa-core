import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createIsolatedTestDb,
  dropTestSchema,
  seedBankReceiptsPrerequisites,
} from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` applies migration 0079. Hand-running the
 * SQL file is not enough: drizzle-orm only executes tags listed in
 * `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0078. `migrate()` must then pick up
 * 0079 from the journal and create `bank_receipt_attachment_claims`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const TAG = '0079_create_bank_receipt_attachment_claims'
/** `when` of journal tag 0078 — last entry before 0079 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1789689600000

describe('drizzle migrate() applies bank_receipt_attachment_claims (T-04.3.01.02)', () => {
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
        `${TAG} journal 'when' (${entry.when}) must be after 0078 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    migrationWhen = entry.when

    ctx = await createIsolatedTestDb()
    // 0078 is already recorded as applied; seed its FK targets in case a
    // later journaled file still expects invoices/profiles/users.
    await seedBankReceiptsPrerequisites(ctx.pool)

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0078', PRIOR_JOURNAL_HEAD_WHEN],
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

  it('creates bank_receipt_attachment_claims through the journaled migrate() path', async () => {
    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'bank_receipt_attachment_claims'
      ORDER BY ordinal_position
    `)
    expect(cols.rows.map((row) => row.column_name)).toEqual([
      'storage_key',
      'claim_type',
      'created_at',
      'updated_at',
    ])
  })

  it('records 0079 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(migrationWhen)
  })

  it('creates the primary-key unique index on storage_key', async () => {
    const indexes = await ctx.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'bank_receipt_attachment_claims'`,
    )
    expect(indexes.rows.some((row) => /UNIQUE/i.test(row.indexdef))).toBe(true)
    expect(indexes.rows.some((row) => /storage_key/.test(row.indexdef))).toBe(true)
  })
})
