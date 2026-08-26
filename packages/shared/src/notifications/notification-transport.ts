/**
 * Notification transport contract (E-05, T-05.01.01).
 *
 * The notification system delivers messages over pluggable channels.
 * Every channel (in-app, email/SMTP, email/Resend, SMS.ir) implements the
 * `INotificationTransport` interface so the outbox worker can dispatch with
 * a uniform contract and swap providers without touching callers.
 *
 * Design notes:
 * - `send()` accepts a single logical delivery (one recipient + channel) and
 *   returns a per-delivery `providerRef` plus a final status. Provider-level
 *   idempotency keys let adapters guarantee at-most-once delivery.
 * - The worker classifies provider outcomes: `delivered` vs `failed`. Finer
 *   error categories (transient/permanent) belong to the error-classification
 *   utility (T-05.08.01) and are surfaced through the outbox `last_error`.
 */

/** All channels the notification pipeline can deliver to. */
export type NotificationChannel = 'in_app' | 'email' | 'sms'

/**
 * Delivery lifecycle states for an outbox row / job.
 * Mirrors the `notification_outbox.status` CHECK constraint in the migration.
 */
export type NotificationDeliveryStatus =
  | 'queued'
  | 'scheduled'
  | 'sending'
  | 'delivered'
  | 'failed'
  | 'cancelled'

/** Result status returned by a transport after a send attempt. */
export type NotificationSendResultStatus = 'delivered' | 'failed'

/**
 * A single logical delivery request handed to a transport adapter.
 *
 * `idempotencyKey` is unique per (event, channel, recipient) so retries and
 * duplicate outbox rows never double-deliver. `payload` carries the business
 * variables needed to render the message through the active template.
 */
export interface NotificationSendPayload {
  /** Unique idempotency key, typically sha256(eventKey + channel + recipientId). */
  idempotencyKey: string

  /** The channel this payload should be delivered on. */
  channel: NotificationChannel

  /** Stable recipient identifier (profile id, or user id for in-app). */
  recipientId: string

  /** Optional owning profile id for scoping / preference resolution. */
  profileId: string | null

  /** Business event key, e.g. 'profile_verified'. Used for template lookup. */
  eventKey: string

  /** JSON variables used to render the message body/title. */
  payload: Record<string, unknown>

  /** Provider reference from a previous attempt, if any (for idempotency). */
  providerRef?: string
}

/** Result returned from a transport `send()` call. */
export interface NotificationSendResult {
  /** Provider-specific reference (e.g. provider message id, SMTP message id). */
  providerRef: string

  /** Final delivery outcome — 'delivered' or 'failed'. */
  status: NotificationSendResultStatus
}

/**
 * Pluggable notification transport.
 *
 * Implementations must be deterministic for test purposes and must never
 * expose credentials or internal state in thrown errors (a safe message is
 * captured into `last_error`).
 */
export interface INotificationTransport {
  /** The channel this transport delivers to. */
  readonly channel: NotificationChannel

  /**
   * Deliver a single message.
   *
   * @throws On unexpected/provider failure — the worker catches the error and
   *   records it in the outbox row's `last_error` before scheduling a retry.
   */
  send(payload: NotificationSendPayload): Promise<NotificationSendResult>
}