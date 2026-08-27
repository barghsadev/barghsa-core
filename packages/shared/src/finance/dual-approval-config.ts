/**
 * Dual-approval threshold configuration contract (S-09.07, T-09.07.01).
 *
 * Single source of truth for the `app_config` key that stores the
 * admin-configurable IRR threshold above which refunds, manual financial
 * adjustments, and bank payment confirmations require approval by a second
 * authorized user, plus the validation rules the admin API must enforce.
 *
 * Semantics: a stored threshold of `0` means dual approval is **disabled**
 * (no threshold is enforced). The dual-approval workflow (T-09.07.02) must
 * check `thresholdIrR > 0 && amount > thresholdIrR` before routing a
 * financial action into Pending Approval. The default returned when nothing
 * is persisted is `0` (disabled) so the feature never surprises fresh
 * installations.
 *
 * @module finance
 */

/** Admin-configurable dual-approval threshold. */
export interface DualApprovalConfig {
  /**
   * IRR amount above which refunds, manual financial adjustments, and bank
   * payment confirmations require a second approver. `0` = dual approval
   * disabled (no threshold enforced).
   */
  thresholdIrR: number
}

/**
 * Default configuration: dual approval disabled. The admin must explicitly
 * set a positive threshold to enable the workflow (T-09.07.02).
 */
export const DEFAULT_DUAL_APPROVAL_CONFIG: DualApprovalConfig = {
  thresholdIrR: 0,
}

/** `app_config` key holding the dual-approval threshold (T-09.07.01). */
export const DUAL_APPROVAL_THRESHOLD_CONFIG_KEY = 'finance.dual_approval_threshold'

/**
 * Result of validating a proposed dual-approval threshold for the admin
 * write path. `ok: true` when the config may be persisted; otherwise
 * `issues` carries one or more human-readable descriptions (English, used as
 * the durable error message and surfaced via i18n on the client).
 */
export interface DualApprovalValidationResult {
  ok: boolean
  issues: string[]
}

/**
 * Validate a proposed dual-approval threshold.
 *
 * Rules: `thresholdIrR` (or snake_case `threshold_irr`) must be a **number**
 * (strictly typed — booleans, arrays, and strings are rejected rather than
 * coerced, since a coercion like `Number(true) === 1` would silently enable
 * dual approval at an unintended threshold) that is an integer between `0`
 * (disabled) and `Number.MAX_SAFE_INTEGER` (the largest integer representable
 * exactly in JSON numbers, so the persisted value round-trips losslessly).
 */
export function validateDualApprovalConfig(input: unknown): DualApprovalValidationResult {
  const issues: string[] = []

  if (!input || typeof input !== 'object') {
    return { ok: false, issues: ['Dual-approval threshold config must be an object'] }
  }

  const o = input as Record<string, unknown>
  const raw = o.threshold_irr ?? o.thresholdIrR

  if (raw === undefined || raw === null || raw === '') {
    issues.push('threshold_irr is required')
    return { ok: false, issues }
  }

  if (typeof raw !== 'number') {
    issues.push(`threshold_irr must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`)
    return { ok: false, issues }
  }

  if (!Number.isInteger(raw) || !Number.isSafeInteger(raw)) {
    issues.push(`threshold_irr must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`)
  } else if (raw < 0 || raw > Number.MAX_SAFE_INTEGER) {
    issues.push(`threshold_irr must be between 0 and ${Number.MAX_SAFE_INTEGER}`)
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Build a normalized {@link DualApprovalConfig} from an admin input. Assumes
 * {@link validateDualApprovalConfig} has already passed; falls back to the
 * default defensively if any value is malformed (should not happen
 * post-validation but keeps the write path total).
 */
export function toDualApprovalConfig(input: unknown): DualApprovalConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_DUAL_APPROVAL_CONFIG }
  const o = input as Record<string, unknown>
  const raw = o.threshold_irr ?? o.thresholdIrR
  if (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 0 &&
    raw <= Number.MAX_SAFE_INTEGER
  ) {
    return { thresholdIrR: raw }
  }
  return { ...DEFAULT_DUAL_APPROVAL_CONFIG }
}
