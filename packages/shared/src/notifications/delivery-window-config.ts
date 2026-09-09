/**
 * Delivery-window configuration contract shared by the API (admin config UI,
 * T-05.03.03), the worker (quiet-hour scheduling, T-05.03.02) and the shared
 * classification registry (T-05.03.01).
 *
 * Single source of truth for the `app_config` key that stores the
 * admin-configurable delivery window and for the validation rules the admin
 * UI/API must enforce (start < end, minimum window length). Keeping these in
 * the shared package guarantees the worker's `loadDeliveryWindowConfig` and the
 * admin's write path agree on the exact persisted shape and semantics.
 *
 * @module notifications
 */

/** Admin-configurable daily delivery window, expressed as hours with minute precision. */
export interface DeliveryWindowConfig {
  /** IANA timezone the window is declared in, e.g. `Asia/Tehran`. */
  timezone: string;
  /** Window open hour (0–23:59, inclusive start). */
  startHour: number;
  /** Window close hour (0–23:59, exclusive end). */
  endHour: number;
}

/** Numeric hour value with whole-minute precision; legacy whole hours remain valid. */
export function isWindowHour(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value < 24 &&
    Math.abs(value * 60 - Math.round(value * 60)) < 1e-7 &&
    Math.round(value * 60) < 1440
  );
}

/** Format a valid window boundary for a native time input. */
export function formatWindowTime(hour: number): string {
  if (!isWindowHour(hour)) return '';
  const minutes = Math.round(hour * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Default window: 09:00–21:00 in Iran time (story T-05.03 default). */
export const DEFAULT_DELIVERY_WINDOW: DeliveryWindowConfig = {
  timezone: 'Asia/Tehran',
  startHour: 9,
  endHour: 21,
};

/** `app_config` key holding the admin-configurable delivery window (T-05.03.03). */
export const DELIVERY_WINDOW_CONFIG_KEY = 'notification.delivery_window';

/** Minimum sensible window length in hours (T-05.03.03 validates ≥ 4h). */
export const MIN_WINDOW_HOURS = 4;

/** Max window length in hours (whole day 00–24 → 24h). */
export const MAX_WINDOW_HOURS = 24;

/**
 * Result of validating a proposed delivery-window configuration for the admin
 * write path. `ok: true` when the config may be persisted; otherwise `issues`
 * carries one or more human-readable (English, used as the durable error
 * message and surfaced via i18n on the client) descriptions.
 */
export interface WindowValidationResult {
  ok: boolean;
  issues: string[];
}

/**
 * Validate an IANA timezone string. Returns a boolean rather than throwing so
 * callers can collect issues.
 */
export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.trim().length === 0) return false;
  try {
    // `Intl.DateTimeFormat` throws RangeError for unknown time zones. A valid
    // result (regardless of the produced offset) proves the named zone exists.
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a proposed window configuration against the story rules for
 * T-05.03.03: start must be strictly before end, and the length must be at
 * least {@link MIN_WINDOW_HOURS}. A valid IANA timezone is also required.
 *
 * Hours have minute precision in 00:00–23:59 (inclusive start, exclusive end), so "overnight"
 * windows (e.g. 22:00→06:00) are intentionally **not** expressible — a daytime
 * delivery window must fall within a single calendar day.
 */
export function validateWindowConfig(input: unknown): WindowValidationResult {
  const issues: string[] = [];

  if (!input || typeof input !== 'object') {
    return { ok: false, issues: ['Delivery window config must be an object'] };
  }

  const o = input as Record<string, unknown>;

  if (typeof o.timezone !== 'string' || !isValidTimeZone(o.timezone)) {
    issues.push('A valid IANA timezone is required');
  }

  const start = o.start_hour ?? o.startHour;
  const end = o.end_hour ?? o.endHour;

  if (!isWindowHour(start)) {
    issues.push('Start time must have minute precision between 00:00 and 23:59');
  }
  if (!isWindowHour(end)) {
    issues.push('End time must have minute precision between 00:00 and 23:59');
  }

  // Only evaluate range rules when both bounds are individually valid so we do
  // not emit misleading extra errors on malformed input.
  const intStart = isWindowHour(start) ? Math.round(start * 60) : null;
  const intEnd = isWindowHour(end) ? Math.round(end * 60) : null;

  if (intStart !== null && intEnd !== null) {
    if (intStart >= intEnd) {
      issues.push('Start time must be before end time');
    }
    const length = intEnd - intStart;
    if (length < MIN_WINDOW_HOURS * 60) {
      issues.push(`Delivery window must be at least ${MIN_WINDOW_HOURS} hours`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Build a normalized {@link DeliveryWindowConfig} object from an admin input.
 * Assumes {@link validateWindowConfig} has already passed; falls back to the
 * default per-field defensively if any value is malformed (should not happen
 * post-validation but keeps the write path total).
 */
export function toDeliveryWindowConfig(input: unknown): DeliveryWindowConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_DELIVERY_WINDOW };
  const o = input as Record<string, unknown>;
  const start = o.start_hour ?? o.startHour;
  const end = o.end_hour ?? o.endHour;
  return {
    timezone:
      typeof o.timezone === 'string' && isValidTimeZone(o.timezone)
        ? o.timezone
        : DEFAULT_DELIVERY_WINDOW.timezone,
    startHour: isWindowHour(start) ? start : DEFAULT_DELIVERY_WINDOW.startHour,
    endHour: isWindowHour(end) ? end : DEFAULT_DELIVERY_WINDOW.endHour,
  };
}
