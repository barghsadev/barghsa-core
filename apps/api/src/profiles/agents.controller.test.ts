import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentsController } from './agents.controller.js'

const mockAgentsService = {
  isOwnerOrManager: vi.fn(),
  listAgents: vi.fn(),
  withdrawInvitation: vi.fn(),
}

describe('AgentsController', () => {
  let controller: AgentsController

  beforeEach(() => {
    controller = new AgentsController(mockAgentsService as any)
    vi.clearAllMocks()
  })

  describe('listAgents', () => {
    it('returns agent list for authorized user', async () => {
      mockAgentsService.isOwnerOrManager.mockResolvedValue(true)
      mockAgentsService.listAgents.mockResolvedValue({
        profileId: 'prof-1',
        agents: [
          { id: 'agent-1', type: 'agent', userId: 'user-a', name: 'Alice', username: 'alice@test.com', role: 'Manager', status: 'Active', joinedAt: '2026-08-01T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' },
        ],
      })

      const req = { session: { userId: 'user-1' } } as any
      const result = await controller.listAgents('prof-1', req)

      expect(result.agents).toHaveLength(1)
      expect(mockAgentsService.isOwnerOrManager).toHaveBeenCalledWith('user-1', 'prof-1')
    })

    it('throws 403 when user is not owner or manager', async () => {
      mockAgentsService.isOwnerOrManager.mockResolvedValue(false)

      const req = { session: { userId: 'user-2' } } as any
      await expect(controller.listAgents('prof-1', req))
        .rejects.toMatchObject({ response: { statusCode: 403 } })
    })
  })

  describe('withdrawInvitation', () => {
    it('withdraws invitation and returns success message', async () => {
      mockAgentsService.withdrawInvitation.mockResolvedValue(undefined)

      const req = { session: { userId: 'user-1' } } as any
      const result = await controller.withdrawInvitation('prof-1', 'inv-1', req)

      expect(result).toEqual({ message: 'Invitation withdrawn successfully.' })
      expect(mockAgentsService.withdrawInvitation).toHaveBeenCalledWith('prof-1', 'inv-1', 'user-1')
    })
  })
})