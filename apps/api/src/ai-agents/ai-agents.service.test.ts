import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AiAgentsService as ServiceType } from './ai-agents.service.js'

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

function modelRow(over: Record<string, unknown> = {}) {
  return {
    id: 'model-1',
    title: 'gpt-4o',
    provider_type: 'openai_compatible',
    model_name: 'gpt-4o',
    ...over,
  }
}

function kbRow(over: Record<string, unknown> = {}) {
  return { id: 'kb-1', title: 'Product docs', ...over }
}

function policyRow(over: Record<string, unknown> = {}) {
  return { id: 'pol-1', title: 'No financial advice', ...over }
}

function agentBaseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    title: 'Support assistant',
    description: '',
    model_id: 'model-1',
    created_by: 'user-admin-1',
    enabled: true,
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

const ACTOR = 'user-admin-1'

/** Load AiAgentsService with a mocked @barghsa/db pool. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { AiAgentsService: Svc } = await import('./ai-agents.service.js')
  return new Svc() as ServiceType
}

let service: ServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('AiAgentsService (T-09.11.04)', () => {
  describe('list', () => {
    it('returns agents with link counts and model title', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'agent-1',
            title: 'Support assistant',
            description: '',
            model_id: 'model-1',
            model_title: 'gpt-4o',
            enabled: true,
            kb_count: 2,
            policy_count: 1,
            created_at: '2026-08-28T00:00:00.000Z',
            updated_at: '2026-08-28T00:00:00.000Z',
          },
        ],
      })
      const result = await service.list()
      expect(result[0]).toMatchObject({
        id: 'agent-1',
        modelId: 'model-1',
        modelTitle: 'gpt-4o',
        enabled: true,
        kbCount: 2,
        policyCount: 1,
      })
      expect(String(mockQuery.mock.calls[0]![0])).toContain('FROM ai_agents')
    })
  })

  describe('get', () => {
    it('throws 404 when the agent does not exist', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery.mockResolvedValueOnce({ rows: [] }) // findAgent
      await expect(service.get('missing')).rejects.toMatchObject({
        status: 404,
        response: { error: 'AI_AGENT_NOT_FOUND' },
      })
    })

    it('throws 404 when the referenced model does not exist', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [] }) // findModel
      await expect(service.get('agent-1')).rejects.toMatchObject({
        status: 404,
        response: { error: 'AI_MODEL_NOT_FOUND' },
      })
    })

    it('returns the agent with its model, KBs, and policies', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [modelRow()] }) // findModel
        .mockResolvedValueOnce({ rows: [{ id: 'kb-1', title: 'Product docs' }] }) // kbs
        .mockResolvedValueOnce({
          rows: [{ id: 'pol-1', title: 'No financial advice', policyType: 'disallowed_actions', enabled: true }],
        }) // policies
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // kb count
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // policy count
      const result = await service.get('agent-1')
      expect(result).toMatchObject({ id: 'agent-1', kbCount: 1, policyCount: 1 })
      expect(result.model).toMatchObject({ id: 'model-1', providerType: 'openai_compatible' })
      expect(result.kbs).toEqual([{ id: 'kb-1', title: 'Product docs' }])
      expect(result.policies[0]).toMatchObject({ policyType: 'disallowed_actions' })
    })
  })

  describe('create', () => {
    it('creates an agent with links and records an audit event', async () => {
      const { mockQuery, pool, client } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [modelRow()] }) // findModel
        .mockResolvedValueOnce({ rows: [kbRow()] }) // findKb
        .mockResolvedValueOnce({ rows: [policyRow()] }) // findPolicy
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // insert agent
        .mockResolvedValueOnce({ rowCount: 1 }) // bulkInsert kbs
        .mockResolvedValueOnce({ rowCount: 1 }) // bulkInsert policies
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.create({
        title: 'Support assistant',
        description: '',
        modelId: 'model-1',
        kbIds: ['kb-1'],
        policyIds: ['pol-1'],
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ id: 'agent-1', enabled: true, kbCount: 1, policyCount: 1 })
      expect(result.modelTitle).toBe('gpt-4o')
      expect(String(mockQuery.mock.calls[0]![0])).toBe('BEGIN')
      const agentSql = String(mockQuery.mock.calls[4]![0])
      expect(agentSql).toContain('INSERT INTO ai_agents')
      const kbSql = String(mockQuery.mock.calls[5]![0])
      expect(kbSql).toContain('INSERT INTO ai_agent_kbs')
      expect(mockQuery.mock.calls[5]![1]).toContain('kb-1')
      const auditSql = String(mockQuery.mock.calls[7]![0])
      expect(auditSql).toContain('INSERT INTO audit_log')
      expect(mockQuery.mock.calls[7]![1]).toContain('ai_agent_created')
      expect(String(mockQuery.mock.calls[8]![0])).toBe('COMMIT')
      expect(client.release).toHaveBeenCalled()
    })

    it('creates a disabled agent when enabled:false is supplied', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [modelRow()] }) // findModel
        .mockResolvedValueOnce({ rows: [agentBaseRow({ enabled: false })] }) // insert
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
      const result = await service.create({
        title: 'Draft agent',
        description: '',
        modelId: 'model-1',
        enabled: false,
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })
      expect(result).toMatchObject({ enabled: false, kbCount: 0, policyCount: 0 })
    })

    it('throws 404 when the model does not exist (before any write)', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // findModel
      await expect(
        service.create({ title: 'x', description: '', modelId: 'missing', actorUserId: ACTOR, ip: '1.2.3.4' }),
      ).rejects.toMatchObject({ status: 404, response: { error: 'AI_MODEL_NOT_FOUND' } })
      const writes = mockQuery.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO ai_agents'))
      expect(writes).toHaveLength(0)
    })

    it('throws 404 when a KB id does not exist', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [modelRow()] }) // findModel
        .mockResolvedValueOnce({ rows: [] }) // findKb
      await expect(
        service.create({ title: 'x', description: '', modelId: 'model-1', kbIds: ['missing'], actorUserId: ACTOR, ip: '1.2.3.4' }),
      ).rejects.toMatchObject({ status: 404, response: { error: 'AI_KB_NOT_FOUND' } })
    })

    it('maps an FK race on the agent insert to a 409 (rolls back)', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [modelRow()] }) // findModel
        .mockRejectedValueOnce({ code: '23503' }) // insert agent → FK violation
      await expect(
        service.create({ title: 'x', description: '', modelId: 'model-1', actorUserId: ACTOR, ip: '1.2.3.4' }),
      ).rejects.toMatchObject({ status: 409, response: { error: 'AI_AGENT_MODEL_MISSING' } })
    })
  })

  describe('update', () => {
    it('throws 404 for a missing agent', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // findAgent
      await expect(
        service.update('missing', { title: 'x', actorUserId: ACTOR, ip: '1.2.3.4' }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('updates the enabled flag without touching references', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [modelRow()] }) // findModel (dto)
        .mockResolvedValueOnce({ rows: [agentBaseRow({ enabled: false })] }) // UPDATE
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // kb count
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // policy count
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.update('agent-1', { enabled: false, actorUserId: ACTOR, ip: '1.2.3.4' })
      expect(result).toMatchObject({ enabled: false })
      const audit = String(mockQuery.mock.calls[6]![1])
      expect(audit).toContain('ai_agent_updated')
      expect(audit).toContain('"enabledBefore":true')
      expect(audit).toContain('"enabledAfter":false')
    })

    it('reconciles a KB link set, bumps updated_at, and records the change', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [modelRow()] }) // findModel (requireModel)
        .mockResolvedValueOnce({ rows: [kbRow()] }) // findKb (requireKbs)
        .mockResolvedValueOnce({ rows: [{ ref: 'kb-old' }] }) // reconcile before
        .mockResolvedValueOnce({ rows: [] }) // DELETE
        .mockResolvedValueOnce({ rowCount: 1 }) // bulkInsert
        .mockResolvedValueOnce({ rows: [{ ref: 'kb-1' }] }) // reconcile after
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // bump updated_at
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // kb count
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // policy count
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.update('agent-1', { kbIds: ['kb-1'], actorUserId: ACTOR, ip: '1.2.3.4' })
      expect(result.kbCount).toBe(1)
      const audits = mockQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO audit_log'),
      )
      expect(audits).toHaveLength(1)
      expect(String(audits[0]![1])).toContain('ai_agent_updated')
      expect(String(audits[0]![1])).toContain('"kbsChanged":true')
    })

    it('emits no audit when the reconcile does not change the link set', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [modelRow()] }) // findModel (requireModel)
        .mockResolvedValueOnce({ rows: [kbRow()] }) // findKb (requireKbs)
        .mockResolvedValueOnce({ rows: [{ ref: 'kb-1' }] }) // reconcile before
        .mockResolvedValueOnce({ rows: [] }) // DELETE
        .mockResolvedValueOnce({ rowCount: 1 }) // bulkInsert
        .mockResolvedValueOnce({ rows: [{ ref: 'kb-1' }] }) // reconcile after (same)
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // kb count
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // policy count
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      await service.update('agent-1', { kbIds: ['kb-1'], actorUserId: ACTOR, ip: '1.2.3.4' })
      const audits = mockQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO audit_log'),
      )
      expect(audits).toHaveLength(0)
    })
  })

  describe('remove', () => {
    it('throws 404 for a missing agent', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // findAgent
      await expect(service.remove('missing', ACTOR, '1.2.3.4')).rejects.toMatchObject({ status: 404 })
    })

    it('deletes the agent and records the audit event', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [] }) // DELETE
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
      await service.remove('agent-1', ACTOR, '1.2.3.4')
      expect(String(mockQuery.mock.calls[2]![0])).toContain('DELETE FROM ai_agents')
      expect(mockQuery.mock.calls[3]![1]).toContain('ai_agent_deleted')
    })
  })

  describe('KB links', () => {
    it('links a KB (idempotent) and records the audit only on a real link', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [kbRow()] }) // findKb
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ agent_id: 'agent-1' }] }) // insert
        .mockResolvedValueOnce({ rows: [] }) // audit
      await service.addKb({ agentId: 'agent-1', kbId: 'kb-1', actorUserId: ACTOR, ip: '1.2.3.4' })
      const insertSql = String(mockQuery.mock.calls[2]![0])
      expect(insertSql).toContain('INSERT INTO ai_agent_kbs')
      expect(insertSql).toContain('ON CONFLICT (agent_id, kb_id) DO NOTHING')
      const auditCalls = mockQuery.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO audit_log'))
      expect(auditCalls).toHaveLength(1)
      expect(auditCalls[0]![1]).toContain('ai_agent_kb_added')
    })

    it('is idempotent: a no-op re-link emits no audit', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [kbRow()] }) // findKb
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // insert → conflict
      await service.addKb({ agentId: 'agent-1', kbId: 'kb-1', actorUserId: ACTOR, ip: '1.2.3.4' })
      const auditCalls = mockQuery.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO audit_log'))
      expect(auditCalls).toHaveLength(0)
    })

    it('throws 404 when the KB does not exist', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [] }) // findKb
      await expect(service.addKb({ agentId: 'agent-1', kbId: 'missing', actorUserId: ACTOR, ip: '1.2.3.4' }))
        .rejects.toMatchObject({ status: 404, response: { error: 'AI_KB_NOT_FOUND' } })
    })

    it('removes a KB link, asserting a real link change', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rowCount: 1 }) // DELETE
        .mockResolvedValueOnce({ rows: [] }) // audit
      await expect(service.removeKb('agent-1', 'kb-1', ACTOR, '1.2.3.4')).resolves.toBeUndefined()
      expect(mockQuery.mock.calls[2]![1]).toContain('ai_agent_kb_removed')
    })

    it('throws 404 when removing a KB that is not linked', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rowCount: 0 }) // DELETE → no row
      await expect(service.removeKb('agent-1', 'kb-1', ACTOR, '1.2.3.4')).rejects.toMatchObject({
        status: 404,
        response: { error: 'AI_AGENT_KB_NOT_FOUND' },
      })
    })
  })

  describe('policy links', () => {
    it('links a policy and records the audit', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [policyRow()] }) // findPolicy
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ agent_id: 'agent-1' }] }) // insert
        .mockResolvedValueOnce({ rows: [] }) // audit
      await service.addPolicy({ agentId: 'agent-1', policyId: 'pol-1', actorUserId: ACTOR, ip: '1.2.3.4' })
      expect(String(mockQuery.mock.calls[2]![0])).toContain('INSERT INTO ai_agent_policies')
      const auditCalls = mockQuery.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO audit_log'))
      expect(auditCalls).toHaveLength(1)
      expect(auditCalls[0]![1]).toContain('ai_agent_policy_added')
    })

    it('removes a policy link', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rowCount: 1 }) // DELETE
        .mockResolvedValueOnce({ rows: [] }) // audit
      await service.removePolicy('agent-1', 'pol-1', ACTOR, '1.2.3.4')
      expect(mockQuery.mock.calls[2]![1]).toContain('ai_agent_policy_removed')
    })

    it('throws 404 when the policy does not exist on link', async () => {
      const { mockQuery, pool } = mockPool()
      service = await loadService(pool)
      mockQuery
        .mockResolvedValueOnce({ rows: [agentBaseRow()] }) // findAgent
        .mockResolvedValueOnce({ rows: [] }) // findPolicy
      await expect(service.addPolicy({ agentId: 'agent-1', policyId: 'missing', actorUserId: ACTOR, ip: '1.2.3.4' }))
        .rejects.toMatchObject({ status: 404, response: { error: 'AI_POLICY_NOT_FOUND' } })
    })
  })
})
