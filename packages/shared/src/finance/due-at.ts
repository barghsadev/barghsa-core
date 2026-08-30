/**
 * Invoice `dueAt` calculation (T-04.1.03.02).
 *
 * Canonical rule (S-04.1.03):
 *   dueAt = issuedAt + config_days
 * unless staff supplies an explicit override (permission + customer-visible
 * reason land in T-04.1.03.03; this module only resolves the instant).
 *
 * `config_days` is the `default_days` of the `service_due_periods` row
 * that is active at `issuedAt` for the invoice's service type. When no
 * row is active the issuance fallback is {@link DEFAULT_SERVICE_DUE_DAYS}.
 *
 * Days are exact 24-hour UTC offsets (not timezone calendar-date
 * arithmetic) so the same `issuedAt` always produces the same `dueAt`
 * regardless of the issuer's locale.
 *
 * @module finance
 */

import {
  DEFAULT_SERVICE_DUE_DAYS,
  MAX_SERVICE_DUE_DAYS,
  MIN_SERVICE_DUE_DAYS,
  isServiceDuePeriodType,
  isValidDefaultDueDays,
  type ServiceDuePeriodType,
} from './service-due-periods.js'

/** Milliseconds in one 24-hour due-period day (UTC). */
export const MS_PER_DUE_DAY = 24 * 60 * 60 * 1000

/** How `dueAt` was produced. */
export type DueAtSource = 'config' | 'staff_override' | 'fallback'

/** Error messages for the dueAt calculation surface. */
export const DUE_AT_ERRORS = {
  BAD_ISSUED_AT: () => 'issuedAt must be a valid Date',
  BAD_CONFIG_DAYS: () =>
    `configDays must be an integer between ${MIN_SERVICE_DUE_DAYS} and ${MAX_SERVICE_DUE_DAYS}`,
  BAD_OVERRIDE: () => 'staffOverride must be a valid Date',
} as const

/** Result of resolving an invoice due instant. */
export interface ResolvedDueAt {
  dueAt: Date
  source: DueAtSource
  /**
   * Days that produced `dueAt` for `config` / `fallback`.
   * Null when a staff override supplied the instant directly.
   */
  configDays: number | null
}

function requireValidDate(value: Date, message: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(message)
  }
  return value
}

/**
 * Add `configDays` exact 24-hour periods to `issuedAt`.
 *
 * @throws RangeError when `issuedAt` is invalid or `configDays` is
 *   outside the admin 1..365 integer range.
 */
export function addDueDays(issuedAt: Date, configDays: number): Date {
  requireValidDate(issuedAt, DUE_AT_ERRORS.BAD_ISSUED_AT())
  if (!isValidDefaultDueDays(configDays)) {
    throw new RangeError(DUE_AT_ERRORS.BAD_CONFIG_DAYS())
  }
  return new Date(issuedAt.getTime() + configDays * MS_PER_DUE_DAY)
}

/**
 * Resolve `dueAt` from an issue instant, optional admin `configDays`,
 * and an optional staff override.
 *
 * Precedence:
 *   1. `staffOverride` (when provided) wins outright;
 *   2. else `issuedAt + configDays` when `configDays` is a valid integer;
 *   3. else `issuedAt + DEFAULT_SERVICE_DUE_DAYS` (fallback).
 */
export function resolveDueAt(input: {
  issuedAt: Date
  configDays?: number | null
  staffOverride?: Date | null
}): ResolvedDueAt {
  requireValidDate(input.issuedAt, DUE_AT_ERRORS.BAD_ISSUED_AT())

  if (input.staffOverride != null) {
    const override = requireValidDate(input.staffOverride, DUE_AT_ERRORS.BAD_OVERRIDE())
    return {
      dueAt: override,
      source: 'staff_override',
      configDays: null,
    }
  }

  if (input.configDays != null) {
    return {
      dueAt: addDueDays(input.issuedAt, input.configDays),
      source: 'config',
      configDays: input.configDays,
    }
  }

  return {
    dueAt: addDueDays(input.issuedAt, DEFAULT_SERVICE_DUE_DAYS),
    source: 'fallback',
    configDays: DEFAULT_SERVICE_DUE_DAYS,
  }
}

/**
 * Map a product `type` onto a due-period service type.
 * Product keys that match the admin set (`electricity`, `saving_plan`,
 * `consultation`) pass through; `hardware` and unknown values return
 * null so issuance falls back rather than querying a non-canonical key.
 */
export function duePeriodTypeForProduct(
  productType: string,
): ServiceDuePeriodType | null {
  return isServiceDuePeriodType(productType) ? productType : null
}

/** Manual invoices always resolve against the `manual` due-period row. */
export function duePeriodTypeForManual(): ServiceDuePeriodType {
  return 'manual'
}
