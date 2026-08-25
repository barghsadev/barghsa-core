import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeographyService } from './geography.service.js'

// Shared mock pool
const mockPool = {
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

describe('GeographyService', () => {
  let service: GeographyService

  beforeEach(() => {
    service = new GeographyService()
    mockPool.query.mockReset()
  })

  describe('getCompanyTypes', () => {
    it('returns company types ordered by Persian name', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { id: 'private-joint-stock', name_en: 'Private Joint Stock', name_fa: 'سهامی خاص' },
          { id: 'limited-liability', name_en: 'Limited Liability', name_fa: 'مسئولیت محدود' },
          { id: 'public-joint-stock', name_en: 'Public Joint Stock', name_fa: 'سهامی عام' },
        ],
      })

      const result = await service.getCompanyTypes()

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        id: 'private-joint-stock',
        nameEn: 'Private Joint Stock',
        nameFa: 'سهامی خاص',
      })
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, name_en, name_fa FROM company_types'),
      )
    })

    it('returns empty array when no company types exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.getCompanyTypes()

      expect(result).toEqual([])
    })

    it('throws when database query fails', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'))

      await expect(service.getCompanyTypes()).rejects.toThrow('Database error')
    })
  })
})