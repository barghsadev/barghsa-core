/**
 * Staff teams and assignment rules configuration contract (S-09.08,
 * T-09.08.02).
 *
 * Single source of truth for the admin-configurable staff teams and the
 * auto-assignment rules the admin API must enforce and the future worker
 * assignment engine (round-robin / by expertise / by load) must consume.
 *
 * Semantics:
 * - A **staff team** is a named group of staff members (users), optionally
 *   tagged with skill tags. Teams are stored relationally
 *   (`staff_teams` + `staff_team_members` in @barghsa/db) because members
 *   are first-class rows referenced elsewhere (assignment outcomes).
 * - **Assignment rules** are the `app_config` key `admin.staff_assignment_rules`:
 *   a flat map work-type → rule. A rule names the team new work of that
 *   type auto-assigns to and the strategy used to pick the member
 *   (`round_robin` | `expertise` | `load`). A `null` team means *fallback
 *   to manual assignment* — no auto-assignment happens for that work type.
 *   The strategy is stored anyway (so an admin can pre-configure it) but is
 *   meaningless until a team is chosen.
 *
 * Assignment is a worker concern (T-09.08.02 engine slice, following this
 * configuration slice): this module only defines and validates the config.
 *
 * @module admin
 */

/** Work types that support auto-assignment today. */
export const STAFF_ASSIGNMENT_WORK_TYPES = ['ticket', 'verification_case'] as const

/** A work type with assignable open items. */
export type StaffAssignmentWorkType = (typeof STAFF_ASSIGNMENT_WORK_TYPES)[number]

/** Auto-assignment strategies (T-09.08.02). */
export const STAFF_ASSIGNMENT_STRATEGIES = ['round_robin', 'expertise', 'load'] as const

/** A strategy used to pick a staff member within a team. */
export type StaffAssignmentStrategy = (typeof STAFF_ASSIGNMENT_STRATEGIES)[number]

/**
 * Assignment rule for one work type.
 *
 * - `teamId` — the team new work of this type auto-assigns to; `null`
 *   means manual assignment (no auto-assignment).
 * - `strategy` — member-selection strategy within the team. Meaningless
 *   while `teamId` is `null` but persisted so the admin can pre-configure.
 */
export interface StaffAssignmentRule {
  teamId: string | null
  strategy: StaffAssignmentStrategy
}

/** Admin-configured assignment rules, keyed by work type. */
export type StaffAssignmentRules = Record<StaffAssignmentWorkType, StaffAssignmentRule>

/** `app_config` key holding the assignment rules (T-09.08.02). */
export const STAFF_ASSIGNMENT_RULES_CONFIG_KEY = 'admin.staff_assignment_rules'

/**
 * Default configuration: every work type falls back to manual assignment.
 *
 * A fresh installation must not auto-assign any work until the admin
 * explicitly wires a team for a work type.
 */
export const DEFAULT_STAFF_ASSIGNMENT_RULES: StaffAssignmentRules = {
  ticket: { teamId: null, strategy: 'round_robin' },
  verification_case: { teamId: null, strategy: 'round_robin' },
}

/** Result of validating a proposed assignment-rules map for the admin write path. */
export interface StaffAssignmentRulesValidationResult {
  ok: boolean
  issues: string[]
}

/** Team name limits (shared by the API surface and validation). */
export const STAFF_TEAM_NAME_MIN = 1
export const STAFF_TEAM_NAME_MAX = 80

/** Skill tag limits. */
export const STAFF_TEAM_SKILL_TAG_MAX = 40
export const STAFF_TEAM_SKILL_TAGS_MAX = 20
export const STAFF_TEAM_MEMBERS_MAX = 200

/** Whether a raw value is a valid strategy. */
export function isValidStaffAssignmentStrategy(raw: unknown): raw is StaffAssignmentStrategy {
  return (
    typeof raw === 'string' &&
    (STAFF_ASSIGNMENT_STRATEGIES as readonly string[]).includes(raw)
  )
}

/**
 * Validate a proposed assignment-rules map.
 *
 * Rules:
 * - must be a plain object;
 * - every key must be a known work type (unknown types are rejected so a
 *   typo can never create dead configuration);
 * - every rule must be an object with `teamId` (`string` or `null`) and a
 *   valid `strategy` (`round_robin` | `expertise` | `load`).
 *
 * The map is a full replace: work types omitted by the admin are normalized
 * to the manual-assignment default (`null` team) on persist.
 */
export function validateStaffAssignmentRules(
  input: unknown,
): StaffAssignmentRulesValidationResult {
  const issues: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: ['Staff assignment rules must be an object'] }
  }

  const o = input as Record<string, unknown>
  const known = new Set<string>(STAFF_ASSIGNMENT_WORK_TYPES)

  for (const key of Object.keys(o)) {
    if (!known.has(key)) {
      issues.push(`Unknown work type '${key}'. Supported types: ${STAFF_ASSIGNMENT_WORK_TYPES.join(', ')}`)
    }
  }

  for (const workType of STAFF_ASSIGNMENT_WORK_TYPES) {
    const raw = o[workType]
    if (raw === undefined || raw === null) continue // omitted → manual default, valid
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push(`${workType} rule must be an object with teamId and strategy`)
      continue
    }
    const rule = raw as Record<string, unknown>
    if (rule.teamId !== undefined && rule.teamId !== null && typeof rule.teamId !== 'string') {
      issues.push(`${workType} teamId must be a string or null`)
    }
    if (rule.strategy !== undefined && !isValidStaffAssignmentStrategy(rule.strategy)) {
      issues.push(`${workType} strategy must be one of: ${STAFF_ASSIGNMENT_STRATEGIES.join(', ')}`)
    }
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Normalize an admin input into a complete {@link StaffAssignmentRules} map.
 * Assumes {@link validateStaffAssignmentRules} has already passed; falls
 * back defensively to the manual default for anything malformed (should not
 * happen post-validation but keeps the write path total).
 *
 * Also used as the corruption-tolerant read-path normalizer: every work
 * type independently degrades to the manual default when its stored rule is
 * malformed, so a corrupt row can never crash the admin read path or the
 * future worker assignment engine — the worst a corrupt row can do is
 * disable auto-assignment for one work type.
 */
export function toStaffAssignmentRules(input: unknown): StaffAssignmentRules {
  const result: StaffAssignmentRules = structuredClone(DEFAULT_STAFF_ASSIGNMENT_RULES)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  const o = input as Record<string, unknown>
  for (const workType of STAFF_ASSIGNMENT_WORK_TYPES) {
    const raw = o[workType]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rule = raw as Record<string, unknown>
    const next: StaffAssignmentRule = {
      teamId: typeof rule.teamId === 'string' ? rule.teamId : null,
      strategy: isValidStaffAssignmentStrategy(rule.strategy)
        ? rule.strategy
        : DEFAULT_STAFF_ASSIGNMENT_RULES[workType].strategy,
    }
    result[workType] = next
  }
  return result
}

/** Input shape used when creating or updating a staff team (T-09.08.02). */
export interface StaffTeamInput {
  name: string
  description: string | null
  skillTags: string[]
  memberUserIds: string[]
}

/** Stored/read shape of a staff team (created_at/updated_at from base columns). */
export interface StaffTeamRecord {
  id: string
  name: string
  description: string | null
  skillTags: string[]
  isActive: boolean
  memberUserIds: string[]
  createdAt: string
  updatedAt: string
}

/** Result of validating a proposed team input for the admin write path. */
export interface StaffTeamInputValidationResult {
  ok: boolean
  issues: string[]
}

/**
 * Validate a proposed staff team input (create/update payload).
 *
 * Rules:
 * - `name` — non-empty trimmed string within 1…80 chars;
 * - `description` — `string` or `null`;
 * - `skillTags` — array of unique non-empty trimmed strings, each ≤ 40
 *   chars, at most 20 tags;
 * - `memberUserIds` — array of unique non-empty strings, at most
 *   200 members (existence of the users is enforced by the service layer).
 */
export function validateStaffTeamInput(input: unknown): StaffTeamInputValidationResult {
  const issues: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: ['Staff team must be an object'] }
  }

  const o = input as Record<string, unknown>

  if (typeof o.name !== 'string' || o.name.trim().length < STAFF_TEAM_NAME_MIN || o.name.trim().length > STAFF_TEAM_NAME_MAX) {
    issues.push(`name must be a string between ${STAFF_TEAM_NAME_MIN} and ${STAFF_TEAM_NAME_MAX} characters`)
  }

  if (o.description !== undefined && o.description !== null && typeof o.description !== 'string') {
    issues.push('description must be a string or null')
  }

  if (!Array.isArray(o.skillTags)) {
    issues.push('skillTags must be an array')
  } else {
    if (o.skillTags.length > STAFF_TEAM_SKILL_TAGS_MAX) {
      issues.push(`skillTags must have at most ${STAFF_TEAM_SKILL_TAGS_MAX} tags`)
    }
    for (const tag of o.skillTags) {
      if (typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > STAFF_TEAM_SKILL_TAG_MAX) {
        issues.push(`each skill tag must be a non-empty string of at most ${STAFF_TEAM_SKILL_TAG_MAX} characters`)
      }
    }
    const unique = new Set(o.skillTags.map((t: unknown) => typeof t === 'string' ? t.trim() : t))
    if (unique.size !== o.skillTags.length) {
      issues.push('skillTags must not contain duplicates')
    }
  }

  if (!Array.isArray(o.memberUserIds)) {
    issues.push('memberUserIds must be an array')
  } else {
    if (o.memberUserIds.length > STAFF_TEAM_MEMBERS_MAX) {
      issues.push(`memberUserIds must have at most ${STAFF_TEAM_MEMBERS_MAX} members`)
    }
    for (const member of o.memberUserIds) {
      if (typeof member !== 'string' || member.trim().length === 0) {
        issues.push('each member user id must be a non-empty string')
      }
    }
    const unique = new Set(o.memberUserIds)
    if (unique.size !== o.memberUserIds.length) {
      issues.push('memberUserIds must not contain duplicates')
    }
  }

  return { ok: issues.length === 0, issues }
}