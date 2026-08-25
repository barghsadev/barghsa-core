import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LegalProfilesService } from './legal-profiles.service.js'
import { ProfilesService } from './profiles.service.js'
import { ConfigCacheService } from '../config-cache/config-cache.service.js'

// Shared mock pool so all calls to getDbPool() return the same instance
const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
}
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

describe('LegalProfilesService', () => {
  let service: LegalProfilesService
  let profilesService: ProfilesService
  let configCache: ConfigCacheService

  const mockProfileRow = {
    id: 'prof-legal-1',
    user_id: 'user-1',
    profile_type: 'LEGAL',
    is_default: true,
    status: 'DRAFT',
    title: null,
    first_name: null,
    last_name: null,
    national_id: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  }

  beforeEach(() => {
    configCache = {
      get: vi.fn(),
    } as unknown as ConfigCacheService

    profilesService = new ProfilesService(configCache)
    service = new LegalProfilesService(profilesService)
    mockPool.query.mockReset()
    mockPool.connect.mockReset()
    mockClient.query.mockReset()
    mockClient.release.mockReset()
    mockPool.connect.mockResolvedValue(mockClient)
  })

  describe('saveLegalProfile', () => {
    const validData = {
      legalName: 'Barghsa LLC',
      nationalIdentifier: '12345678901',
      registrationNumber: '56789',
      companyTypeId: 'limited-liability',
      representativeTitle: 'CEO',
      representativeRelationship: 'Director',
    }

    it('saves a legal profile successfully', async () => {
      // Profile lookup (getProfileById)
      mockPool.query.mockResolvedValueOnce({
        rows: [mockProfileRow],
      })

      // Transaction: BEGIN, UPDATE profiles, INSERT legal_profiles, UPDATE status, COMMIT
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })            // BEGIN
        .mockResolvedValueOnce({
          rows: [{ ...mockProfileRow, title: 'Barghsa LLC', status: 'DRAFT' }],
        })                                                // UPDATE profiles
        .mockResolvedValueOnce({ rowCount: 1 })           // INSERT legal_profiles
        .mockResolvedValueOnce({ rowCount: 1 })           // UPDATE profiles status -> ACTIVE
        .mockResolvedValueOnce(undefined)                  // COMMIT

      // Re-fetch after commit
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockProfileRow, title: 'Barghsa LLC', status: 'ACTIVE' }],
      })

      const result = await service.saveLegalProfile('user-1', 'prof-legal-1', validData)

      expect(result.status).toBe('ACTIVE')
      expect(result.title).toBe('Barghsa LLC')

      // Check the INSERT included the legal profile data
      const insertCall = mockClient.query.mock.calls[2]
      expect(insertCall).toBeDefined()
      expect(insertCall![0]).toContain('INSERT INTO legal_profiles')
      expect(insertCall![1]).toContain('prof-legal-1')
      expect(insertCall![1]).toContain('Barghsa LLC')
      expect(insertCall![1]).toContain('12345678901')

      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('rejects when profile is not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.saveLegalProfile('user-1', 'nonexistent', validData),
      ).rejects.toThrow('Profile not found')
    })

    it('rejects when profile is not owned by the user', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockProfileRow, user_id: 'other-user' }],
      })

      await expect(
        service.saveLegalProfile('user-1', 'prof-legal-1', validData),
      ).rejects.toThrow('Profile not found')
    })

    it('rejects when profile is not in DRAFT state', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockProfileRow, status: 'ACTIVE' }],
      })

      await expect(
        service.saveLegalProfile('user-1', 'prof-legal-1', validData),
      ).rejects.toThrow('Profile is not in draft state')
    })

    it('rejects invalid national identifier format', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockProfileRow],
      })

      await expect(
        service.saveLegalProfile('user-1', 'prof-legal-1', {
          ...validData,
          nationalIdentifier: '123', // too short
        }),
      ).rejects.toThrow('Invalid national identifier format')
    })

    it('rejects non-numeric national identifier', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockProfileRow],
      })

      await expect(
        service.saveLegalProfile('user-1', 'prof-legal-1', {
          ...validData,
          nationalIdentifier: 'abcabcabcab',
        }),
      ).rejects.toThrow('Invalid national identifier format')
    })

    it('rejects all-same-digit national identifier', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockProfileRow],
      })

      await expect(
        service.saveLegalProfile('user-1', 'prof-legal-1', {
          ...validData,
          nationalIdentifier: '11111111111',
        }),
      ).rejects.toThrow('Invalid national identifier format')
    })

    it('rejects invalid postal code format', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockProfileRow],
      })

      await expect(
        service.saveLegalProfile('user-1', 'prof-legal-1', {
          ...validData,
          officialPostalCode: '0123456789', // starts with 0
        }),
      ).rejects.toThrow('Invalid postal code format')
    })

    it('handles unique constraint violation (409)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockProfileRow],
      })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })              // BEGIN
        .mockResolvedValueOnce({
          rows: [{ ...mockProfileRow, title: 'Barghsa LLC', status: 'DRAFT' }],
        })
        .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))         // INSERT fails
        .mockResolvedValueOnce(undefined)                  // ROLLBACK

      await expect(
        service.saveLegalProfile('user-1', 'prof-legal-1', validData),
      ).rejects.toThrow('This national identifier is already registered')
    })

    it('creates address record when official address is provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockProfileRow],
      })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })              // BEGIN
        .mockResolvedValueOnce({
          rows: [{ ...mockProfileRow, title: 'Barghsa LLC', status: 'DRAFT' }],
        })
        .mockResolvedValueOnce({ rowCount: 1 })            // INSERT legal_profiles
        .mockResolvedValueOnce({ rowCount: 1 })            // INSERT addresses
        .mockResolvedValueOnce({ rowCount: 1 })            // UPDATE status -> ACTIVE
        .mockResolvedValueOnce(undefined)                  // COMMIT

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockProfileRow, title: 'Barghsa LLC', status: 'ACTIVE' }],
      })

      await service.saveLegalProfile('user-1', 'prof-legal-1', {
        ...validData,
        officialProvinceId: 'prov-1',
        officialCityId: 'city-1',
        officialFullAddress: '123 Main St, Tehran',
        officialPostalCode: '1234567890',
      })

      // Check the address INSERT was called
      const addressInsert = mockClient.query.mock.calls[3]
      expect(addressInsert).toBeDefined()
      expect(addressInsert![0]).toContain('INSERT INTO addresses')
      expect(addressInsert![1]).toContain('prov-1')
      expect(addressInsert![1]).toContain('city-1')
    })

    it('rolls back on database error', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockProfileRow],
      })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })              // BEGIN
        .mockResolvedValueOnce({
          rows: [{ ...mockProfileRow, title: 'Barghsa LLC', status: 'DRAFT' }],
        })
        .mockRejectedValueOnce(new Error('DB error'))      // INSERT fails
        .mockResolvedValueOnce(undefined)                  // ROLLBACK

      await expect(
        service.saveLegalProfile('user-1', 'prof-legal-1', validData),
      ).rejects.toThrow('DB error')

      expect(mockClient.query.mock.calls[3]![0]).toBe('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })
  })
})