/**
 * Mandatory green-electricity ordering rules configuration contract
 * (S-09.10, T-09.10.02).
 *
 * Single source of truth for the `app_config` key that stores the
 * admin-configurable mandatory green-electricity rules for **simple** and
 * **advanced** ordering, plus the validation rules the admin API must
 * enforce and the read-only accessor used to determine whether the
 * mandatory-green rule is active for a given order mode (enforcement seam
 * for the ordering flow).
 *
 * Semantics: each order mode (simple/advanced) is configured independently.
 * A mode has:
 *   - `mandatoryGreenEnabled`  — whether the mandatory-green rule is active
 *     for that mode.
 *   - `averagePowerThresholdKw` — average-power threshold in kW; orders at
 *     or above this threshold are subject to the rule. Must be >= 0.
 *   - `mandatoryGreenSharePercent` — the percentage of the order that must
 *     be green electricity. Must be 0..100.
 *
 * Defaults (T-09.10.02): simple mode enabled by default, advanced mode
 * disabled by default, threshold 1000 kW, green share 4%.
 *
 * @module finance
 */

/** A single order mode's mandatory-green configuration. */
export interface GreenElectricityModeConfig {
  /** Whether the mandatory-green rule is active for this order mode. */
  mandatoryGreenEnabled: boolean
  /**
   * Average-power threshold in kW. Orders at or above this threshold are
   * subject to the mandatory-green rule. `>= 0`.
   */
  averagePowerThresholdKw: number
  /**
   * Percentage of the order that must be green electricity. `0..100`.
   */
  mandatoryGreenSharePercent: number
}

/** Admin-configurable mandatory green-electricity rules for both order modes. */
export interface GreenElectricityConfig {
  /** Simple-order mandatory-green configuration. Enabled by default. */
  simpleOrder: GreenElectricityModeConfig
  /** Advanced-order mandatory-green configuration. Disabled by default. */
  advancedOrder: GreenElectricityModeConfig
}

/**
 * Default configuration (T-09.10.02): simple mode enabled, advanced mode
 * disabled, threshold 1000 kW, green share 4%.
 */
export const DEFAULT_GREEN_ELECTRICITY_CONFIG: GreenElectricityConfig = {
  simpleOrder: {
    mandatoryGreenEnabled: true,
    averagePowerThresholdKw: 1000,
    mandatoryGreenSharePercent: 4,
  },
  advancedOrder: {
    mandatoryGreenEnabled: false,
    averagePowerThresholdKw: 1000,
    mandatoryGreenSharePercent: 4,
  },
}

/** `app_config` key holding the mandatory green-electricity rules (T-09.10.02). */
export const GREEN_ELECTRICITY_CONFIG_KEY = 'electricity.green_mandatory_rules'

/** Order modes supported by the mandatory-green rule. */
export type GreenElectricityOrderMode = 'simpleOrder' | 'advancedOrder'

/** All order modes, in a stable order. */
export const GREEN_ELECTRICITY_ORDER_MODES: GreenElectricityOrderMode[] = [
  'simpleOrder',
  'advancedOrder',
]

/**
 * Result of validating a proposed green-electricity rules config for the
 * admin write path. `ok: true` when the config may be persisted; otherwise
 * `issues` carries one or more human-readable descriptions (English).
 */
export interface GreenElectricityConfigValidationResult {
  ok: boolean
  issues: string[]
}

/**
 * Whether a raw threshold value is a valid average-power threshold in kW:
 * a number, an integer, `>= 0` and within `Number.MAX_SAFE_INTEGER`.
 */
export function isValidAveragePowerThresholdKw(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 0 &&
    raw <= Number.MAX_SAFE_INTEGER
  )
}

/**
 * Whether a raw share value is a valid mandatory-green share percentage:
 * a number, `0..100`. Decimals are permitted (e.g. `4.5`).
 */
export function isValidMandatoryGreenSharePercent(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isFinite(raw) &&
    raw >= 0 &&
    raw <= 100
  )
}

/**
 * Validate a single mode's raw input (snake_case keys as stored/expected in
 * the admin API body). Appends human-readable issues to `issues`.
 */
function validateMode(
  modeName: GreenElectricityOrderMode,
  raw: unknown,
  issues: string[],
): void {
  const prefix = `${
    modeName === 'simpleOrder' ? 'simple' : 'advanced'
  }_order`
  if (!raw || typeof raw !== 'object') {
    issues.push(`${prefix} must be an object`)
    return
  }
  const o = raw as Record<string, unknown>

  if (o.mandatory_green_enabled !== undefined && typeof o.mandatory_green_enabled !== 'boolean') {
    issues.push(`${prefix}.mandatory_green_enabled must be a boolean`)
  }

  const threshold = o.average_power_threshold_kw ?? o.averagePowerThresholdKw
  if (threshold === undefined || threshold === null || threshold === '') {
    issues.push(`${prefix}.average_power_threshold_kw is required`)
  } else if (typeof threshold !== 'number') {
    issues.push(`${prefix}.average_power_threshold_kw must be an integer >= 0`)
  } else if (!isValidAveragePowerThresholdKw(threshold)) {
    issues.push(`${prefix}.average_power_threshold_kw must be an integer >= 0`)
  }

  const share = o.mandatory_green_share_percent ?? o.mandatoryGreenSharePercent
  if (share === undefined || share === null || share === '') {
    issues.push(`${prefix}.mandatory_green_share_percent is required`)
  } else if (typeof share !== 'number') {
    issues.push(`${prefix}.mandatory_green_share_percent must be a percentage between 0 and 100`)
  } else if (!isValidMandatoryGreenSharePercent(share)) {
    issues.push(`${prefix}.mandatory_green_share_percent must be a percentage between 0 and 100`)
  }
}

/**
 * Validate a proposed green-electricity rules config (T-09.10.02).
 *
 * Rules: both `simple_order` and `advanced_order` mode objects must be
 * present; each must carry a boolean `mandatory_green_enabled`, an integer
 * `average_power_threshold_kw >= 0`, and a `mandatory_green_share_percent`
 * in `0..100`. Values are strictly typed — booleans/arrays/strings are
 * rejected rather than coerced so a malformed payload cannot silently change
 * the enforced rule.
 */
export function validateGreenElectricityConfig(input: unknown): GreenElectricityConfigValidationResult {
  const issues: string[] = []

  if (!input || typeof input !== 'object') {
    return { ok: false, issues: ['Green electricity rules config must be an object'] }
  }

  const o = input as Record<string, unknown>
  const simple = o.simple_order ?? o.simpleOrder
  const advanced = o.advanced_order ?? o.advancedOrder

  validateMode('simpleOrder', simple, issues)
  validateMode('advancedOrder', advanced, issues)

  return { ok: issues.length === 0, issues }
}

/**
 * Build a normalized {@link GreenElectricityModeConfig} from an admin input,
 * falling back to the default for any invalid value (defensive; assumes
 * validation has passed, keeps the read path total).
 */
export function toGreenElectricityModeConfig(
  raw: unknown,
  fallback: GreenElectricityModeConfig,
): GreenElectricityModeConfig {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  const o = raw as Record<string, unknown>
  return {
    mandatoryGreenEnabled:
      typeof o.mandatory_green_enabled === 'boolean'
        ? o.mandatory_green_enabled
        : fallback.mandatoryGreenEnabled,
    averagePowerThresholdKw: isValidAveragePowerThresholdKw(
      o.average_power_threshold_kw ?? o.averagePowerThresholdKw,
    )
      ? (o.average_power_threshold_kw ?? o.averagePowerThresholdKw) as number
      : fallback.averagePowerThresholdKw,
    mandatoryGreenSharePercent: isValidMandatoryGreenSharePercent(
      o.mandatory_green_share_percent ?? o.mandatoryGreenSharePercent,
    )
      ? (o.mandatory_green_share_percent ?? o.mandatoryGreenSharePercent) as number
      : fallback.mandatoryGreenSharePercent,
  }
}

/**
 * Build a normalized {@link GreenElectricityConfig} from an admin input.
 * Assumes {@link validateGreenElectricityConfig} has already passed; falls
 * back to defaults defensively if any value is malformed.
 */
export function toGreenElectricityConfig(input: unknown): GreenElectricityConfig {
  const o = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  return {
    simpleOrder: toGreenElectricityModeConfig(
      o.simple_order ?? o.simpleOrder,
      DEFAULT_GREEN_ELECTRICITY_CONFIG.simpleOrder,
    ),
    advancedOrder: toGreenElectricityModeConfig(
      o.advanced_order ?? o.advancedOrder,
      DEFAULT_GREEN_ELECTRICITY_CONFIG.advancedOrder,
    ),
  }
}

/**
 * Whether the mandatory-green rule is active for a given order mode
 * (the enforcement seam the ordering flow consults). Fail-closed: a
 * malformed/absent mode config is treated as inactive for the rule (the
 * rule never silently applies); an explicitly enabled rule is active.
 */
export function isGreenRuleActive(
  config: GreenElectricityConfig,
  mode: GreenElectricityOrderMode,
): boolean {
  const modeConfig = config?.[mode]
  if (!modeConfig || typeof modeConfig.mandatoryGreenEnabled !== 'boolean') return false
  return modeConfig.mandatoryGreenEnabled
}

/** The snake_case stored shape of a single mode (as persisted in app_config). */
export function modeConfigToStored(
  mode: GreenElectricityModeConfig,
): Record<string, unknown> {
  return {
    mandatory_green_enabled: mode.mandatoryGreenEnabled,
    average_power_threshold_kw: mode.averagePowerThresholdKw,
    mandatory_green_share_percent: mode.mandatoryGreenSharePercent,
  }
}

/** The snake_case stored shape of the full green-electricity config. */
export function greenElectricityConfigToStored(config: GreenElectricityConfig): Record<string, unknown> {
  return {
    simple_order: modeConfigToStored(config.simpleOrder),
    advanced_order: modeConfigToStored(config.advancedOrder),
  }
}
