import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import type { NotificationChannel } from '@barghsa/shared/notifications';

/**
 * Notification observability metrics (E-05, T-05.01.07).
 *
 * Exposes Prometheus metrics for notification delivery and backlog:
 *
 *   - `notifications_outbox_age_seconds`        — gauge: how long the oldest
 *       pending (queued/scheduled/sending) outbox row has been waiting. A
 *       growing value signals the worker is falling behind or a row is stuck.
 *   - `notifications_eligible_outbox_age_seconds` — gauge: elapsed time since
 *       the oldest eligible pending row became due, excluding future schedules.
 *   - `notifications_delivery_attempts_total{channel,status}` — counter: one
 *       increment per delivery attempt, labelled by channel and outcome
 *       (`delivered` | `failed`). Drives delivery error-rate panels.
 *   - `notifications_queue_depth`               — gauge: number of outbox rows
 *       waiting to be dispatched (queued + scheduled).
 *   - `notifications_dead_letter_count`         — gauge: number of `open`
 *       dead-letter rows awaiting admin triage.
 *   - `notifications_outbox_expired_leases`     — pending rows with an expired claim.
 *   - `notifications_outbox_processing_seconds` — duration of each leased row's processing.
 *   - `notifications_scheduled_retries_total`   — channel retries scheduled by committed outcomes.
 *
 * The worker serves these at `GET /metrics` on its health port (WORKER_PORT,
 * default 9090) — see `main.ts`. Gauges are recomputed from the database on
 * each scrape; the delivery-attempts counter is incremented in-process as the
 * outbox runner completes each attempt, so it survives only for the worker's
 * lifetime and is reset on restart (labelled counters, not persisted).
 * `notification_delivery_log` stores processing history, including recovery;
 * it is not a crash-safe count of physical provider requests.
 *
 * A scoped Registry is used (not prom-client's global default) so the worker
 * never collides with the API process's metrics names if both are ever
 * imported into one bundle.
 */
const registry = new Registry();

export const notificationsOutboxAge = new Gauge({
  name: 'notifications_outbox_age_seconds',
  help: 'Age in seconds of the oldest pending (queued/scheduled/sending) notification outbox row',
  registers: [registry],
});

export const notificationsEligibleOutboxAge = new Gauge({
  name: 'notifications_eligible_outbox_age_seconds',
  help: 'Seconds since the oldest eligible pending notification outbox row became due',
  registers: [registry],
});

export const notificationsQueueDepth = new Gauge({
  name: 'notifications_queue_depth',
  help: 'Number of notification outbox rows waiting to be dispatched (queued + scheduled)',
  registers: [registry],
});

export const notificationsDeadLetterCount = new Gauge({
  name: 'notifications_dead_letter_count',
  help: 'Number of open dead-letter notifications awaiting admin triage',
  registers: [registry],
});

export const notificationsDeliveryAttempts = new Counter({
  name: 'notifications_delivery_attempts_total',
  help: 'Total notification delivery attempts, labelled by channel and outcome',
  labelNames: ['channel', 'status'] as const,
  registers: [registry],
});

export const notificationsExpiredLeases = new Gauge({
  name: 'notifications_outbox_expired_leases',
  help: 'Number of pending notification outbox rows with an expired lease',
  registers: [registry],
});

export const notificationsOutboxProcessing = new Histogram({
  name: 'notifications_outbox_processing_seconds',
  help: 'Time spent processing each leased notification outbox row',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60],
  registers: [registry],
});

export const notificationsScheduledRetries = new Counter({
  name: 'notifications_scheduled_retries_total',
  help: 'Notification channel retries scheduled by committed delivery outcomes',
  registers: [registry],
});

export const providerEmailHealth = new Gauge({
  name: 'provider_email_health',
  help: 'Email provider circuit breaker health: 1=healthy, 0=tripped/degraded',
  labelNames: ['provider_id'] as const,
  registers: [registry],
});

export const providerSmsHealth = new Gauge({
  name: 'provider_sms_health',
  help: 'Active SMS provider circuit breaker health: 1=healthy, 0=tripped/degraded',
  labelNames: ['provider_id'] as const,
  registers: [registry],
});

export const providerSmsCreditLow = new Gauge({
  name: 'provider_sms_credit_low',
  help: 'Active verified SMS provider credit state: 1=below configured threshold, 0=not low',
  labelNames: ['provider_id'] as const,
  registers: [registry],
});

/**
 * Record one delivery attempt in the attempts counter. Called by the outbox
 * runner after each channel attempt resolves (success or failure). Pure
 * in-process increment — no database access.
 */
export function recordDeliveryAttempt(
  channel: NotificationChannel,
  status: 'delivered' | 'failed'
): void {
  notificationsDeliveryAttempts.inc({ channel, status }, 1);
}

/**
 * Recompute DB-derived gauges against the given pool. Called on each
 * `/metrics` scrape so values reflect live database state.
 */
export async function collectNotificationGauges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any
): Promise<void> {
  // Preserve the all-pending dashboard age and compute the alert age in the same scan.
  const ageRes = await pool.query(
    `SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at))), 0) AS age,
            COALESCE(MAX(EXTRACT(EPOCH FROM (
              NOW() - GREATEST(created_at, COALESCE(scheduled_for, created_at))
            ))) FILTER (WHERE created_at <= NOW() AND (scheduled_for IS NULL OR scheduled_for <= NOW())), 0)
              AS eligible_age,
            COUNT(*) FILTER (WHERE lease_token IS NOT NULL AND locked_until < NOW()) AS expired_leases
       FROM notification_outbox
      WHERE status IN ('queued', 'scheduled', 'sending')`
  );
  notificationsOutboxAge.set(Number(ageRes.rows[0]?.age ?? 0));
  notificationsEligibleOutboxAge.set(Number(ageRes.rows[0]?.eligible_age ?? 0));
  notificationsExpiredLeases.set(Number(ageRes.rows[0]?.expired_leases ?? 0));

  // Backlog awaiting dispatch: queued + scheduled rows.
  const depthRes = await pool.query(
    `SELECT COUNT(*)::int AS depth
       FROM notification_outbox
      WHERE status IN ('queued', 'scheduled')`
  );
  notificationsQueueDepth.set(Number(depthRes.rows[0]?.depth ?? 0));

  // Open dead-letter items needing triage.
  const dlRes = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM notification_dead_letter
      WHERE status = 'open'`
  );
  notificationsDeadLetterCount.set(Number(dlRes.rows[0]?.count ?? 0));

  // Email provider circuit-breaker health (T-05.06.06): 1=healthy, 0=tripped.
  // Recomputed from the persisted `degraded` flag on email_provider_configs
  // so the /metrics endpoint reflects the same state the send path enforces.
  const healthRes = await pool.query(
    `SELECT id, CASE WHEN degraded THEN 0 ELSE 1 END AS health
       FROM email_provider_configs WHERE status='active'`
  );
  providerEmailHealth.reset();
  for (const row of healthRes.rows as Array<{ id: string; health: number }>) {
    providerEmailHealth.set({ provider_id: row.id }, Number(row.health));
  }

  const smsHealthRes = await pool.query(
    `SELECT id, CASE WHEN degraded THEN 0 ELSE 1 END AS health
       FROM sms_provider_configs WHERE status='active'`
  );
  providerSmsHealth.reset();
  for (const row of smsHealthRes.rows as Array<{ id: string; health: number }>) {
    providerSmsHealth.set({ provider_id: row.id }, Number(row.health));
  }

  const creditRes = await pool.query(
    `SELECT id, CASE WHEN low_credit_alert_active THEN 1 ELSE 0 END AS low_credit
       FROM sms_provider_configs WHERE status='active' AND last_test_status='passed'`
  );
  providerSmsCreditLow.reset();
  for (const row of creditRes.rows as Array<{ id: string; low_credit: number }>) {
    providerSmsCreditLow.set({ provider_id: row.id }, Number(row.low_credit));
  }
}

/**
 * Render all notification metrics in Prometheus text format for `GET /metrics`.
 */
export async function exportWorkerMetrics(): Promise<string> {
  return registry.metrics();
}

// Export the scoped registry so main.ts can wire Node runtime metrics
// (collectDefaultMetrics) onto the same set in one place if desired.
export { registry };
