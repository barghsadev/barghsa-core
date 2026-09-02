import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS,
  ONLINE_TOPUP_CHANNEL,
  ONLINE_TOPUP_EXPIRY_AUDIT_EVENT,
  ONLINE_TOPUP_EXPIRY_REASON,
  ONLINE_TOPUP_EXPIRY_TRANSITION,
} from '@barghsa/shared/finance'
import {
  DEFAULT_ONLINE_TOPUP_EXPIRY_BATCH_SIZE,
  FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL,
  ONLINE_TOPUP_EXPIRY_JOB_TYPE,
  REJECT_EXPIRED_ONLINE_TOPUP_SQL,
  expireStaleOnlineTopUps,
  resolveOnlineTopUpExpiryActor,
} from './online-topup-expiry-scanner.js'

/**
 * Online top-up expiry scanner unit tests (S-04.2.02, T-04.2.02.07).
 *
 * `expireStaleOnlineTopUps` is exercised with an injected fake pool so the
 * candidate query, per-row lock + eligibility re-check, Rejected
 * update, and `wallet.online_topup.expired` audit insert are covered
 * DB-free.
 */

interface FakeDb {
  pool: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }
  calls: Array<{ sql: string; params: unknown[] }>
}

function makeFakeDb(
  onSql: (sql: string, params?: unknown[]) => { rows?: unknown[]; rowCount?: number },
): FakeDb {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const respond = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    const result = onSql(sql, params)
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 }
  }
  const client = { query: respond, release: vi.fn() }
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: respond,
  }
  return { pool: pool as never, calls }
}

const NOW = new Date('2026-09-02T12:00:00.000Z')
const TTL = DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS
const PAST = new Date(NOW.getTime() - TTL - 1_000)
const TX_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const WALLET_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = 'system-actor-001'
const CORRELATION = 'corr-online-expiry-001'

function scanOptions(db: FakeDb, overrides: Record<string, unknown> = {}) {
  const logger = { warn: vi.fn(), info: vi.fn() }
  return {
    pool: db.pool as unknown as Pool,
    now: () => NOW,
    logger,
    ttlMs: TTL,
    actorUserId: ACTOR,
    correlationId: CORRELATION,
    newId: () => 'audit-1',
    ...overrides,
  }
}

function pendingCandidate(
  id = TX_ID,
  metadata: Record<string, unknown> = {
    channel: 'online',
    gateway: { authority: 'auth-1' },
  },
) {
  return {
    id,
    wallet_id: WALLET_ID,
    type: 'topup',
    state: 'Pending',
    created_at: PAST,
    metadata,
  }
}

function defaultHandler(
  candidates: Array<ReturnType<typeof pendingCandidate>> = [pendingCandidate()],
  locked: Array<ReturnType<typeof pendingCandidate>> | 'match' = 'match',
) {
  return (sql: string): { rows?: unknown[]; rowCount?: number } => {
    if (sql.includes("metadata->>'channel'") && sql.includes('created_at < $2')) {
      return { rows: candidates }
    }
    if (sql.includes('FOR UPDATE SKIP LOCKED')) {
      return { rows: locked === 'match' ? candidates : locked }
    }
    if (sql.includes("SET state = 'Rejected'")) {
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO audit_log')) {
      return { rows: [] }
    }
    return { rows: [] }
  }
}

describe('expireStaleOnlineTopUps (T-04.2.02.07)', () => {
  it('exposes the background-job type the worker recorder uses', () => {
    expect(ONLINE_TOPUP_EXPIRY_JOB_TYPE).toBe('online_topup_expiry_scan')
  })

  it('selects online Pending top-ups older than the TTL, oldest first, bounded', async () => {
    const db = makeFakeDb(defaultHandler())
    await expireStaleOnlineTopUps(scanOptions(db))

    const find = db.calls.find((c) => c.sql.includes('created_at < $2'))
    expect(find).toBeDefined()
    expect(find!.params[0]).toBe(ONLINE_TOPUP_CHANNEL)
    expect((find!.params[1] as Date).toISOString()).toBe(
      new Date(NOW.getTime() - TTL).toISOString(),
    )
    expect(find!.params[2]).toBe(DEFAULT_ONLINE_TOPUP_EXPIRY_BATCH_SIZE)
    expect(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL).toContain("type = 'topup'")
    expect(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL).toContain("state = 'Pending'")
    expect(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL).toContain("metadata->>'channel' = $1")
    expect(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL).toContain('ORDER BY created_at ASC, id ASC')
    expect(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL).toContain('LIMIT $3')
  })

  it('rejects an expired online Pending top-up, stamps expiry metadata, and writes audit', async () => {
    const db = makeFakeDb(defaultHandler())
    const result = await expireStaleOnlineTopUps(scanOptions(db))

    expect(result).toMatchObject({
      scanned: 1,
      rejected: 1,
      skipped: 0,
      truncated: false,
      errors: [],
    })

    const update = db.calls.find((c) => c.sql.includes("SET state = 'Rejected'"))
    expect(update!.params[0]).toBe(TX_ID)
    expect(JSON.parse(String(update!.params[1]))).toEqual({
      expiry: {
        rejectedAt: NOW.toISOString(),
        reason: ONLINE_TOPUP_EXPIRY_REASON,
        ttlMs: TTL,
      },
    })
    expect(update!.params[2]).toBe(ONLINE_TOPUP_CHANNEL)
    expect(update!.sql).toContain("COALESCE(metadata, '{}'::jsonb) || $2::jsonb")
    expect(update!.sql).toContain("AND state = 'Pending'")
    expect(update!.sql).toContain("metadata->>'channel' = $3")
    expect(REJECT_EXPIRED_ONLINE_TOPUP_SQL).toContain("metadata->>'channel' = $3")

    const audit = db.calls.find((c) => c.sql.includes('INSERT INTO audit_log'))
    expect(audit!.params[0]).toBe('audit-1')
    expect(audit!.params[1]).toBe(ACTOR)
    expect(audit!.params[2]).toBe('wallet.online_topup.expired')
    expect(JSON.parse(String(audit!.params[3]))).toEqual({
      transactionId: TX_ID,
      walletId: WALLET_ID,
      fromState: 'Pending',
      toState: 'Rejected',
      transition: ONLINE_TOPUP_EXPIRY_TRANSITION,
      reason: ONLINE_TOPUP_EXPIRY_REASON,
      ttlMs: TTL,
    })
    expect(audit!.params[4]).toBe(CORRELATION)
    expect(audit!.params[5]).toBeNull()
    expect(audit!.params[6]).toBe(NOW)
    expect(db.calls.some((c) => c.sql === 'COMMIT')).toBe(true)
  })

  it('skips a candidate that is no longer Pending after the row lock', async () => {
    const candidate = pendingCandidate()
    const db = makeFakeDb(
      defaultHandler([candidate], [{ ...candidate, state: 'Released' }]),
    )
    const result = await expireStaleOnlineTopUps(scanOptions(db))
    expect(result).toMatchObject({ scanned: 1, rejected: 0, skipped: 1, errors: [] })
    expect(db.calls.some((c) => c.sql.includes("SET state = 'Rejected'"))).toBe(false)
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO audit_log'))).toBe(false)
    expect(db.calls.some((c) => c.sql === 'ROLLBACK')).toBe(true)
  })

  it('skips a bank-receipt Pending that slipped into the candidate set', async () => {
    const candidate = pendingCandidate()
    const db = makeFakeDb(
      defaultHandler(
        [candidate],
        [{ ...candidate, metadata: { channel: 'bank_receipt' } }],
      ),
    )
    const result = await expireStaleOnlineTopUps(scanOptions(db))
    expect(result.skipped).toBe(1)
    expect(result.rejected).toBe(0)
    expect(db.calls.some((c) => c.sql.includes("SET state = 'Rejected'"))).toBe(false)
  })

  it('skips when FOR UPDATE SKIP LOCKED returns no row (held by a concurrent worker)', async () => {
    const db = makeFakeDb(defaultHandler([pendingCandidate()], []))
    const result = await expireStaleOnlineTopUps(scanOptions(db))
    expect(result).toMatchObject({ scanned: 1, rejected: 0, skipped: 1 })
    expect(db.calls.some((c) => c.sql.includes("SET state = 'Rejected'"))).toBe(false)
  })

  it('isolates a per-row failure and continues the batch', async () => {
    const rows = [pendingCandidate('tx-ok'), pendingCandidate('tx-boom')]
    const db = makeFakeDb((sql, params) => {
      if (sql.includes("metadata->>'channel'") && sql.includes('created_at < $2')) {
        return { rows }
      }
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        return { rows: [rows.find((r) => r.id === params?.[0])!] }
      }
      if (sql.includes("SET state = 'Rejected'")) {
        if (params?.[0] === 'tx-boom') throw new Error('deadlock')
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO audit_log')) return { rows: [] }
      return { rows: [] }
    })

    const result = await expireStaleOnlineTopUps(scanOptions(db))
    expect(result.rejected).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('tx-boom')
    expect(result.errors[0]).toContain('deadlock')
  })

  it('sets truncated when the candidate query fills the batch cap', async () => {
    const rows = Array.from({ length: 2 }, (_, i) => pendingCandidate(`tx-${i}`))
    const db = makeFakeDb(defaultHandler(rows))
    const result = await expireStaleOnlineTopUps(scanOptions(db, { batchSize: 2 }))
    expect(result.truncated).toBe(true)
    expect(result.scanned).toBe(2)
    expect(result.rejected).toBe(2)
  })

  it('aborts without rejecting when no system actor can be resolved', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('FROM users')) return { rows: [] }
      return { rows: [pendingCandidate()] }
    })
    const logger = { warn: vi.fn(), info: vi.fn() }
    const result = await expireStaleOnlineTopUps(
      scanOptions(db, { actorUserId: undefined, logger }),
    )
    expect(result.rejected).toBe(0)
    expect(result.scanned).toBe(0)
    expect(result.errors[0]).toMatch(/no system actor/)
    expect(logger.warn).toHaveBeenCalled()
    expect(db.calls.some((c) => c.sql.includes("SET state = 'Rejected'"))).toBe(false)
  })

  it('locks each candidate with FOR UPDATE SKIP LOCKED', async () => {
    const db = makeFakeDb(defaultHandler())
    await expireStaleOnlineTopUps(scanOptions(db))
    const lock = db.calls.find((c) => c.sql.includes('FOR UPDATE SKIP LOCKED'))
    expect(lock!.params).toEqual([TX_ID])
  })

  it('uses ONLINE_TOPUP_PENDING_TTL_MS when ttlMs is omitted', async () => {
    const previous = process.env['ONLINE_TOPUP_PENDING_TTL_MS']
    process.env['ONLINE_TOPUP_PENDING_TTL_MS'] = '15000'
    try {
      const db = makeFakeDb(defaultHandler())
      const options = scanOptions(db)
      delete (options as { ttlMs?: number }).ttlMs
      await expireStaleOnlineTopUps(options)

      const find = db.calls.find((c) => c.sql.includes('created_at < $2'))
      expect((find!.params[1] as Date).toISOString()).toBe(
        new Date(NOW.getTime() - 15_000).toISOString(),
      )
    } finally {
      if (previous === undefined) {
        delete process.env['ONLINE_TOPUP_PENDING_TTL_MS']
      } else {
        process.env['ONLINE_TOPUP_PENDING_TTL_MS'] = previous
      }
    }
  })

  it('is a no-op when no expired online Pending top-ups exist', async () => {
    const db = makeFakeDb(defaultHandler([]))
    const result = await expireStaleOnlineTopUps(scanOptions(db))
    expect(result).toMatchObject({
      scanned: 0,
      rejected: 0,
      skipped: 0,
      truncated: false,
      errors: [],
    })
    expect(db.pool.connect).not.toHaveBeenCalled()
  })
})

describe('resolveOnlineTopUpExpiryActor (T-04.2.02.07)', () => {
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
    await expect(
      resolveOnlineTopUpExpiryActor(db.pool as unknown as Pool, 'explicit-1'),
    ).resolves.toBe('explicit-1')
    expect(db.calls).toEqual([])
  })

  it('uses WORKER_SYSTEM_ACTOR_USER_ID when that user exists', async () => {
    process.env['WORKER_SYSTEM_ACTOR_USER_ID'] = 'env-actor'
    const db = makeFakeDb((sql) => {
      if (sql.includes('WHERE user_id = $1')) return { rows: [{ user_id: 'env-actor' }] }
      return { rows: [] }
    })
    await expect(resolveOnlineTopUpExpiryActor(db.pool as unknown as Pool)).resolves.toBe(
      'env-actor',
    )
  })

  it('falls back to the oldest platform admin when the env actor is missing', async () => {
    process.env['WORKER_SYSTEM_ACTOR_USER_ID'] = 'missing'
    const db = makeFakeDb((sql) => {
      if (sql.includes('WHERE user_id = $1')) return { rows: [] }
      if (sql.includes('is_admin = TRUE')) return { rows: [{ user_id: 'admin-oldest' }] }
      return { rows: [] }
    })
    await expect(resolveOnlineTopUpExpiryActor(db.pool as unknown as Pool)).resolves.toBe(
      'admin-oldest',
    )
  })

  it('returns null when no actor can be resolved', async () => {
    const db = makeFakeDb(() => ({ rows: [] }))
    await expect(resolveOnlineTopUpExpiryActor(db.pool as unknown as Pool)).resolves.toBeNull()
  })
})
