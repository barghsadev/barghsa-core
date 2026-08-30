import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  MARK_OVERDUE_AUDIT_EVENT,
  MARK_OVERDUE_REASON,
  MARK_OVERDUE_TRANSITION,
} from '@barghsa/shared/finance'
import {
  DEFAULT_OVERDUE_BATCH_SIZE,
  FIND_OVERDUE_CANDIDATES_SQL,
  INVOICE_OVERDUE_JOB_TYPE,
  resolveOverdueActor,
  scanOverdueInvoices,
} from './overdue-scanner.js'

/**
 * Overdue scanner unit tests (S-04.1.03, T-04.1.03.04).
 *
 * `scanOverdueInvoices` is exercised with an injected fake pool so the
 * candidate query, per-row lock + eligibility re-check, Overdue update,
 * and `invoice.mark_overdue` audit insert are covered DB-free.
 */

interface FakeDb {
  pool: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }
  client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>
    release: ReturnType<typeof vi.fn>
  }
  calls: Array<{ sql: string; params: unknown[] }>
}

function makeFakeDb(
  onSql: (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number },
): FakeDb {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const respond = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    const result = onSql(sql, params)
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 }
  }
  const client = { query: respond, release: vi.fn() }
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: respond,
  }
  return { pool: pool as never, client, calls }
}

const NOW = new Date('2026-08-30T12:00:00.000Z')
const PAST = new Date('2026-08-23T12:00:00.000Z')
const ACTOR = 'system-actor-001'
const CORRELATION = 'corr-overdue-001'

function scanOptions(db: FakeDb, overrides: Record<string, unknown> = {}) {
  const logger = { warn: vi.fn(), info: vi.fn() }
  return {
    pool: db.pool as unknown as Pool,
    now: () => NOW,
    logger,
    actorUserId: ACTOR,
    correlationId: CORRELATION,
    newId: () => 'audit-1',
    ...overrides,
  }
}

function unpaidCandidate(id = 'inv-unpaid') {
  return { id, state: 'Unpaid', due_at: PAST }
}

function defaultHandler(
  candidates: Array<{ id: string; state: string; due_at: Date | null }> = [unpaidCandidate()],
  locked: Array<{ id: string; state: string; due_at: Date | null }> | 'match' = 'match',
) {
  return (sql: string): { rows?: unknown[]; rowCount?: number } => {
    if (sql.includes('FROM invoices') && sql.includes('due_at < $2')) {
      return { rows: candidates }
    }
    if (sql.includes('FOR UPDATE SKIP LOCKED')) {
      return { rows: locked === 'match' ? candidates : locked }
    }
    if (sql.includes("SET state = 'Overdue'")) {
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO audit_log')) {
      return { rows: [] }
    }
    return { rows: [] }
  }
}

describe('scanOverdueInvoices (T-04.1.03.04)', () => {
  it('exposes the background-job type the worker recorder uses', () => {
    expect(INVOICE_OVERDUE_JOB_TYPE).toBe('invoice_overdue_scan')
  })

  it('binds the candidate predicate to invoice_state[] not text[]', () => {
    expect(FIND_OVERDUE_CANDIDATES_SQL).toContain('state = ANY($1::invoice_state[])')
    expect(FIND_OVERDUE_CANDIDATES_SQL).not.toContain('$1::text[]')
  })

  it('selects Unpaid/PartiallyFunded invoices past dueAt, oldest first, bounded', async () => {
    const db = makeFakeDb(defaultHandler())
    await scanOverdueInvoices(scanOptions(db))

    const find = db.calls.find((c) => c.sql.includes('due_at < $2'))
    expect(find).toBeDefined()
    expect(find!.params[0]).toEqual(['Unpaid', 'PartiallyFunded'])
    expect(find!.params[1]).toBe(NOW)
    expect(find!.params[2]).toBe(DEFAULT_OVERDUE_BATCH_SIZE)
    expect(find!.sql).toContain('state = ANY($1::invoice_state[])')
    expect(find!.sql).not.toContain('$1::text[]')
    expect(find!.sql).toContain('ORDER BY due_at ASC, id ASC')
    expect(find!.sql).toContain('LIMIT $3')
    expect(find!.sql).toContain('due_at IS NOT NULL')
  })

  it('marks an Unpaid past-due invoice Overdue, stamps overdue_at, and writes audit', async () => {
    const db = makeFakeDb(defaultHandler())
    const result = await scanOverdueInvoices(scanOptions(db))

    expect(result).toMatchObject({ scanned: 1, marked: 1, skipped: 0, truncated: false, errors: [] })

    const update = db.calls.find((c) => c.sql.includes("SET state = 'Overdue'"))
    expect(update!.params).toEqual(['inv-unpaid', NOW, 'Unpaid'])
    expect(update!.sql).toContain('overdue_at = $2')
    expect(update!.sql).toContain('AND state = $3::invoice_state')

    const audit = db.calls.find((c) => c.sql.includes('INSERT INTO audit_log'))
    expect(audit!.params[0]).toBe('audit-1')
    expect(audit!.params[1]).toBe(ACTOR)
    expect(audit!.params[2]).toBe(MARK_OVERDUE_AUDIT_EVENT)
    expect(JSON.parse(String(audit!.params[3]))).toEqual({
      invoiceId: 'inv-unpaid',
      fromState: 'Unpaid',
      toState: 'Overdue',
      transition: MARK_OVERDUE_TRANSITION,
      reason: MARK_OVERDUE_REASON,
    })
    expect(audit!.params[4]).toBe(CORRELATION)
    expect(audit!.params[5]).toBeNull()
    expect(audit!.params[6]).toBe(NOW)

    expect(db.calls.some((c) => c.sql === 'COMMIT')).toBe(true)
  })

  it('marks a PartiallyFunded past-due invoice Overdue', async () => {
    const row = { id: 'inv-partial', state: 'PartiallyFunded', due_at: PAST }
    const db = makeFakeDb(defaultHandler([row]))
    const result = await scanOverdueInvoices(scanOptions(db))
    expect(result.marked).toBe(1)
    const update = db.calls.find((c) => c.sql.includes("SET state = 'Overdue'"))
    expect(update!.params).toEqual(['inv-partial', NOW, 'PartiallyFunded'])
  })

  it('skips a candidate that is no longer eligible after the row lock', async () => {
    const candidate = unpaidCandidate()
    const db = makeFakeDb(
      defaultHandler([candidate], [{ id: candidate.id, state: 'Paid', due_at: PAST }]),
    )
    const result = await scanOverdueInvoices(scanOptions(db))
    expect(result).toMatchObject({ scanned: 1, marked: 0, skipped: 1, errors: [] })
    expect(db.calls.some((c) => c.sql.includes("SET state = 'Overdue'"))).toBe(false)
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO audit_log'))).toBe(false)
    expect(db.calls.some((c) => c.sql === 'ROLLBACK')).toBe(true)
  })

  it('skips a candidate whose dueAt was overridden into the future under lock', async () => {
    const candidate = unpaidCandidate()
    const db = makeFakeDb(
      defaultHandler(
        [candidate],
        [{ id: candidate.id, state: 'Unpaid', due_at: new Date('2026-09-15T00:00:00.000Z') }],
      ),
    )
    const result = await scanOverdueInvoices(scanOptions(db))
    expect(result.skipped).toBe(1)
    expect(result.marked).toBe(0)
  })

  it('skips when FOR UPDATE SKIP LOCKED returns no row (held by a concurrent worker)', async () => {
    const db = makeFakeDb(defaultHandler([unpaidCandidate()], []))
    const result = await scanOverdueInvoices(scanOptions(db))
    expect(result).toMatchObject({ scanned: 1, marked: 0, skipped: 1 })
    expect(db.calls.some((c) => c.sql.includes("SET state = 'Overdue'"))).toBe(false)
  })

  it('isolates a per-invoice failure and continues the batch', async () => {
    const rows = [
      unpaidCandidate('inv-ok'),
      { id: 'inv-boom', state: 'Unpaid', due_at: PAST },
    ]
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM invoices') && sql.includes('due_at < $2')) {
        return { rows }
      }
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        return { rows: [rows.find((r) => r.id === params[0])!] }
      }
      if (sql.includes("SET state = 'Overdue'")) {
        if (params[0] === 'inv-boom') throw new Error('deadlock')
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO audit_log')) return { rows: [] }
      return { rows: [] }
    })

    const result = await scanOverdueInvoices(scanOptions(db))
    expect(result.marked).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('inv-boom')
    expect(result.errors[0]).toContain('deadlock')
  })

  it('sets truncated when the candidate query fills the batch cap', async () => {
    const rows = Array.from({ length: 2 }, (_, i) => unpaidCandidate(`inv-${i}`))
    const db = makeFakeDb(defaultHandler(rows))
    const result = await scanOverdueInvoices(scanOptions(db, { batchSize: 2 }))
    expect(result.truncated).toBe(true)
    expect(result.scanned).toBe(2)
    expect(result.marked).toBe(2)
  })

  it('aborts without marking when no system actor can be resolved', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM users')) return { rows: [] }
      return { rows: [unpaidCandidate()] }
    })
    const logger = { warn: vi.fn(), info: vi.fn() }
    const result = await scanOverdueInvoices(
      scanOptions(db, { actorUserId: undefined, logger }),
    )
    expect(result.marked).toBe(0)
    expect(result.scanned).toBe(0)
    expect(result.errors[0]).toMatch(/no system actor/)
    expect(logger.warn).toHaveBeenCalled()
    expect(db.calls.some((c) => c.sql.includes("SET state = 'Overdue'"))).toBe(false)
  })

  it('locks each candidate with FOR UPDATE SKIP LOCKED', async () => {
    const db = makeFakeDb(defaultHandler())
    await scanOverdueInvoices(scanOptions(db))
    const lock = db.calls.find((c) => c.sql.includes('FOR UPDATE SKIP LOCKED'))
    expect(lock!.params).toEqual(['inv-unpaid'])
  })

  it('is a no-op when no past-due Unpaid/PartiallyFunded invoices exist', async () => {
    const db = makeFakeDb(defaultHandler([]))
    const result = await scanOverdueInvoices(scanOptions(db))
    expect(result).toMatchObject({ scanned: 0, marked: 0, skipped: 0, truncated: false, errors: [] })
    expect(db.pool.connect).not.toHaveBeenCalled()
  })
})

describe('resolveOverdueActor (T-04.1.03.04)', () => {
  const originalEnv = process.env['WORKER_SYSTEM_ACTOR_USER_ID']

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['WORKER_SYSTEM_ACTOR_USER_ID']
    } else {
      process.env['WORKER_SYSTEM_ACTOR_USER_ID'] = originalEnv
    }
  })

  beforeEach(() => {
    delete process.env['WORKER_SYSTEM_ACTOR_USER_ID']
  })

  it('returns an explicit actor without querying users', async () => {
    const db = makeFakeDb(() => ({ rows: [] }))
    await expect(resolveOverdueActor(db.pool as unknown as Pool, 'explicit-1')).resolves.toBe(
      'explicit-1',
    )
    expect(db.calls).toHaveLength(0)
  })

  it('uses WORKER_SYSTEM_ACTOR_USER_ID when that user exists', async () => {
    process.env['WORKER_SYSTEM_ACTOR_USER_ID'] = 'env-actor'
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM users WHERE user_id')) {
        return { rows: [{ user_id: 'env-actor' }] }
      }
      return { rows: [] }
    })
    await expect(resolveOverdueActor(db.pool as unknown as Pool)).resolves.toBe('env-actor')
  })

  it('falls back to the oldest platform admin when the env user is missing', async () => {
    process.env['WORKER_SYSTEM_ACTOR_USER_ID'] = 'missing'
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM users WHERE user_id')) return { rows: [] }
      if (sql.includes('is_admin = TRUE')) return { rows: [{ user_id: 'admin-oldest' }] }
      return { rows: [] }
    })
    await expect(resolveOverdueActor(db.pool as unknown as Pool)).resolves.toBe('admin-oldest')
  })

  it('returns null when neither env nor admin can be resolved', async () => {
    const db = makeFakeDb(() => ({ rows: [] }))
    await expect(resolveOverdueActor(db.pool as unknown as Pool)).resolves.toBeNull()
  })
})
