import { describe, it, expect } from 'vitest'
import { dispatchOutbox, type OutboxRow } from './outbox-reader.js'
import type {
  INotificationTransport,
  NotificationChannel,
  NotificationSendPayload,
  NotificationSendResult,
} from '@barghsa/shared/notifications'

/**
 * Base outbox reader unit tests.
 *
 * `dispatchOutbox` is the pure, DB-free part of the scaffold (it fans a
 * claimed outbox row out to registered transports). The lease/Dispatch loop
 * against a real pool is covered at integration/e2e level (T-05.01.02).
 */

class FakeTransport implements INotificationTransport {
  readonly channel: NotificationChannel
  reads: NotificationSendPayload[] = []

  constructor(channel: NotificationChannel) {
    this.channel = channel
  }

  async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
    this.reads.push(payload)
    return { providerRef: `ref_${payload.channel}`, status: 'delivered' }
  }
}

const row: OutboxRow = {
  id: '00000000-0000-7000-0000-000000000001',
  profileId: '00000000-0000-7000-0000-0000000000p1',
  userId: 'user-1',
  eventKey: 'profile_verified',
  payload: { name: 'Ali' },
  channels: ['in_app', 'email'],
  idempotencyKey: 'abc123',
  attempts: 0,
  maxAttempts: 5,
  scheduledAt: null,
}

describe('dispatchOutbox', () => {
  it('delivers to each registered channel with a matching payload', async () => {
    const inApp = new FakeTransport('in_app')
    const email = new FakeTransport('email')
    const outcomes = await dispatchOutbox(row, { in_app: inApp, email })

    expect(outcomes).toHaveLength(2)
    expect(outcomes.map((o) => o.channel)).toEqual(['in_app', 'email'])
    expect(outcomes.every((o) => o.result.status === 'delivered')).toBe(true)

    expect(inApp.reads[0]!.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
    expect(inApp.reads[0]!.recipientId).toBe('user-1')
    expect(email.reads[0]!.channel).toBe('email')
    expect(email.reads[0]!.providerRef).toBeUndefined()
  })

  it('gives each channel a distinct per-channel idempotency key (T-05.01.04)', async () => {
    const inApp = new FakeTransport('in_app')
    const email = new FakeTransport('email')
    await dispatchOutbox(row, { in_app: inApp, email })

    const inAppKey = inApp.reads[0]!.idempotencyKey
    const emailKey = email.reads[0]!.idempotencyKey
    expect(inAppKey).toMatch(/^[0-9a-f]{64}$/)
    expect(emailKey).toMatch(/^[0-9a-f]{64}$/)
    // Different channels ⇒ different keys for the same event/profile.
    expect(inAppKey).not.toBe(emailKey)
  })

  it('derives a stable per-channel key across retries of the same row (T-05.01.04)', async () => {
    const inApp = new FakeTransport('in_app')
    const email = new FakeTransport('email')
    await dispatchOutbox(row, { in_app: inApp, email })
    await dispatchOutbox(row, { in_app: inApp, email })
    expect(inApp.reads[0]!.idempotencyKey).toBe(inApp.reads[1]!.idempotencyKey)
    expect(email.reads[0]!.idempotencyKey).toBe(email.reads[1]!.idempotencyKey)
  })

  it('throws when in_app transport is required but missing', async () => {
    const email = new FakeTransport('email')
    await expect(dispatchOutbox(row, { email })).rejects.toThrow(/in_app transport is mandatory/)
  })

  it('skips an unregistered external channel without error', async () => {
    const inApp = new FakeTransport('in_app')
    const outcomes = await dispatchOutbox(row, { in_app: inApp })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.channel).toBe('in_app')
  })

  it('sends exactly one send call per registered channel (no duplicates)', async () => {
    const inApp = new FakeTransport('in_app')
    const email = new FakeTransport('email')
    await dispatchOutbox(row, { in_app: inApp, email })
    expect(inApp.reads).toHaveLength(1)
    expect(email.reads).toHaveLength(1)
  })

  it('uses profileId as recipient when no user id is present', async () => {
    const inApp = new FakeTransport('in_app')
    const noUser = { ...row, userId: null }
    await dispatchOutbox(noUser, { in_app: inApp })
    expect(inApp.reads[0]!.recipientId).toBe(row.profileId)
  })
})

describe('transport result contract', () => {
  it('fake returns delivered with a provider ref', async () => {
    const t = new FakeTransport('sms')
    const r = await t.send({} as NotificationSendPayload)
    expect(r.status).toBe('delivered')
    expect(typeof r.providerRef).toBe('string')
  })
})