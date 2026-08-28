import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentsController } from './ai-agents.controller.js'
import type { AiAgentsService } from './ai-agents.service.js'

// ─── Mock service ─────────────────────────────────────────────────────────

const mockList = vi.fn()
const mockGet = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockRemove = vi.fn()
const mockAddKb = vi.fn()
const mockRemoveKb = vi.fn()
const mockAddPolicy = vi.fn()
const mockRemovePolicy = vi.fn()

const mockService = {
  list: mockList,
  get: mockGet,
  create: mockCreate,
  update: mockUpdate,
  remove: mockRemove,
  addKb: mockAddKb,
  removeKb: mockRemoveKb,
  addPolicy: mockAddPolicy,
  removePolicy: mockRemovePolicy,
} as unknown as AiAgentsService

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '10.0.0.8',
  socket: { remoteAddress: '10.0.0.8' },
} as never

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '10.0.0.8',
} as never

function baseAgent(over: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    title: 'Support assistant',
    description: '',
    modelId: 'model-1',
    modelTitle: 'gpt-4o',
    enabled: true,
    kbCount: 0,
    policyCount: 0,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

describe('AgentsController (T-09.11.04)', () => {
  let controller: AgentsController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new AgentsController(mockService)
  })

  describe('permission gate (admin:ai:agents)', () => {
    it('rejects non-admin sessions on every route with 403', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({ status: 403 })
      await expect(controller.get(nonAdminReq, 'agent-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.create(nonAdminReq, { title: 'x', modelId: 'model-1' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.update(nonAdminReq, 'agent-1', { title: 'y' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.remove(nonAdminReq, 'agent-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.addKb(nonAdminReq, 'agent-1', { kbId: 'kb-1' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.removeKb(nonAdminReq, 'agent-1', 'kb-1')).rejects.toMatchObject({
        status: 403,
      })
      await expect(
        controller.addPolicy(nonAdminReq, 'agent-1', { policyId: 'pol-1' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.removePolicy(nonAdminReq, 'agent-1', 'pol-1'),
      ).rejects.toMatchObject({ status: 403 })
      expect(mockList).not.toHaveBeenCalled()
      expect(mockCreate).not.toHaveBeenCalled()
      expect(mockAddKb).not.toHaveBeenCalled()
    })

    it('allows platform-admin sessions', async () => {
      mockList.mockResolvedValue([])
      await expect(controller.list(adminReq)).resolves.toEqual([])
    })
  })

  describe('POST /api/admin/agents', () => {
    it('rejects a missing modelId', async () => {
      await expect(controller.create(adminReq, { title: 'x' } as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('creates an agent and forwards kbIds/policyIds/enabled', async () => {
      mockCreate.mockResolvedValue(baseAgent({ enabled: false }))
      const result = await controller.create(adminReq, {
        title: 'Support assistant',
        description: 'Boiler answers',
        modelId: 'model-1',
        kbIds: ['kb-1'],
        policyIds: ['pol-1'],
        enabled: false,
      } as never)
      expect(result).toMatchObject({ id: 'agent-1', enabled: false })
      expect(mockCreate).toHaveBeenCalledWith({
        title: 'Support assistant',
        description: 'Boiler answers',
        modelId: 'model-1',
        kbIds: ['kb-1'],
        policyIds: ['pol-1'],
        enabled: false,
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('PUT /api/admin/agents/:id', () => {
    it('rejects an empty update body', async () => {
      await expect(controller.update(adminReq, 'agent-1', {} as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('rejects an oversized link list (>200)', async () => {
      await expect(
        controller.update(adminReq, 'agent-1', { kbIds: new Array(201).fill('kb-x') } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('forwards only provided fields', async () => {
      mockUpdate.mockResolvedValue(baseAgent({ enabled: false }))
      const result = await controller.update(adminReq, 'agent-1', { enabled: false } as never)
      expect(result).toMatchObject({ enabled: false })
      expect(mockUpdate).toHaveBeenCalledWith('agent-1', {
        enabled: false,
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('DELETE /api/admin/agents/:id', () => {
    it('deletes the agent', async () => {
      mockRemove.mockResolvedValue(undefined)
      await expect(controller.remove(adminReq, 'agent-1')).resolves.toBeUndefined()
      expect(mockRemove).toHaveBeenCalledWith('agent-1', 'admin-1', '10.0.0.8')
    })
  })

  describe('KB links', () => {
    it('links a KB (POST /:id/kbs)', async () => {
      mockAddKb.mockResolvedValue(undefined)
      await expect(controller.addKb(adminReq, 'agent-1', { kbId: 'kb-1' } as never)).resolves.toBeUndefined()
      expect(mockAddKb).toHaveBeenCalledWith({
        agentId: 'agent-1',
        kbId: 'kb-1',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('rejects a missing kbId', async () => {
      await expect(controller.addKb(adminReq, 'agent-1', {} as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(mockAddKb).not.toHaveBeenCalled()
    })

    it('removes a KB link (DELETE /:id/kbs/:kbId)', async () => {
      mockRemoveKb.mockResolvedValue(undefined)
      await expect(controller.removeKb(adminReq, 'agent-1', 'kb-1')).resolves.toBeUndefined()
      expect(mockRemoveKb).toHaveBeenCalledWith('agent-1', 'kb-1', 'admin-1', '10.0.0.8')
    })
  })

  describe('policy links', () => {
    it('links a policy (POST /:id/policies)', async () => {
      mockAddPolicy.mockResolvedValue(undefined)
      await expect(controller.addPolicy(adminReq, 'agent-1', { policyId: 'pol-1' } as never)).resolves.toBeUndefined()
      expect(mockAddPolicy).toHaveBeenCalledWith({
        agentId: 'agent-1',
        policyId: 'pol-1',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('removes a policy link (DELETE /:id/policies/:policyId)', async () => {
      mockRemovePolicy.mockResolvedValue(undefined)
      await expect(controller.removePolicy(adminReq, 'agent-1', 'pol-1')).resolves.toBeUndefined()
      expect(mockRemovePolicy).toHaveBeenCalledWith('agent-1', 'pol-1', 'admin-1', '10.0.0.8')
    })
  })
})