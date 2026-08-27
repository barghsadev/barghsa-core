import { describe, it, expect, vi } from 'vitest'
import { runOutboxPoll, sanitizeLastError } from './outbox-runner.js'
import type { INotificationTransport, NotificationSendPayload, NotificationSendResult } from '@barghsa/shared/notifications'

/**
 * Outbox runner unit tests (E-05, T-05.01.02).
 *
 * `runOutboxPoll` is exercised here with an injected fake `pool` (recording
 * UPDATE statements) and a stubbed `leaseOutbox`/`dispatchOutbox`, keeping the
 * DB-free dispatch/status bookkeeping covered at unit level. The real
 * claim-vs-dispatch loop is verified at e2e level.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePool() {
  const updates: Array<{ sql: string; params: unknown[] }> = []
  const pool = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, params?: any[]) {
      updates.push({ sql, params: params ?? [] })
      return { rows: [], rowCount: 0 }
    },
  }
  return { pool, updates }
}

class FakeTransport implements INotificationTransport {
  readonly channel: 'in_app' | 'email' | 'sms'
  fail: boolean
  constructor(channel: 'in_app' | 'email' | 'sms', fail = false) {
    this.channel = channel
    this.fail = fail
  }
  async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
    if (this.fail) return { providerRef: 'fail', status: 'failed' }
    return { providerRef: `real:${payload.channel}`, status: 'delivered' }
  }
}

const baseRow = {
  id: 'ob-1',
  profileId: 'profile-1',
  userId: 'user-1',
  eventKey: 'profile_verified',
  payload: {},
  channels: ['in_app', 'email'] as ('in_app' | 'email')[],
  idempotencyKey: 'k1',
  attempts: 0,
  maxAttempts: 5,
  scheduledAt: null,
  lastError: null,
}

describe('runOutboxPoll', () => {
  it('marks a fully-delivered row and jobs as done, persisting real provider refs', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([baseRow])

    const r = await runOutboxPoll({
      pool,
      transports: { in_app: new FakeTransport('in_app'), email: new FakeTransport('email') },
    })

    expect(r).toEqual({ leased: 1, delivered: 1, failed: 0 })

    const sql = updates.map((u) => u.sql).join('\n')
    expect(sql).toContain("status = 'sending'")
    expect(sql).toContain("status = 'delivered'")
    // Job status is a bound param ($2): "done" for a delivered job.
    const done = updates.filter((u) => u.sql.includes('UPDATE notification_job'))
    expect(done).toHaveLength(2)
    expect(done.every((u) => u.params[1] === 'done')).toBe(true)
    // Real provider refs persisted (param $3), one per channel.
    expect(done.some((u) => u.params[2] === 'real:in_app')).toBe(true)
    expect(done.some((u) => u.params[2] === 'real:email')).toBe(true)

    // Each delivered channel gets a delivery-log row (T-05.01.05).
    const logInserts = updates.filter((u) => u.sql.includes('INSERT INTO notification_delivery_log'))
    expect(logInserts).toHaveLength(2)
    expect(logInserts.every((u) => u.params[2] === 'delivered')).toBe(true)
    // Sanitized error fields stay null on delivered attempts.
    expect(logInserts.every((u) => u.params[6] === null && u.params[7] === null)).toBe(true)
  })

  it('marks only the failing job and returns the row to queued for retry', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([baseRow])

    const r = await runOutboxPoll({
      pool,
      transports: { in_app: new FakeTransport('in_app'), email: new FakeTransport('email', true) },
    })

    expect(r).toEqual({ leased: 1, delivered: 0, failed: 1 })

    const jobUpdates = updates.filter((u) => u.sql.includes('UPDATE notification_job'))
    // in_app done, email retrying (not exhausted at attempts=1 of 5).
    expect(jobUpdates.find((u) => u.params[5] === 'in_app')!.params[1]).toBe('done')
    expect(jobUpdates.find((u) => u.params[5] === 'email')!.params[1]).toBe('retrying')

    // Delivery logs: in_app delivered, email failed with a classified error.
    const logInserts = updates.filter((u) => u.sql.includes('INSERT INTO notification_delivery_log'))
    expect(logInserts).toHaveLength(2)
    const inAppLog = logInserts.find((u) => u.params[1] === 'in_app')!
    const emailLog = logInserts.find((u) => u.params[1] === 'email')!
    expect(inAppLog.params[2]).toBe('delivered')
    expect(emailLog.params[2]).toBe('failed')

    // Outbox row returned to queued with an unconsumed locked_until (backoff).
    const outboxUpdate = updates.find(
      (u) => u.sql.includes('UPDATE notification_outbox') && u.params[1] === 'queued',
    )
    expect(outboxUpdate).toBeTruthy()
  })

  it('marks a row failed permanently and dead-letters its jobs when max attempts are exhausted', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([
      { ...baseRow, attempts: 4, maxAttempts: 5 },
    ])

    const r = await runOutboxPoll({
      pool,
      transports: { in_app: new FakeTransport('in_app'), email: new FakeTransport('email', true) },
    })
    expect(r.failed).toBe(1)

    // Outbox row marked 'failed' permanently (bound param $2).
    const outboxUpdate = updates.find(
      (u) => u.sql.includes('UPDATE notification_outbox') && u.params[1] === 'failed',
    )
    expect(outboxUpdate).toBeTruthy()
    // Exhausted jobs move to dead_letter (not just 'failed').
    const emailJob = updates.find((u) => u.sql.includes('UPDATE notification_job') && u.params[5] === 'email')
    expect(emailJob!.params[1]).toBe('dead_letter')
    // No further retry scheduled after exhaustion: run_after is null.
    expect(emailJob!.params[6]).toBeNull()
  })

  it('schedules a jittered run_after backoff on a retry-eligible job', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([baseRow])

    await runOutboxPoll({
      pool,
      transports: { in_app: new FakeTransport('in_app'), email: new FakeTransport('email', true) },
    })

    const emailJob = updates.find((u) => u.sql.includes('UPDATE notification_job') && u.params[5] === 'email')
    // Retrying job (attempts=1 of 5) gets a run_after backoff (param $6 now
    // holds it; the retry ladder guarantees it is in the future).
    expect(emailJob!.params[1]).toBe('retrying')
    const runAfter = emailJob!.params[6] as Date
    expect(runAfter).toBeInstanceOf(Date)
    expect(runAfter.getTime()).toBeGreaterThan(Date.now())
  })

  it('propagates a throwing dispatch into a failed row with sanitized error and job bookkeeping', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([baseRow])
    vi.spyOn(await import('./outbox-reader.js'), 'dispatchOutbox').mockRejectedValue(
      new Error('SMTP auth failed for user:key:AKIAIOSFODNN7EXAMPLE'),
    )

    const r = await runOutboxPoll({ pool, transports: { in_app: new FakeTransport('in_app') } })
    expect(r).toEqual({ leased: 1, delivered: 0, failed: 1 })
    const errCol = updates.find((u) => u.sql.includes('last_error'))
    expect(String(errCol?.params[3])).not.toContain('AKIAIOSFODNN7EXAMPLE')
    // Exception path must keep per-channel jobs consistent with the outbox row.
    const jobUpdates = updates.filter((u) => u.sql.includes('UPDATE notification_job'))
    expect(jobUpdates.length).toBeGreaterThan(0)
    expect(jobUpdates.every((u) => u.params[1] === 'retrying')).toBe(true)
    expect(jobUpdates[0]!.params[2]).toBe(1) // attempts incremented
  })

  it('returns zeroed results when no rows are due', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([])
    const r = await runOutboxPoll({ pool, transports: {} })
    expect(r).toEqual({ leased: 0, delivered: 0, failed: 0 })
    expect(updates).toHaveLength(0)
  })
})

describe('sanitizeLastError', () => {
  it('redacts bearer tokens and api keys', () => {
    const s = sanitizeLastError('auth failed with Bearer abc123 and api_key=secret456 here')
    expect(s).not.toContain('abc123')
    expect(s).not.toContain('secret456')
    expect(s).toContain('[REDACTED]')
  })

  it('redacts credentials embedded in URLs', () => {
    const s = sanitizeLastError('could not connect to postgres://user:pass123@db.example.com:5432/x')
    expect(s).not.toContain('pass123')
    expect(s).toContain('[REDACTED]')
  })

  it('caps the message length', () => {
    const s = sanitizeLastError('x'.repeat(2000))
    expect(s.length).toBeLessThanOrEqual(500)
  })

  it('keeps benign messages unchanged', () => {
    const s = sanitizeLastError('provider unavailable (timeout)')
    expect(s).toContain('provider unavailable')
  })

  it('does not scrub UUIDs or short identifiers', () => {
    const s = sanitizeLastError('row 550e8400-e29b-41d4-a716-446655440000 not found (tx 12345)')
    expect(s).toContain('550e8400-e29b-41d4-a716-446655440000')
    expect(s).toContain('12345')
  })

  it('redacts AWS access key ids and stripe sk_live tokens', () => {
    const s = sanitizeLastError('denied AKIAIOSFODNN7EXAMPLE sk_live_aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(s).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(s).not.toContain('sk_live_aaaaaaaaaaaaaaaaaaaaaaaa')
  })
})
