/**
 * Unit tests for the dueAt calculation module (T-04.1.03.02).
 *
 * Covers config lookup (active window, exclusive until, fallback) with
 * a mocked DB executor, plus staff-override precedence that must not
 * hit the table.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_SERVICE_DUE_DAYS } from '@barghsa/shared/finance'
import type { DbExecutor } from './vat-calculation.repository.js'
import { DueAtCalculationRepository } from './due-at.repository.js'
import { DueAtCalculationService } from './due-at.service.js'

const ISSUED = new Date('2026-08-01T10:00:00.000Z')
const PERIOD_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'

function makeExecutor(rows: Array<{
  id: string
  service_type: string
  default_days: number
}>): { executor: DbExecutor; calls: string[]; params: unknown[][] } {
  const calls: string[] = []
  const params: unknown[][] = []
  const executor: DbExecutor = {
    query: (async (text: string, values?: unknown[]) => {
      calls.push(text)
      params.push(values ?? [])
      if (text.includes('FROM service_due_periods')) {
        return { rows }
      }
      return { rows: [] }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as DbExecutor['query'],
  }
  return { executor, calls, params }
}

describe('DueAtCalculationRepository (T-04.1.03.02)', () => {
  let repo: DueAtCalculationRepository

  beforeEach(() => {
    repo = new DueAtCalculationRepository()
  })

  it('returns the active period row', async () => {
    const { executor, params } = makeExecutor([
      { id: PERIOD_ID, service_type: 'electricity', default_days: 14 },
    ])
    const result = await repo.findActive(executor, 'electricity', ISSUED)
    expect(result).toEqual({
      id: PERIOD_ID,
      serviceType: 'electricity',
      defaultDays: 14,
    })
    expect(params[0]).toEqual(['electricity', ISSUED])
  })

  it('returns null when no row covers issuedAt', async () => {
    const { executor } = makeExecutor([])
    expect(await repo.findActive(executor, 'manual', ISSUED)).toBeNull()
  })
})

describe('DueAtCalculationService.resolve (T-04.1.03.02)', () => {
  let service: DueAtCalculationService

  beforeEach(() => {
    service = new DueAtCalculationService(new DueAtCalculationRepository())
  })

  it('computes dueAt as issuedAt + config_days from the active row', async () => {
    const { executor, calls } = makeExecutor([
      { id: PERIOD_ID, service_type: 'electricity', default_days: 14 },
    ])
    const result = await service.resolve(executor, {
      serviceType: 'electricity',
      issuedAt: ISSUED,
    })
    expect(result.source).toBe('config')
    expect(result.configDays).toBe(14)
    expect(result.periodId).toBe(PERIOD_ID)
    expect(result.dueAt.toISOString()).toBe('2026-08-15T10:00:00.000Z')
    expect(calls.some((c) => c.includes('service_due_periods'))).toBe(true)
  })

  it('lets a staff override win and skips the config lookup', async () => {
    const override = new Date('2026-09-01T00:00:00.000Z')
    const { executor, calls } = makeExecutor([
      { id: PERIOD_ID, service_type: 'manual', default_days: 30 },
    ])
    const result = await service.resolve(executor, {
      serviceType: 'manual',
      issuedAt: ISSUED,
      staffOverride: override,
    })
    expect(result.source).toBe('staff_override')
    expect(result.configDays).toBeNull()
    expect(result.periodId).toBeNull()
    expect(result.dueAt.getTime()).toBe(override.getTime())
    expect(calls).toHaveLength(0)
  })

  it('falls back to DEFAULT_SERVICE_DUE_DAYS when no period is active', async () => {
    const { executor } = makeExecutor([])
    const result = await service.resolve(executor, {
      serviceType: 'consultation',
      issuedAt: ISSUED,
    })
    expect(result.source).toBe('fallback')
    expect(result.configDays).toBe(DEFAULT_SERVICE_DUE_DAYS)
    expect(result.periodId).toBeNull()
    expect(result.dueAt.toISOString()).toBe('2026-08-08T10:00:00.000Z')
  })

  it('skips the lookup and falls back when serviceType is null', async () => {
    const { executor, calls } = makeExecutor([
      { id: PERIOD_ID, service_type: 'electricity', default_days: 21 },
    ])
    const result = await service.resolve(executor, {
      serviceType: null,
      issuedAt: ISSUED,
    })
    expect(result.source).toBe('fallback')
    expect(result.configDays).toBe(DEFAULT_SERVICE_DUE_DAYS)
    expect(calls).toHaveLength(0)
  })
})
