/**
 * Provider chargeback detection helpers (T-04.2.04.02 / S-04.2.04).
 *
 * An inbound provider notification is parsed and signature-checked at
 * the API boundary, then mapped onto the original Completed online
 * top-up credit. Mapping never rewrites that ledger row: when the
 * original is unique and amount-matched, `WalletService.reverseTransaction`
 * posts a compensating `reversal`. When it is not traceable, the
 * durable chargeback event stays `unmatched` (a general exception)
 * instead of debiting an unknown wallet.
 *
 * @module finance
 */

import { isWalletTransactionUuid } from './wallet-reversal.js'
import { parseOnlineTopUpAmountIrR } from './wallet-topup-config.js'

/**
 * Must stay in lock-step with `onlineTopUpCreditIdempotencyKey` in
 * `apps/api/src/wallet/online-topup-callback.service.ts`.
 */
export const ONLINE_TOPUP_CREDIT_IDEMPOTENCY_PREFIX =
  'wallet-online-topup-credit:' as const

/** Default reversal reason written when the provider omits one. */
export const WALLET_CHARGEBACK_REASON = 'provider chargeback' as const

/** Unique event-id index on `wallet_chargeback_events`. */
export const WALLET_CHARGEBACK_EVENT_CONSTRAINT =
  'uq_wallet_chargeback_event_id' as const

/** Provider event types that mean money already credited was taken back. */
export const CHARGEBACK_NOTIFICATION_TYPES = [
  'chargeback',
  'reversed',
  'reversal',
] as const

export type ChargebackNotificationType =
  (typeof CHARGEBACK_NOTIFICATION_TYPES)[number]

/** How the original Completed top-up credit was identified. */
export const CHARGEBACK_MATCH_METHODS = [
  'merchant_order_id',
  'provider_ref_id',
  'authority',
] as const

export type ChargebackMatchMethod = (typeof CHARGEBACK_MATCH_METHODS)[number]

/** Durable outcomes of a claimed chargeback notification. */
export const WALLET_CHARGEBACK_EVENT_STATUSES = [
  'processing',
  'reversed',
  'unmatched',
  'unresolved',
  'duplicate',
] as const

export type WalletChargebackEventStatus =
  (typeof WALLET_CHARGEBACK_EVENT_STATUSES)[number]

export const WALLET_CHARGEBACK_UNRESOLVED_STATUSES = [
  'unmatched',
  'unresolved',
] as const

export type WalletChargebackUnresolvedStatus =
  (typeof WALLET_CHARGEBACK_UNRESOLVED_STATUSES)[number]

export function isChargebackNotificationType(
  raw: string,
): raw is ChargebackNotificationType {
  return (CHARGEBACK_NOTIFICATION_TYPES as readonly string[]).includes(raw)
}

export function isChargebackMatchMethod(
  raw: string,
): raw is ChargebackMatchMethod {
  return (CHARGEBACK_MATCH_METHODS as readonly string[]).includes(raw)
}

export function isWalletChargebackEventStatus(
  raw: string,
): raw is WalletChargebackEventStatus {
  return (WALLET_CHARGEBACK_EVENT_STATUSES as readonly string[]).includes(raw)
}

export function isUnresolvedChargebackStatus(
  raw: string,
): raw is WalletChargebackUnresolvedStatus {
  return (WALLET_CHARGEBACK_UNRESOLVED_STATUSES as readonly string[]).includes(
    raw,
  )
}

/** Credit idempotency key written when the Pending top-up was confirmed. */
export function chargebackCreditIdempotencyKey(
  pendingTransactionId: string,
): string {
  return `${ONLINE_TOPUP_CREDIT_IDEMPOTENCY_PREFIX}${pendingTransactionId}`
}

/** Reversal retry key bound to the provider event, not the original id. */
export function chargebackReversalIdempotencyKey(eventId: string): string {
  return `wallet-chargeback-reversal:${eventId}`
}

export interface ParsedChargebackNotification {
  type: ChargebackNotificationType
  merchantId: string
  merchantOrderId: string | null
  providerRefId: string | null
  authority: string | null
  amountIrR: bigint
  reason: string
}

export type ParseChargebackFailureReason =
  | 'invalid_json'
  | 'invalid_shape'
  | 'invalid_type'
  | 'invalid_amount'
  | 'invalid_merchant_order_id'

export type ParseChargebackResult =
  | { ok: true; notification: ParsedChargebackNotification }
  | { ok: false; reason: ParseChargebackFailureReason }

export interface ChargebackTopUpCandidate {
  id: string
  walletId: string
  type: string
  amount: bigint
  state: string
  refId: string | null
  idempotencyKey: string
  metadata: unknown
}

export interface ChargebackTopUpMatch {
  original: ChargebackTopUpCandidate
  method: ChargebackMatchMethod
}

/**
 * Parse the verified JSON body of a provider chargeback notification.
 * Signature verification is a separate step on the raw bytes.
 */
export function parseChargebackNotification(
  raw: unknown,
): ParseChargebackResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid_shape' }
  }
  const body = raw as Record<string, unknown>

  if (typeof body.type !== 'string') {
    return { ok: false, reason: 'invalid_type' }
  }
  const type = body.type.trim().toLowerCase()
  if (!isChargebackNotificationType(type)) {
    return { ok: false, reason: 'invalid_type' }
  }

  if (typeof body.merchantId !== 'string' || body.merchantId.trim().length === 0) {
    return { ok: false, reason: 'invalid_shape' }
  }

  const amountIrR = parseOnlineTopUpAmountIrR(body.amountIrR)
  if (amountIrR === null) {
    return { ok: false, reason: 'invalid_amount' }
  }

  let merchantOrderId: string | null = null
  if (body.merchantOrderId !== undefined && body.merchantOrderId !== null) {
    if (typeof body.merchantOrderId !== 'string') {
      return { ok: false, reason: 'invalid_merchant_order_id' }
    }
    const trimmed = body.merchantOrderId.trim()
    if (trimmed.length === 0) {
      merchantOrderId = null
    } else if (!isWalletTransactionUuid(trimmed)) {
      return { ok: false, reason: 'invalid_merchant_order_id' }
    } else {
      merchantOrderId = trimmed
    }
  }

  const providerRefId = optionalLocator(body.providerRefId)
  const authority = optionalLocator(body.authority)
  if (providerRefId === undefined || authority === undefined) {
    return { ok: false, reason: 'invalid_shape' }
  }

  let reason: string = WALLET_CHARGEBACK_REASON
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string') {
      return { ok: false, reason: 'invalid_shape' }
    }
    const trimmedReason = body.reason.trim()
    if (trimmedReason.length > 0) reason = trimmedReason
  }

  return {
    ok: true,
    notification: {
      type,
      merchantId: body.merchantId.trim(),
      merchantOrderId,
      providerRefId,
      authority,
      amountIrR,
      reason,
    },
  }
}

export function parseChargebackNotificationJson(
  rawBody: string,
): ParseChargebackResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  return parseChargebackNotification(parsed)
}

/** True when the notification carries at least one original-top-up locator. */
export function hasChargebackLocator(
  notification: ParsedChargebackNotification,
): boolean {
  return Boolean(
    notification.merchantOrderId ||
      notification.providerRefId ||
      notification.authority,
  )
}

/**
 * Chargeback amount is the original capture (positive). Top-up credits
 * post positive; match either the credit or its absolute value.
 */
export function chargebackAmountMatchesTopUp(
  chargebackAmount: bigint,
  topUpAmount: bigint,
): boolean {
  return chargebackAmount === topUpAmount || chargebackAmount === -topUpAmount
}

export function topUpPendingTransactionId(
  candidate: ChargebackTopUpCandidate,
): string | null {
  if (!candidate.metadata || typeof candidate.metadata !== 'object') return null
  const pending = (candidate.metadata as { pendingTransactionId?: unknown })
    .pendingTransactionId
  return typeof pending === 'string' && pending.length > 0 ? pending : null
}

export function topUpAuthority(
  candidate: ChargebackTopUpCandidate,
): string | null {
  if (candidate.metadata && typeof candidate.metadata === 'object') {
    const meta = candidate.metadata as {
      authority?: unknown
      gateway?: { authority?: unknown }
    }
    if (typeof meta.authority === 'string' && meta.authority.length > 0) {
      return meta.authority
    }
    if (
      typeof meta.gateway?.authority === 'string' &&
      meta.gateway.authority.length > 0
    ) {
      return meta.gateway.authority
    }
  }
  // Successful online credits store providerRefId in refId. Treat it as an
  // authority-compatible fallback only when no stored authority exists.
  if (typeof candidate.refId === 'string' && candidate.refId.length > 0) {
    return candidate.refId
  }
  return null
}

/**
 * Pick the unique Completed top-up that this notification refers to.
 *
 * Locator preference: merchant order id, then provider capture ref,
 * then authority. A present stronger locator that does not uniquely
 * amount-match does **not** fall through — that event becomes an
 * unmatched exception instead of reversing a different top-up.
 */
export function matchChargebackToTopUp(
  notification: ParsedChargebackNotification,
  candidates: readonly ChargebackTopUpCandidate[],
): ChargebackTopUpMatch | null {
  if (!hasChargebackLocator(notification)) return null

  const completed = candidates.filter(
    (row) => row.type === 'topup' && row.state === 'Completed',
  )

  if (notification.merchantOrderId) {
    const byOrder = uniqueAmountMatched(
      notification,
      completed.filter((row) => matchesMerchantOrder(notification, row)),
    )
    return byOrder ? { original: byOrder, method: 'merchant_order_id' } : null
  }

  if (notification.providerRefId) {
    const byRef = uniqueAmountMatched(
      notification,
      completed.filter((row) => matchesProviderRef(notification, row)),
    )
    return byRef ? { original: byRef, method: 'provider_ref_id' } : null
  }

  if (notification.authority) {
    const byAuthority = uniqueAmountMatched(
      notification,
      completed.filter((row) => matchesAuthority(notification, row)),
    )
    return byAuthority ? { original: byAuthority, method: 'authority' } : null
  }

  return null
}

function matchesMerchantOrder(
  notification: ParsedChargebackNotification,
  row: ChargebackTopUpCandidate,
): boolean {
  if (!notification.merchantOrderId) return false
  if (row.idempotencyKey === chargebackCreditIdempotencyKey(notification.merchantOrderId)) {
    return true
  }
  return topUpPendingTransactionId(row) === notification.merchantOrderId
}

function matchesProviderRef(
  notification: ParsedChargebackNotification,
  row: ChargebackTopUpCandidate,
): boolean {
  if (!notification.providerRefId) return false
  return row.refId === notification.providerRefId
}

function matchesAuthority(
  notification: ParsedChargebackNotification,
  row: ChargebackTopUpCandidate,
): boolean {
  if (!notification.authority) return false
  return topUpAuthority(row) === notification.authority
}

function uniqueAmountMatched(
  notification: ParsedChargebackNotification,
  rows: ChargebackTopUpCandidate[],
): ChargebackTopUpCandidate | null {
  const matched = rows.filter((row) =>
    chargebackAmountMatchesTopUp(notification.amountIrR, row.amount),
  )
  if (matched.length !== 1) return null
  return matched[0] ?? null
}

function optionalLocator(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}
