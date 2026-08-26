import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminGeographyService } from './admin-geography.service.js'

// Shared mock pool
const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

vi.mock('uuid', () => ({
  v7: () => 'test-uuid-v7',
}))

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'province-001',
    name_fa: 'تهران',
    name_en: 'Tehran',
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-15T00:00:00Z'),
    ...overrides,
  }
}

describe('AdminGeographyService', () => {
  let service: AdminGeographyService

  beforeEach(() => {
    service = new AdminGeographyService()
    mockPool.query.mockReset()
    mockPool.connect.mockReset()
  })

  // -----------------------------------------------------------------------
  // listProvinces
  // -----------------------------------------------------------------------

  describe('listProvinces', () => {
    it('lists provinces with default pagination', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: '2' }] })
        .mockResolvedValueOnce({
          rows: [
            makeRow({ id: 'province-002', name_en: 'Isfahan', name_fa: 'اصفهان', updated_at: new Date('2026-02-01T00:00:00Z') }),
            makeRow({ id: 'province-001', name_en: 'Tehran', name_fa: 'تهران' }),
          ],
        })

      const result = await service.listProvinces()

      expect(result.total).toBe(2)
      expect(result.provinces).toHaveLength(2)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
      expect(result.provinces[0]!.nameEn).toBe('Isfahan')
      expect(mockPool.query).toHaveBeenCalledTimes(2)
    })

    it('filters by search query', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({
          rows: [makeRow()],
        })

      const result = await service.listProvinces({ search: 'Teh' })

      expect(result.total).toBe(1)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.arrayContaining(['%Teh%']),
      )
    })

    it('filters by status', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({
          rows: [makeRow()],
        })

      const result = await service.listProvinces({ status: 'active' })

      expect(result.total).toBe(1)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('status = $1'),
        ['active'],
      )
    })

    it('returns empty list when no provinces match', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await service.listProvinces({ search: 'zzzzz' })

      expect(result.total).toBe(0)
      expect(result.provinces).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // getProvince
  // -----------------------------------------------------------------------

  describe('getProvince', () => {
    it('returns province by id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })

      const result = await service.getProvince('province-001')

      expect(result).not.toBeNull()
      expect(result!.nameFa).toBe('تهران')
      expect(result!.nameEn).toBe('Tehran')
    })

    it('returns null for non-existent province', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.getProvince('non-existent')

      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // createProvince
  // -----------------------------------------------------------------------

  describe('createProvince', () => {
    it('creates a province and returns it', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [makeRow({ id: 'test-uuid-v7', name_fa: 'اصفهان', name_en: 'Isfahan' })],
      })

      const result = await service.createProvince({ nameFa: 'اصفهان', nameEn: 'Isfahan' })

      expect(result.id).toBe('test-uuid-v7')
      expect(result.nameFa).toBe('اصفهان')
      expect(result.nameEn).toBe('Isfahan')
    })

    it('throws 409 on duplicate name (PG error 23505)', async () => {
      mockPool.query.mockRejectedValueOnce({ code: '23505' })

      const promise = service.createProvince({ nameFa: 'اصفهان', nameEn: 'Isfahan' })
      await expect(promise).rejects.toThrow(HttpException)
      try { await promise } catch (e) {
        expect((e as HttpException).getStatus()).toBe(409)
      }
    })

    it('throws 500 on unexpected DB error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Connection lost'))

      const promise = service.createProvince({ nameFa: 'تهران', nameEn: 'Tehran' })
      await expect(promise).rejects.toThrow(HttpException)
      try { await promise } catch (e) {
        expect((e as HttpException).getStatus()).toBe(500)
      }
    })
  })

  // -----------------------------------------------------------------------
  // updateProvince
  // -----------------------------------------------------------------------

  describe('updateProvince', () => {
    it('updates province fields and returns updated row', async () => {
      // First call: getProvince check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      // Second call: UPDATE
      mockPool.query.mockResolvedValueOnce({
        rows: [makeRow({ name_en: 'Tehran Updated' })],
      })

      const result = await service.updateProvince('province-001', { nameEn: 'Tehran Updated' })

      expect(result).not.toBeNull()
      expect(result!.nameEn).toBe('Tehran Updated')
    })

    it('returns null for non-existent province', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.updateProvince('non-existent', { nameEn: 'Test' })

      expect(result).toBeNull()
    })

    it('returns existing row when no changes provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })

      const result = await service.updateProvince('province-001', {})

      expect(result).not.toBeNull()
      expect(result!.nameEn).toBe('Tehran')
      // No UPDATE query should have been made
      expect(mockPool.query).toHaveBeenCalledTimes(1)
    })

    it('throws 409 on duplicate name conflict', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      mockPool.query.mockRejectedValueOnce({ code: '23505' })

      const promise = service.updateProvince('province-001', { nameEn: 'Duplicate' })
      await expect(promise).rejects.toThrow(HttpException)
      try { await promise } catch (e) {
        expect((e as HttpException).getStatus()).toBe(409)
      }
    })
  })

  // -----------------------------------------------------------------------
  // deleteProvince
  // -----------------------------------------------------------------------

  describe('deleteProvince', () => {
    it('soft-deletes a province by setting inactive', async () => {
      // getProvince check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      // City count check (0 cities)
      mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
      // UPDATE to set inactive
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.deleteProvince('province-001')

      expect(result).toBe(true)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'inactive'"),
        ['province-001'],
      )
    })

    it('returns false for non-existent province', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await service.deleteProvince('non-existent')

      expect(result).toBe(false)
    })

    it('throws 409 when province has cities', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '5' }] })

      const promise = service.deleteProvince('province-001')
      await expect(promise).rejects.toThrow(HttpException)
      try { await promise } catch (e) {
        expect((e as HttpException).getStatus()).toBe(409)
      }
    })
  })
})