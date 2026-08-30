/**
 * Real-PostgreSQL integration tests for dueAt calculation (T-04.1.03.02).
 *
 * Proves against actual PostgreSQL `service_due_periods`:
 *   - dueAt = issuedAt + default_days of the active window
 *   - staff override wins over config days
 *   - fallback when no row is active
 *   - exclusive `effective_until` boundary
 *   - works on the shared pool AND a caller-owned transaction client
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { DueAtCalculationRepository } from './due-at.repository.js'
import { DueAtCalculationService } from './due-at.service.js'

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first')
    }
    return poolHolder.pool
  },
}))

const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const DUE_PERIODS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0059_create_service_due_periods.sql',
)

const ACTOR_USER_ID = 'due-at-config-admin'
const ISSUED = new Date('2026-08-01T10:00:00.000Z')

describe('DueAtCalculationService — real PostgreSQL (T-04.1.03.02)', () => {
  let ctx: IsolatedTestDb
  let service: DueAtCalculationService

  async function insertPeriod(opts: {
    serviceType?: string
    defaultDays?: number
    effectiveFrom?: string
    effectiveUntil?: string | null
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
        ACTOR_USER_ID,
      ],
    )
    return result.rows[0]!.id
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool
    service = new DueAtCalculationService(new DueAtCalculationRepository())

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.db.execute(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY)`)
    await ctx.db.execute(
      `INSERT INTO users (user_id) VALUES ('${ACTOR_USER_ID}') ON CONFLICT DO NOTHING`,
    )
    await ctx.pool.query(readFileSync(DUE_PERIODS_MIGRATION, 'utf-8').trim())
  }, 60_000)

  beforeEach(async () => {
    await ctx.db.execute(`TRUNCATE service_due_periods`)
  })

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  it('computes dueAt as issuedAt + the active period default_days', async () => {
    const periodId = await insertPeriod({ defaultDays: 14 })
    const result = await service.resolve(ctx.pool, {
      serviceType: 'electricity',
      issuedAt: ISSUED,
    })
    expect(result.source).toBe('config')
    expect(result.configDays).toBe(14)
    expect(result.periodId).toBe(periodId)
    expect(result.dueAt.toISOString()).toBe('2026-08-15T10:00:00.000Z')
  })

  it('lets a staff override win over the configured days', async () => {
    await insertPeriod({ serviceType: 'manual', defaultDays: 21 })
    const override = new Date('2026-09-15T08:00:00.000Z')
    const result = await service.resolve(ctx.pool, {
      serviceType: 'manual',
      issuedAt: ISSUED,
      staffOverride: override,
    })
    expect(result.source).toBe('staff_override')
    expect(result.dueAt.toISOString()).toBe(override.toISOString())
    expect(result.periodId).toBeNull()
  })

  it('falls back to 7 days when no period covers issuedAt', async () => {
    await insertPeriod({
      serviceType: 'consultation',
      defaultDays: 30,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveUntil: '2026-07-01T00:00:00.000Z',
    })
    const result = await service.resolve(ctx.pool, {
      serviceType: 'consultation',
      issuedAt: ISSUED,
    })
    expect(result.source).toBe('fallback')
    expect(result.configDays).toBe(7)
    expect(result.dueAt.toISOString()).toBe('2026-08-08T10:00:00.000Z')
  })

  it('treats effective_until as exclusive', async () => {
    await insertPeriod({
      defaultDays: 10,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveUntil: '2026-08-01T10:00:00.000Z',
    })
    await insertPeriod({
      defaultDays: 21,
      effectiveFrom: '2026-08-01T10:00:00.000Z',
      effectiveUntil: null,
    })
    const atBoundary = await service.resolve(ctx.pool, {
      serviceType: 'electricity',
      issuedAt: new Date('2026-08-01T10:00:00.000Z'),
    })
    expect(atBoundary.configDays).toBe(21)
    expect(atBoundary.source).toBe('config')

    const beforeBoundary = await service.resolve(ctx.pool, {
      serviceType: 'electricity',
      issuedAt: new Date('2026-08-01T09:59:59.999Z'),
    })
    expect(beforeBoundary.configDays).toBe(10)
  })

  it('resolves on a caller-owned transaction client', async () => {
    await insertPeriod({ serviceType: 'saving_plan', defaultDays: 45 })
    const client = await ctx.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await service.resolve(client, {
        serviceType: 'saving_plan',
        issuedAt: ISSUED,
      })
      expect(result.configDays).toBe(45)
      expect(result.dueAt.toISOString()).toBe('2026-09-15T10:00:00.000Z')
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  })
})
