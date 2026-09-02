/**
 * Online wallet top-up Pending TTL expiry (T-04.2.02.07 / S-04.2.02).
 *
 * Canonical rule: an online `topup` ledger row that is still `Pending`
 * after the TTL has elapsed is auto-rejected by the worker cron so it
 * cannot linger as an open intent. The row is **not** credited.
 *
 * Provider identifiers (authority / ref) stay on `metadata` so a later
 * authenticated callback can still credit via `WalletService.credit()`
 * ("reconcilable later via provider reference"). Bank-receipt Pendings
 * are out of scope — they wait for staff confirmation, not a TTL.
 *
 * The TTL bound is exclusive: `createdAt + ttl === now` is not expired.
 *
 * @module finance
 */

/** Channel discriminator stored on online top-up ledger metadata. */
export const ONLINE_TOPUP_CHANNEL = 'online' as const

/**
 * Default Pending TTL (30 minutes). Longer than a typical PSP checkout
 * session so an in-progress payment is not rejected while still payable.
 */
export const DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS = 30 * 60 * 1000

/** Ledger state written by the expiry cron. Does not change balances. */
export const ONLINE_TOPUP_EXPIRED_STATE = 'Rejected' as const

/** Customer/staff-visible reason stamped on the rejected row metadata. */
export const ONLINE_TOPUP_EXPIRY_REASON =
  'Pending online top-up expired beyond TTL' as const

/**
 * States that may still receive an authenticated provider callback after
 * initiation. `Rejected` is included so TTL expiry stays reconcilable.
 */
export const ONLINE_TOPUP_CALLBACK_OPEN_STATES = [
  'Pending',
  'Failed',
  'Rejected',
  'Released',
] as const

export type OnlineTopUpCallbackOpenState =
  (typeof ONLINE_TOPUP_CALLBACK_OPEN_STATES)[number]

/**
 * Intent rows that a paid callback may advance to `Released` after credit.
 * `Released` is already terminal for the intent.
 */
export const ONLINE_TOPUP_INTENT_RELEASE_STATES = [
  'Pending',
  'Failed',
  'Rejected',
] as const

export type OnlineTopUpIntentReleaseState =
  (typeof ONLINE_TOPUP_INTENT_RELEASE_STATES)[number]

/** Parse a created/updated instant from pg (`Date`) or an ISO string. */
export function parseOnlineTopUpCreatedAt(
  value: Date | string | null | undefined,
): Date | null {
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
 * Exclusive expiry cutoff: rows with `created_at` strictly before this
 * instant have exceeded `ttlMs`.
 */
export function onlineTopUpExpiryCutoff(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() - ttlMs)
}

/** True when `createdAt + ttlMs` is strictly before `now`. */
export function isOnlineTopUpPendingPastTtl(
  createdAt: Date | string | null | undefined,
  now: Date,
  ttlMs: number,
): boolean {
  const instant = parseOnlineTopUpCreatedAt(createdAt)
  if (instant === null) return false
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false
  if (!Number.isFinite(ttlMs) || ttlMs < 0) return false
  return instant.getTime() < onlineTopUpExpiryCutoff(now, ttlMs).getTime()
}

export function isOnlineTopUpChannel(channel: unknown): channel is typeof ONLINE_TOPUP_CHANNEL {
  return channel === ONLINE_TOPUP_CHANNEL
}

/** Read `metadata.channel` from a ledger JSON object. */
export function readOnlineTopUpChannel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const channel = (metadata as Record<string, unknown>).channel
  return typeof channel === 'string' ? channel : null
}

export function isOnlineTopUpCallbackOpenState(
  state: string,
): state is OnlineTopUpCallbackOpenState {
  return (ONLINE_TOPUP_CALLBACK_OPEN_STATES as readonly string[]).includes(state)
}

export function isOnlineTopUpIntentReleasable(
  state: string,
): state is OnlineTopUpIntentReleaseState {
  return (ONLINE_TOPUP_INTENT_RELEASE_STATES as readonly string[]).includes(state)
}

/**
 * Full eligibility check used by the worker after locking a candidate
 * (re-validates so a concurrent callback cannot be overwritten).
 */
export function isEligibleForOnlineTopUpExpiry(
  input: {
    type: string
    state: string
    channel: unknown
    createdAt: Date | string | null | undefined
  },
  now: Date,
  ttlMs: number = DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS,
): boolean {
  return (
    input.type === 'topup' &&
    input.state === 'Pending' &&
    isOnlineTopUpChannel(input.channel) &&
    isOnlineTopUpPendingPastTtl(input.createdAt, now, ttlMs)
  )
}

/**
 * Parse `ONLINE_TOPUP_PENDING_TTL_MS`. Invalid or sub-second values fall
 * back to the default so a mis-set env cannot expire every Pending row.
 */
export function parseOnlineTopUpPendingTtlMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1_000) return DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS
  return parsed
}
