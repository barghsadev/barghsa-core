import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfilesService } from './profiles.service.js'
import { ConfigCacheService } from '../config-cache/config-cache.service.js'

// Shared mock pool so all calls to getDbPool() return the same instance
const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
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