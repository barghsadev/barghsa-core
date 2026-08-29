/**
 * Contract electricity increase limits configuration contract
 * (S-09.12, T-09.12.06).
 *
 * Single source of truth for the `app_config` key that stores the
 * admin-configurable electricity-contract limits:
 *
 *   - `maxQuantityIncreasePercent` — the maximum percentage by which a
 *     customer may request an increase to the contracted electricity
 *     quantity (quantity-increase requests, S-04.6.01).
 *   - `maxContractDuration` — the maximum contract duration, in Jalali
 *     months, for advanced electricity orders.
 *   - `leadTimeDays` — the minimum number of days between an advanced
 *     order's start date and "today" (start cannot be sooner than
 *     today + lead time; 0 means the start can be today).
 *
 * Defaults (technical note): `maxQuantityIncreasePercent` default is
 * configurable — the product spec does not pin a number, so a documented
 * 20% is served until an admin overrides it; `maxContractDuration`
 * defaults to 24 Jalali months; `leadTimeDays` defaults to 0.
 *
 * Changes affect **new drafts only** — existing contracts and already
 * confirmed orders are never re-validated or retroactively constrained.
 * Enforcement happens at draft time in the ordering flow (T-03.06.01.02,
 * T-04.6.01.01); this module is the configuration contract they read.
 *
 * @module admin
 */

/** Admin-configurable contract electricity limits (camelCase domain shape). */
export interface ContractElectricityLimits {
  /**
   * Max % by which a customer may request an increase to the contracted
   * electricity quantity. Integer, 0..1000. 0 forbids increases entirely.
   */
  maxQuantityIncreasePercent: number
  /**
   * Max contract duration for advanced electricity orders, in Jalali
   * months. Integer, 1..1200 (up to 100 years).
   */
  maxContractDuration: number
  /**
   * Minimum lead time (days) between "today" and an advanced order's
   * start date. Integer, 0..36500. 0 means the start can be today.
   */
  leadTimeDays: number
}

/**
 * Default configuration (T-09.12.06): quantity increase capped at 20%
 * (spec says the default is configurable without pinning a number —
 * 20% is the documented served default until an admin overrides it),
 * contract duration 24 Jalali months, lead time 0 days.
 */
export const DEFAULT_CONTRACT_ELECTRICITY_LIMITS: ContractElectricityLimits = {
  maxQuantityIncreasePercent: 20,
  maxContractDuration: 24,
  leadTimeDays: 0,
}

/** `app_config` key holding the contract electricity limits (T-09.12.06). */
export const CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY = 'electricity.contract_limits'

/** Maximum allowed quantity-increase percentage. */
export const MAX_CONTRACT_QUANTITY_INCREASE_PERCENT = 1000
/** Maximum allowed contract duration in Jalali months (100 years). */
export const MAX_CONTRACT_DURATION_MONTHS = 1200
/** Maximum allowed lead time in days (100 years). */
export const MAX_CONTRACT_LEAD_TIME_DAYS = 36500

/**
 * Result of validating a proposed contract electricity limits config for
 * the admin write path. `ok: true` when the config may be persisted;
 * otherwise `issues` carries one or more human-readable descriptions
 * (English).
 */
export interface ContractElectricityLimitsValidationResult {
  ok: boolean
  issues: string[]
}

/**
 * Whether a raw value is a valid quantity-increase percentage: an integer
 * in 0..{@link MAX_CONTRACT_QUANTITY_INCREASE_PERCENT}.
 */
export function isValidQuantityIncreasePercent(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 0 &&
    raw <= MAX_CONTRACT_QUANTITY_INCREASE_PERCENT
  )
}

/**
 * Whether a raw value is a valid contract duration: an integer in
 * 1..{@link MAX_CONTRACT_DURATION_MONTHS}. A duration of 0 months would
 * make any advanced order impossible, so the floor is 1.
 */
export function isValidContractDuration(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 1 &&
    raw <= MAX_CONTRACT_DURATION_MONTHS
  )
}

/**
 * Whether a raw value is a valid lead time: an integer in
 * 0..{@link MAX_CONTRACT_LEAD_TIME_DAYS}. 0 is valid — the start date can
 * be today.
 */
export function isValidLeadTimeDays(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 0 &&
    raw <= MAX_CONTRACT_LEAD_TIME_DAYS
  )
}

/**
 * Validate a proposed contract electricity limits config (T-09.12.06).
 *
 * Accepts both the admin wire shape (`max_quantity_increase_percent`,
 * `max_contract_duration_months`, `lead_time_days`) and the camelCase
 * domain shape. All three values are required and strictly typed —
 * booleans/arrays/strings are rejected rather than coerced so a malformed
 * payload cannot silently change the enforced limits.
 */
export function validateContractElectricityLimits(
  input: unknown,
): ContractElectricityLimitsValidationResult {
  const issues: string[] = []
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      issues: ['Contract electricity limits config must be an object'],
    }
  }
  const o = input as Record<string, unknown>

  const percent = o.max_quantity_increase_percent ?? o.maxQuantityIncreasePercent
  if (percent === undefined || percent === null || percent === '') {
    issues.push('max_quantity_increase_percent is required')
  } else if (!isValidQuantityIncreasePercent(percent)) {
    issues.push(
      `max_quantity_increase_percent must be an integer between 0 and ${MAX_CONTRACT_QUANTITY_INCREASE_PERCENT}`,
    )
  }

  const duration = o.max_contract_duration_months ?? o.maxContractDuration
  if (duration === undefined || duration === null || duration === '') {
    issues.push('max_contract_duration_months is required')
  } else if (!isValidContractDuration(duration)) {
    issues.push(
      `max_contract_duration_months must be an integer between 1 and ${MAX_CONTRACT_DURATION_MONTHS}`,
    )
  }

  const lead = o.lead_time_days ?? o.leadTimeDays
  if (lead === undefined || lead === null || lead === '') {
    issues.push('lead_time_days is required')
  } else if (!isValidLeadTimeDays(lead)) {
    issues.push(
      `lead_time_days must be an integer between 0 and ${MAX_CONTRACT_LEAD_TIME_DAYS}`,
    )
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Build a normalized {@link ContractElectricityLimits} from an admin
 * input. Assumes {@link validateContractElectricityLimits} has already
 * passed; falls back to defaults defensively if any value is malformed
 * (keeps the read path total).
 */
export function toContractElectricityLimits(input: unknown): ContractElectricityLimits {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const percent = o.max_quantity_increase_percent ?? o.maxQuantityIncreasePercent
  const duration = o.max_contract_duration_months ?? o.maxContractDuration
  const lead = o.lead_time_days ?? o.leadTimeDays
  return {
    maxQuantityIncreasePercent: isValidQuantityIncreasePercent(percent)
      ? (percent as number)
      : DEFAULT_CONTRACT_ELECTRICITY_LIMITS.maxQuantityIncreasePercent,
    maxContractDuration: isValidContractDuration(duration)
      ? (duration as number)
      : DEFAULT_CONTRACT_ELECTRICITY_LIMITS.maxContractDuration,
    leadTimeDays: isValidLeadTimeDays(lead)
      ? (lead as number)
      : DEFAULT_CONTRACT_ELECTRICITY_LIMITS.leadTimeDays,
  }
}

/** The snake_case shape persisted in `app_config` (T-09.12.06). */
export function contractElectricityLimitsToStored(
  config: ContractElectricityLimits,
): Record<string, unknown> {
  return {
    max_quantity_increase_percent: config.maxQuantityIncreasePercent,
    max_contract_duration_months: config.maxContractDuration,
    lead_time_days: config.leadTimeDays,
  }
}