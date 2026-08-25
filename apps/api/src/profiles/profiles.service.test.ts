import { describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('ProfilesService', () => {
  let service: ProfilesService
  let configCache: ConfigCacheService

  beforeEach(() => {
    configCache = {
      get: vi.fn(),
    } as unknown as ConfigCacheService

    service = new ProfilesService(configCache)
    mockPool.query.mockReset()
    mockPool.connect.mockReset()
    mockClient.query.mockReset()
    mockClient.release.mockReset()
    mockPool.connect.mockResolvedValue(mockClient)
  })

  describe('canPlaceCommercialOrder', () => {
    it('returns true when verification is not required', async () => {
      vi.mocked(configCache.get).mockResolvedValue(false)
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'prof-1',
            user_id: 'user-1',
            profile_type: 'INDIVIDUAL',
            is_default: true,
            status: 'ACTIVE',
            title: null,
            first_name: 'John',
            last_name: 'Doe',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      })

      const result = await service.canPlaceCommercialOrder('user-1')
      expect(result).toBe(true)
    })

    it('returns false when verification is required and profile is not verified', async () => {
      vi.mocked(configCache.get).mockResolvedValue(true)
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'prof-1',
            user_id: 'user-1',
            profile_type: 'INDIVIDUAL',
            is_default: true,
            status: 'ACTIVE',
            title: null,
            first_name: 'John',
            last_name: 'Doe',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      })

      const result = await service.canPlaceCommercialOrder('user-1')
      expect(result).toBe(false)
    })

    it('returns true when verification is required and profile is verified', async () => {
      vi.mocked(configCache.get).mockResolvedValue(true)
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'prof-1',
            user_id: 'user-1',
            profile_type: 'INDIVIDUAL',
            is_default: true,
            status: 'VERIFIED',
            title: null,
            first_name: 'John',
            last_name: 'Doe',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      })

      const result = await service.canPlaceCommercialOrder('user-1')
      expect(result).toBe(true)
    })
  })

  describe('createProfile', () => {
    it('creates an INDIVIDUAL profile as default when user has no default', async () => {
      // No existing default profile
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })                  // BEGIN (void)
        .mockResolvedValueOnce({ rows: [] })                  // check existing default
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'prof-new',
              user_id: 'user-1',
              profile_type: 'INDIVIDUAL',
              is_default: true,
              status: 'DRAFT',
              title: null,
              first_name: null,
              last_name: null,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce(undefined)                     // COMMIT (void)

      const result = await service.createProfile('user-1', 'INDIVIDUAL')

      expect(result.id).toBe('prof-new')
      expect(result.profileType).toBe('INDIVIDUAL')
      expect(result.status).toBe('DRAFT')
      expect(result.isDefault).toBe(true)

      // Should have called BEGIN, check default, INSERT, COMMIT
      expect(mockClient.query).toHaveBeenCalledTimes(4)
      expect(mockClient.query.mock.calls[0]![0]).toBe('BEGIN')
      expect(mockClient.query.mock.calls[2]![0]).toContain('INSERT INTO profiles')
      expect(mockClient.query.mock.calls[3]![0]).toBe('COMMIT')
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('creates a LEGAL profile without setting as default when one already exists', async () => {
      // Existing default profile found
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })                  // BEGIN (void)
        .mockResolvedValueOnce({ rows: [{ id: 'existing' }] }) // default exists
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'prof-new',
              user_id: 'user-1',
              profile_type: 'LEGAL',
              is_default: false,
              status: 'DRAFT',
              title: null,
              first_name: null,
              last_name: null,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce(undefined)                     // COMMIT (void)

      const result = await service.createProfile('user-1', 'LEGAL')

      expect(result.profileType).toBe('LEGAL')
      expect(result.isDefault).toBe(false)
      expect(result.status).toBe('DRAFT')
    })

    it('rolls back on database error', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })                  // BEGIN (void)
        .mockRejectedValueOnce(new Error('DB error'))         // check fails
        .mockResolvedValueOnce(undefined)                     // ROLLBACK (void)

      await expect(
        service.createProfile('user-1', 'INDIVIDUAL'),
      ).rejects.toThrow('DB error')

      expect(mockClient.query.mock.calls[2]![0]).toBe('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })
  })

  describe('getVerificationStatus', () => {
    it('returns verificationRequired=false when no default profile', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })

      const result = await service.getVerificationStatus('user-1')
      expect(result.activeProfileId).toBeNull()
      expect(result.verificationRequired).toBe(false)
      expect(result.isVerified).toBe(false)
    })

    it('returns correct fields when profile exists and verification is not required', async () => {
      vi.mocked(configCache.get).mockResolvedValue(false)
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'prof-1',
            user_id: 'user-1',
            profile_type: 'INDIVIDUAL',
            is_default: true,
            status: 'ACTIVE',
            title: null,
            first_name: 'John',
            last_name: 'Doe',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      })

      const result = await service.getVerificationStatus('user-1')
      expect(result.activeProfileId).toBe('prof-1')
      expect(result.isVerified).toBe(false)
      expect(result.verificationRequired).toBe(false)
      expect(result.canAutoVerify).toBe(false)
    })

    it('returns canAutoVerify=true when method=api, enforcement=on, profile unverified', async () => {
      vi.mocked(configCache.get)
        .mockResolvedValueOnce(true)  // verification.required
        .mockResolvedValueOnce('api') // verification.method

      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'prof-1',
            user_id: 'user-1',
            profile_type: 'INDIVIDUAL',
            is_default: true,
            status: 'ACTIVE',
            title: null,
            first_name: 'John',
            last_name: 'Doe',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      })

      const result = await service.getVerificationStatus('user-1')
      expect(result.isVerified).toBe(false)
      expect(result.verificationRequired).toBe(true)
      expect(result.verificationMethod).toBe('api')
      expect(result.canAutoVerify).toBe(true)
    })
  })

  describe('verifyProfileApi', () => {
    it('rejects when verification method is manual (default)', async () => {
      vi.mocked(configCache.get).mockResolvedValue(null)
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'prof-1',
            user_id: 'user-1',
            profile_type: 'INDIVIDUAL',
            is_default: true,
            status: 'ACTIVE',
            title: null,
            first_name: 'John',
            last_name: 'Doe',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      })

      await expect(
        service.verifyProfileApi('user-1', 'prof-1'),
      ).rejects.toThrow("Cannot auto-verify: verification method is 'manual', not 'api'")
    })

    it('updates profile to VERIFIED when method is api', async () => {
      vi.mocked(configCache.get).mockResolvedValue('api')

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'prof-1',
              user_id: 'user-1',
              profile_type: 'INDIVIDUAL',
              is_default: true,
              status: 'ACTIVE',
              title: null,
              first_name: 'John',
              last_name: 'Doe',
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 })

      await service.verifyProfileApi('user-1', 'prof-1')

      expect(mockPool.query).toHaveBeenCalledTimes(2)
      const updateCall = mockPool.query.mock.calls[1]
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toContain("UPDATE profiles SET status = 'VERIFIED'")
    })
  })
})