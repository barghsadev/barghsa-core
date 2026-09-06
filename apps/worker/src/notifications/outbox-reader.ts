import { getDbPool } from '@barghsa/db'
import type {
  INotificationTransport,
  NotificationChannel,
  NotificationSendPayload,
  NotificationSendResult,
} from '@barghsa/shared/notifications'
import { sanitizeError } from './error-redact.js'
import { deriveChannelIdempotencyKey } from './outbox-writer.js'

/**
 * Base outbox reader (E-05, T-05.01.01).
 *
 * The foundation structure for the notification worker. It owns the
 * claim-then-dispatch loop that consumes `notification_outbox` rows and fans
 * each out to one `notification_job` per channel.
 *
 * Responsibilities implemented here:
 *   - `leaseOutbox()`: claim due rows by stamping `locked_until` using an
 *     atomic UPDATE ... FOR UPDATE SKIP LOCKED, so concurrent worker replicas
 *     never double-claim a row.
 *   - `dispatchOutbox()`: fans a claimed row out across its channels via the
 *     registered transports (in-app is mandatory).
 *
 * Retry scheduling with backoff+jitter and idempotency enforcement land in
 * T-05.01.03/T-05.01.04. A missing transport produces a failed channel
 * outcome; it cannot make an undelivered external leg count as success.
 */

const DEFAULT_LEASE_SIZE = 20
const DEFAULT_LEASE_MS = 60_000

export interface OutboxRow {
  id: string
  profileId: string
  userId: string | null
  eventKey: string
  payload: Record<string, unknown>
  channels: NotificationChannel[]
  idempotencyKey: string
  /** Absent only in legacy callers; persisted new rows use version 2. */
  idempotencyVersion?: number
  attempts: number
  maxAttempts: number
  scheduledAt: Date | null
  /** Sanitized error from the last failed attempt (for dead-letter triage). */
  lastError: string | null
}

export interface OutboxReaderOptions {
  /** Transport registry keyed by channel. In-app is mandatory. */
  transports: Partial<Record<NotificationChannel, INotificationTransport>>
  /** Pool override for isolated database checks. */
  pool?: { query: (sql: string, params?: any[]) => Promise<any> }
  /** Maximum rows to claim per poll (default 20). */
  leaseSize?: number
  /** Lease duration in ms (default 60s). */
  leaseDurationMs?: number
}

/**
 * Claim up to `limit` due outbox rows by stamping a lease, then return them.
 *
 * A row is "due" when it is in a dispatchable status (queued/scheduled/
 * sending), its lease is expired or null, and (if scheduled) its
 * `scheduled_for` is in the past. `FOR UPDATE SKIP LOCKED` makes the claim
 * safe across concurrent workers.
 */
export async function leaseOutbox(options?: OutboxReaderOptions): Promise<OutboxRow[]> {
  const limit = Math.max(1, options?.leaseSize ?? DEFAULT_LEASE_SIZE)
  const leaseMs = options?.leaseDurationMs ?? DEFAULT_LEASE_MS
  const pool = options?.pool ?? getDbPool()
  const now = new Date()
  const leaseUntil = new Date(Date.now() + leaseMs)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await pool.query(
    `UPDATE notification_outbox ob
        SET locked_until = $1,
            updated_at = NOW()
        WHERE ob.id IN (
          SELECT id FROM notification_outbox
          WHERE status IN ('queued', 'scheduled', 'sending')
            AND (locked_until IS NULL OR locked_until < $2)
            AND (scheduled_for IS NULL OR scheduled_for <= $2)
          ORDER BY
            /* Urgent jobs (Immediate) dispatch before normal (daytime). */
            EXISTS (
              SELECT 1 FROM notification_job nj
              WHERE nj.outbox_id = notification_outbox.id AND nj.priority = 'urgent'
            ) DESC,
            created_at ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, profile_id, user_id, event_key, payload, channels,
                  idempotency_key, idempotency_version, attempts, max_attempts, scheduled_for, last_error`,
    [leaseUntil, now, limit],
  )
  return result.rows.map((row: Record<string, unknown>): OutboxRow => ({
    id: row.id as string,
    profileId: row.profile_id as string,
    userId: (row.user_id as string) ?? null,
    eventKey: row.event_key as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    channels: (row.channels as NotificationChannel[]) ?? [],
    idempotencyKey: row.idempotency_key as string,
    idempotencyVersion: Number(row.idempotency_version ?? 1),
    attempts: (row.attempts as number) ?? 0,
    maxAttempts: (row.max_attempts as number) ?? 5,
    scheduledAt: (row.scheduled_for as Date | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
  }))
}

export interface DispatchOutcome {
  channel: NotificationChannel
  result: NotificationSendResult
  /** Provider round-trip latency in milliseconds for this attempt. */
  latencyMs: number
  /** Sanitized failure detail for this channel only. */
  error?: string
}

/**
 * Dispatch a claimed outbox row out to each of its channels through the
 * registered transports. Missing adapters and thrown provider errors become
 * individual failed outcomes, preserving successful legs and allowing later
 * channels to run. Required but undelivered channels never count as success.
 *
 * New occurrences derive provider keys from the durable outbox ID and channel.
 * Version 1 rows retain their previous formula across deployment. In-app
 * storage separately deduplicates by outbox ID, including proven legacy rows.
 */
export async function dispatchOutbox(
  row: OutboxRow,
  transports: Partial<Record<NotificationChannel, INotificationTransport>>,
): Promise<DispatchOutcome[]> {
  const outcomes: DispatchOutcome[] = []
  for (const channel of new Set(row.channels)) {
    const transport = transports[channel]
    const payload: NotificationSendPayload = {
      idempotencyKey: deriveChannelIdempotencyKey(
        row.eventKey,
        channel,
        row.profileId,
        row.idempotencyKey,
        row.idempotencyVersion ?? 1,
        row.id,
      ),
      outboxId: row.id,
      channel,
      recipientId: row.userId ?? row.profileId,
      profileId: row.profileId,
      eventKey: row.eventKey,
      payload: row.payload,
    }
    const startedAt = performance.now()
    try {
      if (!transport || transport.channel !== channel) throw new Error(`${channel} transport unavailable`)
      const result = await transport.send(payload)
      if (!result || !['delivered', 'failed'].includes(result.status) || (result.status === 'delivered' && !result.providerRef)) {
        throw new Error(`${channel} transport returned an invalid delivery result`)
      }
      outcomes.push({ channel, result, latencyMs: Math.round(performance.now() - startedAt) })
    } catch (error) {
      outcomes.push({ channel, result: { providerRef: '', status: 'failed' },
        latencyMs: Math.round(performance.now() - startedAt),
        error: sanitizeError(error instanceof Error ? error.message : String(error)) })
    }
  }
  return outcomes
}