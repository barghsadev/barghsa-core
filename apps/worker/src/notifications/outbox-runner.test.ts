import { describe, it, expect, vi } from 'vitest'
import { runOutboxPoll } from './outbox-runner.js'
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
    return { providerRef: `ref:${payload.channel}`, status: 'delivered' }
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
}

describe('runOutboxPoll', () => {
  it('marks a fully-delivered row and jobs as done', async () => {
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
    expect(sql).toContain("status = 'done'")
  })

  it('marks a row failed when a channel reports failure', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([baseRow])

    const r = await runOutboxPoll({
      pool,
      transports: { in_app: new FakeTransport('in_app'), email: new FakeTransport('email', true) },
    })

    expect(r).toEqual({ leased: 1, delivered: 0, failed: 1 })
    const sql = updates.map((u) => u.sql).join('\n')
    expect(sql).toContain("status = 'failed'")
  })

  it('propagates a throwing dispatch into a failed row', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([baseRow])
    vi.spyOn(await import('./outbox-reader.js'), 'dispatchOutbox').mockRejectedValue(new Error('provider down'))

    const r = await runOutboxPoll({ pool, transports: { in_app: new FakeTransport('in_app') } })
    expect(r).toEqual({ leased: 1, delivered: 0, failed: 1 })
    const errCol = updates.find((u) => u.sql.includes('last_error'))
    expect(String(errCol?.params[3])).toContain('provider down')
  })

  it('returns zeroed results when no rows are due', async () => {
    const { pool, updates } = makePool()
    vi.spyOn(await import('./outbox-reader.js'), 'leaseOutbox').mockResolvedValue([])
    const r = await runOutboxPoll({ pool, transports: {} })
    expect(r).toEqual({ leased: 0, delivered: 0, failed: 0 })
    expect(updates).toHaveLength(0)
  })
})
