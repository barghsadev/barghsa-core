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
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Support assistant',
    description: '',
    modelId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
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
      await expect(controller.get(nonAdminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.create(nonAdminReq, { title: 'x', modelId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.update(nonAdminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { title: 'y' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.remove(nonAdminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.addKb(nonAdminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { kbId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.removeKb(nonAdminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).rejects.toMatchObject({
        status: 403,
      })
      await expect(
        controller.addPolicy(nonAdminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { policyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } as never),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.removePolicy(nonAdminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
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
        modelId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        kbIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
        policyIds: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
        enabled: false,
      } as never)
      expect(result).toMatchObject({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', enabled: false })
      expect(mockCreate).toHaveBeenCalledWith({
        title: 'Support assistant',
        description: 'Boiler answers',
        modelId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        kbIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
        policyIds: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
        enabled: false,
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('GET /api/admin/agents/:id', () => {
    it('rejects a non-UUID agent id with 400 before reaching the service', async () => {
      await expect(controller.get(adminReq, 'not-a-uuid')).rejects.toMatchObject({ status: 400 })
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('returns the agent detail', async () => {
      mockGet.mockResolvedValue(baseAgent())
      const result = await controller.get(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      expect(result).toMatchObject({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
      expect(mockGet).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    })
  })

  describe('PUT /api/admin/agents/:id', () => {
    it('rejects an empty update body', async () => {
      await expect(controller.update(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {} as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('rejects an oversized link list (>200)', async () => {
      await expect(
        controller.update(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { kbIds: new Array(201).fill('kb-x') } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('forwards only provided fields', async () => {
      mockUpdate.mockResolvedValue(baseAgent({ enabled: false }))
      const result = await controller.update(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { enabled: false } as never)
      expect(result).toMatchObject({ enabled: false })
      expect(mockUpdate).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
        enabled: false,
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('DELETE /api/admin/agents/:id', () => {
    it('deletes the agent', async () => {
      mockRemove.mockResolvedValue(undefined)
      await expect(controller.remove(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).resolves.toBeUndefined()
      expect(mockRemove).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin-1', '10.0.0.8')
    })
  })

  describe('KB links', () => {
    it('links a KB (POST /:id/kbs)', async () => {
      mockAddKb.mockResolvedValue(undefined)
      await expect(controller.addKb(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { kbId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } as never)).resolves.toBeUndefined()
      expect(mockAddKb).toHaveBeenCalledWith({
        agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        kbId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('rejects a missing kbId', async () => {
      await expect(controller.addKb(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {} as never)).rejects.toMatchObject({
        status: 400,
      })
      expect(mockAddKb).not.toHaveBeenCalled()
    })

    it('removes a KB link (DELETE /:id/kbs/:kbId)', async () => {
      mockRemoveKb.mockResolvedValue(undefined)
      await expect(controller.removeKb(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).resolves.toBeUndefined()
      expect(mockRemoveKb).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin-1', '10.0.0.8')
    })
  })

  describe('policy links', () => {
    it('links a policy (POST /:id/policies)', async () => {
      mockAddPolicy.mockResolvedValue(undefined)
      await expect(controller.addPolicy(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { policyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } as never)).resolves.toBeUndefined()
      expect(mockAddPolicy).toHaveBeenCalledWith({
        agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        policyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('removes a policy link (DELETE /:id/policies/:policyId)', async () => {
      mockRemovePolicy.mockResolvedValue(undefined)
      await expect(controller.removePolicy(adminReq, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).resolves.toBeUndefined()
      expect(mockRemovePolicy).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'admin-1', '10.0.0.8')
    })
  })
})
