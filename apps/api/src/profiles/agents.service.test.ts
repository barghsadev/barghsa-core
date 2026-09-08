import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentsService } from './agents.service.js';
import { SessionService } from '../session/session.service.js';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue(mockClient),
};
const mockUuidV7 = vi.fn();

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}));

vi.mock('uuid', () => ({
  v7: () => mockUuidV7(),
}));

vi.mock('../rate-limit/rate-limit.service.js', () => ({
  RateLimitService: vi.fn(() => ({
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  })),
}));

describe('AgentsService', () => {
  let service: AgentsService;

  beforeEach(() => {
    service = new AgentsService(
      {
        checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
      } as any,
      new SessionService()
    );
    mockPool.query.mockReset();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockUuidV7.mockReset();
    mockUuidV7.mockReturnValue('audit-id-1');
  });

  describe('isOwnerOrManager', () => {
    it('returns true when user is the owner of the legal profile', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'prof-1' }],
      });

      const result = await service.isOwnerOrManager('user-1', 'prof-1');
      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('profiles'), [
        'prof-1',
        'user-1',
      ]);
    });

    it('returns true when user is a manager agent', async () => {
      // First query (ownership) returns empty
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // Second query (manager check) returns a row
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] });

      const result = await service.isOwnerOrManager('user-2', 'prof-1');
      expect(result).toBe(true);
    });

    it('returns false when user is neither owner nor manager', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.isOwnerOrManager('user-3', 'prof-1');
      expect(result).toBe(false);
    });
  });

  describe('listAgents', () => {
    it('returns combined agent and invitation list', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'agent-1',
            user_id: 'user-a',
            role: 'Manager',
            joined_at: new Date('2026-08-01T00:00:00Z'),
            created_at: new Date('2026-08-01T00:00:00Z'),
            first_name: 'Alice',
            last_name: 'Smith',
            username: 'alice@example.com',
          },
        ],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            username: 'bob@example.com',
            role: 'Finance',
            created_at: new Date('2026-08-15T00:00:00Z'),
          },
        ],
      });

      const result = await service.listAgents('prof-1');
      expect(result.profileId).toBe('prof-1');
      expect(result.agents).toHaveLength(2);

      // Active agent
      expect(result.agents[0]).toMatchObject({
        id: 'agent-1',
        type: 'agent',
        userId: 'user-a',
        name: 'Alice Smith',
        role: 'Manager',
        status: 'Active',
      });

      // Pending invitation (privacy: no userId or name)
      expect(result.agents[1]).toMatchObject({
        id: 'inv-1',
        type: 'invitation',
        userId: null,
        name: null,
        username: 'bob@example.com',
        role: 'Finance',
        status: 'Pending',
        joinedAt: null,
      });
    });

    it('returns empty list when no agents or invitations exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listAgents('prof-empty');
      expect(result.agents).toHaveLength(0);
    });
  });

  // Creation/withdrawal success, conflict, authorization and atomicity are exercised
  // through the real HTTP/PostgreSQL fixture in invitation-mutation-http.integration.test.ts.
  describe('createInvitation input and rate limits', () => {
    const actor = { userId: 'user-owner-1', sessionId: 'session-1', csrfToken: 'csrf-1' };
    const profileId = 'prof-legal-1';
    it('denies unknown callers before input validation', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await expect(
        service.createInvitation(profileId, 'invalid', 'invalid', actor)
      ).rejects.toMatchObject({ status: 403 });
      expect(mockClient.query).not.toHaveBeenCalled();
    });
    it.each([
      ['user@example.test', 'InvalidRole'],
      ['not-a-valid-input', 'Legal'],
    ])('rejects invalid invitation %s / %s', async (username, role) => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId }] });
      await expect(
        service.createInvitation(profileId, username!, role!, actor)
      ).rejects.toMatchObject({ status: 400 });
      expect(mockClient.query).not.toHaveBeenCalled();
    });
    it('retains the ten-per-hour limit and retry delay', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId, profile_type: 'LEGAL' }] });
      const checkRateLimit = vi.fn().mockResolvedValue({ allowed: false, resetMs: 60000 });
      service = new AgentsService({ checkRateLimit } as any, new SessionService());
      await expect(
        service.createInvitation(profileId, 'user@example.test', 'Legal', actor)
      ).rejects.toMatchObject({ status: 429, response: { retryAfterMs: 60000 } });
      expect(checkRateLimit).toHaveBeenCalledWith(expect.any(String), 10, 3600000);
      expect(mockClient.query).not.toHaveBeenCalled();
    });
  });

  describe('listPendingInvitations', () => {
    const userId = 'user-1';
    const username = 'test@example.com';

    beforeEach(() => {
      mockPool.query.mockReset();
      mockClient.query.mockReset();
      mockClient.release.mockReset();
      mockUuidV7.mockReset();
    });

    it('returns pending invitations for the current user', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] });
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            profile_id: 'prof-1',
            profile_name: 'Acme Corp',
            role: 'Manager',
            invited_by: 'inviter-1',
            inviter_name: 'John Doe',
            created_at: new Date('2026-08-20T00:00:00Z'),
            expires_at: new Date('2026-09-20T00:00:00Z'),
          },
        ],
      });

      const result = await service.listPendingInvitations(userId);
      expect(result.invitations).toHaveLength(1);
      expect(result.invitations[0]).toMatchObject({
        id: 'inv-1',
        profileId: 'prof-1',
        profileName: 'Acme Corp',
        role: 'Manager',
        invitedBy: 'inviter-1',
        inviterName: 'John Doe',
      });
    });

    it('returns empty when user not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listPendingInvitations('nonexistent-user');
      expect(result.invitations).toHaveLength(0);
    });

    it('returns empty when no pending invitations', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listPendingInvitations(userId);
      expect(result.invitations).toHaveLength(0);
    });
  });

  // Acceptance transaction behavior is covered by invitation-acceptance-http.integration.test.ts.

  // Decline authorization/decision races are covered by the invitation HTTP fixtures.

  describe('initiateOwnershipTransfer', () => {
    const profileId = 'prof-1';
    const userId = 'user-owner';
    const newOwnerUserId = 'user-agent';
    const transferId = 'transfer-1';

    beforeEach(() => {
      mockPool.query.mockReset();
      mockClient.query.mockReset();
      mockClient.release.mockReset();
      mockUuidV7.mockReset();
      mockUuidV7.mockReturnValue(transferId);
    });

    it('creates a pending transfer with audit log', async () => {
      // Profile lookup
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      });
      // Agent check
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'agent-1', role: 'Manager' }],
      });
      // Pending transfer check
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // Transaction: BEGIN
      mockClient.query.mockResolvedValueOnce(undefined);
      // Locked authority and target rechecks, then expiry reconciliation
      mockClient.query.mockResolvedValueOnce({ rows: [{ user_id: userId }] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      // INSERT transfer
      mockClient.query.mockResolvedValueOnce(undefined);
      // INSERT audit log
      mockClient.query.mockResolvedValueOnce(undefined);
      // COMMIT
      mockClient.query.mockResolvedValueOnce(undefined);

      const result = await service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId);

      expect(result).toEqual({ id: transferId });
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO profile_ownership_transfers'),
        expect.arrayContaining([transferId, profileId, userId, newOwnerUserId])
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([expect.any(String), userId, 'ownership_transfer_initiated'])
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('throws 404 when profile not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId)
      ).rejects.toMatchObject({ response: { statusCode: 404 } });
    });

    it('throws 400 when profile is not LEGAL', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'INDIVIDUAL' }],
      });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId)
      ).rejects.toMatchObject({ response: { statusCode: 400 } });
    });

    it('throws 403 when caller is not the profile owner', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: 'other-owner', profile_type: 'LEGAL' }],
      });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId)
      ).rejects.toMatchObject({ response: { statusCode: 403 } });
    });

    it('throws 400 when target is the caller (self-transfer)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      });

      await expect(
        service.initiateOwnershipTransfer(profileId, userId, userId)
      ).rejects.toMatchObject({ response: { statusCode: 400 } });
    });

    it('throws 400 when target user is not an existing agent', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      });
      // Agent check returns empty
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId)
      ).rejects.toMatchObject({ response: { statusCode: 400 } });
    });

    it('throws 409 when a pending transfer already exists', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      });
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'agent-1', role: 'Manager' }],
      });
      // Pending transfer check returns existing
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-transfer' }] });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId)
      ).rejects.toMatchObject({ response: { statusCode: 409 } });
    });
  });
});
