/**
 * Job queue retry schedule (E-05, T-05.01.03).
 *
 * Bounded, jittered retry ladder for notification delivery:
 *
 *   1min → 5min → 30min → 2hr → final (dead-letter)
 *
 * A failed attempt schedules the next attempt after a delay chosen from this
 * ladder (by "how many attempts have completed so far"). Each delay is
 * multiplied by a uniform jitter of ±20% so retries from a burst of rows do
 * not align into a thundering herd. Once the number of completed attempts
 * reaches a (per-type configurable) `max_attempts`, scheduling returns `null`
 * and the worker moves the row/job to dead-letter instead of scheduling again.
 *
 * The ladder is intentionally NOT unbounded exponential growth: it caps at a
 * max delay (2 hours) so a permanently-failing notification is retried at a
 * sane cadence and then surfaces for dead-letter examination rather than
 * growing forever.
 */
import { classifyNotificationType } from '@barghsa/shared/notifications'

/** Ladder of delays applied after each completed attempt (ms). */
export const RETRY_DELAYS_MS: readonly number[] = [
  60_000, // after 1st failure  → retry in 1 min
  300_000, // after 2nd failure  → retry in 5 min
  1_800_000, // after 3rd failure  → retry in 30 min
  7_200_000, // after 4th failure  → retry in 2 hr
] as const

/** Default retry budget when a notification type is not registered. */
export const DEFAULT_MAX_ATTEMPTS = 5

/** Jitter scale: a delay is adjusted by ±20%. */
export const JITTER_RATIO = 0.2

/** Closure over the ladder so the module stays constant and testable. */
const DELAYS = RETRY_DELAYS_MS

/** Standard pseudo-random function signature (injectable for tests). */
export type RandomFn = () => number

/**
 * Apply uniform jitter of ±`ratio` (default 20%) to a base delay.
 *
 * @param baseMs  Base delay in ms.
 * @param rng     Random source (defaults to Math.random); inject for tests.
 */
export function jitter(baseMs: number, ratio = JITTER_RATIO, rng: RandomFn = Math.random): number {
  // Uniform in [1-ratio, 1+ratio], i.e. ±ratio.
  const factor = 1 + (rng() * 2 - 1) * ratio
  return Math.round(baseMs * factor)
}

/**
 * Return the base delay (ms) for a given completed-attempt count, straight
 * from the retry ladder: 1min → 5min → 30min → 2hr, capped at the 2hr slot
 * for any attempt beyond the fifth. Early retries are quick; later ones push
 * out to the cap so failed notifications are retried at a sane cadence then
 * surface for dead-letter examination rather than growing forever.
 */
export function exponentialDelayMs(completedAttempts: number): number {
  const idx = Math.max(0, completedAttempts - 1)
  return DELAYS[Math.min(idx, DELAYS.length - 1)]!
}

/**
 * Return the delay (ms) before the next attempt, or `null` when the retry
 * budget is exhausted (the row/job should move to dead-letter).
 *
 * @param completedAttempts Number of attempts already completed (1-based).
 * @param maxAttempts       Per-type retry budget (default `DEFAULT_MAX_ATTEMPTS`).
 * @param rng               Random source for jitter (inject for tests).
 */
export function nextRetryDelayMs(
  completedAttempts: number,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  rng: RandomFn = Math.random,
): number | null {
  // A row is exhausted once completed attempts meet or exceed its budget: the
  // already-executed attempts include the final one, so nothing more to schedule.
  if (completedAttempts >= maxAttempts) return null
  const base = exponentialDelayMs(completedAttempts)
  return jitter(base, JITTER_RATIO, rng)
}

/** Absolute datetime of the next retry, or `null` when the budget is exhausted. */
export function nextRetryAt(
  completedAttempts: number,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  from: Date = new Date(),
  rng: RandomFn = Math.random,
): Date | null {
  const delay = nextRetryDelayMs(completedAttempts, maxAttempts, rng)
  if (delay === null) return null
  return new Date(from.getTime() + delay)
}

/**
 * Queue priority for a notification type: `urgent` (immediate delivery —
 * security, OTP, authentication, payment, refund, contract-cancellation)
 * dispatches before `normal` (daytime). Derived from the code-defined
 * classification registry (T-05.03.01) so queue priority and delivery-window
 * behaviour always agree; security-relevant types are `immediate` and cannot
 * be reclassified by admins.
 */
export type QueuePriority = 'urgent' | 'normal'

/** Per-type retry config. Registry is code-defined, not admin-editable. */
export interface NotificationTypeConfig {
  /** Retry budget (defaults to `DEFAULT_MAX_ATTEMPTS` when omitted). */
  maxAttempts: number
}

/**
 * Code-defined registry of notification-type retry config. Keys are event keys
 * emitted by business modules. Types not listed fall back to the defaults
 * (max 5 attempts).
 */
const TYPE_CONFIG: Readonly<Record<string, NotificationTypeConfig>> = {
  // Authentication / security — bounded retries so OTPs don't linger.
  'auth.otp_sent': { maxAttempts: 3 },
  // All other types → defaults.
}

/** Max attempts for a notification type (falls back to the default). */
export function maxAttemptsForType(eventKey: string): number {
  return TYPE_CONFIG[eventKey]?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
}

/**
 * Queue priority for a notification type, derived from its delivery
 * classification: `immediate` → `urgent`, everything else → `normal`.
 */
export function priorityForType(eventKey: string): QueuePriority {
  return classifyNotificationType(eventKey) === 'immediate' ? 'urgent' : 'normal'
}
