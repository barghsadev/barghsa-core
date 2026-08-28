import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'

/**
 * AI agent management service (S-09.11, T-09.11.04) — slice 1 (CRUD + links).
 *
 * CRUD for the `ai_agents` table plus KB/policy link orchestration:
 *
 * - An agent references exactly one AI model (ai_models, T-09.11.01) and
 *   optionally links knowledge bases (T-09.11.02) and usage policies
 *   (T-09.11.03). The epic's agent config contract is
 *   `model_id + kb_ids[] + policy_ids[]`; the `ai_agent_kbs` and
 *   `ai_agent_policies` link tables persist those arrays.
 * - Create accepts optional `kbIds`/`policyIds` and inserts the links in the
 *   same request. Update accepts `kbIds`/`policyIds` with full-set (replace)
 *   semantics so the admin multi-select form sends the whole selection; a
 *   DELETE-then-INSERT reconciles the set. Dedicated idempotent add /
 *   assertive remove endpoints (`addKb`, `removeKb`, `addPolicy`,
 *   `removePolicy`) let the UI link/unlink without a full PUT.
 * - Every referenced id is validated to exist BEFORE any write, so a bad id
 *   never leaves a partially-applied agent or link set; a concurrent-delete
 *   race is caught by the FK violation and surfaced as a 409.
 * - Every mutation records an `audit_log` event with actor, ip, and a
 *   target summary. A reconcile that changes nothing (identical link set)
 *   emits no audit, mirroring the no-op-PUT discipline of T-09.11.03.
 *
 * Permission `admin:ai:agents` is enforced at the controller boundary
 * (mapped to platform admin today, per the S-09 admin convention).
 */

// ─── Public DTOs ───────────────────────────────────────────────────────────

/** A KB as referenced from an agent detail view. */
export interface KbRefDto {
  id: string
  title: string
}

/** A policy as referenced from an agent detail view. */
export interface PolicyRefDto {
  id: string
  title: string
  policyType: string
  enabled: boolean
}

/** The agent's referenced model, as rendered in the detail view. */
export interface ModelRefDto {
  id: string
  title: string
  providerType: string
  modelName: string
}

/** An agent row with its admin-list aggregates. */
export interface AgentDto {
  id: string
  title: string
  description: string
  modelId: string
  modelTitle: string
  /** Active/inactive flag that drives the list status column. */
  enabled: boolean
  /** Number of linked knowledge bases. */
  kbCount: number
  /** Number of linked usage policies. */
  policyCount: number
  createdAt: string
  updatedAt: string
}

/** Agent detail: full record + referenced model + linked KBs/policies. */
export interface AgentDetailDto extends AgentDto {
  model: ModelRefDto
  kbs: KbRefDto[]
  policies: PolicyRefDto[]
}

// ─── Mutation inputs ───────────────────────────────────────────────────────

export interface CreateAgentInput {
  title: string
  description: string
  modelId: string
  actorUserId: string
  ip: string
  kbIds?: string[]
  policyIds?: string[]
  enabled?: boolean
}

export interface UpdateAgentInput {
  title?: string
  description?: string
  modelId?: string
  enabled?: boolean
  /** Replace the whole KB link set (undefined = leave untouched). */
  kbIds?: string[]
  /** Replace the whole policy link set (undefined = leave untouched). */
  policyIds?: string[]
  actorUserId: string
  ip: string
}

export interface AddAgentKbInput {
  agentId: string
  kbId: string
  actorUserId: string
  ip: string
}

export interface AddAgentPolicyInput {
  agentId: string
  policyId: string
  actorUserId: string
  ip: string
}

// ─── Internal row shapes (snake_case, as returned by postgres) ─────────────

interface AgentRow {
  id: string
  title: string
  description: string
  model_id: string
  model_title: string
  enabled: boolean
  kb_count: number
  policy_count: number
  created_at: string
  updated_at: string
}

interface AgentBaseRow {
  id: string
  title: string
  description: string
  model_id: string
  created_by: string
  enabled: boolean
  created_at: string
  updated_at: string
}

interface AgentModelRow {
  id: string
  title: string
  provider_type: string
  model_name: string
}

const PG_FOREIGN_KEY_VIOLATION = '23503'
const MAX_LINK_IDS = 200

@Injectable()
export class AiAgentsService {
  private readonly logger = new Logger(AiAgentsService.name)

  // ─── Read ───────────────────────────────────────────────────────────────

  /** List all agents, newest first, with link counts and model title. */
  async list(): Promise<AgentDto[]> {
    const result = await getDbPool().query<AgentRow>(
      `SELECT a.id, a.title, a.description, a.model_id, m.title AS model_title,
              a.enabled, a.created_at, a.updated_at,
              (SELECT COUNT(*) FROM ai_agent_kbs k WHERE k.agent_id = a.id)::int AS kb_count,
              (SELECT COUNT(*) FROM ai_agent_policies p WHERE p.agent_id = a.id)::int AS policy_count
         FROM ai_agents a
         JOIN ai_models m ON m.id = a.model_id
        ORDER BY a.created_at DESC, a.id`,
    )
    return result.rows.map((row) => this.agentToDto(row))
  }

  /** Fetch a single agent with its referenced model and linked KBs/policies. */
  async get(id: string): Promise<AgentDetailDto> {
    const base = await this.findAgent(id)
    if (!base) throw this.agentNotFound(id)
    const model = await this.findModel(base.model_id)
    if (!model) throw this.modelNotFound(base.model_id)

    const [kbs, policies] = await Promise.all([
      getDbPool().query<KbRefDto>(
        `SELECT k.id, k.title
           FROM knowledge_bases k
           JOIN ai_agent_kbs aak ON aak.kb_id = k.id
          WHERE aak.agent_id = $1
          ORDER BY k.title, k.id`,
        [id],
      ),
      getDbPool().query<PolicyRefDto>(
        `SELECT p.id, p.title, p.policy_type AS "policyType", p.enabled
           FROM ai_policies p
           JOIN ai_agent_policies aap ON aap.policy_id = p.id
          WHERE aap.agent_id = $1
          ORDER BY p.title, p.id`,
        [id],
      ),
    ])

    const kbCount = await this.kbCountForAgent(id)
    const policyCount = await this.policyCountForAgent(id)

    return {
      ...this.agentToDto({
        ...base,
        model_title: model.title,
        kb_count: kbCount,
        policy_count: policyCount,
      }),
      model: {
        id: model.id,
        title: model.title,
        providerType: model.provider_type,
        modelName: model.model_name,
      },
      kbs: kbs.rows,
      policies: policies.rows,
    }
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  /** Create an agent, optionally linking KBs and policies in the same call. */
  async create(input: CreateAgentInput): Promise<AgentDto> {
    const id = uuidv7()
    const now = new Date()
    const enabled = input.enabled ?? true

    // Validate every reference exists BEFORE writing anything, so a bad id
    // never yields a partially-applied agent or a partial link set.
    await this.assertReferencesExist(input.modelId, input.kbIds, input.policyIds)

    const result = await getDbPool().query<AgentBaseRow>(
      `INSERT INTO ai_agents
         (id, title, description, model_id, enabled, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING id, title, description, model_id, created_by, enabled, created_at, updated_at`,
      [id, input.title, input.description, input.modelId, enabled, input.actorUserId, now],
    )
    const row = result.rows[0]
    if (!row) {
      throw new HttpException(
        { statusCode: 500, error: 'AI_AGENT_CREATE_FAILED', message: 'Failed to create AI agent' },
        500,
      )
    }

    const kbAdded = await this.bulkInsert('ai_agent_kbs', 'kb_id', id, input.kbIds ?? [])
    const policyAdded = await this.bulkInsert(
      'ai_agent_policies',
      'policy_id',
      id,
      input.policyIds ?? [],
    )

    await this.recordAudit('ai_agent_created', input.actorUserId, input.ip, {
      targetId: row.id,
      title: row.title,
      modelId: row.model_id,
      enabled,
      kbsLinked: kbAdded,
      policiesLinked: policyAdded,
    })
    this.logger.log(
      `Agent created: id=${id}, model=${row.model_id}, kbs=${kbAdded}, policies=${policyAdded}, actor=${input.actorUserId}`,
    )
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      modelId: row.model_id,
      modelTitle: '',
      enabled: row.enabled,
      kbCount: kbAdded,
      policyCount: policyAdded,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * Update an agent's scalar fields and, when `kbIds`/`policyIds` are
   * provided, replace the whole link set (full-set semantics for the admin
   * multi-select form).
   */
  async update(id: string, input: UpdateAgentInput): Promise<AgentDto> {
    const existing = await this.findAgent(id)
    if (!existing) throw this.agentNotFound(id)

    const effectiveModelId = input.modelId ?? existing.model_id
    const referencesTouched =
      input.modelId !== undefined || input.kbIds !== undefined || input.policyIds !== undefined
    if (referencesTouched) {
      await this.assertReferencesExist(
        effectiveModelId,
        input.kbIds,
        input.policyIds,
      )
    }

    const fields: string[] = []
    const values: unknown[] = []
    let param = 1
    const push = (column: string, value: unknown): void => {
      fields.push(`${column} = $${param++}`)
      values.push(value)
    }

    // Before-snapshot for audit fidelity (must not be mutated by the UPDATE).
    let afterRow: AgentBaseRow = existing

    const changedFields: string[] = []
    if (input.title !== undefined) {
      if (input.title !== existing.title) changedFields.push('title')
      push('title', input.title)
    }
    if (input.description !== undefined) {
      if (input.description !== existing.description) changedFields.push('description')
      push('description', input.description)
    }
    if (input.modelId !== undefined) {
      if (input.modelId !== existing.model_id) changedFields.push('model_id')
      push('model_id', input.modelId)
    }
    if (input.enabled !== undefined) {
      if (input.enabled !== existing.enabled) changedFields.push('enabled')
      push('enabled', input.enabled)
    }

    if (fields.length > 0) {
      fields.push(`updated_at = $${param++}`)
      values.push(new Date())
      values.push(id)
      const up = await getDbPool().query<AgentBaseRow>(
        `UPDATE ai_agents SET ${fields.join(', ')}
          WHERE id = $${param}
          RETURNING id, title, description, model_id, created_by, enabled, created_at, updated_at`,
        values,
      )
      if (!up.rows[0]) throw this.agentNotFound(id)
      afterRow = up.rows[0]
    }

    // Reconcile link sets when provided (undefined = leave untouched).
    let kbChanged = false
    let policyChanged = false
    if (input.kbIds !== undefined) {
      kbChanged = await this.reconcileSet('ai_agent_kbs', 'kb_id', id, input.kbIds)
    }
    if (input.policyIds !== undefined) {
      policyChanged = await this.reconcileSet('ai_agent_policies', 'policy_id', id, input.policyIds)
    }

    const model = await this.findModel(effectiveModelId)
    const kbCount = await this.kbCountForAgent(id)
    const policyCount = await this.policyCountForAgent(id)

    // Only a real change emits ai_agent_updated (no-op PUTs are not audited),
    // matching the no-op-PUT discipline of T-09.11.03.
    if (changedFields.length > 0 || kbChanged || policyChanged) {
      await this.recordAudit('ai_agent_updated', input.actorUserId, input.ip, {
        targetId: id,
        title: afterRow.title,
        changedFields,
        ...(changedFields.includes('model_id')
          ? { modelIdBefore: existing.model_id, modelIdAfter: effectiveModelId }
          : {}),
        ...(changedFields.includes('enabled')
          ? { enabledBefore: existing.enabled, enabledAfter: afterRow.enabled }
          : {}),
        kbsChanged: kbChanged,
        policiesChanged: policyChanged,
      })
    }
    this.logger.log(
      `Agent updated: id=${id}, changed=[${changedFields.join(',')}${kbChanged ? ',kbs' : ''}${policyChanged ? ',policies' : ''}], actor=${input.actorUserId}`,
    )
    return this.agentToDto({
      id,
      title: afterRow.title,
      description: afterRow.description,
      model_id: effectiveModelId,
      model_title: model?.title ?? '',
      enabled: afterRow.enabled,
      kb_count: kbCount,
      policy_count: policyCount,
      created_at: afterRow.created_at,
      updated_at: afterRow.updated_at,
    })
  }

  /** Delete an agent (its KB/policy links cascade). */
  async remove(id: string, actorUserId: string, ip: string): Promise<void> {
    const existing = await this.findAgent(id)
    if (!existing) throw this.agentNotFound(id)

    await getDbPool().query('DELETE FROM ai_agents WHERE id = $1', [id])
    await this.recordAudit('ai_agent_deleted', actorUserId, ip, {
      targetId: existing.id,
      title: existing.title,
    })
    this.logger.log(`Agent deleted: id=${id}, actor=${actorUserId}`)
  }

  // ─── KB links ───────────────────────────────────────────────────────────

  /** Link a KB to an agent (idempotent; both records must exist). */
  async addKb(input: AddAgentKbInput): Promise<void> {
    const agent = await this.findAgent(input.agentId)
    if (!agent) throw this.agentNotFound(input.agentId)
    const kb = await this.findKb(input.kbId)
    if (!kb) throw this.kbNotFound(input.kbId)

    let inserted = false
    try {
      const res = await getDbPool().query(
        `INSERT INTO ai_agent_kbs (agent_id, kb_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id, kb_id) DO NOTHING
         RETURNING agent_id`,
        [input.agentId, input.kbId, new Date()],
      )
      inserted = (res.rowCount ?? 0) > 0
    } catch (error) {
      if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        // Race: the agent or KB was deleted between the existence check and insert.
        throw new HttpException(
          {
            statusCode: 409,
            error: 'AI_AGENT_KB_LINK_FAILED',
            message: 'Agent or knowledge base no longer exists',
          },
          409,
        )
      }
      throw error
    }
    if (inserted) {
      await this.recordAudit('ai_agent_kb_added', input.actorUserId, input.ip, {
        targetId: input.agentId,
        kbId: input.kbId,
      })
    }
    this.logger.log(
      `KB ${inserted ? 'linked to' : 'already linked to'} agent: agent=${input.agentId}, kb=${input.kbId}, actor=${input.actorUserId}`,
    )
  }

  /** Remove a KB link from an agent. */
  async removeKb(agentId: string, kbId: string, actorUserId: string, ip: string): Promise<void> {
    const agent = await this.findAgent(agentId)
    if (!agent) throw this.agentNotFound(agentId)

    const result = await getDbPool().query(
      'DELETE FROM ai_agent_kbs WHERE agent_id = $1 AND kb_id = $2',
      [agentId, kbId],
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'AI_AGENT_KB_NOT_FOUND',
          message: `Knowledge base ${kbId} is not linked to agent ${agentId}`,
        },
        404,
      )
    }
    await this.recordAudit('ai_agent_kb_removed', actorUserId, ip, {
      targetId: agentId,
      kbId,
    })
    this.logger.log(`KB unlinked from agent: agent=${agentId}, kb=${kbId}, actor=${actorUserId}`)
  }

  // ─── Policy links ───────────────────────────────────────────────────────

  /** Link a policy to an agent (idempotent; both records must exist). */
  async addPolicy(input: AddAgentPolicyInput): Promise<void> {
    const agent = await this.findAgent(input.agentId)
    if (!agent) throw this.agentNotFound(input.agentId)
    const policy = await this.findPolicy(input.policyId)
    if (!policy) throw this.policyNotFound(input.policyId)

    let inserted = false
    try {
      const res = await getDbPool().query(
        `INSERT INTO ai_agent_policies (agent_id, policy_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id, policy_id) DO NOTHING
         RETURNING agent_id`,
        [input.agentId, input.policyId, new Date()],
      )
      inserted = (res.rowCount ?? 0) > 0
    } catch (error) {
      if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'AI_AGENT_POLICY_LINK_FAILED',
            message: 'Agent or policy no longer exists',
          },
          409,
        )
      }
      throw error
    }
    if (inserted) {
      await this.recordAudit('ai_agent_policy_added', input.actorUserId, input.ip, {
        targetId: input.agentId,
        policyId: input.policyId,
      })
    }
    this.logger.log(
      `Policy ${inserted ? 'linked to' : 'already linked to'} agent: agent=${input.agentId}, policy=${input.policyId}, actor=${input.actorUserId}`,
    )
  }

  /** Remove a policy link from an agent. */
  async removePolicy(agentId: string, policyId: string, actorUserId: string, ip: string): Promise<void> {
    const agent = await this.findAgent(agentId)
    if (!agent) throw this.agentNotFound(agentId)

    const result = await getDbPool().query(
      'DELETE FROM ai_agent_policies WHERE agent_id = $1 AND policy_id = $2',
      [agentId, policyId],
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'AI_AGENT_POLICY_NOT_FOUND',
          message: `Policy ${policyId} is not linked to agent ${agentId}`,
        },
        404,
      )
    }
    await this.recordAudit('ai_agent_policy_removed', actorUserId, ip, {
      targetId: agentId,
      policyId,
    })
    this.logger.log(`Policy unlinked from agent: agent=${agentId}, policy=${policyId}, actor=${actorUserId}`)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Assert the model and every KB/policy id exists before any write. */
  private async assertReferencesExist(
    modelId: string,
    kbIds?: string[],
    policyIds?: string[],
  ): Promise<void> {
    const model = await this.findModel(modelId)
    if (!model) throw this.modelNotFound(modelId)

    for (const kbId of kbIds ?? []) {
      const kb = await this.findKb(kbId)
      if (!kb) throw this.kbNotFound(kbId)
    }
    for (const policyId of policyIds ?? []) {
      const policy = await this.findPolicy(policyId)
      if (!policy) throw this.policyNotFound(policyId)
    }
  }

  /**
   * Replace a link set (delete-then-insert) and report whether the resulting
   * membership actually changed (compared by sorted id sets), so an
   * identical reconcile never emits a misleading audit event.
   */
  private async reconcileSet(
    table: LinkTable,
    column: LinkColumn,
    agentId: string,
    ids: string[],
  ): Promise<boolean> {
    if (ids.length > MAX_LINK_IDS) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'AI_AGENT_TOO_MANY_LINKS',
          message: `An agent can reference at most ${MAX_LINK_IDS} ${column === 'kb_id' ? 'knowledge bases' : 'policies'}`,
        },
        400,
      )
    }
    const before = await this.linkIds(table, column, agentId)
    await getDbPool().query(`DELETE FROM ${table} WHERE agent_id = $1`, [agentId])
    if (ids.length > 0) {
      await this.bulkInsert(table, column, agentId, ids)
    }
    const after = await this.linkIds(table, column, agentId)
    return !this.sameSet(before, after)
  }

  /** Bulk insert of link rows; returns the number of rows actually inserted. */
  private async bulkInsert(
    table: LinkTable,
    column: LinkColumn,
    agentId: string,
    ids: string[],
  ): Promise<number> {
    if (ids.length === 0) return 0
    if (ids.length > MAX_LINK_IDS) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'AI_AGENT_TOO_MANY_LINKS',
          message: `An agent can reference at most ${MAX_LINK_IDS} ${column === 'kb_id' ? 'knowledge bases' : 'policies'}`,
        },
        400,
      )
    }
    const now = new Date()
    const values: unknown[] = []
    const rows: string[] = []
    let param = 1
    for (const refId of ids) {
      rows.push(`($${param++}, $${param++}, $${param++})`)
      values.push(agentId, refId, now)
    }
    try {
      const res = await getDbPool().query(
        `INSERT INTO ${table} (agent_id, ${column}, created_at)
         VALUES ${rows.join(', ')}
         ON CONFLICT DO NOTHING`,
        values,
      )
      return res.rowCount ?? 0
    } catch (error) {
      if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        // A referenced id was deleted between validation and insert.
        throw new HttpException(
          {
            statusCode: 409,
            error: 'AI_AGENT_LINK_FAILED',
            message: 'A referenced knowledge base or policy no longer exists',
          },
          409,
        )
      }
      throw error
    }
  }

  private async linkIds(table: LinkTable, column: LinkColumn, agentId: string): Promise<string[]> {
    const result = await getDbPool().query<{ ref: string }>(
      `SELECT ${column} AS ref FROM ${table} WHERE agent_id = $1 ORDER BY ${column}`,
      [agentId],
    )
    return result.rows.map((r) => r.ref)
  }

  private sameSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  private async findAgent(id: string): Promise<AgentBaseRow | null> {
    const result = await getDbPool().query<AgentBaseRow>(
      `SELECT id, title, description, model_id, created_by, enabled, created_at, updated_at
         FROM ai_agents
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private async findModel(id: string): Promise<AgentModelRow | null> {
    const result = await getDbPool().query<AgentModelRow>(
      `SELECT id, title, provider_type, model_name FROM ai_models WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private async findKb(id: string): Promise<{ id: string; title: string } | null> {
    const result = await getDbPool().query<{ id: string; title: string }>(
      'SELECT id, title FROM knowledge_bases WHERE id = $1',
      [id],
    )
    return result.rows[0] ?? null
  }

  private async findPolicy(id: string): Promise<{ id: string; title: string } | null> {
    const result = await getDbPool().query<{ id: string; title: string }>(
      'SELECT id, title FROM ai_policies WHERE id = $1',
      [id],
    )
    return result.rows[0] ?? null
  }

  private async kbCountForAgent(agentId: string): Promise<number> {
    const result = await getDbPool().query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM ai_agent_kbs WHERE agent_id = $1',
      [agentId],
    )
    return result.rows[0]?.count ?? 0
  }

  private async policyCountForAgent(agentId: string): Promise<number> {
    const result = await getDbPool().query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM ai_agent_policies WHERE agent_id = $1',
      [agentId],
    )
    return result.rows[0]?.count ?? 0
  }

  private agentToDto(row: AgentRow): AgentDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      modelId: row.model_id,
      modelTitle: row.model_title,
      enabled: row.enabled,
      kbCount: row.kb_count,
      policyCount: row.policy_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private agentNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_AGENT_NOT_FOUND', message: `AI agent ${id} not found` },
      404,
    )
  }

  private modelNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_MODEL_NOT_FOUND', message: `AI model ${id} not found` },
      404,
    )
  }

  private kbNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_KB_NOT_FOUND', message: `Knowledge base ${id} not found` },
      404,
    )
  }

  private policyNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_POLICY_NOT_FOUND', message: `Policy ${id} not found` },
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

/** Allowed link-table union for the typed helpers above. */
type LinkTable = 'ai_agent_kbs' | 'ai_agent_policies'
type LinkColumn = 'kb_id' | 'policy_id'