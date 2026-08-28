/**
 * Service escalation policy configuration contract (S-09.08, T-09.08.03).
 *
 * Single source of truth for the `app_config` key that stores the
 * admin-configurable escalation choreography for breached service items,
 * plus the validation rules the admin API must enforce and the worker
 * escalation scan (T-09.08.03) must consume.
 *
 * ## Model
 *
 * Escalation sits **on top of** the T-09.08.01 breach scan. When an open
 * service item (ticket, verification case) exceeds its response target, the
 * breach scanner alerts the *assigned* staff — that is the **level-1**
 * escalation (delay = the breached target itself). This module configures
 * the two deeper tiers the escalation worker adds on top:
 *
 * - **level 2 — team lead**: after `level2.delayHours` of continued
 *   no-response past the initial breach alert, the item escalates to the
 *   responsible staff's team lead(s).
 * - **level 3 — admin**: after `level3.delayHours` past the level-2
 *   escalation, the item escalates to platform administrators.
 *
 * Each level has its own **configurable alert channels** (in-app, email),
 * satisfying the task's "Configurable alert channels (in-app, email)".
 * `in_app` is always mandatory for business notifications (the E-05 outbox
 * enforces it); `email` may be added per level.
 *
 * A level's `delayHours` being `null` disables just that tier. A whole
 * service type being `null` (or absent) disables escalation entirely for
 * that type. A fresh installation escalates nothing until the admin opts a
 * type in.
 *
 * The time base for each level's delay is the moment the previous tier's
 * alert was emitted (the breach alert time for level 2, and the level-2
 * escalation time for level 3) — that is, how long the item has been
 * waiting *since the last alert* before it climbs another rung.
 *
 * @module admin
 */

import type { NotificationChannel } from '../notifications/notification-transport.js'
import type { ServiceResponseTargetType } from './service-response-targets.js'
import { SERVICE_RESPONSE_TARGET_TYPES } from './service-response-targets.js'

/** `app_config` key holding the escalation policy (T-09.08.03). */
export const ESCALATION_POLICY_CONFIG_KEY = 'admin.escalation_policy'

/** Escalation rungs beyond the level-1 (assigned) breach alert. */
export const ESCALATION_LEVELS = [2, 3] as const

/** A level that can be escalated to past the initial breach alert. */
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number]

/** Channels a level may deliver on. In-app is mandatory; email is optional. */
export const ESCALATION_CHANNELS: readonly NotificationChannel[] = ['in_app', 'email']

/** Upper bound for an escalation delay: 8760 hours = one full year. */
export const MAX_ESCALATION_DELAY_HOURS = 8760

/** Human-readable delay range shared by validation messages. */
export const ESCALATION_DELAY_RANGE = `an integer between 1 and ${MAX_ESCALATION_DELAY_HOURS} hours (or null to disable)`

/** Delivery channels allowed on an escalation level. */
export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number]

/**
 * Configuration of one escalation level (2 = team lead, 3 = admin).
 *
 * - `delayHours` — hours the item must wait (since the previous tier's
 *   alert) before escalating to this level; `null` disables this level.
 * - `channels` — delivery channels for the escalation notification; must
 *   include `in_app`, may add `email`.
 */
export interface EscalationLevelConfig {
  delayHours: number | null
  channels: EscalationChannel[]
}

/**
 * Escalation choreography for one service type.
 *
 * - `level2` — team-lead escalation (delay past the level-1 breach alert).
 * - `level3` — admin escalation (delay past the level-2 escalation).
 */
export interface ServiceEscalationPolicy {
  level2: EscalationLevelConfig
  level3: EscalationLevelConfig
}

/**
 * The admin-configurable escalation policy, keyed by service type.
 *
 * A `null` (or absent) type means escalation is disabled for that type.
 */
export type EscalationPolicies = Record<ServiceResponseTargetType, ServiceEscalationPolicy | null>

/**
 * Default configuration: every service type has escalation disabled.
 *
 * A fresh installation must not escalate any item until the admin opts each
 * service type in (mirroring the `DEFAULT_SERVICE_RESPONSE_TARGETS`
 * opt-in behaviour of T-09.08.01).
 */
export const DEFAULT_ESCALATION_POLICIES: EscalationPolicies = {
  ticket: null,
  verification_case: null,
}

/** Result of validating a proposed escalation policy for the admin write path. */
export interface EscalationPolicyValidationResult {
  ok: boolean
  issues: string[]
}

/** Whether a raw value is a valid escalation delay: `null` or a safe positive integer. */
export function isValidEscalationDelayHours(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 1 &&
    raw <= MAX_ESCALATION_DELAY_HOURS
  )
}

/** Whether a channel array is a valid escalation channel set (must include `in_app`). */
export function isValidEscalationChannels(raw: unknown): raw is EscalationChannel[] {
  if (!Array.isArray(raw) || raw.length === 0) return false
  const allowed = new Set<string>(ESCALATION_CHANNELS)
  for (const channel of raw) {
    if (typeof channel !== 'string' || !allowed.has(channel)) return false
  }
  return raw.includes('in_app')
}

/** Validate the per-type policy object shared by level validation. */
function validateLevelConfig(label: string, raw: unknown): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [`${label} must be an object with delayHours and channels`] }
  }
  const o = raw as Record<string, unknown>
  if (o.delayHours !== undefined && o.delayHours !== null && !isValidEscalationDelayHours(o.delayHours)) {
    issues.push(`${label} delayHours must be ${ESCALATION_DELAY_RANGE}`)
  }
  if (o.channels !== undefined && !isValidEscalationChannels(o.channels)) {
    issues.push(`${label} channels must be a non-empty array including 'in_app', using only: ${ESCALATION_CHANNELS.join(', ')}`)
  }
  return { ok: issues.length === 0, issues }
}

/**
 * Validate a proposed escalation policy.
 *
 * Rules:
 * - must be a plain object;
 * - every key must be a known service type (unknown types are rejected so a
 *   typo can never create dead configuration);
 * - every type's value must be `null` (disabled) or an object whose
 *   `level2` and `level3` each have a valid `delayHours` (positive integer
 *   or null) and a valid channel set (must include `in_app`, may add
 *   `email`).
 *
 * The map is a full replace: types omitted by the admin are normalized to
 * `null` (escalation disabled) on persist.
 */
export function validateEscalationPolicies(input: unknown): EscalationPolicyValidationResult {
  const issues: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: ['Escalation policy must be an object'] }
  }

  const o = input as Record<string, unknown>
  const known = new Set<string>(SERVICE_RESPONSE_TARGET_TYPES)

  for (const key of Object.keys(o)) {
    if (!known.has(key)) {
      issues.push(`Unknown service type '${key}'. Supported types: ${SERVICE_RESPONSE_TARGET_TYPES.join(', ')}`)
    }
  }

  for (const type of SERVICE_RESPONSE_TARGET_TYPES) {
    const raw = o[type]
    if (raw === undefined || raw === null) continue // absent/null → disabled, valid
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push(`${type} escalation policy must be an object with level2 and level3, or null to disable`)
      continue
    }
    const policy = raw as Record<string, unknown>
    const level2 = validateLevelConfig(`${type} level2`, policy.level2)
    issues.push(...level2.issues)
    const level3 = validateLevelConfig(`${type} level3`, policy.level3)
    issues.push(...level3.issues)
  }

  return { ok: issues.length === 0, issues }
}

/** Normalize one level config; assumes validation has passed but stays total. */
function toEscalationLevelConfig(raw: unknown): EscalationLevelConfig {
  const result: EscalationLevelConfig = { delayHours: null, channels: ['in_app'] }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  const o = raw as Record<string, unknown>
  if (isValidEscalationDelayHours(o.delayHours)) result.delayHours = o.delayHours
  if (isValidEscalationChannels(o.channels)) result.channels = [...o.channels]
  return result
}

/**
 * Normalize an admin input into a complete {@link EscalationPolicies} map.
 * Assumes {@link validateEscalationPolicies} has already passed; falls back
 * defensively to per-type disabled (`null`) / per-level defaults for
 * anything malformed (should not happen post-validation but keeps the write
 * path total).
 *
 * Also used as the corruption-tolerant read-path normalizer: every catalog
 * type independently degrades to `null` (escalation disabled) when its
 * stored value is malformed, and each level degrades to `delayHours: null` /
 * `['in_app']` when its stored sub-value is malformed, so a corrupt row can
 * never crash the admin read path or the worker escalation scan — the worst
 * a corrupt row can do is disable escalation for one type or one level.
 */
export function toEscalationPolicies(input: unknown): EscalationPolicies {
  const result: EscalationPolicies = structuredClone(DEFAULT_ESCALATION_POLICIES)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  const o = input as Record<string, unknown>
  for (const type of SERVICE_RESPONSE_TARGET_TYPES) {
    const raw = o[type]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const policy = raw as Record<string, unknown>
    result[type] = {
      level2: toEscalationLevelConfig(policy.level2),
      level3: toEscalationLevelConfig(policy.level3),
    }
  }
  return result
}
