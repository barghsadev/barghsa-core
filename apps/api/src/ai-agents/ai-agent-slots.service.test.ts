import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentSlotsService as ServiceType } from './ai-agent-slots.service.js'

/** Mocked pool: pool.query and a transactional client share one mock fn. */
function mockPool() {
  const mockQuery = vi.fn()
  // Default: any un-queued call resolves to an empty result (covers ROLLBACK
  // after an early-throw path). mockResolvedValueOnce entries take precedence.
  mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }))
  const client = { query: mockQuery, release: vi.fn() }
  const pool = { query: mockQuery, connect: async () => client }
  return { mockQuery, pool, client }
}

function slotRow(over: Record<string, unknown> = {}) {
  return {
    slot_key: 'individual_chatbot',
    label: 'Individual chatbot',
    agent_id: null,
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function agentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Support assistant',
    enabled: true,
    ...over,
  }
}

/** Two-row loadSlots response: slots joined rows + usage mapping rows. */
function slotsResult(
  rows: Array<Record<string, unknown>>,
  usage: Array<Record<string, unknown>> = [],
) {
  return [rows, usage]
}

const ACTOR = 'user-admin-1'
const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** Load AgentSlotsService with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { AgentSlotsService: Svc } = await import('./ai-agent-slots.service.js')
  return new Svc() as ServiceType
}

let service: ServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('AgentSlotsService (T-09.11.05)', () => {
  describe('list', () => {
    it('returns every slot with its agent and the also-used-in warning', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      const [slots, usage] = slotsResult(
        [
          {
            slot_key: 'individual_chatbot',
            label: 'Individual chatbot',
            agent_id: AGENT_ID,
            agent_title: 'Support assistant',
            agent_enabled: true,
            updated_at: '2026-08-28T00:00:00.000Z',
          },
          {
            slot_key: 'website_chatbot',
            label: 'Website chatbot',
            agent_id: AGENT_ID,
            agent_title: 'Support assistant',
            agent_enabled: true,
            updated_at: '2026-08-28T00:00:00.000Z',
          },
          {
            slot_key: 'telegram_chatbot',
            label: 'Telegram chatbot',
            agent_id: null,
            agent_title: null,
            agent_enabled: null,
            updated_at: '2026-08-28T00:00:00.000Z',
          },
        ],
        [
          { slot_key: 'individual_chatbot', agent_id: AGENT_ID },
          { slot_key: 'website_chatbot', agent_id: AGENT_ID },
        ],
      )
      mockQuery
        .mockResolvedValueOnce({ rows: slots })
        .mockResolvedValueOnce({ rows: usage })

      const result = await service.list()

      expect(result).toHaveLength(3)
      expect(result[0]!).toMatchObject({
        slotKey: 'individual_chatbot',
        label: 'Individual chatbot',
        agent: { id: AGENT_ID, title: 'Support assistant', enabled: true },
        alsoUsedIn: ['website_chatbot'],
      })
      expect(result[1]!.alsoUsedIn).toEqual(['individual_chatbot'])
      expect(result[2]!.agent).toBeNull()
      expect(result[2]!.alsoUsedIn).toEqual([])
      expect(String(mockQuery.mock.calls[0]![0])).toContain('FROM ai_agent_slots')
    })
  })

  describe('assign', () => {
    it('assigns an agent to a slot inside one transaction and audits the change', async () => {
      const { mockQuery, pool, client } = mockPool()
      service = await loadService(pool)
      const [slots, usage] = slotsResult([
        {
          slot_key: 'individual_chatbot',
          label: 'Individual chatbot',
          agent_id: AGENT_ID,
          agent_title: 'Support assistant',
          agent_enabled: true,
          updated_at: '2026-08-28T00:00:00.000Z',
        },
      ])
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [slotRow()] }) // findSlot
        .mockResolvedValueOnce({ rows: [agentRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [slotRow({ agent_id: AGENT_ID })] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }) // audit INSERT
        .mockResolvedValueOnce({ rows: slots }) // loadSlots: joined rows
        .mockResolvedValueOnce({ rows: usage }) // loadSlots: usage rows
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.assign({
        slotKey: 'individual_chatbot',
        agentId: AGENT_ID,
        actorUserId: ACTOR,
        ip: '10.0.0.8',
      })

      expect(result).toMatchObject({
        slotKey: 'individual_chatbot',
        agent: { id: AGENT_ID, title: 'Support assistant', enabled: true },
        alsoUsedIn: [],
      })
      // Transaction opened, mutation committed, client released.
      const sqlCalls = mockQuery.mock.calls.map((c) => String(c[0]))
      expect(sqlCalls[0]).toBe('BEGIN')
      expect(sqlCalls.some((s) => s.includes('UPDATE ai_agent_slots'))).toBe(true)
      expect(sqlCalls.some((s) => s.includes('INSERT INTO audit_log'))).toBe(true)
      expect(sqlCalls.some((s) => s.includes('COMMIT'))).toBe(true)
      // Same client drove the whole transaction.
      expect(client.release).toHaveBeenCalledOnce()
    })

    it('clears an assignment with agentId null and audits the clear', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      const [slots, usage] = slotsResult([
        {
          slot_key: 'telegram_chatbot',
          label: 'Telegram chatbot',
          agent_id: null,
          agent_title: null,
          agent_enabled: null,
          updated_at: '2026-08-28T00:00:00.000Z',
        },
      ])
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [slotRow({ agent_id: AGENT_ID })] }) // findSlot
        // No findAgent call: clearing does not reference an agent.
        .mockResolvedValueOnce({ rows: [slotRow({ agent_id: null })] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }) // audit INSERT (clear event)
        .mockResolvedValueOnce({ rows: slots })
        .mockResolvedValueOnce({ rows: usage })
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.assign({
        slotKey: 'telegram_chatbot',
        agentId: null,
        actorUserId: ACTOR,
        ip: '10.0.0.8',
      })

      expect(result.agent).toBeNull()
      const auditCall = mockQuery.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO audit_log'),
      )
      expect(auditCall).toBeDefined()
      // Params: [id, user_id, event, metadata, correlation_id, ip, created_at]
      expect(String(auditCall![1]![2])).toBe('ai_agent_slot_cleared')
      expect(JSON.parse(String(auditCall![1]![3]))).toMatchObject({
        slotKey: 'telegram_chatbot',
        agentIdBefore: AGENT_ID,
        agentIdAfter: null,
      })
    })

    it('is a no-op (no UPDATE, no audit) when the mapping is unchanged', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      const [slots, usage] = slotsResult([
        {
          slot_key: 'individual_chatbot',
          label: 'Individual chatbot',
          agent_id: AGENT_ID,
          agent_title: 'Support assistant',
          agent_enabled: true,
          updated_at: '2026-08-28T00:00:00.000Z',
        },
      ])
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [slotRow({ agent_id: AGENT_ID })] }) // findSlot
        .mockResolvedValueOnce({ rows: [agentRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: slots }) // loadSlots: joined rows
        .mockResolvedValueOnce({ rows: usage }) // loadSlots: usage rows
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.assign({
        slotKey: 'individual_chatbot',
        agentId: AGENT_ID,
        actorUserId: ACTOR,
        ip: '10.0.0.8',
      })

      expect(result.agent?.id).toBe(AGENT_ID)
      const sqlCalls = mockQuery.mock.calls.map((c) => String(c[0]))
      expect(sqlCalls.some((s) => s.includes('UPDATE ai_agent_slots'))).toBe(false)
      expect(sqlCalls.some((s) => s.includes('INSERT INTO audit_log'))).toBe(false)
    })

    it('throws 404 when the slot does not exist', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // findSlot
      await expect(
        service.assign({
          slotKey: 'website_chatbot',
          agentId: AGENT_ID,
          actorUserId: ACTOR,
          ip: '10.0.0.8',
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: { error: 'AI_AGENT_SLOT_NOT_FOUND' },
      })
    })

    it('throws 404 when the agent does not exist', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [slotRow()] }) // findSlot
        .mockResolvedValueOnce({ rows: [] }) // findAgent
      await expect(
        service.assign({
          slotKey: 'individual_chatbot',
          agentId: AGENT_ID,
          actorUserId: ACTOR,
          ip: '10.0.0.8',
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: { error: 'AI_AGENT_NOT_FOUND' },
      })
    })

    it('surfaces an agent delete race as 409', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      const fkViolation = Object.assign(new Error('FK violation'), { code: '23503' })
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [slotRow()] }) // findSlot
        .mockResolvedValueOnce({ rows: [agentRow()] }) // findAgent
        .mockRejectedValueOnce(fkViolation) // UPDATE -> 23503

      await expect(
        service.assign({
          slotKey: 'individual_chatbot',
          agentId: AGENT_ID,
          actorUserId: ACTOR,
          ip: '10.0.0.8',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'AI_AGENT_SLOT_ASSIGN_FAILED' },
      })
      // The failed transaction is rolled back.
      const sqlCalls = mockQuery.mock.calls.map((c) => String(c[0]))
      expect(sqlCalls.some((s) => s.includes('ROLLBACK'))).toBe(true)
    })

    it('rolls back the transaction when a lookup inside it fails', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [slotRow()] }) // findSlot
        .mockRejectedValueOnce(new Error('db down')) // findAgent

      await expect(
        service.assign({
          slotKey: 'individual_chatbot',
          agentId: AGENT_ID,
          actorUserId: ACTOR,
          ip: '10.0.0.8',
        }),
      ).rejects.toThrow('db down')
      const sqlCalls = mockQuery.mock.calls.map((c) => String(c[0]))
      expect(sqlCalls[0]).toBe('BEGIN')
      expect(sqlCalls.some((s) => s.includes('ROLLBACK'))).toBe(true)
    })
  })
})
