import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'

/**
 * AI agent slot assignment service (S-09.11, T-09.11.05).
 *
 * Slots are FIXED system configuration: exactly five predefined chatbot
 * surfaces — Individual, Legal Entity, Staff, Website, Telegram — each
 * mapped to at most one AI agent (ai_agents, T-09.11.04). One agent can
 * be used in several slots. The slot rows and the five keys are seeded by
 * migration 0046 and pinned by a CHECK constraint; this service only
 * reads the slot list and changes the `agent_id` mapping.
 *
 * - `list()` returns every slot with its current agent (if any) plus the
 *   `alsoUsedIn` set — other slots sharing the same agent — so the UI can
 *   render the "This agent is also used in [other slots]" warning.
 * - `assign()` maps a slot to an agent (or clears the mapping with
 *   `agentId: null`). Assignment changes are audited
 *   (`ai_agent_slot_assigned` / `ai_agent_slot_cleared`). A request that
 *   does not change the current mapping emits NO audit (no-op discipline
 *   mirroring T-09.11.03/04). Every mutation runs in ONE database
 *   transaction on a single client (BEGIN/COMMIT/ROLLBACK); a
 *   concurrent agent delete between the existence check and the UPDATE
 *   surfaces the FK violation as a 409 instead of a raw 500.
 *
 * Permission `admin:ai:agents` is enforced at the controller boundary
 * (mapped to platform admin today, per the S-09 admin convention).
 */

// ─── Public types ──────────────────────────────────────────────────────────

/** The five predefined chatbot slots (epic T-09.11.05). */
export const AGENT_SLOT_KEYS = [
  'individual_chatbot',
  'legal_entity_chatbot',
  'staff_chatbot',
  'website_chatbot',
  'telegram_chatbot',
] as const

export type AgentSlotKey = (typeof AGENT_SLOT_KEYS)[number]

/** The agent currently serving a slot, as rendered in the admin list. */
export interface AgentSlotRefDto {
  id: string
  title: string
  enabled: boolean
}

/** One slot with its current assignment and cross-slot usage warning. */
export interface AgentSlotDto {
  slotKey: AgentSlotKey
  label: string
  /** The agent serving this slot, or null when unassigned. */
  agent: AgentSlotRefDto | null
  /** Other slots that currently use the same agent (the "also used in" warning). */
  alsoUsedIn: AgentSlotKey[]
  updatedAt: string
}

export interface AssignSlotInput {
  slotKey: AgentSlotKey
  /** null clears the assignment; otherwise must be an existing agent id. */
  agentId: string | null
  actorUserId: string
  ip: string
}

// ─── Internal types ────────────────────────────────────────────────────────

/** Minimal query executor shared by the pool and a transactional client. */
type DbExecutor = { query: QueryFn }
type QueryFn = <T = DbRow>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = any

interface SlotWithAgentRow {
  slot_key: string
  label: string
  agent_id: string | null
  agent_title: string | null
  agent_enabled: boolean | null
  updated_at: string
}

const PG_FOREIGN_KEY_VIOLATION = '23503'

@Injectable()
export class AgentSlotsService {
  private readonly logger = new Logger(AgentSlotsService.name)

  // ─── Read ───────────────────────────────────────────────────────────────

  /** List all five predefined slots with their current agent assignments. */
  list(): Promise<AgentSlotDto[]> {
    return this.loadSlots(getDbPool())
  }

  // ─── Mutation ───────────────────────────────────────────────────────────

  /**
   * Assign an agent to a slot (or clear the assignment with `agentId:
   * null`). Audited when the mapping actually changes; an identical
   * request is a no-op that emits no audit. Runs in one transaction.
   */
  assign(input: AssignSlotInput): Promise<AgentSlotDto> {
    return this.withTransaction(async (q) => {
      const existing = await this.findSlot(q, input.slotKey)
      if (!existing) throw this.slotNotFound(input.slotKey)

      // Validate the referenced agent exists BEFORE writing anything.
      if (input.agentId !== null && !(await this.findAgent(q, input.agentId))) {
        throw this.agentNotFound(input.agentId)
      }

      // No-op: the requested mapping already holds — no write, no audit.
      if (existing.agent_id === input.agentId) {
        return this.assignedSlotDto(q, input.slotKey)
      }

      const now = new Date()
      try {
        await q.query(
          `UPDATE ai_agent_slots
             SET agent_id = $1, updated_by = $2, updated_at = $3
           WHERE slot_key = $4`,
          [input.agentId, input.actorUserId, now, input.slotKey],
        )
      } catch (error) {
        if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
          // Race: the agent was deleted between the existence check and the
          // UPDATE. Surface a 409 instead of a raw 500.
          throw new HttpException(
            {
              statusCode: 409,
              error: 'AI_AGENT_SLOT_ASSIGN_FAILED',
              message: 'The agent no longer exists',
            },
            409,
          )
        }
        throw error
      }

      const event =
        input.agentId === null ? 'ai_agent_slot_cleared' : 'ai_agent_slot_assigned'
      await this.recordAudit(q, event, input.actorUserId, input.ip, {
        slotKey: input.slotKey,
        label: existing.label,
        agentIdBefore: existing.agent_id,
        agentIdAfter: input.agentId,
      })
      this.logger.log(
        `Slot ${event}: slot=${input.slotKey}, agent=${input.agentId ?? '(none)'}, actor=${input.actorUserId}`,
      )

      return this.assignedSlotDto(q, input.slotKey)
    })
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  /** Load every slot row with agent refs and build the DTO list. */
  private async loadSlots(q: DbExecutor): Promise<AgentSlotDto[]> {
    const [slots, assignments] = await Promise.all([
      q.query<SlotWithAgentRow>(
        `SELECT s.slot_key, s.label, s.agent_id, s.updated_at,
                a.title AS agent_title, a.enabled AS agent_enabled
           FROM ai_agent_slots s
           LEFT JOIN ai_agents a ON a.id = s.agent_id
          ORDER BY s.slot_key`,
      ),
      q.query<{ slot_key: string; agent_id: string }>(
        `SELECT slot_key, agent_id
           FROM ai_agent_slots
          WHERE agent_id IS NOT NULL`,
      ),
    ])

    // agent_id -> the other slot keys using the same agent.
    const usage = new Map<string, AgentSlotKey[]>()
    for (const row of assignments.rows) {
      const list = usage.get(row.agent_id) ?? []
      list.push(row.slot_key as AgentSlotKey)
      usage.set(row.agent_id, list)
    }

    return slots.rows.map((row) => this.toSlotDto(row, usage))
  }

  /** Load the single slot's post-mutation DTO (throws when missing). */
  private async assignedSlotDto(q: DbExecutor, slotKey: string): Promise<AgentSlotDto> {
    const slots = await this.loadSlots(q)
    const slot = slots.find((s) => s.slotKey === slotKey)
    if (!slot) throw this.slotNotFound(slotKey)
    return slot
  }

  private toSlotDto(
    row: SlotWithAgentRow,
    usage: Map<string, AgentSlotKey[]>,
  ): AgentSlotDto {
    const agentId = row.agent_id
    return {
      slotKey: row.slot_key as AgentSlotKey,
      label: row.label,
      agent:
        agentId !== null
          ? {
              id: agentId,
              title: row.agent_title ?? '',
              enabled: row.agent_enabled ?? false,
            }
          : null,
      alsoUsedIn:
        agentId !== null
          ? (usage.get(agentId) ?? []).filter((k) => k !== row.slot_key)
          : [],
      updatedAt: row.updated_at,
    }
  }

  // ─── Transaction helper ─────────────────────────────────────────────────

  /** Run `fn` inside a single DB transaction on one client; any error rolls back. */
  private async withTransaction<T>(fn: (q: DbExecutor) => Promise<T>): Promise<T> {
    const client = await getDbPool().connect()
    let committed = false
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      committed = true
      return result
    } catch (error) {
      if (committed) throw error
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  // ─── Lookups / errors ───────────────────────────────────────────────────

  private async findSlot(q: DbExecutor, slotKey: string): Promise<SlotWithAgentRow | null> {
    const result = await q.query<SlotWithAgentRow>(
      `SELECT slot_key, label, agent_id, updated_at,
              NULL::text AS agent_title, NULL::boolean AS agent_enabled
         FROM ai_agent_slots
        WHERE slot_key = $1
        FOR UPDATE`,
      [slotKey],
    )
    return result.rows[0] ?? null
  }

  private async findAgent(
    q: DbExecutor,
    id: string,
  ): Promise<{ id: string; title: string; enabled: boolean } | null> {
    const result = await q.query<{ id: string; title: string; enabled: boolean }>(
      'SELECT id, title, enabled FROM ai_agents WHERE id = $1',
      [id],
    )
    return result.rows[0] ?? null
  }

  private slotNotFound(slotKey: string): HttpException {
    return new HttpException(
      {
        statusCode: 404,
        error: 'AI_AGENT_SLOT_NOT_FOUND',
        message: `AI agent slot ${slotKey} not found`,
      },
      404,
    )
  }

  private agentNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_AGENT_NOT_FOUND', message: `AI agent ${id} not found` },
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
    q: DbExecutor,
    event: string,
    actorUserId: string,
    ip: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const auditId = uuidv7()
    await q.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [auditId, actorUserId, event, JSON.stringify(meta), uuidv7(), ip, new Date()],
    )
  }
}
