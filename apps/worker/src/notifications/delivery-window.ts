/**
 * Delivery window logic (E-05, T-05.03.02).
 *
 * Implements quiet-hour / delivery-window scheduling on top of the code-defined
 * notification classification registry (T-05.03.01):
 *
 *   - `immediate` events (OTP, security, auth, payment, refund, contract
 *     cancellation) bypass the quiet window entirely and dispatch as soon as
 *     possible.
 *   - `daytime` events are only dispatched inside the user's configured daily
 *     window (09:00–21:00 by default). Outside the window they are parked as
 *     `scheduled` with `scheduled_for` set to the next window open, so the
 *     worker's normal `leaseOutbox` claim (which only leases rows whose
 *     `scheduled_for` is in the past) leaves them queued until the window
 *     opens. The polling worker re-evaluates on every wake-up, which is the
 *     "re-check on wakeup" the task calls for.
 *
 *   - In-app-only notifications are **never** window-gated: the bell must
 *     show a message immediately regardless of quiet hours ("in-app appears
 *     immediately regardless" in the story acceptance criteria).
 *
 * The window itself is admin-configurable and stored per timezone in the
 * `app_config` table under key {@link DELIVERY_WINDOW_CONFIG_KEY} as
 * `{ timezone, start_hour, end_hour }` (T-05.03.03 owns the admin UI; here we
 * read it with a safe fallback to the default). All time arithmetic is done in
 * the configured IANA timezone via `Intl`, so scheduling lands on the correct
 * local boundary regardless of the server's UTC clock or DST transitions.
 *
 * @module notifications
 */
import {
  classifyNotificationType,
  DEFAULT_DELIVERY_WINDOW,
  DELIVERY_WINDOW_CONFIG_KEY,
  MIN_WINDOW_HOURS,
  type DeliveryWindowConfig,
} from '@barghsa/shared/notifications'
import type { NotificationChannel } from '@barghsa/shared/notifications'

// Re-export the shared delivery-window contract so worker consumers (and the
// worker test suite) keep importing from this module while the canonical
// definitions live in @barghsa/shared/notifications (single source of truth,
// used by both the admin config API and the worker).
export {
  DEFAULT_DELIVERY_WINDOW,
  DELIVERY_WINDOW_CONFIG_KEY,
  MIN_WINDOW_HOURS,
  type DeliveryWindowConfig,
} from '@barghsa/shared/notifications'

/** External channels that are subject to the quiet window. */
const EXTERNAL_CHANNELS: ReadonlySet<string> = new Set<NotificationChannel>(['email', 'sms'])

/** Result of applying the delivery window to a single notification event. */
export type DeliveryScheduleDecision =
  | { kind: 'now' }
  | { kind: 'schedule'; scheduledFor: Date }

// ───────────────────────────────────────────────────────────────────────────
//  Timezone helpers (Intl-based, DST-tolerant)
// ───────────────────────────────────────────────────────────────────────────

interface TzParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Wall-clock date/time parts of `date` as seen in `timeZone`. */
function tzParts(date: Date, timeZone: string): TzParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number.parseInt(p.value, 10)
  }
  return {
    year: parts['year']!,
    month: parts['month']!,
    day: parts['day']!,
    hour: parts['hour']! % 24, // Intl may emit "24" for midnight with hour12:false
    minute: parts['minute']!,
    second: parts['second']!,
  }
}

/**
 * Return the absolute instant whose wall-clock in `timeZone` equals the given
 * calendar fields. Iterates to converge on the correct UTC offset (handles DST
 * transitions where the offset differs between the guess and the target).
 */
function atCalendar(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  let epoch = targetUtc
  for (let i = 0; i < 3; i++) {
    const p = tzParts(new Date(epoch), timeZone)
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    // wall == targetUtc at the fixpoint; correct the guess by the discrepancy.
    epoch = targetUtc - (wall - epoch)
  }
  return new Date(epoch)
}

// ───────────────────────────────────────────────────────────────────────────
//  Window predicates
// ───────────────────────────────────────────────────────────────────────────

const HOUR_MIN = 60

/** True when `date` (as a wall clock in `config.timezone`) is inside the window. */
export function isWithinWindow(date: Date, config: DeliveryWindowConfig): boolean {
  const p = tzParts(date, config.timezone)
  const minutes = p.hour * HOUR_MIN + p.minute
  return minutes >= config.startHour * HOUR_MIN && minutes < config.endHour * HOUR_MIN
}

/**
 * Absolute instant of the next window open: later today if the current wall
 * clock is before `startHour`, otherwise tomorrow at `startHour`.
 */
export function nextWindowOpen(date: Date, config: DeliveryWindowConfig): Date {
  const p = tzParts(date, config.timezone)
  if (p.hour < config.startHour) {
    return atCalendar(config.timezone, p.year, p.month, p.day, config.startHour)
  }
  // Never returns "now / inside the window": when the clock is already at or
  // past startHour the open boundary has passed, so bump to the next calendar
  // day (read tomorrow's y/m/d in the target timezone to survive DST shifts).
  const tomorrow = new Date(date.getTime() + 24 * 60 * 60 * 1000)
  const t = tzParts(tomorrow, config.timezone)
  return atCalendar(config.timezone, t.year, t.month, t.day, config.startHour)
}

// ───────────────────────────────────────────────────────────────────────────
//  Decision
// ───────────────────────────────────────────────────────────────────────────

/** True when the row requests an external (quiet-window-gated) channel. */
export function hasExternalChannel(channels: readonly NotificationChannel[]): boolean {
  return channels.some((c) => EXTERNAL_CHANNELS.has(c))
}

/**
 * Decide how to dispatch a notification given its event, target channels and
 * the current instant:
 *
 *   - `immediate` events  → `{ kind: 'now' }` (bypass quiet hours, always).
 *   - in-app-only rows     → `{ kind: 'now' }` (bell is never window-gated).
 *   - `daytime` w/ external channel, inside the window → `{ kind: 'now' }`.
 *   - `daytime` w/ external channel, outside the window →
 *     `{ kind: 'schedule', scheduledFor: nextWindowOpen(...) }`.
 */
export function decideDeliverySchedule(
  eventKey: string,
  channels: readonly NotificationChannel[],
  now: Date,
  config: DeliveryWindowConfig,
): DeliveryScheduleDecision {
  if (classifyNotificationType(eventKey) === 'immediate') return { kind: 'now' }
  if (!hasExternalChannel(channels)) return { kind: 'now' }
  if (isWithinWindow(now, config)) return { kind: 'now' }
  return { kind: 'schedule', scheduledFor: nextWindowOpen(now, config) }
}

// ───────────────────────────────────────────────────────────────────────────
//  Config resolution
// ───────────────────────────────────────────────────────────────────────────

/** Coerce a stored hour to a valid 0–23 integer, or `fallback`. */
function toHour(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback
}

/**
 * Normalize a raw (possibly partial / malformed) config value into a valid
 * `DeliveryWindowConfig`, falling back per-field to the defaults. A `start_hour`
 * ≥ `end_hour` (impossible window) resets to the default window so a bad admin
 * value can never disable delivery entirely.
 */
export function normalizeWindowConfig(raw: unknown): DeliveryWindowConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DELIVERY_WINDOW }

  const o = raw as Record<string, unknown>
  const timezone =
    typeof o.timezone === 'string' && o.timezone.length > 0 ? o.timezone : DEFAULT_DELIVERY_WINDOW.timezone
  const startHour = toHour(o.start_hour ?? o.startHour, DEFAULT_DELIVERY_WINDOW.startHour)
  const endHour = toHour(o.end_hour ?? o.endHour, DEFAULT_DELIVERY_WINDOW.endHour)

  if (startHour >= endHour) return { ...DEFAULT_DELIVERY_WINDOW, timezone }

  return { timezone, startHour, endHour }
}

/**
 * Load and normalize the admin-configurable delivery window from `app_config`.
 * When no entry exists (or it is malformed) the default 09:00–21:00 window is
 * returned, so delivery never breaks before the admin UI (T-05.03.03) writes a
 * value.
 */
export async function loadDeliveryWindowConfig(pool: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}): Promise<DeliveryWindowConfig> {
  const result = await pool.query('SELECT value FROM app_config WHERE key = $1', [
    DELIVERY_WINDOW_CONFIG_KEY,
  ])
  return normalizeWindowConfig(result.rows[0]?.value)
}
