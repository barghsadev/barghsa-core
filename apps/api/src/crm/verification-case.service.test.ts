import { describe, it, expect, beforeEach, vi } from 'vitest'
import { VerificationCaseService } from './verification-case.service.js'

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

let service: VerificationCaseService

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

const VALID_PROFILE_ID = '00000000-0000-7000-8000-000000000001'
const VALID_USER_ID = '00000000-0000-7000-8000-000000000010'
const VALID_CASE_ID = '00000000-0000-7000-8000-000000000020'
const IP = '127.0.0.1'

describe('VerificationCaseService', () => {
  describe('createCase', () => {
    it('returns null when profile is not found', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({ rows: [] })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.createCase(
        VALID_PROFILE_ID,
        { fieldName: 'first_name', currentValue: 'John', requestedValue: 'Jane', reason: 'Name correction' },
        VALID_USER_ID,
        IP,
      )

      expect(result).toBeNull()
    })

    it('returns error for invalid field name', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_PROFILE_ID, profile_type: 'INDIVIDUAL', status: 'VERIFIED' }],
      })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.createCase(
        VALID_PROFILE_ID,
        { fieldName: 'email', currentValue: null, requestedValue: 'new@example.com', reason: 'Fix email' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toContain('not a valid identity field')
    })

    it('returns error for missing requestedValue', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_PROFILE_ID, profile_type: 'INDIVIDUAL', status: 'VERIFIED' }],
      })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.createCase(
        VALID_PROFILE_ID,
        { fieldName: 'first_name', currentValue: 'John', requestedValue: '', reason: 'Name correction' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toContain('requestedValue is required')
    })

    it('returns error for missing reason', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_PROFILE_ID, profile_type: 'INDIVIDUAL', status: 'VERIFIED' }],
      })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.createCase(
        VALID_PROFILE_ID,
        { fieldName: 'first_name', currentValue: 'John', requestedValue: 'Jane', reason: '' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toContain('reason is required')
    })

    it('returns error when duplicate open case exists', async () => {
      const { mockQuery, pool, mockConnect } = mockPool()
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: VALID_PROFILE_ID, profile_type: 'INDIVIDUAL', status: 'VERIFIED' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: VALID_CASE_ID }],
        })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.createCase(
        VALID_PROFILE_ID,
        { fieldName: 'first_name', currentValue: 'John', requestedValue: 'Jane', reason: 'Name correction' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toContain('open verification case already exists')
    })

    it('creates a verification case successfully', async () => {
      const { mockQuery, pool, mockConnect } = mockPool()
      const { client, mockClientQuery, mockRelease } = mockClient()
      mockConnect.mockResolvedValue(client)
      mockClientQuery.mockResolvedValue({ rows: [] })

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: VALID_PROFILE_ID, profile_type: 'INDIVIDUAL', status: 'VERIFIED' }],
        })
        .mockResolvedValueOnce({ rows: [] }) // no duplicate

      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
      vi.doMock('uuid', () => ({ v7: () => VALID_CASE_ID }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.createCase(
        VALID_PROFILE_ID,
        { fieldName: 'last_name', currentValue: 'Doe', requestedValue: 'Smith', evidenceUrls: ['https://s3.example.com/doc1.pdf'], reason: 'Legal name correction' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toEqual({
        success: true,
        id: VALID_CASE_ID,
        status: 'Open',
        createdAt: expect.any(String),
      })

      // Verify transaction calls
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN')
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT')
      expect(mockRelease).toHaveBeenCalled()
    })

    it('handles LEGAL profile identity fields', async () => {
      const { mockQuery, pool, mockConnect } = mockPool()
      const { client, mockClientQuery, mockRelease } = mockClient()
      mockConnect.mockResolvedValue(client)
      mockClientQuery.mockResolvedValue({ rows: [] })

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: VALID_PROFILE_ID, profile_type: 'LEGAL', status: 'VERIFIED' }],
        })
        .mockResolvedValueOnce({ rows: [] })

      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
      vi.doMock('uuid', () => ({ v7: () => VALID_CASE_ID }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.createCase(
        VALID_PROFILE_ID,
        { fieldName: 'legal_name', currentValue: 'Old Corp', requestedValue: 'New Corp Ltd', reason: 'Company renamed' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toEqual({
        success: true,
        id: VALID_CASE_ID,
        status: 'Open',
        createdAt: expect.any(String),
      })
    })
  })

  describe('listCases', () => {
    it('returns empty list when no cases exist', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.listCases({ limit: 20, offset: 0 })

      expect(result).toEqual({ cases: [], total: 0 })
    })

    it('lists cases with default Open status filter', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery
        .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: VALID_CASE_ID,
              profile_id: VALID_PROFILE_ID,
              field_name: 'first_name',
              requested_value: 'Jane',
              reason: 'Name correction',
              status: 'Open',
              created_by: VALID_USER_ID,
              created_at: '2026-08-26T10:00:00.000Z',
              updated_at: '2026-08-26T10:00:00.000Z',
            },
            {
              id: 'case-002',
              profile_id: VALID_PROFILE_ID,
              field_name: 'last_name',
              requested_value: 'Smith',
              reason: 'Legal name',
              status: 'Under Review',
              created_by: VALID_USER_ID,
              created_at: '2026-08-25T10:00:00.000Z',
              updated_at: '2026-08-25T10:00:00.000Z',
            },
          ],
        })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.listCases({ limit: 20, offset: 0 })
      expect('error' in result).toBe(false)

      if (!('error' in result)) {
        expect(result.total).toBe(2)
        expect(result.cases).toHaveLength(2)
        expect(result.cases[0]!.id).toBe(VALID_CASE_ID)
        expect(result.cases[0]!.fieldName).toBe('first_name')
      }
    })

    it('filters by profileId', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery
        .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })
        .mockResolvedValueOnce({
          rows: [{
            id: VALID_CASE_ID,
            profile_id: VALID_PROFILE_ID,
            field_name: 'first_name',
            requested_value: 'Jane',
            reason: 'Name correction',
            status: 'Open',
            created_by: VALID_USER_ID,
            created_at: '2026-08-26T10:00:00.000Z',
            updated_at: '2026-08-26T10:00:00.000Z',
          }],
        })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.listCases({ profileId: VALID_PROFILE_ID, limit: 20, offset: 0 })

      expect('error' in result).toBe(false)
      if (!('error' in result)) {
        expect(result.total).toBe(1)
      }
      expect(mockQuery.mock.calls[0]![0]).toContain('profile_id = $1')
    })
  })

  describe('getCase', () => {
    it('returns null when case not found', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({ rows: [] })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.getCase('nonexistent')

      expect(result).toBeNull()
    })

    it('returns full case detail', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: VALID_CASE_ID,
          profile_id: VALID_PROFILE_ID,
          profile_type: 'INDIVIDUAL',
          field_name: 'first_name',
          current_value: 'John',
          requested_value: 'Jane',
          evidence_urls: JSON.stringify(['https://s3.example.com/doc1.pdf']),
          reason: 'Name correction',
          status: 'Open',
          created_by: VALID_USER_ID,
          created_at: '2026-08-26T10:00:00.000Z',
          reviewed_by: null,
          reviewed_at: null,
          reviewer_notes: null,
          updated_at: '2026-08-26T10:00:00.000Z',
        }],
      })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.getCase(VALID_CASE_ID)

      expect(result).not.toBeNull()
      const detail = result as NonNullable<typeof result>
      expect('id' in detail).toBe(true)
      if ('id' in detail) {
        expect(detail.id).toBe(VALID_CASE_ID)
        expect(detail.fieldName).toBe('first_name')
        expect(detail.evidenceUrls).toEqual(['https://s3.example.com/doc1.pdf'])
        expect(detail.reviewedBy).toBeNull()
      }
    })
  })

  describe('reviewCase', () => {
    it('returns null when case not found', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({ rows: [] })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.reviewCase(
        'nonexistent',
        { decision: 'Approved' },
        VALID_USER_ID,
        IP,
      )

      expect(result).toBeNull()
    })

    it('rejects invalid state transition from terminal status', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_CASE_ID, profile_id: VALID_PROFILE_ID, field_name: 'first_name', current_value: 'John', requested_value: 'Jane', status: 'Approved', evidence_urls: '[]' }],
      })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.reviewCase(
        VALID_CASE_ID,
        { decision: 'Approved' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toContain('Cannot transition')
    })

    it('requires reviewer notes for rejection', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_CASE_ID, profile_id: VALID_PROFILE_ID, field_name: 'first_name', current_value: 'John', requested_value: 'Jane', status: 'Open', evidence_urls: '[]' }],
      })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.reviewCase(
        VALID_CASE_ID,
        { decision: 'Rejected' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toContain('Reviewer notes are required')
    })

    it('approves a case from Under Review and returns success with Approved status', async () => {
      const { mockQuery, pool, mockConnect } = mockPool()
      const { client, mockClientQuery, mockRelease } = mockClient()
      mockConnect.mockResolvedValueOnce(client)

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_CASE_ID, profile_id: VALID_PROFILE_ID, field_name: 'first_name', current_value: 'John', requested_value: 'Jane', status: 'Under Review', evidence_urls: '[]' }],
      })
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // UPDATE verification_cases
        .mockResolvedValueOnce(undefined) // UPDATE profiles
        .mockResolvedValueOnce(undefined) // INSERT audit_log
        .mockResolvedValueOnce(undefined) // COMMIT

      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.reviewCase(
        VALID_CASE_ID,
        { decision: 'Approved', reviewerNotes: 'Verified with documents' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      if (result && 'success' in result) {
        expect(result.success).toBe(true)
        expect(result.status).toBe('Approved')
        expect(result.profileId).toBe(VALID_PROFILE_ID)
      }
    })

    it('rejects a case with reviewer notes', async () => {
      const { mockQuery, pool, mockConnect } = mockPool()
      const { client, mockClientQuery, mockRelease } = mockClient()
      mockConnect.mockResolvedValue(client)
      mockClientQuery.mockResolvedValue({ rows: [] })

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_CASE_ID, profile_id: VALID_PROFILE_ID, field_name: 'first_name', current_value: 'John', requested_value: 'Jane', status: 'Open', evidence_urls: '[]' }],
      })

      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.reviewCase(
        VALID_CASE_ID,
        { decision: 'Rejected', reviewerNotes: 'Insufficient evidence' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      if (result && 'success' in result) {
        expect(result.success).toBe(true)
        expect(result.status).toBe('Rejected')
      }
    })

    it('moves case to Under Review', async () => {
      const { mockQuery, pool, mockConnect } = mockPool()
      const { client, mockClientQuery, mockRelease } = mockClient()
      mockConnect.mockResolvedValue(client)
      mockClientQuery.mockResolvedValue({ rows: [] })

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_CASE_ID, profile_id: VALID_PROFILE_ID, field_name: 'first_name', current_value: 'John', requested_value: 'Jane', status: 'Open', evidence_urls: '[]' }],
      })

      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.reviewCase(
        VALID_CASE_ID,
        { decision: 'Under Review' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      if (result && 'success' in result) {
        expect(result.success).toBe(true)
        expect(result.status).toBe('Under Review')
      }
    })

    it('rejects approval with malicious field name (SQL injection prevention)', async () => {
      const { mockQuery, pool } = mockPool()

      // Simulate a case with a malformed field_name (e.g. stored via raw insert)
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: VALID_CASE_ID, profile_id: VALID_PROFILE_ID, field_name: 'email; DROP TABLE users; --', current_value: null, requested_value: 'test@evil.com', status: 'Under Review', evidence_urls: '[]' }],
      })

      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.reviewCase(
        VALID_CASE_ID,
        { decision: 'Approved', reviewerNotes: 'Malicious' },
        VALID_USER_ID,
        IP,
      )

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('error')
      expect((result as { error: string }).error).toContain('Invalid identity field')
    })
  })

  describe('listCases - filters', () => {
    it('filters by status filter', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery
        .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })
        .mockResolvedValueOnce({
          rows: [{
            id: VALID_CASE_ID,
            profile_id: VALID_PROFILE_ID,
            field_name: 'first_name',
            requested_value: 'Jane',
            reason: 'Name correction',
            status: 'Open',
            created_by: VALID_USER_ID,
            created_at: '2026-08-26T10:00:00.000Z',
            updated_at: '2026-08-26T10:00:00.000Z',
          }],
        })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.listCases({ status: 'Open', limit: 20, offset: 0 })

      expect('error' in result).toBe(false)
      if (!('error' in result)) {
        expect(result.total).toBe(2)
      }
      // Verify WHERE clause includes status filter
      expect(mockQuery.mock.calls[0]![0]).toContain('status = $1')
    })

    it('filters by createdBy', async () => {
      const { mockQuery, pool } = mockPool()
      mockQuery
        .mockResolvedValueOnce({ rows: [{ cnt: 1 }] })
        .mockResolvedValueOnce({
          rows: [{
            id: VALID_CASE_ID,
            profile_id: VALID_PROFILE_ID,
            field_name: 'first_name',
            requested_value: 'Jane',
            reason: 'Name correction',
            status: 'Open',
            created_by: VALID_USER_ID,
            created_at: '2026-08-26T10:00:00.000Z',
            updated_at: '2026-08-26T10:00:00.000Z',
          }],
        })
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))

      const { VerificationCaseService: Svc } = await import('./verification-case.service.js')
      service = new Svc()

      const result = await service.listCases({ createdBy: VALID_USER_ID, limit: 20, offset: 0 })

      expect('error' in result).toBe(false)
      if (!('error' in result)) {
        expect(result.total).toBe(1)
      }
      expect(mockQuery.mock.calls[0]![0]).toContain('created_by = $1')
    })
  })
})