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
 * Transaction-scoped advisory lock namespace for {@link WALLET_TOP_UP_LIMIT_CONFIG_KEY}.
 *
 * `SELECT … FOR UPDATE` locks nothing when the `app_config` row is absent, so
 * both the online top-up submission transaction and the admin first-write
 * must take `pg_advisory_xact_lock(hashtext(namespace), hashtext(key))`
 * before reading or upserting. That serializes the absent-row/first-write
 * race (T-04.2.02.06).
 */
export const WALLET_TOP_UP_LIMIT_LOCK_NAMESPACE = 'barghsa.finance.wallet_top_up_limit'

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
 * Snapshot of the versioned `onlineTopUpLimit` that was enforced when a
 * Pending online top-up was submitted (T-04.2.02.06).
 *
 * `onlineTopUpLimit` is the per-transaction ceiling in IRR. `configVersion`
 * is `app_config.version` for {@link WALLET_TOP_UP_LIMIT_CONFIG_KEY}, or
 * `0` when the default is used because nothing is persisted yet.
 */
export interface OnlineTopUpLimitSnapshot {
  onlineTopUpLimit: number
  configVersion: number
}

/**
 * Build the submission snapshot from a resolved limit config and its
 * per-key `app_config` version.
 */
export function toOnlineTopUpLimitSnapshot(
  config: WalletTopUpLimitConfig,
  version: number | null | undefined,
): OnlineTopUpLimitSnapshot {
  const configVersion =
    typeof version === 'number' && Number.isSafeInteger(version) && version >= 0 ? version : 0
  return {
    onlineTopUpLimit: config.limitIrR,
    configVersion,
  }
}

/**
 * English server message for an over-limit online top-up (T-04.2.02.06).
 * The HTTP 400 body also carries {@link OnlineTopUpLimitSnapshot} so the
 * customer form can refresh the advertised ceiling and retry with a
 * reduced amount without scraping this string.
 */
export function onlineTopUpLimitExceededMessage(
  amountIrR: bigint,
  snapshot: OnlineTopUpLimitSnapshot,
): string {
  return (
    `Online top-up amount ${amountIrR.toString()} IRR exceeds the configured ` +
    `per-transaction limit of ${snapshot.onlineTopUpLimit} IRR`
  )
}

/**
 * Read the versioned ceiling from a 400 submission body so a stale
 * advertised GET can be replaced with the limit that was actually
 * enforced (T-04.2.02.06).
 */
export function readOnlineTopUpLimitFromErrorBody(raw: unknown): OnlineTopUpLimitSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const nested =
    o.error && typeof o.error === 'object' ? (o.error as Record<string, unknown>) : null
  const candidate = isValidWalletTopUpLimit(o.onlineTopUpLimit)
    ? o
    : nested && isValidWalletTopUpLimit(nested.onlineTopUpLimit)
      ? nested
      : null
  if (!candidate) return null
  return toOnlineTopUpLimitSnapshot(
    { limitIrR: candidate.onlineTopUpLimit as number },
    candidate.configVersion as number,
  )
}

/**
 * Whether a proposed online top-up amount is permitted under a limit config
 * (the check T-04.2.02.01 / T-04.2.02.06 must run before creating a Pending top-up).
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

/** PostgreSQL `bigint` / signed int8 maximum (inclusive). */
const MAX_INT8 = 9_223_372_036_854_775_807n

/**
 * Parse a proposed online top-up amount in IRR (T-04.2.02.01).
 *
 * Accepts a positive integer as `number`, `bigint`, or a digit string.
 * Returns `null` when the value cannot be a precise positive IRR amount
 * so the initiation API can fail closed before creating a Pending row.
 */
export function parseOnlineTopUpAmountIrR(raw: unknown): bigint | null {
  if (typeof raw === 'bigint') {
    if (raw <= 0n || raw > MAX_INT8) return null
    return raw
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) return null
    return BigInt(raw)
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!/^[1-9][0-9]{0,18}$/.test(trimmed)) return null
    try {
      const amount = BigInt(trimmed)
      if (amount <= 0n || amount > MAX_INT8) return null
      return amount
    } catch {
      return null
    }
  }
  return null
}
