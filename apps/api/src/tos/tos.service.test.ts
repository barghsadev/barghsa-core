import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TosService } from './tos.service.js'
import { HttpException } from '@nestjs/common'

// Shared mock pool
const mockPool = {
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

describe('TosService', () => {
  let service: TosService

  beforeEach(() => {
    service = new TosService()
    mockPool.query.mockReset()
  })

  describe('getCurrent', () => {
    const activeVersion = {
      id: '00000000-0000-0000-0000-000000000001',
      version_id: 'v1',
      content_fa: 'قوانین استفاده نسخه ۱',
      content_en: 'Terms of Service version 1',
      is_active: true,
      published_at: new Date('2026-01-01T00:00:00Z'),
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    }

    it('returns Persian content by default', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [activeVersion] })

      const result = await service.getCurrent()

      expect(result.content).toBe('قوانین استفاده نسخه ۱')
      expect(result.versionId).toBe('v1')
      expect(result.updatedAt).toEqual(activeVersion.updated_at)
      expect(result.publishedAt).toEqual(activeVersion.published_at)
    })

    it('returns Persian content when locale is fa', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [activeVersion] })

      const result = await service.getCurrent('fa')

      expect(result.content).toBe('قوانین استفاده نسخه ۱')
    })

    it('returns English content when locale is en', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [activeVersion] })

      const result = await service.getCurrent('en')

      expect(result.content).toBe('Terms of Service version 1')
    })

    it('throws 404 with TOS_NOT_FOUND code when no active version exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const err = await service.getCurrent().catch((e) => e)

      expect(err).toBeInstanceOf(HttpException)
      expect(err.getStatus()).toBe(404)
      expect(err.getResponse()).toMatchObject({
        message: 'No active TOS version found',
        code: 'TOS_NOT_FOUND',
      })
    })

    it('queries with ORDER BY published_at DESC', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [activeVersion] })

      await service.getCurrent()

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY published_at DESC'),
      )
    })

    it('queries only active versions', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [activeVersion] })

      await service.getCurrent()

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE is_active = true'),
      )
    })

    it('throws when database query fails', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'))

      await expect(service.getCurrent()).rejects.toThrow('Database error')
    })
  })
})