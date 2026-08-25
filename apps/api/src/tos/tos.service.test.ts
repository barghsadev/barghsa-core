import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TosService } from './tos.service.js'
import { HttpException } from '@nestjs/common'

// Shared mock pool
const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
}

// Mock client for transaction tests
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

vi.mock('uuid', () => ({
  v7: () => '00000000-0000-0000-0000-000000000099',
}))

vi.mock('@barghsa/shared/errors', () => ({
  ErrorCodes: {
    AUTH_REGISTER_TOS_NOT_ACCEPTED: { code: 'AUTH:REGISTER:TOS_NOT_ACCEPTED' },
    VALIDATION_INPUT_INVALID: { code: 'VALIDATION:INPUT:INVALID' },
    INTERNAL_SERVER: { code: 'INTERNAL:SERVER' },
  },
}))

describe('TosService', () => {
  let service: TosService

  beforeEach(() => {
    service = new TosService()
    mockPool.query.mockReset()
    mockPool.connect.mockReset()
    mockClient.query.mockReset()
    mockClient.release.mockReset()
    mockPool.connect.mockResolvedValue(mockClient)
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

  describe('recordAcceptance', () => {
    const userId = 'user-0001'
    const versionId = 'tos-ver-uuid'
    const ip = '192.168.1.1'
    const userAgent = 'TestAgent/1.0'

    beforeEach(() => {
      mockClient.query.mockResolvedValue({ rows: [] })
    })

    it('inserts acceptance record and updates user on success', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: versionId }] }) // SELECT tos_versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT tos_acceptances
        .mockResolvedValueOnce({ rows: [] }) // UPDATE users
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      await service.recordAcceptance(userId, versionId, ip, userAgent)

      // Verify the INSERT into tos_acceptances
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tos_acceptances'),
        expect.arrayContaining([
          expect.any(String),
          userId,
          versionId,
          expect.any(Date),
          ip,
          userAgent,
        ]),
      )

      // Verify the UPDATE on users
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.arrayContaining([versionId, expect.any(Date), userId]),
      )

      expect(mockClient.release).toHaveBeenCalled()
    })

    it('throws 400 when TOS version does not exist or is not active', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT tos_versions returns empty (version not found or not active)

      const err = await service
        .recordAcceptance(userId, versionId, ip)
        .catch((e) => e)

      expect(err).toBeInstanceOf(HttpException)
      expect(err.getStatus()).toBe(400)
      expect(err.getResponse()).toMatchObject({
        error: 'VALIDATION:INPUT:INVALID',
      })
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('rolls back on database error and throws 500', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('DB connection lost'))

      const err = await service
        .recordAcceptance(userId, versionId, ip)
        .catch((e) => e)

      expect(err).toBeInstanceOf(HttpException)
      expect(err.getStatus()).toBe(500)
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('records acceptance without user_agent when not provided', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: versionId }] }) // SELECT tos_versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT tos_acceptances
        .mockResolvedValueOnce({ rows: [] }) // UPDATE users
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      await service.recordAcceptance(userId, versionId, ip)

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tos_acceptances'),
        expect.arrayContaining([null]),
      )
    })
  })
})