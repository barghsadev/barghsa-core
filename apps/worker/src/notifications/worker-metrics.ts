import promClient, { Registry, Counter, Gauge } from 'prom-client'
import type { NotificationChannel } from '@barghsa/shared/notifications'

/**
 * Notification observability metrics (E-05, T-05.01.07).
 *
 * Exposes the four Prometheus metrics the notification story requires:
 *
 *   - `notifications_outbox_age_seconds`        — gauge: how long the oldest
 *       pending (queued/scheduled/sending) outbox row has been waiting. A
 *       growing value signals the worker is falling behind or a row is stuck.
 *   - `notifications_delivery_attempts_total{channel,status}` — counter: one
 *       increment per delivery attempt, labelled by channel and outcome
 *       (`delivered` | `failed`). Drives delivery error-rate panels.
 *   - `notifications_queue_depth`               — gauge: number of outbox rows
 *       waiting to be dispatched (queued + scheduled).
 *   - `notifications_dead_letter_count`         — gauge: number of `open`
 *       dead-letter rows awaiting admin triage.
 *
 * The worker serves these at `GET /metrics` on its health port (WORKER_PORT,
 * default 9090) — see `main.ts`. Gauges are recomputed from the database on
 * each scrape; the delivery-attempts counter is incremented in-process as the
 * outbox runner completes each attempt, so it survives only for the worker's
 * lifetime and is reset on restart (labelled counters, not persisted). For
 * crash-safe cumulative totals an operator should instead graph the
 * `notification_delivery_log` table.
 *
 * A scoped Registry is used (not prom-client's global default) so the worker
 * never collides with the API process's metrics names if both are ever
 * imported into one bundle.
 */
const registry = new Registry()

export const notificationsOutboxAge = new Gauge({
  name: 'notifications_outbox_age_seconds',
  help: 'Age in seconds of the oldest pending (queued/scheduled/sending) notification outbox row',
  registers: [registry],
})

export const notificationsQueueDepth = new Gauge({
  name: 'notifications_queue_depth',
  help: 'Number of notification outbox rows waiting to be dispatched (queued + scheduled)',
  registers: [registry],
})

export const notificationsDeadLetterCount = new Gauge({
  name: 'notifications_dead_letter_count',
  help: 'Number of open dead-letter notifications awaiting admin triage',
  registers: [registry],
})

export const notificationsDeliveryAttempts = new Counter({
  name: 'notifications_delivery_attempts_total',
  help: 'Total notification delivery attempts, labelled by channel and outcome',
  labelNames: ['channel', 'status'] as const,
  registers: [registry],
})

/**
 * Record one delivery attempt in the attempts counter. Called by the outbox
 * runner after each channel attempt resolves (success or failure). Pure
 * in-process increment — no database access.
 */
export function recordDeliveryAttempt(
  channel: NotificationChannel,
  status: 'delivered' | 'failed',
): void {
  notificationsDeliveryAttempts.inc({ channel, status }, 1)
}

/**
 * Recompute the three DB-derived gauges against the given pool. Called on each
 * `/metrics` scrape so values reflect live database state.
 */
export async function collectNotificationGauges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
): Promise<void> {
  // Oldest pending row's age, in seconds. NULL (no pending rows) -> 0.
  const ageRes = await pool.query(
    `SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at))), 0) AS age
       FROM notification_outbox
      WHERE status IN ('queued', 'scheduled', 'sending')`,
  )
  notificationsOutboxAge.set(Number(ageRes.rows[0]?.age ?? 0))

  // Backlog awaiting dispatch: queued + scheduled rows.
  const depthRes = await pool.query(
    `SELECT COUNT(*)::int AS depth
       FROM notification_outbox
      WHERE status IN ('queued', 'scheduled')`,
  )
  notificationsQueueDepth.set(Number(depthRes.rows[0]?.depth ?? 0))

  // Open dead-letter items needing triage.
  const dlRes = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM notification_dead_letter
      WHERE status = 'open'`,
  )
  notificationsDeadLetterCount.set(Number(dlRes.rows[0]?.count ?? 0))
}

/**
 * Render all notification metrics in Prometheus text format for `GET /metrics`.
 */
export async function exportWorkerMetrics(): Promise<string> {
  return registry.metrics()
}

// Re-export prom-client's collectDefaultMetrics so main.ts can wire Node
// runtime metrics in one place without a second import surface.
export { registry }
