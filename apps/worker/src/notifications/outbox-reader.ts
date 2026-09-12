import type { QueryResultRow } from 'pg';
import { getDbPool } from '@barghsa/db';
import type {
  INotificationTransport,
  NotificationChannel,
  NotificationSendPayload,
  NotificationSendResult,
} from '@barghsa/shared/notifications';
import { sanitizeError } from './error-redact.js';
import { deriveChannelIdempotencyKey } from './outbox-writer.js';
import type { QueryPool } from './channel-scheduling.js';
import { recordDeliveryAttempt } from './worker-metrics.js';
import { DeliveryOutcomeUnknown } from './send-receipt.js';

/** Local delivery can share the worker's pinned persistence transaction. */
export interface WorkerNotificationTransport extends INotificationTransport {
  send(payload: NotificationSendPayload, transaction?: QueryPool): Promise<NotificationSendResult>;
}

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

const DEFAULT_LEASE_SIZE = 5;
const DEFAULT_LEASE_MS = 60_000;
export function normalizeLeaseDurationMs(value?: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 100 && value <= 300_000
    ? Math.floor(value)
    : DEFAULT_LEASE_MS;
}

export interface OutboxRow {
  id: string;
  profileId: string | null;
  userId: string | null;
  eventKey: string;
  payload: Record<string, unknown>;
  channels: NotificationChannel[];
  idempotencyKey: string;
  /** Absent only in legacy callers; persisted new rows use version 2. */
  idempotencyVersion?: number;
  leaseToken?: string;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date | null;
  /** Sanitized error from the last failed attempt (for dead-letter triage). */
  lastError: string | null;
}

export interface OutboxReaderOptions {
  /** Transport registry keyed by channel. In-app is mandatory. */
  transports: Partial<Record<NotificationChannel, WorkerNotificationTransport>>;
  /** Pool override for isolated database checks. */
  pool?: {
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: QueryResultRow[]; rowCount?: number | null }>;
  };
  /** Maximum rows to claim per poll (default 5). */
  leaseSize?: number;
  /** Lease duration in ms (default 60s). */
  leaseDurationMs?: number;
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
  const requestedLimit = options?.leaseSize ?? DEFAULT_LEASE_SIZE;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
    : DEFAULT_LEASE_SIZE;
  const leaseMs = normalizeLeaseDurationMs(options?.leaseDurationMs);
  const pool = options?.pool ?? getDbPool();
  const now = new Date();

  const result = await pool.query(
    `UPDATE notification_outbox ob
        SET locked_until = clock_timestamp()+$1*INTERVAL '1 millisecond',
            lease_token=gen_random_uuid()::text,
            updated_at = NOW()
        WHERE ob.id IN (
          SELECT id FROM notification_outbox
          WHERE status IN ('queued', 'scheduled', 'sending')
            AND (locked_until IS NULL OR locked_until < clock_timestamp())
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
                  idempotency_key, idempotency_version, lease_token, attempts, max_attempts, scheduled_for, last_error`,
    [leaseMs, now, limit]
  );
  return result.rows.map((row: Record<string, unknown>): OutboxRow => ({
    id: row.id as string,
    profileId: (row.profile_id as string | null) ?? null,
    userId: (row.user_id as string) ?? null,
    eventKey: row.event_key as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    channels: (row.channels as NotificationChannel[]) ?? [],
    idempotencyKey: row.idempotency_key as string,
    idempotencyVersion: Number(row.idempotency_version ?? 1),
    ...(typeof row.lease_token === 'string' ? { leaseToken: row.lease_token } : {}),
    attempts: (row.attempts as number) ?? 0,
    maxAttempts: (row.max_attempts as number) ?? 5,
    scheduledAt: (row.scheduled_for as Date | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
  }));
}

export interface DispatchOutcome {
  channel: NotificationChannel;
  result: NotificationSendResult;
  /** Provider round-trip latency in milliseconds for this attempt. */
  latencyMs: number;
  /** Sanitized failure detail for this channel only. */
  error?: string;
  /** An uncertain external send must be reconciled before any retry. */
  requiresReconciliation?: boolean;
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
  transports: Partial<Record<NotificationChannel, WorkerNotificationTransport>>,
  control?: { signal: AbortSignal; beforeSend: () => Promise<void> },
  transaction?: QueryPool
): Promise<DispatchOutcome[]> {
  const outcomes: DispatchOutcome[] = [];
  for (const channel of new Set(row.channels)) {
    await control?.beforeSend();
    const transport = transports[channel];
    const payload: NotificationSendPayload = {
      idempotencyKey: deriveChannelIdempotencyKey(
        row.eventKey,
        channel,
        row.profileId ?? row.userId ?? '',
        row.idempotencyKey,
        row.idempotencyVersion ?? 1,
        row.id
      ),
      outboxId: row.id,
      ...(control ? { signal: control.signal } : {}),
      channel,
      recipientId: row.userId ?? row.profileId ?? '',
      profileId: row.profileId,
      eventKey: row.eventKey,
      payload: row.payload,
    };
    const startedAt = performance.now();
    try {
      if (!transport || transport.channel !== channel)
        throw new Error(`${channel} transport unavailable`);
      const result = await transport.send(payload, transaction);
      if (
        !result ||
        !['delivered', 'failed'].includes(result.status) ||
        (result.status === 'delivered' && !result.providerRef)
      ) {
        throw new Error(`${channel} transport returned an invalid delivery result`);
      }
      outcomes.push({ channel, result, latencyMs: Math.round(performance.now() - startedAt) });
    } catch (error) {
      outcomes.push({
        channel,
        result: { providerRef: '', status: 'failed' },
        latencyMs: Math.round(performance.now() - startedAt),
        error: sanitizeError(error instanceof Error ? error.message : String(error)),
        ...(error instanceof DeliveryOutcomeUnknown ? { requiresReconciliation: true } : {}),
      });
    }
    // Transactional inbox delivery is counted by its commit/rollback owner.
    // External attempts must not be counted again when persistence retries.
    if (!transaction) recordDeliveryAttempt(channel, outcomes[outcomes.length - 1]!.result.status);
  }
  return outcomes;
}
