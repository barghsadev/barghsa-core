/**
 * Invoice overdue eligibility (T-04.1.03.04 / S-04.1.03).
 *
 * Canonical rule: an invoice whose `dueAt` is strictly in the past and
 * whose stored state is still `Unpaid` or `PartiallyFunded` may be
 * transitioned to `Overdue` by the worker cron. Other states (Draft,
 * PaymentUnderReview, Paid, already Overdue, Cancelled, refunds) are
 * left untouched. There is no automatic late fee in v1.
 *
 * `dueAt === now` is not past: the invoice becomes overdue only after
 * the due instant.
 *
 * @module finance
 */

/** Invoice states the overdue cron is allowed to move to Overdue. */
export const OVERDUE_ELIGIBLE_STATES = ['Unpaid', 'PartiallyFunded'] as const

/** An invoice state the overdue cron may mark Overdue. */
export type OverdueEligibleState = (typeof OVERDUE_ELIGIBLE_STATES)[number]

/** Named state-machine transition applied by the cron. */
export const MARK_OVERDUE_TRANSITION = 'mark_overdue' as const

/** Audit-log event written atomically with the Overdue state change. */
export const MARK_OVERDUE_AUDIT_EVENT = 'invoice.mark_overdue' as const

/** Customer/staff-visible reason stored on the audit row. */
export const MARK_OVERDUE_REASON = 'Marked overdue by cron' as const

/** Parse a due instant from pg (`Date`) or an ISO string. Invalid → null. */
export function parseDueAt(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

/**
 * True when `dueAt` is a valid instant strictly before `now`.
 * Null/invalid due dates are never past-due.
 */
export function isPastDueAt(
  dueAt: Date | string | null | undefined,
  now: Date,
): boolean {
  const instant = parseDueAt(dueAt)
  if (instant === null) return false
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false
  return instant.getTime() < now.getTime()
}

/** True when `state` is one of the two cron-eligible source states. */
export function isOverdueEligibleState(state: string): state is OverdueEligibleState {
  return (OVERDUE_ELIGIBLE_STATES as readonly string[]).includes(state)
}

/**
 * Full eligibility check used by the worker after locking a candidate row
 * (re-validates state + dueAt so a concurrent payment/override cannot be
 * overwritten).
 */
export function isEligibleForOverdueMark(
  state: string,
  dueAt: Date | string | null | undefined,
  now: Date,
): boolean {
  return isOverdueEligibleState(state) && isPastDueAt(dueAt, now)
}
