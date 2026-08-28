import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { getDbPool } from '@barghsa/db'
import { rulesSchemas, rulesErrorDetails } from './ai-policies.rules.js'

/**
 * AI usage policy management service (S-09.11, T-09.11.03).
 *
 * CRUD for the `ai_policies` table plus policy group orchestration:
 *
 * - Policies are admin-curated guardrails (title, description, kind, a
 *   per-kind `rules` document, and an `enabled` flag). The `rules` JSONB
 *   shape is validated by kind in the controller's structured editor; the
 *   four kinds mirror the epic:
 *     - `allowed_topics`     — topics the agent may respond about
 *     - `disallowed_actions` — actions the agent must never perform
 *     - `data_access_scope`  — which data domains the agent may read
 *     - `response_style`     — tone / language / length guardrails
 *   Agents (T-09.11.04) reference policies to enforce these guardrails.
 * - Policy groups are named collections of policies (many-to-many via
 *   `ai_policy_group_members`). Agents reference groups to adopt a
 *   coherent set of guardrails at once.
 *
 * Every mutation records an `audit_log` event with actor, ip, and a
 * masked-target summary. Permission `admin:ai:policies` is enforced at the
 * controller boundary (mapped to platform admin today, per the S-09 admin
 * convention).
 */

// ─── Policy kinds ─────────────────────────────────────────────────────────

export const POLICY_TYPES = [
  'allowed_topics',
  'disallowed_actions',
  'data_access_scope',
  'response_style',
] as const

export type PolicyType = (typeof POLICY_TYPES)[number]

// ─── Public DTOs ───────────────────────────────────────────────────────────

/** A policy row with its admin-list aggregate (number of group memberships). */
export interface PolicyDto {
  id: string
  title: string
  description: string
  policyType: PolicyType
  /** Validated structured guardrail document (shape depends on policyType). */
  rules: Record<string, unknown>
  enabled: boolean
  /** Number of policy groups this policy belongs to. */
  groupCount: number
  createdAt: string
  updatedAt: string
}

/** A policy group as referenced from a policy detail view. */
export interface PolicyGroupRefDto {
  id: string
  title: string
}

/** Policy detail: full record + group memberships. */
export interface PolicyDetailDto extends PolicyDto {
  groups: PolicyGroupRefDto[]
}

/** A policy as referenced from a group detail view. */
export interface PolicyRefDto {
  id: string
  title: string
  policyType: PolicyType
  enabled: boolean
}

/** A policy group row with its member count. */
export interface PolicyGroupDto {
  id: string
  title: string
  description: string
  memberCount: number
  createdAt: string
  updatedAt: string
}

/** Policy group detail: member policies. */
export interface PolicyGroupDetailDto extends PolicyGroupDto {
  members: PolicyRefDto[]
}

// ─── Mutation inputs ───────────────────────────────────────────────────────

export interface CreatePolicyInput {
  title: string
  description: string
  policyType: PolicyType
  rules: Record<string, unknown>
  actorUserId: string
  ip: string
  /** Optional initial active/inactive state; defaults to enabled. */
  enabled?: boolean
}

export interface UpdatePolicyInput {
  title?: string
  description?: string
  policyType?: PolicyType
  rules?: Record<string, unknown>
  enabled?: boolean
  actorUserId: string
  ip: string
}

export interface CreatePolicyGroupInput {
  title: string
  description: string
  actorUserId: string
  ip: string
}

export interface UpdatePolicyGroupInput {
  title?: string
  description?: string
  actorUserId: string
  ip: string
}

export interface AddGroupMemberInput {
  groupId: string
  policyId: string
  actorUserId: string
  ip: string
}

// ─── Internal row shapes (snake_case, as returned by postgres) ─────────────

interface PolicyRow {
  id: string
  title: string
  description: string
  policy_type: PolicyType
  rules: Record<string, unknown>
  enabled: boolean
  group_count: number
  created_at: string
  updated_at: string
}

interface PolicyBaseRow {
  id: string
  title: string
  description: string
  policy_type: PolicyType
  rules: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
}

interface PolicyGroupRow {
  id: string
  title: string
  description: string
  member_count: number
  created_at: string
  updated_at: string
}

interface PolicyGroupBaseRow {
  id: string
  title: string
  description: string
  created_at: string
  updated_at: string
}

const PG_FOREIGN_KEY_VIOLATION = '23503'

@Injectable()
export class AiPoliciesService {
  private readonly logger = new Logger(AiPoliciesService.name)

  // ─── Policy CRUD ─────────────────────────────────────────────────────────

  /** List all policies, newest first, with group-membership counts. */
  async listPolicies(): Promise<PolicyDto[]> {
    const result = await getDbPool().query<PolicyRow>(
      `SELECT p.id, p.title, p.description, p.policy_type, p.rules, p.enabled,
              p.created_at, p.updated_at,
              COUNT(m.group_id)::int AS group_count
         FROM ai_policies p
         LEFT JOIN ai_policy_group_members m ON m.policy_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC, p.id`,
    )
    return result.rows.map((row) => this.policyToDto(row))
  }

  /** Fetch a single policy with its group memberships. */
  async getPolicy(id: string): Promise<PolicyDetailDto> {
    const base = await this.findPolicy(id)
    if (!base) throw this.policyNotFound(id)

    const groups = await getDbPool().query<PolicyGroupRefDto>(
      `SELECT g.id, g.title
         FROM ai_policy_groups g
         JOIN ai_policy_group_members m ON m.group_id = g.id
        WHERE m.policy_id = $1
        ORDER BY g.title, g.id`,
      [id],
    )

    return {
      ...this.policyToDto({ ...base, group_count: groups.rows.length }),
      groups: groups.rows,
    }
  }

  /** Create a policy. */
  async createPolicy(input: CreatePolicyInput): Promise<PolicyDto> {
    const id = uuidv7()
    const now = new Date()
    const enabled = input.enabled ?? true

    const result = await getDbPool().query<PolicyBaseRow>(
      `INSERT INTO ai_policies
         (id, title, description, policy_type, rules, enabled, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id, title, description, policy_type, rules, enabled, created_at, updated_at`,
      [
        id,
        input.title,
        input.description,
        input.policyType,
        JSON.stringify(input.rules),
        enabled,
        input.actorUserId,
        now,
      ],
    )
    const row = result.rows[0]
    if (!row) {
      throw new HttpException(
        { statusCode: 500, error: 'AI_POLICY_CREATE_FAILED', message: 'Failed to create policy' },
        500,
      )
    }
    await this.recordAudit('ai_policy_created', input.actorUserId, input.ip, {
      targetId: row.id,
      title: row.title,
      policyType: row.policy_type,
    })
    this.logger.log(
      `Policy created: id=${id}, type=${row.policy_type}, actor=${input.actorUserId}`,
    )
    return { ...this.toPolicyBase(row), groupCount: 0 }
  }

  /** Update a policy's fields. */
  async updatePolicy(id: string, input: UpdatePolicyInput): Promise<PolicyDto> {
    const existing = await this.findPolicy(id)
    if (!existing) throw this.policyNotFound(id)

    // Authoritative cross-validation: a rules-only update must be validated
    // against the *stored* policy_type, and changing the policy_type without
    // a fresh rules document leaves the stored document invalid for the new
    // kind. Enforced here (where the DB state is known) as well as in the
    // controller's create-time schema.
    const effectiveType = input.policyType ?? existing.policy_type
    if (input.rules !== undefined) {
      const parsedRules = rulesSchemas[effectiveType].safeParse(input.rules)
      if (!parsedRules.success) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'AI_POLICY_RULES_INVALID',
            message: `Invalid rules for policy type "${effectiveType}"`,
            details: rulesErrorDetails(effectiveType, parsedRules.error.issues),
          },
          400,
        )
      }
    }
    if (input.policyType !== undefined && input.rules === undefined) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'AI_POLICY_TYPE_WITHOUT_RULES',
          message: 'Changing the policy type requires a matching rules document',
        },
        400,
      )
    }

    const fields: string[] = []
    const values: unknown[] = []
    let param = 1
    const push = (column: string, value: unknown): void => {
      fields.push(`${column} = $${param++}`)
      values.push(value)
    }

    const changedFields: string[] = []
    if (input.title !== undefined) {
      if (input.title !== existing.title) changedFields.push('title')
      push('title', input.title)
    }
    if (input.description !== undefined) {
      if (input.description !== existing.description) changedFields.push('description')
      push('description', input.description)
    }
    if (input.policyType !== undefined) {
      changedFields.push('policy_type')
      push('policy_type', input.policyType)
    }
    if (input.rules !== undefined) {
      changedFields.push('rules')
      push('rules', JSON.stringify(input.rules))
    }
    if (input.enabled !== undefined) {
      if (input.enabled !== existing.enabled) changedFields.push('enabled')
      push('enabled', input.enabled)
    }
    if (fields.length === 0) return this.getPolicy(id)

    fields.push(`updated_at = $${param++}`)
    values.push(new Date())
    values.push(id)

    const result = await getDbPool().query<PolicyBaseRow>(
      `UPDATE ai_policies SET ${fields.join(', ')}
        WHERE id = $${param}
        RETURNING id, title, description, policy_type, rules, enabled, created_at, updated_at`,
      values,
    )
    const row = result.rows[0]
    if (!row) throw this.policyNotFound(id)

    const groupCount = await this.groupCountForPolicy(id)
    await this.recordAudit('ai_policy_updated', input.actorUserId, input.ip, {
      targetId: row.id,
      title: row.title,
      changedFields,
      ...(changedFields.includes('enabled')
        ? { enabledBefore: existing.enabled, enabledAfter: row.enabled }
        : {}),
      ...(changedFields.includes('policy_type')
        ? { policyTypeBefore: existing.policy_type, policyTypeAfter: row.policy_type }
        : {}),
      rulesChanged: changedFields.includes('rules'),
    })
    this.logger.log(`Policy updated: id=${id}, actor=${input.actorUserId}`)
    return { ...this.toPolicyBase(row), groupCount }
  }

  /** Delete a policy (cascades to group memberships). */
  async removePolicy(id: string, actorUserId: string, ip: string): Promise<void> {
    const existing = await this.findPolicy(id)
    if (!existing) throw this.policyNotFound(id)

    await getDbPool().query('DELETE FROM ai_policies WHERE id = $1', [id])
    await this.recordAudit('ai_policy_deleted', actorUserId, ip, {
      targetId: existing.id,
      title: existing.title,
    })
    this.logger.log(`Policy deleted: id=${id}, actor=${actorUserId}`)
  }

  // ─── Policy group CRUD ───────────────────────────────────────────────────

  /** List all policy groups, newest first, with member counts. */
  async listGroups(): Promise<PolicyGroupDto[]> {
    const result = await getDbPool().query<PolicyGroupRow>(
      `SELECT g.id, g.title, g.description, g.created_at, g.updated_at,
              COUNT(m.policy_id)::int AS member_count
         FROM ai_policy_groups g
         LEFT JOIN ai_policy_group_members m ON m.group_id = g.id
        GROUP BY g.id
        ORDER BY g.created_at DESC, g.id`,
    )
    return result.rows.map((row) => this.groupToDto(row))
  }

  /** Fetch a single policy group with its member policies. */
  async getGroup(id: string): Promise<PolicyGroupDetailDto> {
    const base = await this.findGroup(id)
    if (!base) throw this.groupNotFound(id)

    const members = await getDbPool().query<PolicyRefRow>(
      `SELECT p.id, p.title, p.policy_type, p.enabled
         FROM ai_policies p
         JOIN ai_policy_group_members m ON m.policy_id = p.id
        WHERE m.group_id = $1
        ORDER BY p.title, p.id`,
      [id],
    )
    return {
      ...this.groupToDto({ ...base, member_count: members.rows.length }),
      members: members.rows.map((row) => ({
        id: row.id,
        title: row.title,
        policyType: row.policy_type,
        enabled: row.enabled,
      })),
    }
  }

  /** Create a policy group. */
  async createGroup(input: CreatePolicyGroupInput): Promise<PolicyGroupDto> {
    const id = uuidv7()
    const now = new Date()

    const result = await getDbPool().query<PolicyGroupBaseRow>(
      `INSERT INTO ai_policy_groups (id, title, description, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id, title, description, created_at, updated_at`,
      [id, input.title, input.description, input.actorUserId, now],
    )
    const row = result.rows[0]
    if (!row) {
      throw new HttpException(
        { statusCode: 500, error: 'AI_POLICY_GROUP_CREATE_FAILED', message: 'Failed to create policy group' },
        500,
      )
    }
    await this.recordAudit('ai_policy_group_created', input.actorUserId, input.ip, {
      targetId: row.id,
      title: row.title,
    })
    this.logger.log(`Policy group created: id=${id}, actor=${input.actorUserId}`)
    return { ...this.toGroupBase(row), memberCount: 0 }
  }

  /** Update a policy group's title/description. */
  async updateGroup(id: string, input: UpdatePolicyGroupInput): Promise<PolicyGroupDto> {
    const existing = await this.findGroup(id)
    if (!existing) throw this.groupNotFound(id)

    const fields: string[] = []
    const values: unknown[] = []
    let param = 1
    const push = (column: string, value: unknown): void => {
      fields.push(`${column} = $${param++}`)
      values.push(value)
    }

    const changedFields: string[] = []
    if (input.title !== undefined) {
      if (input.title !== existing.title) changedFields.push('title')
      push('title', input.title)
    }
    if (input.description !== undefined) {
      if (input.description !== existing.description) changedFields.push('description')
      push('description', input.description)
    }
    if (fields.length === 0) return this.getGroup(id)

    fields.push(`updated_at = $${param++}`)
    values.push(new Date())
    values.push(id)

    const result = await getDbPool().query<PolicyGroupBaseRow>(
      `UPDATE ai_policy_groups SET ${fields.join(', ')}
        WHERE id = $${param}
        RETURNING id, title, description, created_at, updated_at`,
      values,
    )
    const row = result.rows[0]
    if (!row) throw this.groupNotFound(id)

    const memberCount = await this.memberCountForGroup(id)
    await this.recordAudit('ai_policy_group_updated', input.actorUserId, input.ip, {
      targetId: row.id,
      title: row.title,
      changedFields,
    })
    this.logger.log(`Policy group updated: id=${id}, actor=${input.actorUserId}`)
    return { ...this.toGroupBase(row), memberCount }
  }

  /** Delete a policy group (cascades to its memberships). */
  async removeGroup(id: string, actorUserId: string, ip: string): Promise<void> {
    const existing = await this.findGroup(id)
    if (!existing) throw this.groupNotFound(id)

    await getDbPool().query('DELETE FROM ai_policy_groups WHERE id = $1', [id])
    await this.recordAudit('ai_policy_group_deleted', actorUserId, ip, {
      targetId: existing.id,
      title: existing.title,
    })
    this.logger.log(`Policy group deleted: id=${id}, actor=${actorUserId}`)
  }

  // ─── Group membership ────────────────────────────────────────────────────

  /** Link a policy into a group (idempotent; both records must exist). */
  async addGroupMember(input: AddGroupMemberInput): Promise<void> {
    const group = await this.findGroup(input.groupId)
    if (!group) throw this.groupNotFound(input.groupId)
    const policy = await this.findPolicy(input.policyId)
    if (!policy) throw this.policyNotFound(input.policyId)

    let inserted = false
    try {
      const res = await getDbPool().query(
        `INSERT INTO ai_policy_group_members (group_id, policy_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, policy_id) DO NOTHING
         RETURNING group_id`,
        [input.groupId, input.policyId, new Date()],
      )
      inserted = (res.rowCount ?? 0) > 0
    } catch (error) {
      if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        // Race: one side was deleted between the existence check and insert.
        throw new HttpException(
          {
            statusCode: 409,
            error: 'AI_POLICY_GROUP_MEMBER_LINK_FAILED',
            message: 'Policy or group no longer exists',
          },
          409,
        )
      }
      throw error
    }
    // Only audit a real link; a no-op re-link must not emit a duplicate event.
    if (inserted) {
      await this.recordAudit('ai_policy_group_member_added', input.actorUserId, input.ip, {
        targetId: input.groupId,
        policyId: input.policyId,
      })
    }
    this.logger.log(
      `Policy ${inserted ? 'linked into' : 'already in'} group: group=${input.groupId}, policy=${input.policyId}, actor=${input.actorUserId}`,
    )
  }

  /** Remove a policy from a group. */
  async removeGroupMember(
    groupId: string,
    policyId: string,
    actorUserId: string,
    ip: string,
  ): Promise<void> {
    const group = await this.findGroup(groupId)
    if (!group) throw this.groupNotFound(groupId)

    const result = await getDbPool().query(
      'DELETE FROM ai_policy_group_members WHERE group_id = $1 AND policy_id = $2',
      [groupId, policyId],
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'AI_POLICY_GROUP_MEMBER_NOT_FOUND',
          message: `Policy ${policyId} is not a member of group ${groupId}`,
        },
        404,
      )
    }
    await this.recordAudit('ai_policy_group_member_removed', actorUserId, ip, {
      targetId: groupId,
      policyId,
    })
    this.logger.log(
      `Policy removed from group: group=${groupId}, policy=${policyId}, actor=${actorUserId}`,
    )
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async findPolicy(id: string): Promise<PolicyBaseRow | null> {
    const result = await getDbPool().query<PolicyBaseRow>(
      `SELECT id, title, description, policy_type, rules, enabled, created_at, updated_at
         FROM ai_policies
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private async findGroup(id: string): Promise<PolicyGroupBaseRow | null> {
    const result = await getDbPool().query<PolicyGroupBaseRow>(
      `SELECT id, title, description, created_at, updated_at
         FROM ai_policy_groups
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private async groupCountForPolicy(policyId: string): Promise<number> {
    const result = await getDbPool().query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM ai_policy_group_members WHERE policy_id = $1',
      [policyId],
    )
    return result.rows[0]?.count ?? 0
  }

  private async memberCountForGroup(groupId: string): Promise<number> {
    const result = await getDbPool().query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM ai_policy_group_members WHERE group_id = $1',
      [groupId],
    )
    return result.rows[0]?.count ?? 0
  }

  private toPolicyBase(row: PolicyBaseRow): Omit<PolicyDto, 'groupCount'> {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      policyType: row.policy_type,
      rules: row.rules,
      enabled: row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private policyToDto(row: PolicyRow): PolicyDto {
    return { ...this.toPolicyBase(row), groupCount: row.group_count }
  }

  private toGroupBase(row: PolicyGroupBaseRow): Omit<PolicyGroupDto, 'memberCount'> {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private groupToDto(row: PolicyGroupBaseRow & { member_count?: number }): PolicyGroupDto {
    return { ...this.toGroupBase(row), memberCount: row.member_count ?? 0 }
  }

  private policyNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_POLICY_NOT_FOUND', message: `Policy ${id} not found` },
      404,
    )
  }

  private groupNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_POLICY_GROUP_NOT_FOUND', message: `Policy group ${id} not found` },
      404,
    )
  }

  private isPgError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === code
    )
  }

  private async recordAudit(
    event: string,
    actorUserId: string,
    ip: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const auditId = uuidv7()
    await getDbPool().query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [auditId, actorUserId, event, JSON.stringify(meta), uuidv7(), ip, new Date()],
    )
  }
}

/** Row shape for a policy as referenced from a group detail view. */
interface PolicyRefRow {
  id: string
  title: string
  policy_type: PolicyType
  enabled: boolean
}
