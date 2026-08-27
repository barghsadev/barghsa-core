/**
 * Service response targets configuration contract (S-09.08, T-09.08.01).
 *
 * Single source of truth for the `app_config` key that stores the
 * admin-configurable response targets per service type (hours), plus the
 * validation rules the admin API must enforce and the worker breach scan
 * (T-09.08.01) must consume.
 *
 * Semantics: the config is a key-value map of service type → target in
 * **hours**, where `null` means "no target configured" (breach detection is
 * off for that type). A value of `0` is NOT allowed — disabling a target is
 * expressed by setting it to `null`, so a persisted `0` is treated as
 * corrupt and normalized to `null` rather than silently meaning "alert
 * everything immediately".
 *
 * Breached targets create **staff alerts only**; they do not promise a
 * service level to customers (T-09.08.01 UI note). The breach scan lives in
 * the worker and alerts the assigned staff member (or platform admins when
 * nothing is assigned) through the in-app notification pipeline.
 *
 * @module admin
 */

/** Service types that have open items a response target can apply to today. */
export const SERVICE_RESPONSE_TARGET_TYPES = ['ticket', 'verification_case'] as const

/** A service type whose open items are checked against response targets. */
export type ServiceResponseTargetType = (typeof SERVICE_RESPONSE_TARGET_TYPES)[number]

/**
 * Admin-configured response targets, keyed by service type.
 *
 * Each value is a target in hours (integer, 1…{@link MAX_SERVICE_RESPONSE_TARGET_HOURS})
 * or `null` when no target is configured for that type.
 */
export type ServiceResponseTargets = Record<ServiceResponseTargetType, number | null>

/** `app_config` key holding the service response targets (T-09.08.01). */
export const SERVICE_RESPONSE_TARGETS_CONFIG_KEY = 'admin.service_response_targets'

/** Upper bound for a target: 8760 hours = one full year. */
export const MAX_SERVICE_RESPONSE_TARGET_HOURS = 8760

/** Human-readable range description shared by validation messages. */
export const SERVICE_RESPONSE_TARGET_HOURS_RANGE = `an integer between 1 and ${MAX_SERVICE_RESPONSE_TARGET_HOURS} hours (or null to disable)`

/**
 * Default configuration: every service type has no target configured.
 *
 * A fresh installation must not fire breach alerts for pre-existing open
 * items — the admin explicitly opts each service type in by setting a
 * target.
 */
export const DEFAULT_SERVICE_RESPONSE_TARGETS: ServiceResponseTargets = {
  ticket: null,
  verification_case: null,
}

/** Result of validating a proposed targets map for the admin write path. */
export interface ServiceResponseTargetsValidationResult {
  ok: boolean
  issues: string[]
}

/**
 * Whether a raw value is a valid target: `null` (disabled) or a safe
 * positive integer within 1…{@link MAX_SERVICE_RESPONSE_TARGET_HOURS}.
 *
 * Strictly typed on purpose — booleans, strings, floats, and zero are
 * rejected rather than coerced so a malformed admin payload can never
 * silently mean "alert everything immediately".
 */
export function isValidServiceResponseTargetHours(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 1 &&
    raw <= MAX_SERVICE_RESPONSE_TARGET_HOURS
  )
}

/**
 * Validate a proposed service-response-targets map.
 *
 * Rules:
 * - must be a plain object;
 * - every key must be a known service type (unknown types — e.g.
 *   `consultation` until its module exists — are rejected so a typo can
 *   never create dead configuration);
 * - every value must be `null` or an integer within
 *   1…{@link MAX_SERVICE_RESPONSE_TARGET_HOURS}.
 *
 * The map is a full replace: keys omitted by the admin are normalized to
 * `null` (disabled) on persist.
 */
export function validateServiceResponseTargets(
  input: unknown,
): ServiceResponseTargetsValidationResult {
  const issues: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: ['Service response targets must be an object'] }
  }

  const o = input as Record<string, unknown>
  const known = new Set<string>(SERVICE_RESPONSE_TARGET_TYPES)

  // Reject unknown keys first so the issue list is complete.
  for (const key of Object.keys(o)) {
    if (!known.has(key)) {
      issues.push(`Unknown service type '${key}'. Supported types: ${SERVICE_RESPONSE_TARGET_TYPES.join(', ')}`)
    }
  }

  for (const type of SERVICE_RESPONSE_TARGET_TYPES) {
    const raw = o[type]
    if (raw === undefined || raw === null) continue // absent/null → disabled, valid
    if (!isValidServiceResponseTargetHours(raw)) {
      issues.push(`${type} target must be ${SERVICE_RESPONSE_TARGET_HOURS_RANGE}`)
    }
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Normalize an admin input into a complete {@link ServiceResponseTargets}
 * map. Assumes {@link validateServiceResponseTargets} has already passed;
 * falls back defensively to `null` for anything malformed (should not happen
 * post-validation but keeps the write path total).
 */
export function toServiceResponseTargets(input: unknown): ServiceResponseTargets {
  const result: ServiceResponseTargets = { ...DEFAULT_SERVICE_RESPONSE_TARGETS }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  const o = input as Record<string, unknown>
  for (const type of SERVICE_RESPONSE_TARGET_TYPES) {
    if (isValidServiceResponseTargetHours(o[type])) {
      result[type] = o[type]
    }
    // absent / null / corrupt → stays null (disabled)
  }
  return result
}

/**
 * Defensively normalize a stored `app_config` value into a complete
 * {@link ServiceResponseTargets} map.
 *
 * Corruption-tolerant by design: a malformed row degrades per-type to
 * `null` (that type disabled) instead of throwing, so a corrupt value can
 * never crash the admin read path or the worker breach scan — the worst a
 * corrupt row can do is disable breach detection for one type (and the read
 * path logs a warning so the corruption is observable).
 */
export function parseStoredServiceResponseTargets(raw: unknown): ServiceResponseTargets {
  return toServiceResponseTargets(raw)
}