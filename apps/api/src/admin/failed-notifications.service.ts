import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import type { NotificationChannel } from '@barghsa/shared/notifications'

/**
 * Dead-letter notification triage (S-09.09, T-09.09.03).
 *
 * Lifecycle states of a `notification_dead_letter` row (same taxonomy the
 * outbox worker writes, migration 0027):
 *
 * - `open`      awaiting triage — the default ops-panel view;
 * - `retried`   an admin re-queued it (idempotency key preserved);
 * - `resolved`  durable dismissal — terminal, no further retry;
 * - `dismissed` acknowledged and removed from the active view.
 */
export const DEAD_LETTER_STATUSES = ['open', 'retried', 'resolved', 'dismissed'] as const
/** A dead-letter notification lifecycle state. */
export type DeadLetterStatus = (typeof DEAD_LETTER_STATUSES)[number]

/** Triage severity classes written by the worker. */
export const DEAD_LETTER_SEVERITIES = ['error', 'critical'] as const
export type DeadLetterSeverity = (typeof DEAD_LETTER_SEVERITIES)[number]

/** Notification channels that can dead-letter. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms'] as const

/** A dead-lettered notification as returned by the admin API (T-09.09.03). */
export interface FailedNotificationDto {
  id: string
  outboxId: string
  jobId: string
  channel: NotificationChannel | string
  eventKey: string
  severity: DeadLetterSeverity
  cause: string | null
  errorCategory: string | null
  attempts: number
  maxAttempts: number
  status: DeadLetterStatus
  /** Masked recipient identifier (never leaks a raw profile/user id). */
  recipientKey: string | null
  /** Sensitive fields masked; safe to render in the ops panel. */
  data: Record<string, unknown> | null
  resolvedById: string | null
  resolvedAt: string | null
  createdAt: string
}

/** Options for the failed-notifications list view. */
export interface ListFailedNotificationsOptions {
  status?: DeadLetterStatus
  severity?: DeadLetterSeverity
  channel?: NotificationChannel | string
  limit?: number
  offset?: number
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

/**
 * Failed-notifications dashboard service (S-09.09, T-09.09.03).
 *
 * Admin/staff surface for notification deliveries that exhausted their retry
 * budget and landed in `notification_dead_letter`:
 *
 * - {@link listFailedNotifications} — the triage view, newest-first, filtered
 *   by status/severity/channel, with raw payload data masked;
 * - {@link retryFailedNotification} — re-queue the underlying outbox row and
 *   its channel job so the outbox worker re-attempts delivery;
 * - {@link resolveFailedNotification} — durable terminal dismissal;
 * - {@link dismissFailedNotification} — acknowledge and remove from the view.
 *
 * Every admin state change writes an `audit_log` row (`notification_retried`
 * / `notification_resolved` / `notification_dismissed`) in the same
 * transaction. Re-failure after a retry re-opens the row (the worker's
 * `writeDeadLetter` ON CONFLICT update), so it stays visible for triage.
 */
@Injectable()
export class FailedNotificationsService {
  private readonly logger = new Logger(FailedNotificationsService.name)

  /**
   * List dead-lettered notifications, newest-first.
   *
   * @throws 400 when an invalid status/severity/channel filter is supplied.
   */
  async listFailedNotifications(
    options: ListFailedNotificationsOptions = {},
  ): Promise<FailedNotificationDto[]> {
    const limit = sanitizeLimit(options.limit)
    const offset = sanitizeOffset(options.offset)
    const status = options.status ?? null
    const severity = options.severity ?? null
    const channel = options.channel ?? null

    if (status !== null && !isDeadLetterStatus(status)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'status must be one of open, retried, resolved, dismissed',
        },
        400,
      )
    }
    if (severity !== null && !(DEAD_LETTER_SEVERITIES as readonly string[]).includes(severity)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'severity must be one of error, critical',
        },
        400,
      )
    }
    if (channel !== null && !(NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'channel must be one of in_app, email, sms',
        },
        400,
      )
    }

    const pool = getDbPool()
    const result = await pool.query(
      `SELECT dl.*, ob.payload
         FROM notification_dead_letter dl
         LEFT JOIN notification_outbox ob ON ob.id = dl.outbox_id
        WHERE ($1::text IS NULL OR dl.status = $1)
          AND ($2::text IS NULL OR dl.severity = $2)
          AND ($3::text IS NULL OR dl.channel = $3)
        ORDER BY dl.created_at DESC, dl.id DESC
        LIMIT $4 OFFSET $5`,
      [status, severity, channel, limit, offset],
    )

    return result.rows.map((row: Record<string, unknown>) => toFailedNotificationDto(row))
  }

  /**
   * Retry a dead-lettered notification: re-queue the outbox row and its
   * channel job so the worker re-attempts delivery, and mark the triage row
   * `retried`. Delivery remains at-most-once via the provider idempotency key.
   *
   * @throws 404 when the row does not exist, 409 when it is no longer `open`.
   */
  async retryFailedNotification(
    id: string,
    actorUserId: string,
    ip: string,
  ): Promise<FailedNotificationDto> {
    return this.transition(id, actorUserId, ip, 'retried', {
      description: 'Re-queue a dead-lettered notification for a fresh delivery attempt',
      event: 'notification_retried',
      allowedFrom: ['open'],
      requeue: true,
    })
  }

  /**
   * Resolve a dead-lettered notification durably (terminal; excluded from the
   * active view and no further retry).
   *
   * @throws 404 when the row does not exist, 409 when it is already terminal.
   */
  async resolveFailedNotification(
    id: string,
    actorUserId: string,
    ip: string,
  ): Promise<FailedNotificationDto> {
    return this.transition(id, actorUserId, ip, 'resolved', {
      description: 'Mark a dead-lettered notification as resolved',
      event: 'notification_resolved',
      allowedFrom: ['open', 'retried'],
      requeue: false,
    })
  }

  /**
   * Dismiss a dead-lettered notification, acknowledging it and removing it
   * from the active view.
   *
   * @throws 404 when the row does not exist, 409 when it is not `open`.
   */
  async dismissFailedNotification(
    id: string,
    actorUserId: string,
    ip: string,
  ): Promise<FailedNotificationDto> {
    return this.transition(id, actorUserId, ip, 'dismissed', {
      description: 'Dismiss a dead-lettered notification',
      event: 'notification_dismissed',
      allowedFrom: ['open'],
      requeue: false,
    })
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async transition(
    id: string,
    actorUserId: string,
    ip: string,
    toStatus: DeadLetterStatus,
    opts: {
      allowedFrom: DeadLetterStatus[]
      event: string
      requeue: boolean
      description: string
    },
  ): Promise<FailedNotificationDto> {
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')

      const result = await client.query(
        `SELECT dl.*, ob.payload
           FROM notification_dead_letter dl
           LEFT JOIN notification_outbox ob ON ob.id = dl.outbox_id
          WHERE dl.id = $1
          FOR UPDATE OF dl`,
        [id],
      )
      const row = result.rows[0] as
        | (Record<string, unknown> & { status: string; outbox_id: string; channel: string })
        | undefined

      if (!row) {
        await client.query('ROLLBACK')
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Dead-letter notification not found' },
          404,
        )
      }

      if (!opts.allowedFrom.includes(row.status as DeadLetterStatus)) {
        await client.query('ROLLBACK')
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_STATE.code,
            message: `Dead-letter notification status '${row.status}' cannot be changed to '${toStatus}'`,
          },
          409,
        )
      }

      if (opts.requeue) {
        // Re-open the delivery: clear the lease, reset the attempt budget, and
        // make the row immediately leasable by the outbox worker.
        await client.query(
          `UPDATE notification_outbox
              SET status = 'queued', attempts = 0, locked_until = NULL,
                  scheduled_for = NULL, last_error = NULL, updated_at = NOW()
            WHERE id = $1`,
          [row.outbox_id],
        )
        const jobUpdate = await client.query(
          `UPDATE notification_job
              SET status = 'queued', attempts = 0, run_after = NOW(),
                  last_error = NULL, updated_at = NOW()
            WHERE outbox_id = $1 AND channel = $2`,
          [row.outbox_id, row.channel],
        )
        if (jobUpdate?.rowCount === 0) {
          this.logger.warn(
            `Retry dead-letter ${id}: no notification_job matched (outbox=${row.outbox_id}, channel=${row.channel})`,
          )
        }
      }

      await client.query(
        `UPDATE notification_dead_letter
            SET status = $2, resolved_by = $3, resolved_at = $4, updated_at = NOW()
          WHERE id = $1`,
        [id, toStatus, actorUserId, now],
      )

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          uuidv7(),
          actorUserId,
          opts.event,
          JSON.stringify({
            deadLetterId: id,
            outboxId: row.outbox_id,
            channel: row.channel,
            fromStatus: row.status,
            toStatus,
            eventKey: row.event_key,
          }),
          uuidv7(),
          ip,
          now,
        ],
      )

      await client.query('COMMIT')
      committed = true

      this.logger.log(`Dead-letter notification ${id} ${toStatus} by ${actorUserId}`)
    } catch (error) {
      if (committed) throw error
      if (error instanceof HttpException) throw error
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to transition dead-letter notification: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code, message: 'Failed to transition dead-letter notification' },
        500,
      )
    } finally {
      client.release()
    }

    return this.getDto(id)
  }

  private async getDto(id: string): Promise<FailedNotificationDto> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT dl.*, ob.payload
         FROM notification_dead_letter dl
         LEFT JOIN notification_outbox ob ON ob.id = dl.outbox_id
        WHERE dl.id = $1`,
      [id],
    )
    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Dead-letter notification not found' },
        404,
      )
    }
    return toFailedNotificationDto(result.rows[0]!)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function isDeadLetterStatus(raw: unknown): raw is DeadLetterStatus {
  return typeof raw === 'string' && (DEAD_LETTER_STATUSES as readonly string[]).includes(raw)
}

/** Map a raw pg row to the API DTO, masking recipient + payload data. */
export function toFailedNotificationDto(row: Record<string, unknown>): FailedNotificationDto {
  const toIso = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    const d = v instanceof Date ? v : new Date(String(v))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  const profileId = row.profile_id === null || row.profile_id === undefined ? null : String(row.profile_id)
  const userId = row.user_id === null || row.user_id === undefined ? null : String(row.user_id)
  const rawPayload =
    row.payload && typeof row.payload === 'object'
      ? (row.payload as Record<string, unknown>)
      : null

  return {
    id: String(row.id),
    outboxId: String(row.outbox_id),
    jobId: String(row.job_id),
    channel: row.channel as NotificationChannel | string,
    eventKey: String(row.event_key),
    severity: row.severity as DeadLetterSeverity,
    cause:
      row.cause === null || row.cause === undefined
        ? null
        : String(maskSensitiveData(String(row.cause), 'cause')),
    errorCategory:
      row.error_category === null || row.error_category === undefined
        ? null
        : String(row.error_category),
    attempts: Number(row.attempts) || 0,
    maxAttempts: Number(row.max_attempts) || 0,
    status: row.status as DeadLetterStatus,
    recipientKey: maskIdentifier(userId ?? profileId),
    data: rawPayload ? (maskSensitiveData(rawPayload) as Record<string, unknown>) : null,
    resolvedById:
      row.resolved_by === null || row.resolved_by === undefined ? null : String(row.resolved_by),
    resolvedAt: toIso(row.resolved_at),
    createdAt: toIso(row.created_at) ?? '',
  }
}

/** Clamp a list limit to the documented bounds. */
export function sanitizeLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_LIST_LIMIT
  return Math.min(raw, MAX_LIST_LIMIT)
}

/** Clamp a list offset to a non-negative integer. */
export function sanitizeOffset(raw: number | undefined): number {
  if (raw === undefined || !Number.isInteger(raw) || raw < 0) return 0
  return raw
}

/** Sensitive words whose presence in a (normalized) key forces full redaction. */
const SENSITIVE_WORDS = new Set([
  'email',
  'phone',
  'mobile',
  'password',
  'passwd',
  'otp',
  'token',
  'secret',
  'api',
  'auth',
  'pin',
  'verification',
  'national',
  'card',
])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Any email-looking sequence inside a longer string. */
const EMAIL_ANY_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
/** A 10–13 digit phone-like number, optionally with a leading + . */
const PHONE_EMBEDDED_RE = /(?<!\d)(?:\+?\d[\d\s\-().]{8,}\d)(?!\d)/g

/**
 * Whether a key names a sensitive field. Keys are normalized so all common
 * casing styles match: `otp`, `recovery_token`, `otpCode`, `emailAddress`,
 * `verification_code` and `apiKeyRef` all resolve to their sensitive words.
 */
export function isSensitiveKey(key: string): boolean {
  if (!key) return false
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
  return words.some((w) => SENSITIVE_WORDS.has(w))
}

/** True when a string is a standalone phone-shaped value (10–13 digits). */
function isPhoneValue(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 13
}

/**
 * Redact a possibly-sensitive recipient id for the ops panel — shows enough
 * to distinguish rows without leaking the raw id.
 */
export function maskIdentifier(id: string | null): string | null {
  if (!id) return null
  if (id.length <= 6) return '***'
  return `${id.slice(0, 2)}…${id.slice(-2)}`
}

/**
 * Recursively mask sensitive fields in a notification payload so the admin
 * panel can render raw delivery data without exposing PII or credentials.
 *
 * A key that names a sensitive field is fully redacted regardless of value
 * type (so `{ otp: 123456 }` and `{ token: { value: 'abc' } }` are both
 * `'***'`, not just string leaves). Emails and phone numbers are partially
 * masked; stand-alone values and embedded occurrences inside longer strings
 * (e.g. a provider `cause` message) are both covered.
 */
export function maskSensitiveData(value: unknown, key = ''): unknown {
  const sensitive = key !== '' && isSensitiveKey(key)

  // Sensitive key + string value: partial-mask PII for triage, else redact.
  if (sensitive && typeof value === 'string') {
    if (EMAIL_RE.test(value)) return maskEmail(value)
    if (isPhoneValue(value)) return maskPhone(value)
    return '***'
  }
  // Sensitive key + any other value type (numbers, booleans, whole nested
  // objects/arrays) is redacted entirely — `{ token: { value: 'abc' } }` is
  // `'***'`, never recursed.
  if (sensitive) return '***'

  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveData(item, key))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskSensitiveData(v, k)
    }
    return out
  }
  if (typeof value !== 'string' || value === '') return value
  if (EMAIL_RE.test(value)) return maskEmail(value)
  if (isPhoneValue(value)) return maskPhone(value)
  // Mask PII embedded inside longer strings (e.g. a provider `cause` message).
  return value
    .replace(EMAIL_ANY_RE, (m) => maskEmail(m))
    .replace(PHONE_EMBEDDED_RE, (m) => maskPhone(m))
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const dLocal = local.length > 2 ? `${local[0]}***${local[local.length - 1]}` : '***'
  const tld = domain.split('.').pop() ?? 'com'
  return `${dLocal}@***.${tld}`
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length > 4 ? `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}` : '***'
}
