import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from './test/testDb'
import type { IsolatedTestDb } from './test/testDb'

/**
 * Proves production `migrate()` (drizzle-orm journal discovery) applies
 * migration 0059. Hand-running the SQL file is not enough: drizzle-orm
 * only executes tags listed in `drizzle/meta/_journal.json`.
 *
 * The isolated schema is seeded to look like a database that already
 * applied journal entries through 0058 and already has `users` (FK
 * target). `migrate()` must then pick up 0059 from the journal and
 * create `service_due_periods`.
 */

const DRIZZLE_FOLDER = resolve(__dirname, '../drizzle')
const JOURNAL_PATH = resolve(DRIZZLE_FOLDER, 'meta/_journal.json')
const UUIDV7_MIGRATION = resolve(DRIZZLE_FOLDER, '0000_init_uuidv7_function.sql')
const DUE_PERIODS_TAG = '0059_create_service_due_periods'
/** `when` of journal tag 0058 — last entry before 0059 was registered. */
const PRIOR_JOURNAL_HEAD_WHEN = 1750000000000

describe('drizzle migrate() applies service_due_periods (T-04.1.03.01)', () => {
  let ctx: IsolatedTestDb
  let duePeriodsWhen: number

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const duePeriodsEntry = journal.entries.find((entry) => entry.tag === DUE_PERIODS_TAG)
    if (!duePeriodsEntry) {
      throw new Error(
        `${DUE_PERIODS_TAG} is missing from drizzle/meta/_journal.json; migrate() would skip it`,
      )
    }
    if (duePeriodsEntry.when <= PRIOR_JOURNAL_HEAD_WHEN) {
      throw new Error(
        `${DUE_PERIODS_TAG} journal 'when' (${duePeriodsEntry.when}) must be after 0058 (${PRIOR_JOURNAL_HEAD_WHEN})`,
      )
    }
    duePeriodsWhen = duePeriodsEntry.when

    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)

    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    await ctx.pool.query(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      ['prior-journal-head-0058', PRIOR_JOURNAL_HEAD_WHEN],
    )

    await migrate(ctx.db, {
      migrationsFolder: DRIZZLE_FOLDER,
      migrationsSchema: ctx.schemaName,
    })
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('creates service_due_periods through the journaled migrate() path', async () => {
    const cols = await ctx.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'service_due_periods'
      ORDER BY ordinal_position
    `)
    expect(cols.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'id',
        'service_type',
        'default_days',
        'effective_from',
        'effective_until',
        'created_by',
        'created_at',
        'updated_at',
      ]),
    )
  })

  it('records 0059 in the migrator bookkeeping table', async () => {
    const rows = await ctx.pool.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at
       FROM __drizzle_migrations
       WHERE created_at > $1
       ORDER BY created_at ASC`,
      [PRIOR_JOURNAL_HEAD_WHEN],
    )
    expect(rows.rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.rows.map((row) => Number(row.created_at))).toContain(duePeriodsWhen)
  })
})
