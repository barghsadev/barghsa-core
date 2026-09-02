/**
 * Finance chargeback alert contract (T-04.2.04.03 / S-04.2.04).
 *
 * Unmatched or reversal-failed provider chargebacks must alert the
 * finance team immediately (in-app push + email) and stay visible as a
 * dashboard warning until the durable event leaves the unresolved set.
 *
 * @module finance
 */

import {
  isUnresolvedChargebackStatus,
  type ParsedChargebackNotification,
  type WalletChargebackEventStatus,
  type WalletChargebackUnresolvedStatus,
} from './wallet-chargeback.js'
import type { NotificationChannel } from '../notifications/notification-transport.js'

/** Immediate staff alert event for an unresolved chargeback. */
export const FINANCE_CHARGEBACK_ALERT_EVENT_KEY =
  'finance.chargeback_unresolved' as const

/** Capability gate documented on the dashboard warning API. */
export const FINANCE_CHARGEBACK_ALERT_PERMISSION =
  'admin:finance:wallet:chargeback-alerts' as const

/** Predefined staff role that receives chargeback alerts. */
export const FINANCE_CHARGEBACK_ALERT_ROLE_ID = 'role-finance' as const

/**
 * In-app is the staff push (notification center). Email is the durable
 * fallback so an unread bell cannot hide a chargeback.
 */
export const FINANCE_CHARGEBACK_ALERT_CHANNELS: readonly NotificationChannel[] =
  ['in_app', 'email']

/** Newest unresolved events returned on the dashboard warning. */
export const FINANCE_CHARGEBACK_WARNING_LIMIT = 20

export const CHARGEBACK_UNRESOLVED_STATUS_LABELS: Record<
  WalletChargebackUnresolvedStatus,
  { fa: string; en: string }
> = {
  unmatched: { fa: 'بدون تطبیق با شارژ اصلی', en: 'unmatched to original top-up' },
  unresolved: {
    fa: 'برگشت ثبت نشد',
    en: 'reversal could not post',
  },
}

export function needsFinanceChargebackAlert(
  status: WalletChargebackEventStatus,
): status is WalletChargebackUnresolvedStatus {
  return isUnresolvedChargebackStatus(status)
}

/** Outbox idempotency key: one logical alert per (event, recipient). */
export function financeChargebackAlertIdempotencyKey(
  eventId: string,
  profileId: string,
): string {
  return `${FINANCE_CHARGEBACK_ALERT_EVENT_KEY}:${eventId}:${profileId}`
}

export interface FinanceChargebackAlertInput {
  eventId: string
  status: WalletChargebackEventStatus
  notification: ParsedChargebackNotification
  walletId: string | null
  originalTransactionId: string | null
}

export interface FinanceChargebackAlertPayload {
  event_id: string
  status: WalletChargebackUnresolvedStatus
  status_label_fa: string
  status_label_en: string
  amount_irr: string
  wallet_id: string
  original_transaction_id: string
  reason: string
}

export function buildFinanceChargebackAlertPayload(
  input: FinanceChargebackAlertInput & { status: WalletChargebackUnresolvedStatus },
): FinanceChargebackAlertPayload {
  const labels = CHARGEBACK_UNRESOLVED_STATUS_LABELS[input.status]
  return {
    event_id: input.eventId,
    status: input.status,
    status_label_fa: labels.fa,
    status_label_en: labels.en,
    amount_irr: input.notification.amountIrR.toString(),
    wallet_id: input.walletId ?? '',
    original_transaction_id: input.originalTransactionId ?? '',
    reason: input.notification.reason,
  }
}

export interface UnresolvedChargebackWarningItem {
  eventId: string
  status: WalletChargebackUnresolvedStatus
  amountIrR: string | null
  walletId: string | null
  originalTransactionId: string | null
  reason: string | null
  createdAt: string
}

export interface UnresolvedChargebackWarning {
  count: number
  unmatchedCount: number
  reversalFailedCount: number
  items: UnresolvedChargebackWarningItem[]
}

export function emptyUnresolvedChargebackWarning(): UnresolvedChargebackWarning {
  return {
    count: 0,
    unmatchedCount: 0,
    reversalFailedCount: 0,
    items: [],
  }
}

export function summarizeUnresolvedChargebackCounts(rows: ReadonlyArray<{
  status: string
  n: number
}>): Pick<
  UnresolvedChargebackWarning,
  'count' | 'unmatchedCount' | 'reversalFailedCount'
> {
  let unmatchedCount = 0
  let reversalFailedCount = 0
  for (const row of rows) {
    if (row.status === 'unmatched') unmatchedCount += row.n
    if (row.status === 'unresolved') reversalFailedCount += row.n
  }
  return {
    count: unmatchedCount + reversalFailedCount,
    unmatchedCount,
    reversalFailedCount,
  }
}
