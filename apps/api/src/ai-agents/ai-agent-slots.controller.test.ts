import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentSlotsController } from './ai-agent-slots.controller.js'
import type { AgentSlotsService } from './ai-agent-slots.service.js'

// ─── Mock service ─────────────────────────────────────────────────────────

const mockList = vi.fn()
const mockAssign = vi.fn()

const mockService = {
  list: mockList,
  assign: mockAssign,
} as unknown as AgentSlotsService

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '10.0.0.8',
  socket: { remoteAddress: '10.0.0.8' },
} as never

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '10.0.0.8',
} as never

const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function baseSlot(over: Record<string, unknown> = {}) {
  return {
    slotKey: 'individual_chatbot',
    label: 'Individual chatbot',
    agent: null,
    alsoUsedIn: [],
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

describe('AgentSlotsController (T-09.11.05)', () => {
  let controller: AgentSlotsController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new AgentSlotsController(mockService)
  })

  describe('permission gate (admin:ai:agents)', () => {
    it('rejects non-admin sessions on every route with 403', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.assign(nonAdminReq, 'individual_chatbot', { agentId: AGENT_ID } as never),
      ).rejects.toMatchObject({ status: 403 })
      expect(mockList).not.toHaveBeenCalled()
      expect(mockAssign).not.toHaveBeenCalled()
    })

    it('allows platform-admin sessions', async () => {
      mockList.mockResolvedValue([])
      await expect(controller.list(adminReq)).resolves.toEqual([])
    })
  })

  describe('GET /api/admin/agent-slots', () => {
    it('forwards to the service and returns the slot list', async () => {
      mockList.mockResolvedValue([baseSlot()])
      const result = await controller.list(adminReq)
      expect(result).toHaveLength(1)
      expect(mockList).toHaveBeenCalledOnce()
    })
  })

  describe('PUT /api/admin/agent-slots/:slotKey/agent', () => {
    it('rejects an unknown slot key with 400', async () => {
      await expect(
        controller.assign(adminReq, 'bogus_slot', { agentId: AGENT_ID } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockAssign).not.toHaveBeenCalled()
    })

    it('rejects a malformed agentId with 400', async () => {
      await expect(
        controller.assign(adminReq, 'individual_chatbot', { agentId: 'not-a-uuid' } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockAssign).not.toHaveBeenCalled()
    })

    it('rejects a missing body with 400', async () => {
      await expect(
        controller.assign(adminReq, 'individual_chatbot', {} as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockAssign).not.toHaveBeenCalled()
    })

    it('assigns an agent and forwards actor + ip', async () => {
      mockAssign.mockResolvedValue(baseSlot({ agent: { id: AGENT_ID, title: 'Support assistant', enabled: true } }))
      const result = await controller.assign(adminReq, 'individual_chatbot', {
        agentId: AGENT_ID,
      } as never)
      expect(result).toMatchObject({
        slotKey: 'individual_chatbot',
        agent: { id: AGENT_ID, title: 'Support assistant' },
      })
      expect(mockAssign).toHaveBeenCalledWith({
        slotKey: 'individual_chatbot',
        agentId: AGENT_ID,
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('clears the assignment when agentId is null', async () => {
      mockAssign.mockResolvedValue(baseSlot())
      await controller.assign(adminReq, 'telegram_chatbot', { agentId: null } as never)
      expect(mockAssign).toHaveBeenCalledWith({
        slotKey: 'telegram_chatbot',
        agentId: null,
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })

    it('accepts every predefined slot key', async () => {
      mockAssign.mockResolvedValue(baseSlot())
      for (const slotKey of [
        'individual_chatbot',
        'legal_entity_chatbot',
        'staff_chatbot',
        'website_chatbot',
        'telegram_chatbot',
      ]) {
        await controller.assign(adminReq, slotKey, { agentId: AGENT_ID } as never)
      }
      expect(mockAssign).toHaveBeenCalledTimes(5)
    })
  })
})