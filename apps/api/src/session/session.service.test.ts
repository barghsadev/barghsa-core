import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { SessionService } from './session.service.js'

const mockQuery = vi.fn()
const mockConnect = vi.fn()
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}
const mockPool = {
  query: mockQuery,
  connect: mockConnect,
}

vi.mock('@barghsa/db', () => ({
  getDbPool: vi.fn(() => mockPool),
}))

/**
 * Build a fake session row.
 */
function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-001',
    user_id: 'user-001',
    csrf_token: 'csrf-token-001',
    is_admin: false,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    idle_deadline: new Date(Date.now() + 30 * 60 * 1000),
    revoked_at: null,
    family_id: 'family-001',
    device_info: null,
    created_at: new Date(Date.now() - 60 * 1000),
    updated_at: new Date(Date.now() - 60 * 1000),
    ...overrides,
  }
}

/**
 * Build a fake refresh token row.
 */
function makeTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'token-001',
    family_id: 'family-001',
    token_hash: createHash('sha256').update('test-refresh-token').digest('hex'),
    user_id: 'user-001',
    session_id: 'session-001',
    version: 1,
    consumed_at: null,
    created_at: new Date(Date.now() - 60 * 1000),
    ...overrides,
  }
}

describe('SessionService', () => {
  let service: SessionService

  beforeEach(() => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(mockClient)
    mockClient.query.mockReset()
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT' || sql.startsWith('ROLLBACK')) return { rows: [] }
      return { rows: [] }
    })
    mockClient.release.mockReset()
    service = new SessionService()
  })

  // ────────────────────────────────────────────────────────────
  // validateSession
  // ────────────────────────────────────────────────────────────

  describe('validateSession', () => {
    it('returns session data for a valid, unexpired session', async () => {
      const row = makeSessionRow()
      mockQuery.mockResolvedValueOnce({ rows: [row] })
      mockQuery.mockResolvedValueOnce({ rows: [] }) // UPDATE idle_deadline

      const result = await service.validateSession('session-001')

      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe('session-001')
      expect(result!.userId).toBe('user-001')
      expect(result!.csrfToken).toBe('csrf-token-001')
    })

    it('returns null when session does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.validateSession('nonexistent')
      expect(result).toBeNull()
    })

    it('returns null when session is revoked', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeSessionRow({ revoked_at: new Date() })],
      })

      const result = await service.validateSession('session-001')
      expect(result).toBeNull()
    })

    it('returns null when absolute expiry has passed', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeSessionRow({ expires_at: new Date(Date.now() - 60_000) })],
      })

      const result = await service.validateSession('session-001')
      expect(result).toBeNull()
    })

    it('returns null when idle deadline has passed', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeSessionRow({ idle_deadline: new Date(Date.now() - 60_000) })],
      })

      const result = await service.validateSession('session-001')
      expect(result).toBeNull()
    })

    it('slides idle_deadline on successful validation when touchOnValidate is true', async () => {
      const row = makeSessionRow()
      mockQuery.mockResolvedValueOnce({ rows: [row] })
      mockQuery.mockResolvedValueOnce({ rows: [] }) // UPDATE

      await service.validateSession('session-001', true)

      // Second query should be the idle_deadline update
      const secondCall = mockQuery.mock.calls[1]!
      expect(secondCall[0]).toContain('UPDATE sessions')
      expect(secondCall[0]).toContain('idle_deadline')
    })

    it('returns null on transient DB error (conservative failure mode)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection lost'))

      const result = await service.validateSession('session-001')
      expect(result).toBeNull()
    })
  })

  // ────────────────────────────────────────────────────────────
  // createSession
  // ────────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('creates a session and returns credentials', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        // SELECT FOR UPDATE → no existing sessions
        if (sql.includes('FOR UPDATE')) return { rows: [] }
        // INSERT → success
        return { rows: [] }
      })

      const result = await service.createSession('user-001', false, {
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      })

      expect(result.sessionId).toBeDefined()
      expect(result.csrfToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.expiresAt).toBeInstanceOf(Date)
      expect(typeof result.csrfToken).toBe('string')
      expect(result.csrfToken.length).toBeGreaterThan(0)
    })

    it('revokes oldest session when limit is reached (50)', async () => {
      // Build 50 active sessions
      const sessions50 = Array.from({ length: 50 }, (_, i) => ({
        session_id: `session-${String(i).padStart(3, '0')}`,
      }))

      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: sessions50 }
        // The revoke-oldest query
        if (sql.includes('UPDATE sessions') && sql.includes('LIMIT 1'))
          return { rows: [] }
        // INSERT
        return { rows: [] }
      })

      await service.createSession('user-001', false)

      // Verify that a revoke query was issued
      const calls = mockClient.query.mock.calls.map((c: any[]) => c[0])
      const revokeCall = calls.find(
        (s: any) =>
          s.includes('UPDATE sessions') &&
          s.includes('revoked_at') &&
          s.includes('LIMIT 1'),
      )
      expect(revokeCall).toBeDefined()
    })

    it('uses BEGIN/COMMIT transaction', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: [] }
        return { rows: [] }
      })

      await service.createSession('user-001', false)

      const calls = mockClient.query.mock.calls.map((c: any[]) => c[0])
      expect(calls).toContain('BEGIN')
      expect(calls).toContain('COMMIT')
    })

    it('releases the client in finally', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) return { rows: [] }
        return { rows: [] }
      })

      await service.createSession('user-001', false)
      expect(mockClient.release).toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────
  // redeemRefreshToken
  // ────────────────────────────────────────────────────────────

  describe('redeemRefreshToken', () => {
    const validToken = 'test-refresh-token'

    it('redeems and rotates a valid refresh token', async () => {
      const tokenRow = makeTokenRow()
      const sessionRow = makeSessionRow()

      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('token_hash')) return { rows: [tokenRow] }
        if (sql.includes('session_id = $1')) return { rows: [sessionRow] }
        // Consume old token
        if (sql.includes('consumed_at')) return { rows: [] }
        // INSERT new token
        if (sql.includes('INSERT INTO refresh_tokens')) return { rows: [] }
        // UPDATE session
        if (sql.includes('UPDATE sessions')) return { rows: [] }
        return { rows: [] }
      })

      const result = await service.redeemRefreshToken(validToken)

      expect(result.refreshToken).toBeDefined()
      expect(result.sessionId).toBe('session-001')
      // New refresh token should differ from input
      expect(result.refreshToken).not.toBe(validToken)
    })

    it('revokes entire family when a consumed token is reused (theft detection)', async () => {
      const consumedToken = makeTokenRow({ consumed_at: new Date() })

      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('token_hash')) return { rows: [consumedToken] }
        // Revoke family tokens
        if (
          (sql.includes('refresh_tokens') && sql.includes('consumed_at')) ||
          (sql.includes('sessions') && sql.includes('revoked_at'))
        )
          return { rows: [] }
        return { rows: [] }
      })

      await expect(
        service.redeemRefreshToken('reused-token'),
      ).rejects.toThrow(UnauthorizedException)

      // Verify family queries were issued
      const calls = mockClient.query.mock.calls.map((c: any[]) => c[0])
      const familyTokenUpdate = calls.filter(
        (s: string) =>
          s.includes('UPDATE refresh_tokens') && s.includes('consumed_at'),
      )
      const familySessionUpdate = calls.filter(
        (s: string) =>
          s.includes('UPDATE sessions') && s.includes('revoked_at'),
      )
      expect(familyTokenUpdate.length).toBeGreaterThan(0)
      expect(familySessionUpdate.length).toBeGreaterThan(0)
    })

    it('rejects a token whose session is expired', async () => {
      const tokenRow = makeTokenRow()
      const expiredSession = makeSessionRow({
        expires_at: new Date(Date.now() - 60_000),
      })

      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('token_hash')) return { rows: [tokenRow] }
        if (sql.includes('session_id = $1')) return { rows: [expiredSession] }
        return { rows: [] }
      })

      await expect(
        service.redeemRefreshToken(validToken),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('rejects an unknown token hash', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('token_hash')) return { rows: [] }
        return { rows: [] }
      })

      await expect(
        service.redeemRefreshToken('nonexistent'),
      ).rejects.toThrow(UnauthorizedException)
    })
  })

  // ────────────────────────────────────────────────────────────
  // revokeSession
  // ────────────────────────────────────────────────────────────

  describe('revokeSession', () => {
    it('revokes a session and consumes its family tokens', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('family_id')) return { rows: [makeSessionRow()] }
        // UPDATE sessions → revoke
        if (sql.includes('sessions') && sql.includes('revoked_at'))
          return { rows: [] }
        // UPDATE refresh_tokens → consume
        if (sql.includes('refresh_tokens') && sql.includes('consumed_at'))
          return { rows: [] }
        return { rows: [] }
      })

      await service.revokeSession('session-001')

      const calls = mockClient.query.mock.calls.map((c: any[]) => c[0])
      expect(calls).toContain('BEGIN')
      expect(calls).toContain('COMMIT')
    })

    it('does nothing for a nonexistent session', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('family_id')) return { rows: [] }
        return { rows: [] }
      })

      await service.revokeSession('nonexistent')

      // Should not throw
      expect(true).toBe(true)
    })
  })

  // ────────────────────────────────────────────────────────────
  // revokeAllUserSessions
  // ────────────────────────────────────────────────────────────

  describe('revokeAllUserSessions', () => {
    it('revokes all sessions and tokens for a user', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        return { rows: [] }
      })

      await service.revokeAllUserSessions('user-001')

      const calls = mockClient.query.mock.calls.map((c: any[]) => c[0])
      const sessionUpdate = calls.find(
        (s: string) =>
          s.includes('UPDATE sessions') && s.includes('revoked_at'),
      )
      const tokenUpdate = calls.find(
        (s: string) =>
          s.includes('UPDATE refresh_tokens') && s.includes('consumed_at'),
      )
      expect(sessionUpdate).toBeDefined()
      expect(tokenUpdate).toBeDefined()
    })

    it('excludes a specified session when excludeSessionId is provided', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        return { rows: [] }
      })

      await service.revokeAllUserSessions('user-001', 'session-001')

      const calls = mockClient.query.mock.calls.map((c: any[]) => c[0])
      const excludeCall = calls.find((s: any) => s.includes('session_id !='))
      expect(excludeCall).toBeDefined()
      // Verify the parameters include the excluded session
      const excludeCallParams = mockClient.query.mock.calls.find(
        (c: any[]) =>
          c[0].includes('session_id !='),
      )?.[1]
      expect(excludeCallParams).toContain('session-001')
    })
  })

  // ────────────────────────────────────────────────────────────
  // rotateSession
  // ────────────────────────────────────────────────────────────

  describe('rotateSession', () => {
    it('rotates to a new session and returns fresh credentials', async () => {
      const oldSession = makeSessionRow({ family_id: 'family-001' })

      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'COMMIT') return { rows: [] }
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        // Find old session FOR UPDATE
        if (sql.includes('FOR UPDATE') && sql.includes('sessions'))
          return { rows: [oldSession] }
        // Revoke old session
        if (sql.includes('UPDATE sessions') && !sql.includes('INSERT'))
          return { rows: [] }
        // Insert new session
        if (sql.includes('INSERT INTO sessions')) return { rows: [] }
        // Get next version
        if (sql.includes('MAX(version)')) return { rows: [{ next_ver: 2 }] }
        // Insert new token
        if (sql.includes('INSERT INTO refresh_tokens')) return { rows: [] }
        // Consume others
        if (sql.includes('consumed_at')) return { rows: [] }
        return { rows: [] }
      })

      const result = await service.rotateSession('session-001', 'test')

      expect(result).not.toBeNull()
      expect(result!.sessionId).not.toBe('session-001')
      expect(result!.csrfToken).toBeDefined()
      expect(result!.refreshToken).toBeDefined()
    })

    it('returns null when old session is not found', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('ROLLBACK')) return { rows: [] }
        if (sql.includes('FOR UPDATE')) return { rows: [] }
        return { rows: [] }
      })

      const result = await service.rotateSession('nonexistent', 'test')
      expect(result).toBeNull()
    })
  })
})