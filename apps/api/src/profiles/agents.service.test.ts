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

describe('AgentsService', () => {
  let service: AgentsService

  beforeEach(() => {
    service = new AgentsService()
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
})