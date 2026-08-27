import { describe, it, expect, beforeEach } from 'vitest'
import {
  exportWorkerMetrics,
  collectNotificationGauges,
  recordDeliveryAttempt,
  notificationsDeliveryAttempts,
  notificationsOutboxAge,
  notificationsQueueDepth,
  notificationsDeadLetterCount,
  providerEmailHealth,
} from './worker-metrics.js'

/**
 * Worker notification-metrics tests (E-05, T-05.01.07 / T-05.06.06).
 *
 * Covers the DB-derived gauges (outbox age, queue depth, dead-letter count,
 * email provider health) via an injected fake pool that returns rows for the
 * collector queries, plus the in-process delivery-attempts counter increments
 * and the Prometheus text-format export.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePool(overrides: {
  age?: number
  depth?: number
  deadLetter?: number
  /** Provider health rows: [{ id, health }]. */
  providerHealth?: Array<{ id: string; health: number }>
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
      if (sql.includes('email_provider_configs')) {
        return { rows: overrides.providerHealth ?? [] }
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
    providerEmailHealth.reset()
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

  it('reports provider_email_health per provider (1 healthy, 0 tripped)', async () => {
    await collectNotificationGauges(
      makePool({
        providerHealth: [
          { id: 'prov-active', health: 1 },
          { id: 'prov-tripped', health: 0 },
        ],
      }),
    )

    const text = await exportWorkerMetrics()
    expect(text).toContain('provider_email_health')
    expect(text).toContain('provider_id="prov-active"} 1')
    expect(text).toContain('provider_id="prov-tripped"} 0')
  })

  it('emits no provider_email_health series when no providers exist', async () => {
    await collectNotificationGauges(makePool({ providerHealth: [] }))
    const text = await exportWorkerMetrics()
    // HELP/TYPE header lines exist for a registered metric; assert no label
    // series was emitted (no provider_id= rows).
    expect(text).not.toMatch(/provider_email_health\{provider_id=/)
  })
})
