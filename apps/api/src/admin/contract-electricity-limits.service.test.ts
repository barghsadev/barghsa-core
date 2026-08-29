import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { ContractElectricityLimitsService as ServiceType } from './contract-electricity-limits.service.js'

/**
 * SQL-routing mock for @barghsa/db (same pattern as the upload-policy /
 * VAT service tests): router.on(fragment, fn) dispatches by SQL content
 * so BEGIN/COMMIT and Promise.all reordering never break the queue.
 */
function makeDb() {
  type Handler = (values: unknown[], callIndex: number) => { rows: unknown[]; rowCount?: number | null }
  const handlers = new Map<string, Handler>()
  const callCounts = new Map<string, number>()
  const calls: Array<{ sql: string; values: unknown[] }> = []

  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    for (const [frag, fn] of handlers) {
      if (sql.includes(frag)) {
        const idx = callCounts.get(frag) ?? 0
        callCounts.set(frag, idx + 1)
        return fn(values, idx)
      }
    }
    return { rows: [], rowCount: null }
  })

  const client = { query, release: vi.fn() }
  const pool = { query, connect: async () => client }

  const router = {
    on: (frag: string, fn: Handler) => handlers.set(frag, fn),
    calls,
    queries: (frag: string) => calls.filter((c) => c.sql.includes(frag)),
  }

  return { query, pool, router }
}

const ACTOR = 'user-admin-1'
const STORED_VALID = {
  max_quantity_increase_percent: 20,
  max_contract_duration_months: 24,
  lead_time_days: 0,
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

/** Load the service with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { ContractElectricityLimitsService: Svc } = await import('./contract-electricity-limits.service.js')
  const correlationIdProvider = { getCorrelationId: () => 'corr-contract-limits-test-1' }
  return new Svc(correlationIdProvider as never) as ServiceType
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('ContractElectricityLimitsService.get (T-09.12.06)', () => {
  it('returns the documented defaults when nothing is persisted', async () => {
    const { pool, router } = makeDb()
    router.on('FROM app_config', () => ({ rows: [] }))
    const service = await loadService(pool)

    const result = await service.get()
    expect(result).toEqual({
      maxQuantityIncreasePercent: 20,
      maxContractDuration: 24,
      leadTimeDays: 0,
    })
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('app_config'),
      expect.arrayContaining(['electricity.contract_limits']),
    )
  })

  it('returns the persisted config when valid', async () => {
    const { pool, router } = makeDb()
    router.on('FROM app_config', () => ({
      rows: [
        {
          value: {
            max_quantity_increase_percent: 50,
            max_contract_duration_months: 36,
            lead_time_days: 7,
          },
        },
      ],
    }))
    const service = await loadService(pool)

    const result = await service.get()
    expect(result).toEqual({
      maxQuantityIncreasePercent: 50,
      maxContractDuration: 36,
      leadTimeDays: 7,
    })
  })

  it('falls back to defaults with a warning for a malformed persisted row', async () => {
    const { pool, router } = makeDb()
    router.on('FROM app_config', () => ({
      rows: [{ value: { max_quantity_increase_percent: 'twenty' } }],
    }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = await loadService(pool)

    const result = await service.get()
    expect(result).toEqual({
      maxQuantityIncreasePercent: 20,
      maxContractDuration: 24,
      leadTimeDays: 0,
    })
    warn.mockRestore()
  })
})

describe('ContractElectricityLimitsService.update (T-09.12.06)', () => {
  it('persists a valid payload: upsert, global version bump, audit, transaction', async () => {
    const { pool, router } = makeDb()
    router.on('FOR UPDATE', () => ({ rows: [] })) // no previous row
    router.on('INSERT INTO app_config', () => ({ rows: [{ version: 1 }] }))
    router.on('UPDATE config_version', () => ({ rows: [], rowCount: 1 }))
    router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
    const service = await loadService(pool)

    const result = await service.update({
      raw: {
        max_quantity_increase_percent: 30,
        max_contract_duration_months: 12,
        lead_time_days: 3,
      },
      actorUserId: ACTOR,
      ip: '127.0.0.1',
    })

    expect(result).toEqual({
      maxQuantityIncreasePercent: 30,
      maxContractDuration: 12,
      leadTimeDays: 3,
    })

    // Transaction bookkeeping ran on the pooled client.
    const client = await pool.connect()
    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()

    // Upsert used the canonical key + stored snake_case value.
    const insertCall = router.queries('INSERT INTO app_config')[0]
    expect(insertCall?.values[0]).toBe('electricity.contract_limits')
    expect(JSON.parse(insertCall?.values[1] as string)).toEqual({
      max_quantity_increase_percent: 30,
      max_contract_duration_months: 12,
      lead_time_days: 3,
    })

    // Audit recorded previous + new values with the correlation id.
    const auditCall = router.queries('INSERT INTO audit_log')[0]
    const metadata = JSON.parse(auditCall?.values[2] as string)
    expect(metadata.entity).toBe('contract_electricity_limits')
    expect(metadata.action).toBe('updated')
    expect(metadata.previousValue).toBeNull()
    expect(metadata.newValue).toEqual({
      max_quantity_increase_percent: 30,
      max_contract_duration_months: 12,
      lead_time_days: 3,
    })
    expect(auditCall?.values[3]).toBe('corr-contract-limits-test-1')
  })

  it('records the previous value and version when replacing an existing row', async () => {
    const { pool, router } = makeDb()
    router.on('FOR UPDATE', () => ({
      rows: [{ value: STORED_VALID, version: 3 }],
    }))
    router.on('INSERT INTO app_config', () => ({ rows: [{ version: 4 }] }))
    router.on('UPDATE config_version', () => ({ rows: [], rowCount: 1 }))
    router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
    const service = await loadService(pool)

    await service.update({
      raw: {
        max_quantity_increase_percent: 25,
        max_contract_duration_months: 24,
        lead_time_days: 0,
      },
      actorUserId: ACTOR,
      ip: '10.0.0.1',
    })

    const auditCall = router.queries('INSERT INTO audit_log')[0]
    const metadata = JSON.parse(auditCall?.values[2] as string)
    expect(metadata.previousValue).toEqual(STORED_VALID)
    expect(metadata.previousVersion).toBe(3)
    expect(metadata.version).toBe(4)
    expect(auditCall?.values[4]).toBe('10.0.0.1')
  })

  it('rejects an invalid payload with 400 and the collected issues', async () => {
    const { pool } = makeDb()
    const service = await loadService(pool)

    const rejection = await service
      .update({
        raw: { max_quantity_increase_percent: -1, max_contract_duration_months: 0, lead_time_days: 'x' },
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })
      .catch((e: unknown) => e)

    expect(rejection).toMatchObject({ status: 400 })
    const body = rejectionBody(rejection)
    expect(body.statusCode).toBe(400)
    expect((body.message as string).split('; ').length).toBe(3)
    // Nothing was written.
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app_config'),
      expect.anything(),
    )
  })

  it('rolls back and maps DB failures to 500', async () => {
    const { pool, router } = makeDb()
    router.on('FOR UPDATE', () => ({ rows: [] }))
    router.on('INSERT INTO app_config', () => {
      throw new Error('db exploded')
    })
    const service = await loadService(pool)

    const rejection = await service
      .update({
        raw: {
          max_quantity_increase_percent: 30,
          max_contract_duration_months: 12,
          lead_time_days: 3,
        },
        actorUserId: ACTOR,
        ip: '127.0.0.1',
      })
      .catch((e: unknown) => e)

    expect(rejection).toMatchObject({ status: 500 })
    const client = await pool.connect()
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})