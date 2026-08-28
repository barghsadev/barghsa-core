/**
 * Reconciliation exception ledger contract (S-09.09, T-09.09.01).
 *
 * Single source of truth for the reconciliation exceptions an admin/staff
 * user can view and resolve: the valid exception types (wallet mismatch,
 * payment mismatch, …) and severities used by the finance reconciliation
 * system that *produces* exceptions, plus the lifecycle states an admin can
 * advance an item through.
 *
 * Reconciliation is a *finance-module* capability (T-09.09.01's dependency):
 * this package defines the shared vocabulary (types, severities, statuses,
 * validation) that the API surface in `apps/api/src/admin` consumes today and
 * the future finance worker that records mismatches will consume tomorrow.
 * Keeping the enums here prevents the API and the finance/reconciliation
 * producers from drifting apart on allowed values.
 *
 * @module admin
 */

/** Kinds of reconciliation exception the ledger can record. */
export const RECONCILIATION_EXCEPTION_TYPES = [
  'wallet_mismatch',
  'payment_mismatch',
] as const

/** A kind of reconciliation exception. */
export type ReconciliationExceptionType = (typeof RECONCILIATION_EXCEPTION_TYPES)[number]

/** Severity ladder for a reconciliation exception (low → critical). */
export const RECONCILIATION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

/** A reconciliation severity level. */
export type ReconciliationSeverity = (typeof RECONCILIATION_SEVERITIES)[number]

/**
 * Lifecycle states of a reconciliation exception.
 *
 * - `open`           recorded by a reconciliation producer, awaiting review;
 * - `investigating`  staff are examining the mismatch;
 * - `resolved`       the mismatch has been corrected/resolved;
 * - `closed`         no further action (dismissed or superseded).
 */
export const RECONCILIATION_STATUSES = [
  'open',
  'investigating',
  'resolved',
  'closed',
] as const

/** A reconciliation exception lifecycle state. */
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number]

/** Result of validating a reconciliation exception input for the write path. */
export interface ReconciliationExceptionValidationResult {
  ok: boolean
  issues: string[]
}

/** Whether a raw value is a known reconciliation exception type. */
export function isReconciliationExceptionType(raw: unknown): raw is ReconciliationExceptionType {
  return (
    typeof raw === 'string' &&
    (RECONCILIATION_EXCEPTION_TYPES as readonly string[]).includes(raw)
  )
}

/** Whether a raw value is a valid reconciliation severity. */
export function isReconciliationSeverity(raw: unknown): raw is ReconciliationSeverity {
  return typeof raw === 'string' && (RECONCILIATION_SEVERITIES as readonly string[]).includes(raw)
}

/** Whether a raw value is a valid reconciliation status. */
export function isReconciliationStatus(raw: unknown): raw is ReconciliationStatus {
  return typeof raw === 'string' && (RECONCILIATION_STATUSES as readonly string[]).includes(raw)
}