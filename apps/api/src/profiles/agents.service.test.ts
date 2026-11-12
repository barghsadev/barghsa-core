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
    const actor = { userId: 'user-1', sessionId: 'session-1', csrfToken: 'csrf' };
    const roster = vi.fn();

    beforeEach(() => {
      roster.mockReset();
      mockClient.query.mockImplementation((sql: string, values: unknown[]) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return Promise.resolve({ rows: [] });
        if (sql.startsWith('SELECT disabled_at FROM users'))
          return Promise.resolve({ rows: [{ disabled_at: null }] });
        if (sql.startsWith('SELECT session_id FROM sessions'))
          return Promise.resolve({ rows: [{ session_id: actor.sessionId }] });
        if (sql.startsWith('SELECT csrf_token, step_up_verified_at'))
          return Promise.resolve({ rows: [{ active: true, csrf_token: actor.csrfToken }] });
        return roster(sql, values);
      });
    });

    it('returns combined agent and invitation list', async () => {
      roster.mockResolvedValueOnce({ rows: [{ name: 'Example company', user_id: actor.userId }] });
      roster.mockResolvedValueOnce({
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
      roster.mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            username: 'bob@example.com',
            role: 'Finance',
            created_at: new Date('2026-08-15T00:00:00Z'),
          },
        ],
      });

      const result = await service.listAgents('prof-1', actor);
      expect(result.profileId).toBe('prof-1');
      expect(result.canTransferOwnership).toBe(true);
      expect(roster).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("pa.user_id=$2 AND pa.role='Manager'"),
        ['prof-1', actor.userId]
      );
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
      roster
        .mockResolvedValueOnce({ rows: [{ name: 'Empty company', user_id: 'company-owner' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const result = await service.listAgents('prof-empty', actor);
      expect(result.agents).toHaveLength(0);
      expect(result.canTransferOwnership).toBe(false);
    });

    it('checks current ownership or Manager access before loading team data', async () => {
      roster.mockResolvedValueOnce({ rows: [] });
      await expect(service.listAgents('prof-private', actor)).rejects.toMatchObject({
        status: 403,
      });
      expect(roster).toHaveBeenCalledTimes(1);
      expect(mockPool.query).not.toHaveBeenCalled();
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

    beforeEach(() => {
      mockPool.query.mockReset();
      mockClient.query.mockReset();
      mockClient.release.mockReset();
      mockUuidV7.mockReset();
    });

    it('returns pending invitations for the current user', async () => {
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
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listPendingInvitations(userId);
      expect(result.invitations).toHaveLength(0);
    });
  });

  describe('acceptInvitation', () => {
    it.each(['Accepted', 'Declined', 'Withdrawn', 'Expired', 'Pending'])(
      'denies a past-deadline %s invitation without writing',
      async (status) => {
        const profileId = 'prof-1';
        const actor = { userId: 'invitee', sessionId: 'session-1', csrfToken: 'csrf-1' };
        const past = new Date('2026-01-01T00:00:00Z');
        mockPool.query.mockResolvedValue({ rows: [{ profile_id: profileId }] });
        mockClient.query.mockImplementation(async (sql: string) => {
          if (sql.includes('FROM profiles')) {
            return { rows: [{ user_id: 'owner', profile_type: 'LEGAL', archived: false }] };
          }
          if (sql.includes('FROM users')) {
            return { rows: [{ username: 'invitee@example.test', disabled_at: null }] };
          }
          if (sql.includes('FROM sessions')) {
            return { rows: [{ csrf_token: actor.csrfToken, revoked_at: null }] };
          }
          if (sql.includes('FROM profile_invitations')) {
            return {
              rows: [
                {
                  profile_id: profileId,
                  username: 'invitee@example.test',
                  role: 'Legal',
                  status,
                  expires_at: past,
                },
              ],
            };
          }
          if (sql.includes('FROM account_login_identifiers')) return { rows: [{ found: 1 }] };
          if (sql.includes('AS invited')) return { rows: [{ active: true, invited: false }] };
          return { rows: [] };
        });

        await expect(service.acceptInvitation('invite-1', actor)).rejects.toMatchObject({
          status: 400,
        });
        expect(
          mockClient.query.mock.calls.some(([sql]) => String(sql).includes('AS invited'))
        ).toBe(status === 'Pending');
        expect(
          mockClient.query.mock.calls.some(([sql]) =>
            /^(UPDATE|INSERT)\b/.test(String(sql).trimStart())
          )
        ).toBe(false);
        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalledOnce();
      }
    );
  });

  // Successful acceptance and session rotation use the mounted invitation HTTP fixtures.

  // Decline authorization/decision races are covered by the invitation HTTP fixtures.

  describe('initiateOwnershipTransfer', () => {
    const profileId = 'prof-1';
    const userId = 'user-owner';
    const actor = { userId, sessionId: 'session-1', csrfToken: 'csrf-1' };
    const newOwnerUserId = 'user-agent';
    const transferId = 'transfer-1';

    beforeEach(() => {
      mockPool.query.mockReset();
      mockClient.query.mockReset();
      mockClient.release.mockReset();
      mockUuidV7.mockReset();
      mockUuidV7.mockReturnValue(transferId);
    });

    // Successful creation and transaction behavior use the real ownership HTTP fixtures.

    it('throws 404 when profile not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, actor)
      ).rejects.toMatchObject({ response: { statusCode: 404 } });
    });

    it('throws 400 when profile is not LEGAL', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'INDIVIDUAL' }],
      });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, actor)
      ).rejects.toMatchObject({ response: { statusCode: 400 } });
    });

    it('throws 403 when caller is not the profile owner', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: 'other-owner', profile_type: 'LEGAL' }],
      });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, actor)
      ).rejects.toMatchObject({ response: { statusCode: 403 } });
    });

    it('throws 400 when target is the caller (self-transfer)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      });

      await expect(
        service.initiateOwnershipTransfer(profileId, userId, actor)
      ).rejects.toMatchObject({ response: { statusCode: 400 } });
    });

    it('throws 400 when target user is not an existing agent', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      });
      // Agent check returns empty
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, actor)
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
        service.initiateOwnershipTransfer(profileId, newOwnerUserId, actor)
      ).rejects.toMatchObject({ response: { statusCode: 409 } });
    });
  });
});
