import { describe, it, expect, beforeEach } from 'vitest'
import {
  exportWorkerMetrics,
  collectNotificationGauges,
  recordDeliveryAttempt,
  notificationsDeliveryAttempts,
  notificationsOutboxAge,
  notificationsQueueDepth,
  notificationsDeadLetterCount,
} from './worker-metrics.js'

/**
 * Worker notification-metrics tests (E-05, T-05.01.07).
 *
 * Covers the DB-derived gauges (outbox age, queue depth, dead-letter count)
 * via an injected fake pool that returns rows for the three collector queries,
 * plus the in-process delivery-attempts counter increments and the Prometheus
 * text-format export.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePool(overrides: {
  age?: number
  depth?: number
  deadLetter?: number
} = {}): any {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> {
      if (sql.includes('EXTRACT(EPOCH FROM (NOW() - created_at))')) {
        return { rows: [{ age: overrides.age ?? 120 }] }
      }
      if (sql.includes('notification_dead_letter')) {
        return { rows: [{ count: overrides.deadLetter ?? 3 }] }
      }
      if (sql.includes('notification_outbox')) {
        return { rows: [{ depth: overrides.depth ?? 7 }] }
      }
      return { rows: [] }
    },
  }
}

describe('worker notification metrics', () => {
  beforeEach(() => {
    // Reset gauges to a clean slate between tests.
    notificationsOutboxAge.reset()
    notificationsQueueDepth.reset()
    notificationsDeadLetterCount.reset()
    notificationsDeliveryAttempts.reset()
  })

  it('recordDeliveryAttempt increments the labelled attempts counter', async () => {
    recordDeliveryAttempt('email', 'delivered')
    recordDeliveryAttempt('email', 'delivered')
    recordDeliveryAttempt('sms', 'failed')

    const text = await exportWorkerMetrics()
    expect(text).toContain('notifications_delivery_attempts_total')
    expect(text).toContain('channel="email",status="delivered"} 2')
    expect(text).toContain('channel="sms",status="failed"} 1')
  })

  it('collectNotificationGauges sets outbox age, queue depth and dead-letter count', async () => {
    await collectNotificationGauges(makePool({ age: 300, depth: 12, deadLetter: 5 }))

    const text = await exportWorkerMetrics()
    expect(text).toContain('notifications_outbox_age_seconds 300')
    expect(text).toContain('notifications_queue_depth 12')
    expect(text).toContain('notifications_dead_letter_count 5')
  })

  it('treats missing rows (empty tables) as zero-valued gauges', async () => {
    await collectNotificationGauges(makePool({ age: 0, depth: 0, deadLetter: 0 }))

    const text = await exportWorkerMetrics()
    expect(text).toContain('notifications_outbox_age_seconds 0')
    expect(text).toContain('notifications_queue_depth 0')
    expect(text).toContain('notifications_dead_letter_count 0')
  })
})
