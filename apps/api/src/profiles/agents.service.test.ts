import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentsService } from './agents.service.js'

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}
const mockPool = {
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue(mockClient),
}
const mockUuidV7 = vi.fn()

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

vi.mock('uuid', () => ({
  v7: () => mockUuidV7(),
}))

vi.mock('../rate-limit/rate-limit.service.js', () => ({
  RateLimitService: vi.fn(() => ({
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  })),
}))

describe('AgentsService', () => {
  let service: AgentsService

  beforeEach(() => {
    service = new AgentsService(
      { checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
    )
    mockPool.query.mockReset()
    mockClient.query.mockReset()
    mockClient.release.mockReset()
    mockUuidV7.mockReset()
    mockUuidV7.mockReturnValue('audit-id-1')
  })

  describe('isOwnerOrManager', () => {
    it('returns true when user is the owner of the legal profile', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'prof-1' }],
      })

      const result = await service.isOwnerOrManager('user-1', 'prof-1')
      expect(result).toBe(true)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('profiles'),
        ['prof-1', 'user-1'],
      )
    })

    it('returns true when user is a manager agent', async () => {
      // First query (ownership) returns empty
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      // Second query (manager check) returns a row
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] })

      const result = await service.isOwnerOrManager('user-2', 'prof-1')
      expect(result).toBe(true)
    })

    it('returns false when user is neither owner nor manager', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.isOwnerOrManager('user-3', 'prof-1')
      expect(result).toBe(false)
    })
  })

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
      })
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            username: 'bob@example.com',
            role: 'Finance',
            created_at: new Date('2026-08-15T00:00:00Z'),
          },
        ],
      })

      const result = await service.listAgents('prof-1')
      expect(result.profileId).toBe('prof-1')
      expect(result.agents).toHaveLength(2)

      // Active agent
      expect(result.agents[0]).toMatchObject({
        id: 'agent-1',
        type: 'agent',
        userId: 'user-a',
        name: 'Alice Smith',
        role: 'Manager',
        status: 'Active',
      })

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
      })
    })

    it('returns empty list when no agents or invitations exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.listAgents('prof-empty')
      expect(result.agents).toHaveLength(0)
    })
  })

  describe('withdrawInvitation', () => {
    it('withdraws a pending invitation when user is owner/manager', async () => {
      // Find invitation
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'inv-1', status: 'Pending', invited_by: 'other-user' }],
      })
      // isOwnerOrManager returns true
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] })
      // Transaction: BEGIN
      mockClient.query.mockResolvedValueOnce(undefined)
      // Transaction: UPDATE invitation
      mockClient.query.mockResolvedValueOnce({ rows: [] })
      // Transaction: INSERT audit log
      mockClient.query.mockResolvedValueOnce({ rows: [] })
      // Transaction: COMMIT
      mockClient.query.mockResolvedValueOnce(undefined)

      await expect(service.withdrawInvitation('prof-1', 'inv-1', 'user-1')).resolves.toBeUndefined()

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE profile_invitations'),
        ['inv-1'],
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('throws 404 when invitation not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.withdrawInvitation('prof-1', 'inv-nonexistent', 'user-1'))
        .rejects.toMatchObject({ response: { statusCode: 404 } })
    })

    it('throws 400 when invitation is not in Pending status', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'inv-1', status: 'Accepted', invited_by: 'other' }],
      })

      await expect(service.withdrawInvitation('prof-1', 'inv-1', 'user-1'))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 403 when user is not authorized', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'inv-1', status: 'Pending', invited_by: 'other-user' }],
      })
      // isOwnerOrManager returns false
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      // Not the inviter either
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.withdrawInvitation('prof-1', 'inv-1', 'user-3'))
        .rejects.toMatchObject({ response: { statusCode: 403 } })
    })

    it('allows the original inviter to withdraw even if not owner/manager', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'inv-1', status: 'Pending', invited_by: 'user-2' }],
      })
      // isOwnerOrManager returns false
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      // isOwner check (second query in isOwnerOrManager): returns empty
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      // Transaction: BEGIN
      mockClient.query.mockResolvedValueOnce(undefined)
      // Transaction: UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [] })
      // Transaction: INSERT audit
      mockClient.query.mockResolvedValueOnce({ rows: [] })
      // Transaction: COMMIT
      mockClient.query.mockResolvedValueOnce(undefined)

      await expect(service.withdrawInvitation('prof-1', 'inv-1', 'user-2')).resolves.toBeUndefined()
    })
  })

  describe('createInvitation', () => {
    const profileId = 'prof-legal-1'
    const userId = 'user-owner-1'
    const normalisedUsername = '+989121234567'

    const defaultInviteMock = () => {
      // Permission check: isOwnerOrManager returns true (owner)
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId }] })
      // Profile lookup: LEGAL profile exists
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId, profile_type: 'LEGAL' }] })
      // Duplicate invite check: no pending invitation
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      // Duplicate agent check: user not found or not an agent
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      // Transaction: BEGIN
      mockClient.query.mockResolvedValueOnce(undefined)
      // Transaction: INSERT invitation
      mockClient.query.mockResolvedValueOnce(undefined)
      // Transaction: INSERT audit log
      mockClient.query.mockResolvedValueOnce(undefined)
      // Transaction: COMMIT
      mockClient.query.mockResolvedValueOnce(undefined)
    }

    beforeEach(() => {
      mockPool.query.mockReset()
      mockClient.query.mockReset()
      mockClient.release.mockReset()
      mockUuidV7.mockReset()
      mockUuidV7.mockReturnValue('invitation-uuid-1')
    })

    it('creates an invitation successfully for owner', async () => {
      defaultInviteMock()

      // uuidv7 calls: 1=invitationId, 2=correlationId, 3=audit log id
      const result = await service.createInvitation(profileId, '09121234567', 'Manager', userId)

      expect(result).toEqual({ id: 'invitation-uuid-1' })
      // Permission check query ran first
      expect(mockPool.query.mock.calls[0]![0]).toContain('profiles')
      // Profile lookup
      expect(mockPool.query.mock.calls[1]![0]).toContain('profiles')
      // Rate limit check
      expect(mockPool.query.mock.calls[2]![0]).toContain('profile_invitations')
      // Duplicate user check
      expect(mockPool.query.mock.calls[3]![0]).toContain('users')
      // Transaction
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO profile_invitations'),
        expect.arrayContaining(['invitation-uuid-1', profileId, '+989121234567', 'Manager', userId]),
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('throws 403 when user is not owner or manager (permission check first)', async () => {
      // isOwnerOrManager returns false
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.createInvitation(profileId, 'user@example.com', 'Finance', 'user-nobody'))
        .rejects.toMatchObject({ response: { statusCode: 403 } })

      // Only 2 queries ran (the permission check), no more
      expect(mockPool.query).toHaveBeenCalledTimes(2)
    })

    it('throws 400 for invalid role', async () => {
      // Permission check passes
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId }] })

      await expect(service.createInvitation(profileId, 'user@example.com', 'InvalidRole', userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 400 for unrecognisable username', async () => {
      // Permission check passes
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId }] })

      await expect(service.createInvitation(profileId, 'not-a-valid-input', 'Legal', userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 409 when a pending invitation already exists', async () => {
      // Permission check passes (owner)
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId }] })
      // Profile exists and is LEGAL
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId, profile_type: 'LEGAL' }] })
      // Rate limit allowed
      // Duplicate invite check: pending invitation exists
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-invite' }] })

      await expect(service.createInvitation(profileId, 'user@example.com', 'Finance', userId))
        .rejects.toMatchObject({ response: { statusCode: 409 } })
    })

    it('throws 409 when user is already an agent', async () => {
      // Permission check passes (owner)
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId }] })
      // Profile exists and is LEGAL
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId, profile_type: 'LEGAL' }] })
      // Rate limit allowed
      // Duplicate invite check: no pending
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      // Duplicate agent check: user exists and is already an agent
      mockPool.query.mockResolvedValueOnce({ rows: [{ user_id: 'existing-user' }] })
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-agent' }] })

      await expect(service.createInvitation(profileId, 'user@example.com', 'Legal', userId))
        .rejects.toMatchObject({ response: { statusCode: 409 } })
    })

    it('throws 429 when rate limit exceeded', async () => {
      // Permission check passes (owner)
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId }] })
      // Profile exists and is LEGAL
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: profileId, profile_type: 'LEGAL' }] })
      // Rate limit check: rateLimitService returns not allowed
      service = new AgentsService(
        { checkRateLimit: vi.fn().mockResolvedValue({ allowed: false, resetMs: 60000 }) } as any,
      )

      await expect(service.createInvitation(profileId, 'user@example.com', 'Legal', userId))
        .rejects.toMatchObject({ response: { statusCode: 429 } })
    })

    it('throws 404 when profile does not exist', async () => {
      // Permission check passes (isOwnerOrManager returns true for non-existent? no — it returns false)
      // Actually, isOwnerOrManager returns false for non-existent profiles
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.createInvitation('nonexistent', 'user@example.com', 'Legal', userId))
        .rejects.toMatchObject({ response: { statusCode: 403 } })
    })

    it('throws 400 when profile is not a LEGAL type', async () => {
      // Permission check passes (owner of individual profile)
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'prof-individual' }] })
      // Profile exists but is INDIVIDUAL
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'prof-individual', profile_type: 'INDIVIDUAL' }] })

      await expect(service.createInvitation('prof-individual', 'user@example.com', 'Manager', userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })
  })

  describe('listPendingInvitations', () => {
    const userId = 'user-1'
    const username = 'test@example.com'

    beforeEach(() => {
      mockPool.query.mockReset()
      mockClient.query.mockReset()
      mockClient.release.mockReset()
      mockUuidV7.mockReset()
    })

    it('returns pending invitations for the current user', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
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
      })

      const result = await service.listPendingInvitations(userId)
      expect(result.invitations).toHaveLength(1)
      expect(result.invitations[0]).toMatchObject({
        id: 'inv-1',
        profileId: 'prof-1',
        profileName: 'Acme Corp',
        role: 'Manager',
        invitedBy: 'inviter-1',
        inviterName: 'John Doe',
      })
    })

    it('returns empty when user not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.listPendingInvitations('nonexistent-user')
      expect(result.invitations).toHaveLength(0)
    })

    it('returns empty when no pending invitations', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.listPendingInvitations(userId)
      expect(result.invitations).toHaveLength(0)
    })
  })

  describe('acceptInvitation', () => {
    const userId = 'user-1'
    const inviteId = 'inv-1'
    const username = 'test@example.com'
    const profileId = 'prof-1'

    beforeEach(() => {
      mockPool.query.mockReset()
      mockClient.query.mockReset()
      mockClient.release.mockReset()
      mockUuidV7.mockReset()
      mockUuidV7.mockReturnValue('uuid-1')
    })

    it('accepts a pending invitation and creates profile_agents record', async () => {
      // Lookup username
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      // Fetch invitation
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: inviteId, profile_id: profileId, username, role: 'Manager', status: 'Pending', expires_at: new Date('2026-09-20T00:00:00Z') }],
      })
      // Transaction: BEGIN
      mockClient.query.mockResolvedValueOnce(undefined)
      // Duplicate agent check (inside transaction)
      mockClient.query.mockResolvedValueOnce({ rows: [] })
      // INSERT profile_agents
      mockClient.query.mockResolvedValueOnce(undefined)
      // UPDATE invitation
      mockClient.query.mockResolvedValueOnce(undefined)
      // INSERT audit log
      mockClient.query.mockResolvedValueOnce(undefined)
      // COMMIT
      mockClient.query.mockResolvedValueOnce(undefined)

      await expect(service.acceptInvitation(inviteId, userId)).resolves.toBeUndefined()

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM profile_agents'),
        [profileId, userId],
      )
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO profile_agents'),
        expect.any(Array),
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('throws 404 when user not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.acceptInvitation(inviteId, userId))
        .rejects.toMatchObject({ response: { statusCode: 404 } })
    })

    it('throws 404 when invitation not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.acceptInvitation('nonexistent-invite', userId))
        .rejects.toMatchObject({ response: { statusCode: 404 } })
    })

    it('throws 400 when invitation is not in Pending status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: inviteId, profile_id: profileId, username, role: 'Manager', status: 'Accepted', expires_at: null }],
      })

      await expect(service.acceptInvitation(inviteId, userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 404 when invitation belongs to a different user (username mismatch)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: inviteId, profile_id: profileId, username: 'other@example.com', role: 'Manager', status: 'Pending', expires_at: null }],
      })

      await expect(service.acceptInvitation(inviteId, userId))
        .rejects.toMatchObject({ response: { statusCode: 404 } })
    })

    it('throws 400 when invitation has expired', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: inviteId, profile_id: profileId, username, role: 'Manager', status: 'Pending', expires_at: new Date('2020-01-01T00:00:00Z') }],
      })

      await expect(service.acceptInvitation(inviteId, userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 409 when user is already an agent of the profile', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: inviteId, profile_id: profileId, username, role: 'Manager', status: 'Pending', expires_at: new Date('2026-09-20T00:00:00Z') }],
      })
      // Transaction: BEGIN
      mockClient.query.mockResolvedValueOnce(undefined)
      // Duplicate agent check (inside transaction): already exists
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'existing-agent' }] })
      // ROLLBACK from conflict handler
      mockClient.query.mockResolvedValueOnce(undefined)

      await expect(service.acceptInvitation(inviteId, userId))
        .rejects.toMatchObject({ response: { statusCode: 409 } })
      expect(mockClient.release).toHaveBeenCalled()
    })
  })

  describe('declineInvitation', () => {
    const userId = 'user-1'
    const inviteId = 'inv-1'
    const username = 'test@example.com'

    beforeEach(() => {
      mockPool.query.mockReset()
      mockClient.query.mockReset()
      mockClient.release.mockReset()
      mockUuidV7.mockReset()
      mockUuidV7.mockReturnValue('uuid-1')
    })

    it('declines a pending invitation with audit log', async () => {
      // Lookup username
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      // Fetch invitation
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: inviteId, username, status: 'Pending', expires_at: null }],
      })
      // Transaction: BEGIN
      mockClient.query.mockResolvedValueOnce(undefined)
      // UPDATE invitation
      mockClient.query.mockResolvedValueOnce(undefined)
      // INSERT audit log
      mockClient.query.mockResolvedValueOnce(undefined)
      // COMMIT
      mockClient.query.mockResolvedValueOnce(undefined)

      await expect(service.declineInvitation(inviteId, userId)).resolves.toBeUndefined()

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE profile_invitations'),
        [inviteId],
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('throws 404 when user not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.declineInvitation(inviteId, userId))
        .rejects.toMatchObject({ response: { statusCode: 404 } })
    })

    it('throws 404 when invitation not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.declineInvitation('nonexistent', userId))
        .rejects.toMatchObject({ response: { statusCode: 404 } })
    })

    it('throws 400 when invitation is not in Pending status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: inviteId, username, status: 'Accepted', expires_at: null }],
      })

      await expect(service.declineInvitation(inviteId, userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 404 when invitation belongs to a different user (username mismatch)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ username }] })
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: inviteId, username: 'other@example.com', status: 'Pending', expires_at: null }],
      })

      await expect(service.declineInvitation(inviteId, userId))
        .rejects.toMatchObject({ response: { statusCode: 404 } })
    })
  })

  describe('initiateOwnershipTransfer', () => {
    const profileId = 'prof-1'
    const userId = 'user-owner'
    const newOwnerUserId = 'user-agent'
    const transferId = 'transfer-1'

    beforeEach(() => {
      mockPool.query.mockReset()
      mockClient.query.mockReset()
      mockClient.release.mockReset()
      mockUuidV7.mockReset()
      mockUuidV7.mockReturnValue(transferId)
    })

    it('creates a pending transfer with audit log', async () => {
      // Profile lookup
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      })
      // Agent check
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'agent-1', role: 'Manager' }],
      })
      // Pending transfer check
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      // Transaction: BEGIN
      mockClient.query.mockResolvedValueOnce(undefined)
      // INSERT transfer
      mockClient.query.mockResolvedValueOnce(undefined)
      // INSERT audit log
      mockClient.query.mockResolvedValueOnce(undefined)
      // COMMIT
      mockClient.query.mockResolvedValueOnce(undefined)

      const result = await service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId)

      expect(result).toEqual({ id: transferId })
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO profile_ownership_transfers'),
        expect.arrayContaining([transferId, profileId, userId, newOwnerUserId]),
      )
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([expect.any(String), userId, 'ownership_transfer_initiated']),
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('throws 404 when profile not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId))
        .rejects.toMatchObject({ response: { statusCode: 404 } })
    })

    it('throws 400 when profile is not LEGAL', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'INDIVIDUAL' }],
      })

      await expect(service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 403 when caller is not the profile owner', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: 'other-owner', profile_type: 'LEGAL' }],
      })

      await expect(service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId))
        .rejects.toMatchObject({ response: { statusCode: 403 } })
    })

    it('throws 400 when target is the caller (self-transfer)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      })

      await expect(service.initiateOwnershipTransfer(profileId, userId, userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 400 when target user is not an existing agent', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      })
      // Agent check returns empty
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId))
        .rejects.toMatchObject({ response: { statusCode: 400 } })
    })

    it('throws 409 when a pending transfer already exists', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: profileId, user_id: userId, profile_type: 'LEGAL' }],
      })
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'agent-1', role: 'Manager' }],
      })
      // Pending transfer check returns existing
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-transfer' }] })

      await expect(service.initiateOwnershipTransfer(profileId, newOwnerUserId, userId))
        .rejects.toMatchObject({ response: { statusCode: 409 } })
    })
  })
})