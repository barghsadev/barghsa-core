/**
 * Resend webhook payload types (E-05, T-05.06.07).
 *
 * Resend posts a single JSON object per event with a `type` discriminator and
 * a `data` object whose fields vary by event. We model the fields the delivery
 * callback handler needs; unknown/extra fields are ignored.
 */

/** The event types the delivery-callback receiver understands. */
export type ResendEmailEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened'
  | 'email.clicked'

/** Resend bounce severity. Only `hard_bounce` triggers suppression. */
export type ResendBounceCategory = 'hard_bounce' | 'soft_bounce'

export interface ResendEventData {
  /** Provider message id, used to reconcile a delivery log / outbox row. */
  email_id?: string
  from?: string
  to?: string
  /** Bounce severity for `email.bounced` events. */
  category?: ResendBounceCategory
  subject?: string
  [key: string]: unknown
}

export interface ResendWebhookEvent {
  object?: string
  type: ResendEmailEventType
  created_at?: string
  data: ResendEventData
}

/** The `svix-*` headers Resend sends on every webhook POST. */
export interface ResendWebhookHeaders {
  id: string | undefined
  timestamp: string | undefined
  signature: string | undefined
}

/** Outcome classification of an event for the `email_webhook_events.status` column. */
export type WebhookEventStatus =
  | 'delivered'
  | 'failed'
  | 'opened'
  | 'clicked'
  | 'complained'

export const EVENT_STATUS: Record<ResendEmailEventType, WebhookEventStatus | null> = {
  'email.sent': null,
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'failed',
  'email.bounced': 'failed',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
}

/** A durable sideline of the event, enough to reconcile later. */
export interface DispatchOutcome {
  /** True when a new event was recorded (non-duplicate). */
  processed: boolean
  /** The `email_webhook_events.id` when a new row was inserted. */
  eventId?: string
}