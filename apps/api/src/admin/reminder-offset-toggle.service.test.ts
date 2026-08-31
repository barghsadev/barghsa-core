import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { ReminderOffsetToggleService as ServiceType } from './reminder-offset-toggle.service.js'
import { ErrorCodes } from '@barghsa/shared/errors'
import { REMINDER_OFFSET_TOGGLE_EVENT, defaultReminderOffsetToggles } from '@barghsa/shared/finance'

function makeDb() {
  type Handler = (
    values: unknown[],
    callIndex: number,
  ) => { rows: unknown[]; rowCount?: number | null }
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

  return { query, pool, client, router }
}

const ACTOR = 'admin-1'

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { ReminderOffsetToggleService: Svc } = await import('./reminder-offset-toggle.service.js')
  const correlationIdProvider = { getCorrelationId: () => 'corr-reminder-offset-1' }
  return new Svc(correlationIdProvider as never) as ServiceType
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('ReminderOffsetToggleService.list (T-04.1.04.05)', () => {
  it('returns the full enabled matrix when nothing is persisted', async () => {
    const { pool, router } = makeDb()
    router.on('FROM invoice_reminder_offset_toggles', () => ({ rows: [] }))
    const service = await loadService(pool)

    const result = await service.list()
    expect(result).toEqual(defaultReminderOffsetToggles())
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('invoice_reminder_offset_toggles'),
    )
  })

  it('overlays stored disabled rows onto the defaults', async () => {
    const { pool, router } = makeDb()
    router.on('FROM invoice_reminder_offset_toggles', () => ({
      rows: [{ service_type: 'electricity', offset: -7, enabled: false }],
    }))
    const service = await loadService(pool)

    const result = await service.list()
    expect(result.find((row) => row.serviceType === 'electricity' && row.offset === -7)?.enabled).toBe(
      false,
    )
    expect(result.find((row) => row.serviceType === 'electricity' && row.offset === -3)?.enabled).toBe(
      true,
    )
  })
})

describe('ReminderOffsetToggleService.set (T-04.1.04.05)', () => {
  it('rejects an invalid body with 400', async () => {
    const { pool } = makeDb()
    const service = await loadService(pool)
    const rejection = await service
      .set({ raw: { serviceType: 'hardware', offset: -7, enabled: true }, actorUserId: ACTOR, ip: '127.0.0.1' })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
  })

  it('upserts the toggle, writes an audit event, and returns the merged matrix', async () => {
    const { pool, router, client } = makeDb()
    router.on('FOR UPDATE', () => ({ rows: [] }))
    router.on('ON CONFLICT', () => ({ rows: [], rowCount: 1 }))
    router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
    router.on('FROM invoice_reminder_offset_toggles', () => ({
      rows: [{ service_type: 'manual', offset: 0, enabled: false }],
    }))
    const service = await loadService(pool)

    const result = await service.set({
      raw: { serviceType: 'manual', offset: 0, enabled: false },
      actorUserId: ACTOR,
      ip: '10.0.0.1',
    })

    expect(result.find((row) => row.serviceType === 'manual' && row.offset === 0)?.enabled).toBe(false)
    expect(result.find((row) => row.serviceType === 'electricity' && row.offset === 0)?.enabled).toBe(
      true,
    )

    const upsert = router.queries('ON CONFLICT')[0]
    expect(upsert?.values).toEqual(['manual', 0, false, ACTOR])

    const audit = router.queries('INSERT INTO audit_log')[0]
    expect(audit?.values[2]).toBe(REMINDER_OFFSET_TOGGLE_EVENT)
    expect(audit?.values[1]).toBe(ACTOR)
    expect(audit?.values[5]).toBe('10.0.0.1')
    const metadata = JSON.parse(String(audit?.values[3])) as {
      serviceType: string
      offset: number
      enabled: boolean
      previousEnabled: boolean
    }
    expect(metadata).toMatchObject({
      serviceType: 'manual',
      offset: 0,
      enabled: false,
      previousEnabled: true,
    })

    expect(router.queries('BEGIN')).toHaveLength(1)
    expect(router.queries('COMMIT')).toHaveLength(1)
    expect(client.release).toHaveBeenCalled()

    const lock = router.queries('pg_advisory_xact_lock')[0]
    expect(lock?.values).toEqual(['barghsa.invoice_reminder_offset_toggles', 'manual', 0])
    const lockIdx = router.calls.findIndex((c) => c.sql.includes('pg_advisory_xact_lock'))
    const forUpdateIdx = router.calls.findIndex((c) => c.sql.includes('FOR UPDATE'))
    expect(lockIdx).toBeGreaterThan(-1)
    expect(forUpdateIdx).toBeGreaterThan(lockIdx)
  })

  it('locks the pair with an advisory lock before reading previousEnabled', async () => {
    const { pool, router } = makeDb()
    router.on('FOR UPDATE', () => ({
      rows: [{ service_type: 'electricity', offset: -7, enabled: false }],
    }))
    router.on('ON CONFLICT', () => ({ rows: [], rowCount: 1 }))
    router.on('INSERT INTO audit_log', () => ({ rows: [], rowCount: 1 }))
    router.on('FROM invoice_reminder_offset_toggles', () => ({
      rows: [{ service_type: 'electricity', offset: -7, enabled: true }],
    }))
    const service = await loadService(pool)

    await service.set({
      raw: { serviceType: 'electricity', offset: -7, enabled: true },
      actorUserId: ACTOR,
      ip: '127.0.0.1',
    })

    const lock = router.queries('pg_advisory_xact_lock')[0]
    expect(lock?.values).toEqual([
      'barghsa.invoice_reminder_offset_toggles',
      'electricity',
      -7,
    ])
    const audit = router.queries('INSERT INTO audit_log')[0]
    const metadata = JSON.parse(String(audit?.values[3])) as { previousEnabled: boolean }
    expect(metadata.previousEnabled).toBe(false)
  })
})
