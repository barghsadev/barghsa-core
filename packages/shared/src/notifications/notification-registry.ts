/**
 * Notification type registry & classification (E-05, T-05.03.01).
 *
 * A single, code-defined registry of every business notification event the
 * platform can emit. Each event is assigned a `classification` that drives
 * delivery-window behaviour:
 *
 * - `immediate` — bypasses the nightly quiet / delivery window and is
 *   dispatched as soon as possible. Applies to security, OTP, authentication,
 *   payment, refund and contract-cancellation events.
 * - `daytime` — queued and only dispatched during the user's configured
 *   delivery window (09:00–21:00 by default). Everything not explicitly listed
 *   as `immediate` falls back to `daytime`.
 *
 * The registry is **code-defined and NOT admin-editable**, so security-relevant
 * event types can never be reclassified (e.g. an admin must not be able to make
 * an OTP notification `daytime` and delay delivery). Events marked
 * `securityPinned` are those that the product requires to stay `immediate`
 * unconditionally.
 *
 * The canonical list of event keys and their classifications mirrors
 * `kanban/epics/05-notifications-documents-ai.md` §3 "Appendix: Business
 * Notification Events". Keeping the registry here in `@barghsa/shared` lets
 * both the API (outbox writer / enqueue) and the worker (delivery-window logic)
 * resolve classification against the same source of truth.
 *
 * The `notification_outbox.scheduled_for` column this classification feeds is
 * already present in the schema and migration `0025_create_notification_outbox`:
 * rows carrying `status='scheduled'` + a `scheduled_for` timestamp are not
 * dispatched until the window opens (delivery-window computation is T-05.03.02).
 *
 * @module notifications
 */

/** Delivery classification of a notification event. */
export type NotificationClassification = 'immediate' | 'daytime'

/** Whether an event is a mandatory, marketing or system/test notification. */
export type NotificationCategory = 'mandatory' | 'marketing' | 'system'

/** Static, code-defined metadata for one notification event key. */
export interface NotificationTypeDefinition {
  /** Delivery classification: `immediate` bypasses the quiet window. */
  classification: NotificationClassification
  /**
   * True for security/OTP/auth events that must always be `immediate` and can
   * never be reclassified by an admin. The registry is code-defined, so this
   * flag is the semantic marker downstream logic (and any future admin config)
   * must respect.
   */
  securityPinned: boolean
  /** Event category for consent / mandatory-vs-marketing routing. */
  category: NotificationCategory
}

/** The code-defined registry of business notification events (E-05 §3 Appendix). */
export const NOTIFICATION_TYPE_REGISTRY: Readonly<Record<string, NotificationTypeDefinition>> = {
  // ── Authentication & security — immediate, security-pinned ──────────────
  'auth.otp_sent': { classification: 'immediate', securityPinned: true, category: 'mandatory' },
  'auth.password_changed': { classification: 'immediate', securityPinned: true, category: 'mandatory' },
  'auth.session_revoked': { classification: 'immediate', securityPinned: true, category: 'mandatory' },
  'auth.new_device_login': { classification: 'immediate', securityPinned: true, category: 'mandatory' },

  // ── Payment / wallet — financial, mostly immediate ──────────────────────
  'payment.wallet_topup_completed': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'payment.wallet_topup_failed': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'payment.invoice_paid': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'payment.bank_receipt_rejected': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'payment.invoice_overdue': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  // Hourly ReminderSender (T-04.1.04.03). Daytime: schedule rows are already
  // snapped into the delivery window; the outbox still parks a late tick.
  'payment.invoice_reminder': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'payment.refund_completed': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'payment.refund_failed': { classification: 'immediate', securityPinned: false, category: 'mandatory' },

  // ── Contract lifecycle ──────────────────────────────────────────────────
  'contract.created': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'contract.awaiting_acceptance': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'contract.accepted': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'contract.signed': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'contract.active': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'contract.cancelled': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'contract.changes_requested': { classification: 'immediate', securityPinned: false, category: 'mandatory' },

  // ── Orders ──────────────────────────────────────────────────────────────
  'order.submitted': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'order.status_changed': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'order.awaiting_staff': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'order.cancellation_requested': { classification: 'daytime', securityPinned: false, category: 'mandatory' },

  // ── Tickets ─────────────────────────────────────────────────────────────
  'ticket.new_reply': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'ticket.assigned': { classification: 'daytime', securityPinned: false, category: 'mandatory' },

  // ── Documents ───────────────────────────────────────────────────────────
  'document.uploaded': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'document.scan_failed': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'document.quarantined': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'document.review_completed': { classification: 'daytime', securityPinned: false, category: 'mandatory' },

  // ── Profile ─────────────────────────────────────────────────────────────
  'profile.verification_status': { classification: 'daytime', securityPinned: false, category: 'mandatory' },
  'profile.invitation_received': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'profile.agent_role_changed': { classification: 'daytime', securityPinned: false, category: 'mandatory' },

  // ── Wallet alerts ───────────────────────────────────────────────────────
  'wallet.low_balance': { classification: 'immediate', securityPinned: false, category: 'mandatory' },
  'wallet.credit_received': { classification: 'immediate', securityPinned: false, category: 'mandatory' },

  // ── System / marketing ──────────────────────────────────────────────────
  'system.service_outage': { classification: 'immediate', securityPinned: false, category: 'system' },
  'marketing.promotion': { classification: 'daytime', securityPinned: false, category: 'marketing' },
  'system.notification_test': { classification: 'immediate', securityPinned: false, category: 'system' },

  // ── Admin / staff operations (S-09.08) ─────────────────────────────────
  // Staff-only operational alert: an open service item (ticket, verification
  // case) has exceeded its admin-configured response target. Immediate so a
  // breached target is never delayed by the daytime delivery window.
  'admin.service_target_breached': {
    classification: 'immediate',
    securityPinned: false,
    category: 'system',
  },

  // Staff-only operational alert: a breached service item has climbed an
  // escalation tier (team lead / admin) because no response arrived within
  // the configured window (T-09.08.03). Immediate so an escalation is never
  // delayed by the daytime delivery window.
  'admin.service_escalated': {
    classification: 'immediate',
    securityPinned: false,
    category: 'system',
  },

  // Staff-only finance alert: a provider chargeback could not be mapped
  // or its compensating reversal could not post (T-04.2.04.03). Immediate
  // so the quiet window cannot delay a money-at-risk exception.
  'finance.chargeback_unresolved': {
    classification: 'immediate',
    securityPinned: false,
    category: 'system',
  },
} as const

/**
 * Resolve the delivery classification for an event key.
 *
 * Unknown / unregistered event keys default to `daytime` ("all others →
 * daytime"). Security-pinned types (OTP, auth) are `immediate` by construction
 * in the registry and can never be reclassified.
 */
export function classifyNotificationType(eventKey: string): NotificationClassification {
  return NOTIFICATION_TYPE_REGISTRY[eventKey]?.classification ?? 'daytime'
}

/**
 * True when the event is security-pinned (OTP / authentication / security)
 * and must never be reclassified away from `immediate`.
 *
 * The registry is code-defined and non-admin-editable; this predicate is the
 * explicit guard any configuration surface must consult before allowing a
 * classification change.
 */
export function isSecurityPinnedNotification(eventKey: string): boolean {
  return NOTIFICATION_TYPE_REGISTRY[eventKey]?.securityPinned ?? false
}

/** Resolve the static definition for an event key, or `undefined` if unregistered. */
export function getNotificationTypeDefinition(
  eventKey: string,
): NotificationTypeDefinition | undefined {
  return NOTIFICATION_TYPE_REGISTRY[eventKey]
}
