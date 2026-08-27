import {
  isValidDualApprovalThreshold,
  type DualApprovalConfig,
} from './dual-approval-config.js'

/**
 * Dual-approval approval request contract (S-09.07, T-09.07.02).
 *
 * A dual-approval request is created when a financial action (refund, manual
 * financial adjustment, bank payment confirmation) exceeds the
 * admin-configured IRR threshold (T-09.07.01). The request enters the
 * `pending` state and can only be resolved by a second authorized user
 * different from the initiator (`approve` or `reject`, with a mandatory
 * reason on reject).
 *
 * This module is the single source of truth for:
 * - the allowed financial action types,
 * - the approval request status machine,
 * - strict input validation for the initiation API,
 * - the threshold-routing predicate {@link shouldRequireDualApproval} the
 *   finance module must call before routing an action into Pending Approval.
 *
 * @module finance
 */

/** Financial actions that are subject to dual approval (T-09.07.01). */
export const APPROVAL_ACTION_TYPES = [
  'refund',
  'manual_adjustment',
  'bank_payment_confirmation',
] as const

/** Type of the financial action an approval request covers. */
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number]

/** States of an approval request lifecycle. */
export const APPROVAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const

/** Current state of an approval request. */
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number]

/** Whether a raw value is a known financial action type. */
export function isApprovalActionType(raw: unknown): raw is ApprovalActionType {
  return (
    typeof raw === 'string' &&
    (APPROVAL_ACTION_TYPES as readonly string[]).includes(raw)
  )
}

/** Whether a raw value is a valid approval request status. */
export function isApprovalRequestStatus(raw: unknown): raw is ApprovalRequestStatus {
  return (
    typeof raw === 'string' &&
    (APPROVAL_REQUEST_STATUSES as readonly string[]).includes(raw)
  )
}

/**
 * Input for initiating a dual-approval request (T-09.07.02).
 *
 * The initiator is taken from the authenticated session, never from the
 * body — a request can never claim a different initiator.
 */
export interface ApprovalRequestInput {
  /** Financial action being approved. */
  actionType: ApprovalActionType
  /** IRR amount of the action, a positive safe integer. */
  amountIrR: number
  /** Human-readable reason for the financial action. */
  reason: string
  /** Optional transaction details (JSON-serializable object). */
  details?: Record<string, unknown> | null
}

/** Result of validating a proposed approval request. */
export interface ApprovalRequestValidationResult {
  ok: boolean
  issues: string[]
}

/** Upper bounds protecting the audit payload and API surface from abuse. */
export const APPROVAL_BOUNDS = {
  reasonMaxLength: 2000,
  detailsMaxJsonLength: 100_000,
} as const

/** Max length for the review reason when rejecting a request. */
export const APPROVAL_REVIEW_REASON_MAX_LENGTH = 2000

/**
 * Validate a proposed approval request against the T-09.07.02 rules.
 *
 * Strictly typed, mirroring {@link validateDualApprovalConfig}: booleans,
 * arrays, and numeric strings are rejected rather than coerced, so a
 * malformed payload can never silently become a valid pending request.
 */
export function validateApprovalRequestInput(
  input: unknown,
): ApprovalRequestValidationResult {
  const issues: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: ['Approval request must be an object'] }
  }

  const o = input as Record<string, unknown>
  const actionType = o.action_type ?? o.actionType
  const rawAmount = o.amount_irr ?? o.amountIrR
  const reason = o.reason
  const details = o.details

  if (actionType === undefined || actionType === null || actionType === '') {
    issues.push('action_type is required')
  } else if (!isApprovalActionType(actionType)) {
    issues.push(
      `action_type must be one of ${APPROVAL_ACTION_TYPES.join(', ')}`,
    )
  }

  if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
    issues.push('amount_irr is required')
  } else if (
    typeof rawAmount !== 'number' ||
    !Number.isSafeInteger(rawAmount) ||
    rawAmount < 1 ||
    rawAmount > Number.MAX_SAFE_INTEGER
  ) {
    issues.push(
      `amount_irr must be an integer between 1 and ${Number.MAX_SAFE_INTEGER}`,
    )
  }

  if (reason === undefined || reason === null) {
    issues.push('reason is required')
  } else if (typeof reason !== 'string' || reason.trim() === '') {
    issues.push('reason must be a non-empty string')
  } else if (reason.length > APPROVAL_BOUNDS.reasonMaxLength) {
    issues.push(`reason must not exceed ${APPROVAL_BOUNDS.reasonMaxLength} characters`)
  }

  if (details !== undefined && details !== null) {
    if (typeof details !== 'object' || Array.isArray(details)) {
      issues.push('details must be a JSON object')
    } else {
      let jsonLength = 0
      try {
        jsonLength = JSON.stringify(details).length
      } catch {
        jsonLength = Number.POSITIVE_INFINITY
      }
      if (jsonLength > APPROVAL_BOUNDS.detailsMaxJsonLength) {
        issues.push(
          `details must not exceed ${APPROVAL_BOUNDS.detailsMaxJsonLength} characters when serialized`,
        )
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Normalize a validated approval request input to the canonical camelCase
 * shape. Assumes {@link validateApprovalRequestInput} has passed; malformed
 * values fall back to safe defaults rather than throwing.
 */
export function toApprovalRequestInput(input: unknown): ApprovalRequestInput {
  if (!input || typeof input !== 'object') {
    return { actionType: 'refund', amountIrR: 0, reason: '', details: null }
  }
  const o = input as Record<string, unknown>
  const actionType = o.action_type ?? o.actionType
  const rawAmount = o.amount_irr ?? o.amountIrR
  return {
    actionType: isApprovalActionType(actionType) ? actionType : 'refund',
    amountIrR:
      typeof rawAmount === 'number' && Number.isSafeInteger(rawAmount) && rawAmount > 0
        ? rawAmount
        : 0,
    reason:
      typeof o.reason === 'string' ? o.reason.slice(0, APPROVAL_BOUNDS.reasonMaxLength) : '',
    details:
      o.details !== undefined && o.details !== null && typeof o.details === 'object'
        ? (o.details as Record<string, unknown>)
        : null,
  }
}

/**
 * The T-09.07.02 routing rule: whether a financial action of `amountIrR`
 * toman must enter Pending Approval under the given configuration.
 *
 * A stored threshold of `0` means dual approval is disabled, so nothing is
 * routed (T-09.07.01 semantics). Amounts that are not positive safe
 * integers return `false` — callers must validate input with
 * {@link validateApprovalRequestInput} first, so a malformed amount is a
 * programming error, not a reason to silently route funds around the
 * approval gate.
 */
export function shouldRequireDualApproval(
  config: DualApprovalConfig,
  amountIrR: unknown,
): boolean {
  if (
    config == null ||
    !isValidDualApprovalThreshold(config.thresholdIrR) ||
    config.thresholdIrR === 0
  ) {
    return false
  }
  return (
    typeof amountIrR === 'number' &&
    Number.isSafeInteger(amountIrR) &&
    amountIrR > 0 &&
    amountIrR > config.thresholdIrR
  )
}