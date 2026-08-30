/**
 * Service due-period configuration contract (T-04.1.03.01).
 *
 * Admin configures a default invoice due period (in days) per service
 * type. Rows are versioned with an effective window so a change of
 * default days never mutates history: the previously-open row is
 * end-dated and a new row opens (mirroring VAT configurations).
 *
 * Canonical service types (S-04.1.03):
 *   electricity | saving_plan | consultation | manual
 *
 * Windows:
 *   - `effective_from` (inclusive)
 *   - `effective_until` (exclusive; null = open/current)
 * At most one open row exists per service type, enforced by the
 * `service_due_periods` GIST EXCLUDE constraint (migration 0059).
 *
 * `dueAt` resolution (`issuedAt + default_days`, staff override) lives
 * in `due-at.ts` (T-04.1.03.02); this module is the shared
 * type/validation surface for the admin config rows.
 *
 * @module finance
 */

/** Canonical invoice service types that carry an admin due-period. */
export const SERVICE_DUE_PERIOD_TYPES = [
  'electricity',
  'saving_plan',
  'consultation',
  'manual',
] as const

export type ServiceDuePeriodType = (typeof SERVICE_DUE_PERIOD_TYPES)[number]

/** Fallback used by invoice issuance when no active period row exists. */
export const DEFAULT_SERVICE_DUE_DAYS = 7

/** Minimum configurable due period in days (due the next calendar day). */
export const MIN_SERVICE_DUE_DAYS = 1

/** Maximum configurable due period in days (one calendar year). */
export const MAX_SERVICE_DUE_DAYS = 365

/** Whether a raw value is a known service-due-period type. */
export function isServiceDuePeriodType(raw: unknown): raw is ServiceDuePeriodType {
  return (
    typeof raw === 'string' &&
    (SERVICE_DUE_PERIOD_TYPES as readonly string[]).includes(raw)
  )
}

/**
 * Whether a raw value is a valid default due period in days:
 * an integer within [1, 365].
 */
export function isValidDefaultDueDays(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= MIN_SERVICE_DUE_DAYS &&
    raw <= MAX_SERVICE_DUE_DAYS
  )
}

/**
 * A versioned due-period row as stored in `service_due_periods` and
 * exposed by the future admin API.
 */
export interface ServiceDuePeriodDto {
  id: string
  serviceType: ServiceDuePeriodType
  /** Default due period in days (`issuedAt + defaultDays` → `dueAt`). */
  defaultDays: number
  /** Effective window — `effectiveFrom` inclusive. */
  effectiveFrom: string
  /** Effective window end — exclusive; null = open/current. */
  effectiveUntil: string | null
  /** Admin who recorded this period. */
  createdBy: string
  createdAt: string
  updatedAt: string
  /**
   * Derived status for admin UI/table:
   * - `current` — active now
   * - `scheduled` — future effective date (not yet active)
   * - `expired` — ended in the past
   */
  status: 'current' | 'scheduled' | 'expired'
}

/**
 * Derive the display status of a versioned due-period window at `at`
 * (default now). Same inclusive/exclusive semantics as VAT windows.
 */
export function serviceDuePeriodWindowStatus(
  effectiveFrom: Date | string,
  effectiveUntil: Date | string | null,
  at: Date = new Date(),
): 'current' | 'scheduled' | 'expired' {
  const from = effectiveFrom instanceof Date ? effectiveFrom : new Date(effectiveFrom)
  const until =
    effectiveUntil == null
      ? null
      : effectiveUntil instanceof Date
        ? effectiveUntil
        : new Date(effectiveUntil)
  if (from.getTime() > at.getTime()) return 'scheduled'
  if (until !== null && until.getTime() <= at.getTime()) return 'expired'
  return 'current'
}
