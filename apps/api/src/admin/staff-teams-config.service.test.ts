import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import {
  DEFAULT_STAFF_ASSIGNMENT_RULES,
  STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
} from '@barghsa/shared/admin'

// ─── Helpers ──────────────────────────────────────────────────────────

function mockPool() {
  const mockQuery = vi.fn()
  const mockConnect = vi.fn()
  const pool = { query: mockQuery, connect: mockConnect }
  return { mockQuery, mockConnect, pool }
}

function mockClient() {
  const mockClientQuery = vi.fn()
  const mockRelease = vi.fn()
  const client = { query: mockClientQuery, release: mockRelease }
  return { mockClientQuery, mockRelease, client }
}

function mockDbModule(pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }) {
  return { getDbPool: () => pool, PREDEFINED_ROLES: [] }
}

let AdminService: typeof AdminServiceType
let service: AdminServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

async function loadService() {
  const { pool, mockQuery, mockConnect } = mockPool()
  vi.doMock('@barghsa/db', () => mockDbModule(pool))
  const { AdminService: Svc } = await import('./admin.service.js')
  service = new Svc()
  return { pool, mockQuery, mockConnect }
}

// ─── Assignment rules (T-09.08.02) ────────────────────────────────────

describe('AdminService staff assignment rules (T-09.08.02)', () => {
  describe('getStaffAssignmentRules', () => {
    it('returns the all-manual default when no value is persisted', async () => {
      const { mockQuery } = await loadService()
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.getStaffAssignmentRules()
      expect(result).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('app_config'),
        [STAFF_ASSIGNMENT_RULES_CONFIG_KEY],
      )
    })

    it('returns the stored map as-is when valid', async () => {
      const { mockQuery } = await loadService()
      mockQuery.mockResolvedValueOnce({
        rows: [{
          value: {
            ticket: { teamId: 'team-1', strategy: 'round_robin' },
            verification_case: { teamId: null, strategy: 'load' },
          },
        }],
      })

      const result = await service.getStaffAssignmentRules()
      expect(result).toEqual({
        ticket: { teamId: 'team-1', strategy: 'round_robin' },
        verification_case: { teamId: null, strategy: 'load' },
      })
    })

    it('fills omitted work types from a stored map with the manual default', async () => {
      const { mockQuery } = await loadService()
      mockQuery.mockResolvedValueOnce({
        rows: [{ value: { ticket: { teamId: 'team-1', strategy: 'expertise' } } }],
      })

      const result = await service.getStaffAssignmentRules()
      expect(result.ticket).toEqual({ teamId: 'team-1', strategy: 'expertise' })
      expect(result.verification_case).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES.verification_case)
    })

    it('normalizes a corrupt stored row without throwing', async () => {
      const { mockQuery } = await loadService()
      mockQuery.mockResolvedValueOnce({
        rows: [{ value: { ticket: 'garbage', verification_case: { teamId: 't-2', strategy: 'bogus' } } }],
      })

      const result = await service.getStaffAssignmentRules()
      expect(result.ticket).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES.ticket)
      expect(result.verification_case.teamId).toBe('t-2')
      expect(result.verification_case.strategy).toBe('round_robin')
    })

    it('treats an unknown work-type key as corrupt without throwing', async () => {
      const { mockQuery } = await loadService()
      mockQuery.mockResolvedValueOnce({
        rows: [{
          value: { consultation: { teamId: 't-9', strategy: 'load' } },
        }],
      })

      const result = await service.getStaffAssignmentRules()
      expect(result.ticket).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES.ticket)
      expect(result.verification_case).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES.verification_case)
    })
  })

  describe('setStaffAssignmentRules', () => {
    it('rejects an invalid payload with 400 before touching the pool', async () => {
      const { mockConnect } = await loadService()

      await expect(
        service.setStaffAssignmentRules({ consultation: { teamId: 't', strategy: 'load' } }, 'admin-1', 'ip'),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockConnect).not.toHaveBeenCalled()
    })

    it('persists a valid map, bumps config version, and records a config_change audit', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ value: null, version: 0 }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [{ version: 1 }] }) // INSERT RETURNING
        .mockResolvedValueOnce({ rows: [] }) // config_version
        .mockResolvedValueOnce({ rows: [] }) // audit_log
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.setStaffAssignmentRules(
        { ticket: { teamId: 'team-1', strategy: 'round_robin' } },
        'admin-1',
        '127.0.0.1',
      )
      expect(result).toEqual({
        ticket: { teamId: 'team-1', strategy: 'round_robin' },
        verification_case: DEFAULT_STAFF_ASSIGNMENT_RULES.verification_case,
      })

      const auditCall = client.query.mock.calls.find(([sql]) =>
        String(sql).includes('audit_log'),
      )
      expect(auditCall).toBeDefined()
      const auditParams = auditCall![1] as unknown[]
      expect(auditParams[2]).toBe('config_change')
      const metadata = JSON.parse(String(auditParams[3])) as Record<string, unknown>
      expect(metadata).toMatchObject({
        key: STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
        newValue: {
          ticket: { teamId: 'team-1', strategy: 'round_robin' },
          verification_case: { teamId: null, strategy: 'round_robin' },
        },
      })
      expect(
        client.query.mock.calls.some(([sql]) => String(sql).includes('config_version')),
      ).toBe(true)
    })
  })
})

// ─── Staff team CRUD (T-09.08.02) ─────────────────────────────────────

describe('AdminService staff team CRUD (T-09.08.02)', () => {
  describe('listStaffTeams', () => {
    it('returns [] when no teams exist', async () => {
      const { mockQuery } = await loadService()
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.listStaffTeams()
      expect(result).toEqual([])
    })

    it('groups members by team and maps rows to records', async () => {
      const { mockQuery } = await loadService()
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'team-1', name: 'Billing', description: null,
              skill_tags: ['billing'], is_active: true,
              created_at: new Date('2026-01-01T00:00:00Z'),
              updated_at: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { team_id: 'team-1', user_id: 'u-2', created_at: new Date('2026-01-01T00:00:00Z') },
            { team_id: 'team-1', user_id: 'u-1', created_at: new Date('2026-01-01T00:00:00Z') },
          ],
        })

      const result = await service.listStaffTeams()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'team-1',
        name: 'Billing',
        memberUserIds: ['u-2', 'u-1'],
        isActive: true,
      })
      // Members query uses the collected team ids (single ANY($1) param).
      expect(mockQuery.mock.calls[1]![1]).toEqual([['team-1']])
    })
  })

  describe('createStaffTeam', () => {
    it('rejects invalid input with 400', async () => {
      const { mockConnect } = await loadService()
      await expect(
        service.createStaffTeam({ name: '' }, 'admin-1', 'ip'),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockConnect).not.toHaveBeenCalled()
    })

    it('verifies members exist, inserts team + memberships, records team_create audit', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      const teamRow = {
        id: 'team-1', name: 'Billing', description: null,
        skill_tags: ['billing'], is_active: true,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      }
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 'u-1' }, { user_id: 'u-2' }] }) // members exist
        .mockResolvedValueOnce({ rows: [teamRow] }) // INSERT staff_teams RETURNING
        .mockResolvedValueOnce({ rows: [] }) // INSERT members
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.createStaffTeam(
        { name: '  Billing  ', description: null, skillTags: ['billing'], memberUserIds: ['u-1', 'u-2'] },
        'admin-1',
        '127.0.0.1',
      )
      expect(result).toMatchObject({ id: 'team-1', name: 'Billing', memberUserIds: ['u-1', 'u-2'] })

      const auditCall = client.query.mock.calls.find(([sql]) =>
        String(sql).includes('audit_log'),
      )
      const auditParams = auditCall![1] as unknown[]
      expect(auditParams[2]).toBe('team_create')
      const metadata = JSON.parse(String(auditParams[3])) as Record<string, unknown>
      expect(metadata).toMatchObject({ name: 'Billing' })
      expect(metadata.teamId).toEqual(expect.any(String))
    })

    it('creates a team from a name-only body (optional fields default)', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      const teamRow = {
        id: 'team-1', name: 'Billing', description: null,
        skill_tags: [], is_active: true,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      }
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [teamRow] }) // INSERT staff_teams RETURNING
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.createStaffTeam(
        { name: 'Billing' },
        'admin-1',
        '127.0.0.1',
      )
      expect(result).toMatchObject({
        id: 'team-1', name: 'Billing', skillTags: [], memberUserIds: [],
      })
    })

    it('returns 400 when a member user does not exist', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 'u-1' }] }) // only u-1 exists
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      await expect(
        service.createStaffTeam(
          { name: 'Billing', description: null, skillTags: [], memberUserIds: ['u-1', 'missing'] },
          'admin-1',
          '127.0.0.1',
        ),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('returns 409 on duplicate team name', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // members exist (none)
        .mockRejectedValueOnce(
          Object.assign(
            new Error('duplicate key value violates unique constraint "uq_st_name"'),
            { code: '23505', constraint: 'uq_st_name' },
          ),
        )
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      await expect(
        service.createStaffTeam(
          { name: 'Billing', description: null, skillTags: [], memberUserIds: [] },
          'admin-1',
          '127.0.0.1',
        ),
      ).rejects.toMatchObject({ status: 409 })
    })
  })

  describe('updateStaffTeam', () => {
    it('returns 404 when the team does not exist', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      await expect(
        service.updateStaffTeam('nope', { name: 'X' }, 'admin-1', '127.0.0.1'),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('merges partial input, replaces members, records team_update audit', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      const existingRow = {
        id: 'team-1', name: 'Billing', description: null,
        skill_tags: ['billing'], is_active: true,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      }
      const updatedRow = { ...existingRow, name: 'Billing Plus' }
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [existingRow] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [{ user_id: 'u-1' }] }) // prev members
        .mockResolvedValueOnce({ rows: [{ user_id: 'u-1' }, { user_id: 'u-2' }] }) // members exist check
        .mockResolvedValueOnce({ rows: [updatedRow] }) // UPDATE RETURNING
        .mockResolvedValueOnce({ rows: [] }) // DELETE members
        .mockResolvedValueOnce({ rows: [] }) // INSERT members
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.updateStaffTeam(
        'team-1',
        { name: 'Billing Plus', memberUserIds: ['u-1', 'u-2'] },
        'admin-1',
        '127.0.0.1',
      )
      expect(result).toMatchObject({ id: 'team-1', name: 'Billing Plus', memberUserIds: ['u-1', 'u-2'] })

      const auditCall = client.query.mock.calls.find(([sql]) =>
        String(sql).includes('audit_log'),
      )
      const auditParams = auditCall![1] as unknown[]
      expect(auditParams[2]).toBe('team_update')
      const metadata = JSON.parse(String(auditParams[3])) as Record<string, unknown>
      expect(metadata).toMatchObject({
        teamId: 'team-1',
        previousName: 'Billing',
        previousMemberUserIds: ['u-1'],
        memberUserIds: ['u-1', 'u-2'],
      })
      // Members were replaced: DELETE then INSERT.
      const deleteCall = client.query.mock.calls.find(([sql]) =>
        String(sql).includes('DELETE FROM staff_team_members'),
      )
      expect(deleteCall).toBeDefined()
    })

    it('rejects a non-string name without coercing it (e.g. name: 42)', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      const existingRow = {
        id: 'team-1', name: 'Billing', description: null,
        skill_tags: ['billing'], is_active: true,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      }
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [existingRow] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [{ user_id: 'u-1' }] }) // prev members
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      await expect(
        service.updateStaffTeam('team-1', { name: 42 }, 'admin-1', '127.0.0.1'),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('deleteStaffTeam', () => {
    it('returns 404 when the team does not exist', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      await expect(service.deleteStaffTeam('nope', 'admin-1', '127.0.0.1'))
        .rejects.toMatchObject({ status: 404 })
    })

    it('deletes the team and records team_delete audit', async () => {
      const { mockConnect } = await loadService()
      const { client } = mockClient()
      mockConnect.mockResolvedValue(client)
      client.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'team-1', name: 'Billing' }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] }) // DELETE team
        .mockResolvedValueOnce({ rows: [] }) // audit
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await service.deleteStaffTeam('team-1', 'admin-1', '127.0.0.1')
      expect(result).toEqual({ deleted: true })

      const auditCall = client.query.mock.calls.find(([sql]) =>
        String(sql).includes('audit_log'),
      )
      const auditParams = auditCall![1] as unknown[]
      expect(auditParams[2]).toBe('team_delete')
      const metadata = JSON.parse(String(auditParams[3])) as Record<string, unknown>
      expect(metadata).toMatchObject({ teamId: 'team-1', name: 'Billing' })
    })
  })
})
