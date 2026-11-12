import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { AgentsController } from './agents.controller.js';

const mockAgentsService = {
  listAgents: vi.fn(),
  withdrawInvitation: vi.fn(),
};

describe('AgentsController', () => {
  let controller: AgentsController;

  beforeEach(() => {
    controller = new AgentsController(mockAgentsService as any);
    vi.clearAllMocks();
  });

  describe('listAgents', () => {
    const profileId = '00000000-0000-4000-8000-000000000001';

    it('returns agent list for authorized user', async () => {
      mockAgentsService.listAgents.mockResolvedValue({
        profileId,
        canTransferOwnership: true,
        agents: [
          {
            id: 'agent-1',
            type: 'agent',
            userId: 'user-a',
            name: 'Alice',
            username: 'alice@test.com',
            role: 'Manager',
            status: 'Active',
            joinedAt: '2026-08-01T00:00:00.000Z',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      });

      const req = {
        session: { userId: 'user-1', sessionId: 'session-1', csrfToken: 'csrf' },
      } as any;
      const result = await controller.listAgents(profileId, req);

      expect(result.agents).toHaveLength(1);
      expect(result.canTransferOwnership).toBe(true);
      expect(mockAgentsService.listAgents).toHaveBeenCalledWith(profileId, req.session);
    });

    it('throws 403 when user is not owner or manager', async () => {
      mockAgentsService.listAgents.mockRejectedValueOnce(
        new HttpException({ statusCode: 403 }, 403)
      );

      const req = { session: { userId: 'user-2' } } as any;
      await expect(controller.listAgents(profileId, req)).rejects.toMatchObject({
        response: { statusCode: 403 },
      });
    });
  });

  describe('withdrawInvitation', () => {
    it('withdraws invitation and returns success message', async () => {
      mockAgentsService.withdrawInvitation.mockResolvedValue(undefined);

      const req = {
        session: { userId: 'user-1', sessionId: 'session-1', csrfToken: 'csrf-1' },
      } as any;
      const result = await controller.withdrawInvitation(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        req
      );

      expect(result).toEqual({
        id: '00000000-0000-4000-8000-000000000002',
        status: 'Withdrawn',
        message: 'Invitation withdrawn successfully.',
      });
      expect(mockAgentsService.withdrawInvitation).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        req.session
      );
    });
  });
});
