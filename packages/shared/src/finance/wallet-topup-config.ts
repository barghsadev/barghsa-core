/**
 * Per-transaction online wallet top-up limit configuration contract
 * (S-09.10, T-09.10.01).
 *
 * Single source of truth for the `app_config` key that stores the
 * admin-configurable per-transaction ceiling (in IRR) for **online** wallet
 * top-ups, plus the validation rules the admin API must enforce and the
 * guard the online top-up initiation flow (S-04.2.02, T-04.2.02.01) must
 * call before a Pending top-up transaction is created.
 *
 * Semantics: the limit is an integer IRR amount. A stored limit of `0`
 * blocks **all** online top-ups (fail-closed admin kill switch). The default
 * returned when nothing is persisted is 2,000,000,000 IRR (2 billion),
 * per T-09.10.01.
 *
 * @module finance
 */

/** Admin-configurable per-transaction online wallet top-up limit. */
export interface WalletTopUpLimitConfig {
  /**
   * Maximum IRR amount a single online wallet top-up may request.
   * `0` blocks all online top-ups (admin kill switch).
   */
  limitIrR: number
}

/** Default configuration: 2,000,000,000 IRR per transaction (T-09.10.01). */
export const DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG: WalletTopUpLimitConfig = {
  limitIrR: 2_000_000_000,
}

/** `app_config` key holding the online wallet top-up limit (T-09.10.01). */
export const WALLET_TOP_UP_LIMIT_CONFIG_KEY = 'finance.wallet_top_up_limit'

/**
 * Result of validating a proposed online wallet top-up limit for the admin
 * write path. `ok: true` when the config may be persisted; otherwise
 * `issues` carries one or more human-readable descriptions (English, used as
 * the durable error message and surfaced via i18n on the client).
 */
export interface WalletTopUpLimitValidationResult {
  ok: boolean
  issues: string[]
}

/**
 * Whether a raw persisted/parsed limit value is a valid, losslessly
 * representable IRR amount: a number, an integer, within `0`…
 * `Number.MAX_SAFE_INTEGER`.
 *
 * Shared by {@link toWalletTopUpLimitConfig} (normalization), the admin
 * service read path (corruption detection), and the enforcement guard so the
 * validation rules can never drift apart.
 */
export function isValidWalletTopUpLimit(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 0 &&
    raw <= Number.MAX_SAFE_INTEGER
  )
}

/**
 * Validate a proposed online wallet top-up limit.
 *
 * Rules: `limit_irr` (or camelCase `limitIrR`) must be a **number**
 * (strictly typed — booleans, arrays, and strings are rejected rather than
 * coerced, since a coercion like `Number('nope') === NaN` or
 * `Number(true) === 1` would silently change the enforced ceiling) that is
 * an integer between `0` (blocks all online top-ups) and
 * `Number.MAX_SAFE_INTEGER` (the largest integer representable exactly in
 * JSON numbers, so the persisted value round-trips losslessly).
 */
export function validateWalletTopUpLimitConfig(input: unknown): WalletTopUpLimitValidationResult {
  const issues: string[] = []

  if (!input || typeof input !== 'object') {
    return { ok: false, issues: ['Online wallet top-up limit config must be an object'] }
  }

  const o = input as Record<string, unknown>
  const raw = o.limit_irr ?? o.limitIrR

  if (raw === undefined || raw === null || raw === '') {
    issues.push('limit_irr is required')
    return { ok: false, issues }
  }

  if (typeof raw !== 'number') {
    issues.push(`limit_irr must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`)
    return { ok: false, issues }
  }

  if (!isValidWalletTopUpLimit(raw)) {
    issues.push(`limit_irr must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`)
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Build a normalized {@link WalletTopUpLimitConfig} from an admin input.
 * Assumes {@link validateWalletTopUpLimitConfig} has already passed; falls
 * back to the default defensively if any value is malformed (should not
 * happen post-validation but keeps the read path total).
 */
export function toWalletTopUpLimitConfig(input: unknown): WalletTopUpLimitConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG }
  const o = input as Record<string, unknown>
  const raw = o.limit_irr ?? o.limitIrR
  if (isValidWalletTopUpLimit(raw)) {
    return { limitIrR: raw }
  }
  return { ...DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG }
}

/**
 * Whether a proposed online top-up amount is permitted under a limit config
 * (the check T-04.2.02.01 must run before creating a Pending top-up).
 *
 * Fail-closed: a corrupt/absent limit config, a non-integer amount, or a
 * non-positive amount is never allowed, and a configured `0` limit blocks
 * everything. An amount exactly equal to the limit is allowed
 * (the limit is a per-transaction ceiling, not an exclusive bound).
 */
export function isOnlineWalletTopUpAllowed(
  config: WalletTopUpLimitConfig,
  amountIrR: number | bigint,
): boolean {
  if (!isValidWalletTopUpLimit(config.limitIrR)) return false
  const limit = BigInt(config.limitIrR)

  if (typeof amountIrR === 'bigint') {
    if (amountIrR <= 0n) return false
    return limit >= amountIrR
  }

  if (
    typeof amountIrR !== 'number' ||
    !Number.isSafeInteger(amountIrR) ||
    amountIrR <= 0
  ) {
    return false
  }
  return limit >= BigInt(amountIrR)
}