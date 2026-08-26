import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AdminService as AdminServiceType } from './admin.service.js'
import type { CreateStaffUserInput } from './admin.service.js'

// Mock uuid v7 for deterministic UUID generation
vi.mock('uuid', () => ({
  v7: vi.fn(() => 'new-user-uuid'),
}))

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

/** Predefined roles for mocking @barghsa/db. */
const MOCK_ROLES = [
  { id: 'role-customer-support' as const, name: 'Customer Support', description: '', permissions: [] },
  { id: 'role-crm-verification' as const, name: 'CRM & Verification', description: '', permissions: [] },
  { id: 'role-finance' as const, name: 'Finance', description: '', permissions: [] },
  { id: 'role-legal-contracts' as const, name: 'Legal & Contracts', description: '', permissions: [] },
  { id: 'role-operations' as const, name: 'Operations', description: '', permissions: [] },
  { id: 'role-admin' as const, name: 'Admin', description: '', permissions: [] },
]

/**
 * Build a mock for @barghsa/db that returns the given pool from `getDbPool`
 * and the MOCK_ROLES from `PREDEFINED_ROLES`.
 */
function mockDbModule(pool: ReturnType<typeof mockPool>['pool']) {
  return {
    getDbPool: () => pool,
    PREDEFINED_ROLES: MOCK_ROLES,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminServiceType

  beforeEach(() => {
    vi.resetModules()
  })

  describe('createStaffUser', () => {
    const validInput: CreateStaffUserInput = {
      username: 'new.staff@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      activationMethod: 'tempPassword',
      roleIds: [],
    }

    it('creates a staff user with tempPassword activation', async () => {
      const { pool } = mockPool()
      const { mockClientQuery, mockRelease, client } = mockClient()

      // ── Pre-check: username not taken ───────────────────────────────
      pool.query.mockResolvedValueOnce({ rows: [] })

      // ── Transaction: connect ────────────────────────────────────────
      pool.connect.mockResolvedValue(client)

      // ── Transaction steps in order ──────────────────────────────────
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // BEGIN
      mockClientQuery.mockResolvedValueOnce({
        // CREATE user
        rows: [{ user_id: 'new-user', username: 'new.staff@example.com' }],
      })
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // INSERT profile
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // INSERT roles (none)
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // INSERT audit_log
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // COMMIT

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      const result = await service.createStaffUser(validInput, 'actor', '10.0.0.1')

      expect(result.userId).toBe('new-user-uuid')
      expect(result.username).toBe('new.staff@example.com')
      expect(result.activationMethod).toBe('tempPassword')
      expect(result.temporaryPassword).toBeDefined()
      expect(result.temporaryPassword!.length).toBeGreaterThanOrEqual(8)
      expect(mockRelease).toHaveBeenCalled()
    })

    it('creates a staff user with activation link', async () => {
      const { pool } = mockPool()
      const { mockClientQuery, mockRelease, client } = mockClient()

      // ── Pre-check: username not taken ───────────────────────────────
      pool.query.mockResolvedValueOnce({ rows: [] })

      // ── Transaction: connect ────────────────────────────────────────
      pool.connect.mockResolvedValue(client)

      // ── Transaction steps ───────────────────────────────────────────
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // BEGIN
      mockClientQuery.mockResolvedValueOnce({
        rows: [{ user_id: 'new-user-link', username: 'link.staff@example.com' }],
      })
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // INSERT profile
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // INSERT roles (none)
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // INSERT audit_log
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // COMMIT

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      const result = await service.createStaffUser(
        { ...validInput, username: 'link.staff@example.com', activationMethod: 'link' },
        'actor',
        '10.0.0.1',
      )

      expect(result.userId).toBe('new-user-uuid')
      expect(result.activationMethod).toBe('link')
      expect(result.activationToken).toBeDefined()
      expect(mockRelease).toHaveBeenCalled()
    })

    it('throws 409 when username is already taken', async () => {
      const { pool } = mockPool()
      pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'existing' }] })

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      let caught: unknown
      try {
        await service.createStaffUser(validInput, 'actor', '10.0.0.1')
      } catch (e) {
        caught = e
      }

      expect(caught).toBeInstanceOf(HttpException)
      expect((caught as HttpException).getStatus()).toBe(409)
    })

    it('throws 400 when roleIds contain invalid role IDs', async () => {
      const { pool } = mockPool()
      pool.query.mockResolvedValueOnce({ rows: [] })

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      let caught: unknown
      try {
        await service.createStaffUser(
          { ...validInput, roleIds: ['nonexistent-role'] },
          'actor',
          '10.0.0.1',
        )
      } catch (e) {
        caught = e
      }

      expect(caught).toBeInstanceOf(HttpException)
      expect((caught as HttpException).getStatus()).toBe(400)
    })

    it('rolls back on unique constraint violation', async () => {
      const { pool } = mockPool()
      const { mockClientQuery, mockRelease, client } = mockClient()

      // Pre-check passes
      pool.query.mockResolvedValueOnce({ rows: [] })

      // Transaction
      pool.connect.mockResolvedValue(client)
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // BEGIN
      mockClientQuery.mockRejectedValueOnce({
        // CREATE user — fails with unique violation
        code: '23505',
        detail: 'Key (username)=(new.staff@example.com) already exists.',
      })
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      let caught: unknown
      try {
        await service.createStaffUser(validInput, 'actor', '10.0.0.1')
      } catch (e) {
        caught = e
      }

      expect(caught).toBeInstanceOf(HttpException)
      expect((caught as HttpException).getStatus()).toBe(409)
      expect(mockRelease).toHaveBeenCalled()
    })
  })

  describe('updateStaffRoles', () => {
    it('replaces role set for an existing staff user', async () => {
      const { pool } = mockPool()
      const { mockClientQuery, mockRelease, client } = mockClient()

      // Pre-check: user exists and is admin
      pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'target', is_admin: true }] })

      // Transaction
      pool.connect.mockResolvedValue(client)
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // BEGIN
      mockClientQuery.mockResolvedValueOnce({
        // Fetch current roles
        rows: [{ role_id: 'role-customer-support' }],
      })
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // DELETE roles
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // INSERT roles
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // INSERT audit_log
      mockClientQuery.mockResolvedValueOnce({ rows: [] }) // COMMIT

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      const result = await service.updateStaffRoles(
        'target',
        ['role-crm-verification', 'role-finance'],
        'actor',
        '10.0.0.1',
        'Promoting to CRM and Finance',
      )

      expect(result.userId).toBe('target')
      expect(result.roleIds).toEqual(['role-crm-verification', 'role-finance'])
      expect(result.previousRoleIds).toEqual(['role-customer-support'])
      expect(mockRelease).toHaveBeenCalled()
    })

    it('throws 404 when target user does not exist', async () => {
      const { pool } = mockPool()
      pool.query.mockResolvedValueOnce({ rows: [] })

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      let caught: unknown
      try {
        await service.updateStaffRoles('nonexistent', ['role-admin'], 'actor', '10.0.0.1')
      } catch (e) {
        caught = e
      }

      expect(caught).toBeInstanceOf(HttpException)
      expect((caught as HttpException).getStatus()).toBe(404)
    })

    it('throws 400 when roleIds contain invalid role IDs', async () => {
      const { pool } = mockPool()
      pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'target', is_admin: true }] })

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      let caught: unknown
      try {
        await service.updateStaffRoles('target', ['nonexistent-role'], 'actor', '10.0.0.1')
      } catch (e) {
        caught = e
      }

      expect(caught).toBeInstanceOf(HttpException)
      expect((caught as HttpException).getStatus()).toBe(400)
    })
  })

  describe('getProfileVerificationMode', () => {
    it('returns DISABLED when config key is not set', async () => {
      const { pool } = mockPool()
      pool.query.mockResolvedValueOnce({ rows: [] })

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      const result = await service.getProfileVerificationMode()
      expect(result.mode).toBe('DISABLED')
    })

    it('returns the configured mode from app_config', async () => {
      const { pool } = mockPool()
      pool.query.mockResolvedValueOnce({ rows: [{ value: 'MANUAL' }] })

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      const result = await service.getProfileVerificationMode()
      expect(result.mode).toBe('MANUAL')
    })
  })

  describe('setProfileVerificationMode', () => {
    it('upserts the config value and bumps global version', async () => {
      const { pool } = mockPool()
      const { mockClientQuery, mockRelease, client } = mockClient()
      pool.connect.mockResolvedValue(client)
      mockClientQuery.mockResolvedValue({ rows: [] }) // BEGIN
      mockClientQuery.mockResolvedValue({ rows: [] }) // INSERT/UPDATE
      mockClientQuery.mockResolvedValue({ rows: [] }) // config_version bump
      mockClientQuery.mockResolvedValue({ rows: [] }) // audit_log insert
      mockClientQuery.mockResolvedValue({ rows: [] }) // COMMIT

      vi.doMock('@barghsa/db', () => mockDbModule(pool))
      const { AdminService: Svc } = await import('./admin.service.js')
      service = new Svc()

      const result = await service.setProfileVerificationMode('API', 'actor', '10.0.0.1')
      expect(result.mode).toBe('API')
      expect(mockClientQuery).toHaveBeenCalled()
      expect(mockRelease).toHaveBeenCalled()
    })
  })
})