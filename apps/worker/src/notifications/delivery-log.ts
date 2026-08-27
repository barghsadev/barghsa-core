import type { NotificationChannel } from '@barghsa/shared/notifications'
import { sanitizeError } from './error-redact.js'

/**
 * Delivery log writer (E-05, T-05.01.05).
 *
 * Appends one `notification_delivery_log` row per delivery attempt so the
 * admin panel can reconstruct a notification's full delivery history. The
 * worker calls `writeDeliveryLog` after each transport attempt (success or
 * failure) and on the exception path, capturing the channel, attempt number,
 * provider ref, latency, and a sanitized, classified error.
 *
 * `error_detail` is always run through the same redaction used for
 * `notification_outbox.last_error` so provider messages can never leak
 * credentials, tokens, or connection strings.
 *
 * `error_category` classifies the failure for admin triage:
 *   - 'permanent' — a non-retryable outcome (e.g. 4xx validation); retrying
 *     will not succeed, so dead-lettering is expected.
 *   - 'transient' — a retryable outage (timeout, 5xx, network); the job will
 *     be re-attempted with backoff.
 *   - 'provider' — the transport reported a provider-side rejection without a
 *     clear permanent/transient signal.
 */

export type DeliveryErrorCategory = 'transient' | 'permanent' | 'provider'

export interface WriteDeliveryLogInput {
  /** The outbox notification id this attempt belongs to. */
  notificationId: string
  /** The channel delivered. */
  channel: NotificationChannel
  /** Whether the provider accepted the delivery. */
  delivered: boolean
  /** 1-based attempt number within this channel's job. */
  attemptNumber: number
  /** Provider reference returned by the transport, if any. */
  providerRef: string | null
  /** Provider round-trip latency in milliseconds, if measurable. */
  latencyMs: number | null
  /** Raw error message (sanitized before persistence). */
  error?: string | null
  /** Precomputed error category; otherwise derived heuristically. */
  errorCategory?: DeliveryErrorCategory | null
}

/**
 * Coarse permanent-vs-transient classification for triage. Permanent signals
 * (validation, forbidden, bad request, unknown recipient) should not be
 * retried; everything ambiguous leans transient so the existing outbox
 * backoff ladder still attempts recovery.
 */
export function classifyDeliveryError(message: string): DeliveryErrorCategory {
  const m = message.toLowerCase()
  if (
    /(\b4\d{2}\b|\bvalidation\b|\bforbidden\b|\bbad request\b|\bunauthorized\b|\brejected\b|\bnot found\b|\binvalid\b)/.test(
      m,
    )
  ) {
    return 'permanent'
  }
  if (/(timeout|\b5\d{2}\b|unavailable|unreachable|refused|temporary|overloaded)/.test(m)) {
    return 'transient'
  }
  return 'provider'
}

/**
 * Insert one delivery log row. Uses the injected pool (real) so it
 * participates in the caller's transaction when a client is passed.
 */
export async function writeDeliveryLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  input: WriteDeliveryLogInput,
): Promise<void> {
  const safeError = input.error ? sanitizeError(input.error) : null
  const category = input.errorCategory ?? (safeError ? classifyDeliveryError(safeError) : null)
  await pool.query(
    `INSERT INTO notification_delivery_log
       (notification_id, channel, status, attempt_number, provider_ref,
        latency_ms, error_category, error_detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.notificationId,
      input.channel,
      input.delivered ? 'delivered' : 'failed',
      input.attemptNumber,
      input.providerRef ?? null,
      input.latencyMs ?? null,
      input.delivered ? null : category,
      safeError,
    ],
  )
}
