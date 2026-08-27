import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { NotificationChannel } from '@barghsa/shared/notifications'
import { maxAttemptsForType, priorityForType } from './retry-schedule.js'

/**
 * Transactional outbox write pipeline (E-05, T-05.01.02).
 *
 * `enqueueOutbox` inserts a durable `notification_outbox` row and its
 * per-channel `notification_job` rows **inside the caller's running
 * transaction**. The caller passes a `PoolClient` that it already owns
 * (`pool.connect()` + `BEGIN`), runs its business writes, calls
 * `enqueueOutbox`, then commits. If the process crashes before COMMIT the
 * whole unit — business change + delivery intent — rolls back together, so a
 * notification is never enqueued for a business event that didn't happen, and
 * a business event never happens without its delivery intent being durable.
 *
 * Idempotency: the outbox enforces a UNIQUE `idempotency_key`. Re-inserting a
 * duplicate (same business event re-fired, retry after ambiguous timeout)
 * returns `inserted: false` and leaves the original row untouched
 * (ON CONFLICT DO NOTHING), guaranteeing at-most-once logical delivery.
 */

export interface EnqueueOutboxInput {
  /** Owner of the notification (recipient profile). */
  profileId: string
  /** Recipient user id (in-app delivery target). Falls back to profileId. */
  userId?: string | null
  /** Business event key, e.g. 'profile_verified'. Used for template lookup. */
  eventKey: string
  /** JSON variables used to render the message. Defaults to {}. */
  payload?: Record<string, unknown>
  /** Target channels. In-app is always mandatory for business events. */
  channels: NotificationChannel[]
  /**
   * Unique idempotency key. Defaults to sha256(`${eventKey}:${profileId}`).
   * Override for cross-event semantics (e.g. per-channel keys after T-05.01.04).
   */
  idempotencyKey?: string
  /** 'queued' (immediate) or 'scheduled' (deferred until scheduledFor). */
  status?: 'queued' | 'scheduled'
  /** When the row first becomes eligible for dispatch (delivery window). */
  scheduledFor?: Date | null
  /** Bounded retry cap (T-05.01.03). Default 5. */
  maxAttempts?: number
  /** Queue priority per job: 'urgent' before 'normal'. Default 'normal'. */
  priority?: 'urgent' | 'normal'
}

export interface EnqueueOutboxResult {
  /** The outbox row id, or null when a duplicate idempotency key was skipped. */
  outboxId: string | null
  /** True when a new row was inserted; false when a duplicate was ignored. */
  inserted: boolean
}

/** Default idempotency key — sha256(eventKey + ':' + profileId). */
export function deriveIdempotencyKey(eventKey: string, profileId: string): string {
  return createHash('sha256').update(`${eventKey}:${profileId}`).digest('hex')
}

/**
 * Insert an outbox row and its per-channel jobs within `client`'s transaction.
 *
 * `client` must already be inside a transaction (BEGIN issued by the caller).
 * This function never commits / rolls back — it only issues INSERTs so the
 * caller keeps full control of transactional atomicity with its business write.
 */
export async function enqueueOutbox(
  client: PoolClient,
  input: EnqueueOutboxInput,
): Promise<EnqueueOutboxResult> {
  const idempotencyKey = input.idempotencyKey ?? deriveIdempotencyKey(input.eventKey, input.profileId)
  const channels = input.channels
  const status = input.status ?? 'queued'
  // Per-type config (T-05.01.03): max_attempts and queue priority resolve from
  // the code-defined notification-type registry unless the caller overrides.
  const maxAttempts = input.maxAttempts ?? maxAttemptsForType(input.eventKey)
  const priority = input.priority ?? priorityForType(input.eventKey)

  if (channels.length === 0) {
    throw new Error('enqueueOutbox requires at least one channel')
  }
  if (!channels.includes('in_app')) {
    throw new Error('in_app channel is mandatory for notification delivery')
  }

  const insertResult = await client.query<{ id: string }>(
    `INSERT INTO notification_outbox
       (profile_id, user_id, event_key, payload, channels, status,
        idempotency_key, max_attempts, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.profileId,
      input.userId ?? null,
      input.eventKey,
      input.payload ?? {},
      channels,
      status,
      idempotencyKey,
      maxAttempts,
      input.scheduledFor ?? null,
    ],
  )

  if (insertResult.rowCount === 0 || !insertResult.rows[0]) {
    return { outboxId: null, inserted: false }
  }

  const outboxId = insertResult.rows[0].id

  // One job per channel. ON CONFLICT (outbox_id, channel) DO NOTHING keeps the
  // insert idempotent across re-runs of the same outbox row.
  const jobValues: unknown[] = []
  const placeholders: string[] = []
  channels.forEach((channel, i) => {
    const base = i * 5
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`)
    jobValues.push(outboxId, channel, 'queued', priority, maxAttempts)
  })

  await client.query(
    `INSERT INTO notification_job
       (outbox_id, channel, status, priority, max_attempts)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (outbox_id, channel) DO NOTHING`,
    jobValues,
  )

  return { outboxId, inserted: true }
}
