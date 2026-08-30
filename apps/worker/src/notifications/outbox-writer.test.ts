import { describe, it, expect, vi } from 'vitest'
import {
  enqueueOutbox,
  deriveIdempotencyKey,
  deriveChannelIdempotencyKey,
} from './outbox-writer.js'

/**
 * Transactional outbox write pipeline unit tests (E-05, T-05.01.02).
 *
 * `enqueueOutbox` runs against a caller-owned `PoolClient` transaction. These
 * tests use a fake client that records the issued SQL + params, so we can
 * assert the write pipeline produces the right atomic inserts without a live
 * database (integration coverage is e2e).
 */

interface RecordedQuery {
  sql: string
  params: unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any
}

/** Minimal fake PoolClient that returns configurable per-call results. */
function makeClient(onQuery?: (q: string) => unknown): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
  calls: RecordedQuery[]
} {
  const calls: RecordedQuery[] = []
  const client = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, params?: any[]) {
      const result = onQuery ? onQuery(sql) : undefined
      calls.push({ sql, params: params ?? [], result })
      return result ?? { rows: [], rowCount: 0 }
    },
  }
  return { client, calls }
}

describe('deriveIdempotencyKey', () => {
  it('is a stable sha256 hex digest of eventKey:profileId', () => {
    const a = deriveIdempotencyKey('profile_verified', 'profile-1')
    const b = deriveIdempotencyKey('profile_verified', 'profile-1')
    const c = deriveIdempotencyKey('profile_verified', 'profile-2')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('deriveChannelIdempotencyKey', () => {
  it('is a stable sha256 hex digest of eventKey:channel:profileId:outboxKey', () => {
    const a = deriveChannelIdempotencyKey('profile_verified', 'email', 'profile-1', 'outbox-a')
    const b = deriveChannelIdempotencyKey('profile_verified', 'email', 'profile-1', 'outbox-a')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
  })

  it('varies by channel, profile, and outbox idempotency key for the same event', () => {
    const emailP1 = deriveChannelIdempotencyKey('profile_verified', 'email', 'profile-1', 'outbox-a')
    const inAppP1 = deriveChannelIdempotencyKey('profile_verified', 'in_app', 'profile-1', 'outbox-a')
    const emailP2 = deriveChannelIdempotencyKey('profile_verified', 'email', 'profile-2', 'outbox-a')
    const emailOtherRow = deriveChannelIdempotencyKey(
      'profile_verified',
      'email',
      'profile-1',
      'outbox-b',
    )
    expect(emailP1).not.toBe(inAppP1)
    expect(emailP1).not.toBe(emailP2)
    expect(emailP1).not.toBe(emailOtherRow)
  })
})

describe('enqueueOutbox', () => {
  it('inserts one outbox row and one job per channel', async () => {
    const { client, calls } = makeClient((sql) => {
      if (sql.includes('INSERT INTO notification_outbox')) {
        return { rows: [{ id: 'outbox-1' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })

    const res = await enqueueOutbox(client, {
      profileId: 'profile-1',
      userId: 'user-1',
      eventKey: 'profile_verified',
      payload: { name: 'Ali' },
      channels: ['in_app', 'email'],
    })

    expect(res).toEqual({ outboxId: 'outbox-1', inserted: true })
    expect(calls).toHaveLength(2)

    const [outboxCall, jobCall] = calls
    // Outbox insert: profile, user, event, payload, channels, status, idem, max, scheduled
    expect(outboxCall!.sql).toContain('INSERT INTO notification_outbox')
    expect(outboxCall!.params[0]).toBe('profile-1')
    expect(outboxCall!.params[1]).toBe('user-1')
    expect(outboxCall!.params[2]).toBe('profile_verified')
    expect(outboxCall!.params[3]).toEqual({ name: 'Ali' })
    expect(outboxCall!.params[4]).toEqual(['in_app', 'email'])
    expect(outboxCall!.params[5]).toBe('queued')
    expect(outboxCall!.params[6]).toMatch(/^[0-9a-f]{64}$/)
    expect(outboxCall!.params[7]).toBe(5)
    expect(outboxCall!.params[8]).toBeNull()

    // Job insert: two channels.
    expect(jobCall!.sql).toContain('INSERT INTO notification_job')
    expect(jobCall!.sql).toContain('ON CONFLICT (outbox_id, channel) DO NOTHING')
    expect(jobCall!.params).toHaveLength(10) // 2 channels * 5 params
    expect(jobCall!.params[0]).toBe('outbox-1')
    expect(jobCall!.params[1]).toBe('in_app')
    expect(jobCall!.params[5]).toBe('outbox-1')
    expect(jobCall!.params[6]).toBe('email')
  })

  it('returns inserted:false and does not write jobs on duplicate idempotency key', async () => {
    const { client, calls } = makeClient((sql) => {
      if (sql.includes('INSERT INTO notification_outbox')) {
        return { rows: [], rowCount: 0 } // conflict → no row
      }
      return { rows: [], rowCount: 0 }
    })

    const res = await enqueueOutbox(client, {
      profileId: 'profile-1',
      eventKey: 'profile_verified',
      channels: ['in_app'],
    })

    expect(res).toEqual({ outboxId: null, inserted: false })
    expect(calls).toHaveLength(1) // no job insert attempted
  })

  it('throws when no channels are provided', async () => {
    const { client } = makeClient()
    await expect(
      enqueueOutbox(client, {
        profileId: 'profile-1',
        eventKey: 'x',
        channels: [],
      }),
    ).rejects.toThrow(/at least one channel/)
  })

  it('throws when in_app is missing', async () => {
    const { client } = makeClient()
    await expect(
      enqueueOutbox(client, {
        profileId: 'profile-1',
        eventKey: 'x',
        channels: ['email'],
      }),
    ).rejects.toThrow(/in_app channel is mandatory/)
  })

  it('honours explicit idempotencyKey, status, scheduledFor, priority and maxAttempts', async () => {
    const { client, calls } = makeClient((sql) => {
      if (sql.includes('INSERT INTO notification_outbox')) {
        return { rows: [{ id: 'outbox-2' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })

    const scheduledFor = new Date('2026-09-01T08:00:00Z')
    await enqueueOutbox(client, {
      profileId: 'profile-2',
      eventKey: 'order_placed',
      channels: ['in_app', 'sms'],
      idempotencyKey: 'custom-key',
      status: 'scheduled',
      scheduledFor,
      maxAttempts: 3,
      priority: 'urgent',
    })

    const [outboxCall, jobCall] = calls
    expect(outboxCall!.params[5]).toBe('scheduled')
    expect(outboxCall!.params[6]).toBe('custom-key')
    expect(outboxCall!.params[7]).toBe(3)
    expect(outboxCall!.params[8]).toEqual(scheduledFor)
    expect(jobCall!.params[3]).toBe('urgent')
    expect(jobCall!.params[4]).toBe(3)
  })
})
