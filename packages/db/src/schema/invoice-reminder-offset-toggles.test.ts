import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { invoiceReminderOffsetToggles } from './invoice-reminder-offset-toggles.js'
import { users } from './users.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0062_create_invoice_reminder_offset_toggles.sql',
)
const JOURNAL_PATH = resolve(__dirname, '../../drizzle/meta/_journal.json')
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8')
const ACTOR_USER_ID = '11111111-1111-4111-8111-111111111111'

async function retryOnDeadlock<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if ((err as { code?: string }).code !== '40P01' || attempt === 7) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt))
    }
  }
  throw lastError
}

/**
 * Drift guard + real-PostgreSQL enforcement for
 * invoice_reminder_offset_toggles (T-04.1.04.05).
 */
describe('invoice_reminder_offset_toggles schema (T-04.1.04.05)', () => {
  it('declares the domain columns expected by the admin toggle UI', () => {
    const columns = Object.keys(invoiceReminderOffsetToggles)
    for (const column of ['serviceType', 'offset', 'enabled', 'updatedBy']) {
      expect(columns).toContain(column)
    }
  })

  it('Drizzle schema mirrors the SQL column set', () => {
    const names = getTableConfig(invoiceReminderOffsetToggles).columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'service_type',
        'offset',
        'enabled',
        'updated_by',
        'created_at',
        'updated_at',
      ]),
    )
  })

  it('updated_by references users with RESTRICT', () => {
    const fks = getTableConfig(invoiceReminderOffsetToggles).foreignKeys
    const userFk = fks.find((fk) => fk.reference().foreignTable === users)
    expect(userFk).toBeDefined()
    expect(userFk!.onDelete).toBe('restrict')
  })

  it('declares the unique (service_type, offset) index', () => {
    const indexes = getTableConfig(invoiceReminderOffsetToggles).indexes
    const unique = indexes.find(
      (idx) => idx.config.name === 'uq_invoice_reminder_offset_toggles_type_offset',
    )
    expect(unique).toBeDefined()
    expect(unique!.config.unique).toBe(true)
  })

  it('migration 0062 still declares the constraints the table relies on', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS invoice_reminder_offset_toggles')
    expect(MIGRATION).toContain(
      "CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual'))",
    )
    expect(MIGRATION).toContain('CHECK ("offset" IN (-7, -3, -1, 0, 1, 7))')
    expect(MIGRATION).toContain('REFERENCES users(user_id) ON DELETE RESTRICT')
    expect(MIGRATION).toContain('UNIQUE (service_type, "offset")')
    expect(MIGRATION).toContain('trg_invoice_reminder_offset_toggles_updated_at')
    expect(MIGRATION).toContain('idx_invoice_reminder_offset_toggles_service_type')
  })

  it('migration 0062 is idempotent', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS invoice_reminder_offset_toggles')
    expect(MIGRATION).toContain(
      'DROP TRIGGER IF EXISTS trg_invoice_reminder_offset_toggles_updated_at',
    )
    expect(MIGRATION).toContain(
      'CREATE INDEX IF NOT EXISTS idx_invoice_reminder_offset_toggles_service_type',
    )
  })

  it('migration 0062 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0062_create_invoice_reminder_offset_toggles',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(62)
    const prior = journal.entries.find(
      (row) => row.tag === '0061_add_invoice_reminder_schedule_idempotency',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('invoice_reminder_offset_toggles PostgreSQL enforcement (T-04.1.04.05)', () => {
  let ctx: IsolatedTestDb

  async function insertToggle(opts: {
    serviceType?: string
    offset?: number
    enabled?: boolean
    updatedBy?: string
  } = {}): Promise<string> {
    const result = await ctx.pool.query<{ id: string }>(
      `INSERT INTO invoice_reminder_offset_toggles
         (service_type, "offset", enabled, updated_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        opts.serviceType ?? 'electricity',
        opts.offset ?? -7,
        opts.enabled ?? true,
        opts.updatedBy ?? ACTOR_USER_ID,
      ],
    )
    return result.rows[0]!.id
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestDb()

    const uuidSql = readFileSync(UUIDV7_MIGRATION, 'utf-8').trim()
    await ctx.pool.query(uuidSql)

    await ctx.db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)
    await ctx.db.execute(sql`
      INSERT INTO users (user_id) VALUES (${ACTOR_USER_ID})
    `)

    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await ctx.pool.query(migrationSql)
  })

  beforeEach(async () => {
    await retryOnDeadlock(() => ctx.db.execute(sql`TRUNCATE invoice_reminder_offset_toggles`))
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('accepts a valid electricity -7 toggle', async () => {
    const id = await insertToggle()
    const row = await ctx.db.execute<{
      service_type: string
      offset: number
      enabled: boolean
    }>(sql`
      SELECT service_type, "offset", enabled
      FROM invoice_reminder_offset_toggles
      WHERE id = ${id}
    `)
    expect(row.rows[0]).toMatchObject({
      service_type: 'electricity',
      offset: -7,
      enabled: true,
    })
  })

  it('accepts all four canonical service types and all six offsets', async () => {
    const types = ['electricity', 'saving_plan', 'consultation', 'manual'] as const
    const offsets = [-7, -3, -1, 0, 1, 7] as const
    for (const serviceType of types) {
      for (const offset of offsets) {
        await expect(insertToggle({ serviceType, offset })).resolves.toBeTruthy()
      }
    }
  })

  it('rejects an unknown service type', async () => {
    await expect(insertToggle({ serviceType: 'hardware' })).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('rejects a non-canonical offset', async () => {
    await expect(insertToggle({ offset: 2 })).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('rejects a duplicate (service_type, offset)', async () => {
    await insertToggle({ serviceType: 'manual', offset: 0 })
    await expect(insertToggle({ serviceType: 'manual', offset: 0 })).rejects.toMatchObject({
      code: '23505',
    })
  })

  it('upserts enabled via ON CONFLICT (service_type, offset)', async () => {
    await insertToggle({ serviceType: 'electricity', offset: -3, enabled: true })
    await ctx.pool.query(
      `INSERT INTO invoice_reminder_offset_toggles (service_type, "offset", enabled, updated_by)
       VALUES ('electricity', -3, FALSE, $1)
       ON CONFLICT (service_type, "offset")
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by`,
      [ACTOR_USER_ID],
    )
    const row = await ctx.pool.query<{ enabled: boolean; count: string }>(
      `SELECT enabled, COUNT(*)::text AS count
         FROM invoice_reminder_offset_toggles
        WHERE service_type = 'electricity' AND "offset" = -3
        GROUP BY enabled`,
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]!.enabled).toBe(false)
    expect(row.rows[0]!.count).toBe('1')
  })

  it('stamps updated_at on UPDATE', async () => {
    const id = await insertToggle()
    const before = await ctx.pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM invoice_reminder_offset_toggles WHERE id = $1`,
      [id],
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    await ctx.pool.query(
      `UPDATE invoice_reminder_offset_toggles SET enabled = FALSE WHERE id = $1`,
      [id],
    )
    const after = await ctx.pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM invoice_reminder_offset_toggles WHERE id = $1`,
      [id],
    )
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.rows[0]!.updated_at.getTime())
  })
})
