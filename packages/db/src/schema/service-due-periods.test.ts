import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '../test/testDb'
import type { IsolatedTestDb } from '../test/testDb'
import { serviceDuePeriods } from './service-due-periods.js'
import { users } from './users.js'

const UUIDV7_MIGRATION = resolve(__dirname, '../../drizzle/0000_init_uuidv7_function.sql')
const MIGRATION_PATH = resolve(
  __dirname,
  '../../drizzle/0059_create_service_due_periods.sql',
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
 * Drift guard + real-PostgreSQL enforcement for service_due_periods
 * (T-04.1.03.01).
 *
 * CHECKs, the GIST EXCLUDE no-overlap constraint, and the `updated_at`
 * trigger live in the hand-written migration 0059 (Drizzle v0.40's
 * column builder has no `.check()` / `.exclude()`). This file asserts
 * the migration still declares them, that the drizzle schema matches
 * the admin-config column set, and that PostgreSQL actually enforces
 * the invariants.
 */
describe('service_due_periods schema (T-04.1.03.01)', () => {
  it('declares the domain columns expected by the admin config surface', () => {
    const columns = Object.keys(serviceDuePeriods)
    for (const column of [
      'serviceType',
      'defaultDays',
      'effectiveFrom',
      'effectiveUntil',
      'createdBy',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('Drizzle schema mirrors the SQL column set', () => {
    const names = getTableConfig(serviceDuePeriods).columns.map((c) => c.name)
    expect(names).toEqual(
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

  it('created_by references users with RESTRICT', () => {
    const fks = getTableConfig(serviceDuePeriods).foreignKeys
    const userFk = fks.find((fk) => fk.reference().foreignTable === users)
    expect(userFk).toBeDefined()
    expect(userFk!.onDelete).toBe('restrict')
  })

  it('migration 0059 still declares the constraints the table relies on', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS service_due_periods')
    expect(MIGRATION).toContain(
      "CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual'))",
    )
    expect(MIGRATION).toContain('default_days BETWEEN 1 AND 365')
    expect(MIGRATION).toContain(
      'effective_until IS NULL OR effective_from < effective_until',
    )
    expect(MIGRATION).toContain('excl_service_due_periods_no_overlap')
    expect(MIGRATION).toContain('EXCLUDE USING GIST')
    expect(MIGRATION).toContain('service_type WITH =')
    expect(MIGRATION).toContain(
      "tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)')",
    )
    expect(MIGRATION).toContain('ON DELETE RESTRICT')
    expect(MIGRATION).toContain('trg_service_due_periods_updated_at')
    expect(MIGRATION).toContain('idx_service_due_periods_service_type')
    expect(MIGRATION).toContain('idx_service_due_periods_effective_from')
    expect(MIGRATION).toContain('idx_service_due_periods_effective_until')
  })

  it('migration 0059 is idempotent (matching sibling migrations)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS service_due_periods')
    expect(MIGRATION).toContain("extname = 'btree_gist'")
    expect(MIGRATION).toContain('CREATE EXTENSION btree_gist')
    expect(MIGRATION).toContain('WHEN unique_violation THEN NULL')
    expect(MIGRATION).toContain(
      'DROP TRIGGER IF EXISTS trg_service_due_periods_updated_at',
    )
    expect(MIGRATION).toContain('CREATE INDEX IF NOT EXISTS idx_service_due_periods_service_type')
  })

  it('migration 0059 is registered in the Drizzle journal so migrate() applies it', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>
    }
    const entry = journal.entries.find(
      (row) => row.tag === '0059_create_service_due_periods',
    )
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(59)
    const prior = journal.entries.find(
      (row) => row.tag === '0058_add_invoice_calculation_snapshot',
    )
    expect(prior).toBeDefined()
    expect(entry!.when).toBeGreaterThan(prior!.when)
  })
})

describe('service_due_periods PostgreSQL enforcement (T-04.1.03.01)', () => {
  let ctx: IsolatedTestDb

  async function insertPeriod(opts: {
    serviceType?: string
    defaultDays?: number
    effectiveFrom?: string
    effectiveUntil?: string | null
    createdBy?: string
  } = {}): Promise<string> {
    const result = await ctx.pool.query<{ id: string }>(
      `INSERT INTO service_due_periods
         (service_type, default_days, effective_from, effective_until, created_by)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5)
       RETURNING id`,
      [
        opts.serviceType ?? 'electricity',
        opts.defaultDays ?? 7,
        opts.effectiveFrom ?? '2026-01-01T00:00:00.000Z',
        opts.effectiveUntil === undefined ? null : opts.effectiveUntil,
        opts.createdBy ?? ACTOR_USER_ID,
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
    await retryOnDeadlock(() => ctx.db.execute(sql`TRUNCATE service_due_periods`))
  })

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('accepts a valid open electricity period of 7 days', async () => {
    const id = await insertPeriod()
    const row = await ctx.db.execute<{
      service_type: string
      default_days: number
    }>(sql`
      SELECT service_type, default_days
      FROM service_due_periods
      WHERE id = ${id}
    `)
    expect(row.rows[0]).toMatchObject({
      service_type: 'electricity',
      default_days: 7,
    })
  })

  it('accepts all four canonical service types', async () => {
    for (const serviceType of ['saving_plan', 'consultation', 'manual'] as const) {
      await expect(insertPeriod({ serviceType })).resolves.toBeTruthy()
    }
  })

  it('rejects an unknown service type', async () => {
    await expect(insertPeriod({ serviceType: 'hardware' })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_service_due_periods_service_type'),
    })
  })

  it('rejects default_days outside 1..365', async () => {
    await expect(insertPeriod({ defaultDays: 0 })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_service_due_periods_default_days'),
    })
    await expect(insertPeriod({ defaultDays: 366 })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_service_due_periods_default_days'),
    })
  })

  it('rejects an effective window whose until is not after from', async () => {
    await expect(
      insertPeriod({
        serviceType: 'consultation',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        effectiveUntil: '2026-06-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('chk_service_due_periods_effective_range'),
    })
  })

  it('rejects a missing created_by user (FK)', async () => {
    await expect(
      insertPeriod({ createdBy: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('restricts deleting a user referenced by a due-period row', async () => {
    await insertPeriod({ serviceType: 'manual' })
    await expect(
      ctx.db.execute(sql`DELETE FROM users WHERE user_id = ${ACTOR_USER_ID}`),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('forbids overlapping windows for the same service type', async () => {
    await insertPeriod({
      serviceType: 'saving_plan',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveUntil: '2026-04-01T00:00:00.000Z',
    })
    await expect(
      insertPeriod({
        serviceType: 'saving_plan',
        effectiveFrom: '2026-03-01T00:00:00.000Z',
        effectiveUntil: '2026-06-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: '23P01',
      message: expect.stringContaining('excl_service_due_periods_no_overlap'),
    })
  })

  it('allows adjacent non-overlapping windows (until exclusive)', async () => {
    await insertPeriod({
      serviceType: 'consultation',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveUntil: '2026-04-01T00:00:00.000Z',
    })
    await expect(
      insertPeriod({
        serviceType: 'consultation',
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        effectiveUntil: null,
      }),
    ).resolves.toBeTruthy()
  })

  it('allows the same window on a different service type', async () => {
    await insertPeriod({
      serviceType: 'electricity',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveUntil: null,
    })
    await expect(
      insertPeriod({
        serviceType: 'manual',
        effectiveFrom: '2026-09-01T00:00:00.000Z',
        effectiveUntil: null,
      }),
    ).resolves.toBeTruthy()
  })

  it('creates the lookup indexes and updated_at trigger', async () => {
    const indexes = await ctx.db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = ${ctx.schemaName}
        AND indexname IN (
          'idx_service_due_periods_service_type',
          'idx_service_due_periods_effective_from',
          'idx_service_due_periods_effective_until'
        )
      ORDER BY indexname
    `)
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'idx_service_due_periods_effective_from',
      'idx_service_due_periods_effective_until',
      'idx_service_due_periods_service_type',
    ])

    const id = await insertPeriod({
      serviceType: 'electricity',
      effectiveFrom: '2027-01-01T00:00:00.000Z',
      effectiveUntil: '2027-02-01T00:00:00.000Z',
    })
    const before = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM service_due_periods WHERE id = ${id}
    `)
    await ctx.db.execute(sql`
      UPDATE service_due_periods SET default_days = 14 WHERE id = ${id}
    `)
    const after = await ctx.db.execute<{ updated_at: Date }>(sql`
      SELECT updated_at FROM service_due_periods WHERE id = ${id}
    `)
    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.rows[0]!.updated_at).getTime(),
    )
  })

  it('migration 0059 is idempotent — re-running keeps enforcement', async () => {
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
    await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined()

    await expect(insertPeriod({ serviceType: 'hardware' })).rejects.toMatchObject({
      code: '23514',
    })
  })
})
