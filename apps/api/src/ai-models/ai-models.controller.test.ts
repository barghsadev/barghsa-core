import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AiModelsController } from './ai-models.controller.js'
import type { AiModelsService } from './ai-models.service.js'

// ─── Mock service ─────────────────────────────────────────────────────────

const mockList = vi.fn()
const mockGet = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockRemove = vi.fn()
const mockTest = vi.fn()
const mockService = {
  list: mockList,
  get: mockGet,
  create: mockCreate,
  update: mockUpdate,
  remove: mockRemove,
  test: mockTest,
} as unknown as AiModelsService

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '10.0.0.8',
  socket: { remoteAddress: '10.0.0.8' },
} as never

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '10.0.0.8',
} as never

function baseModel(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    title: 'OpenAI GPT-4o',
    providerType: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4o',
    apiTokenMasked: '********1234',
    status: 'unknown',
    lastTestedAt: null,
    lastTestError: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

describe('AiModelsController (T-09.11.01)', () => {
  let controller: AiModelsController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new AiModelsController(mockService)
  })

  describe('permission gate (admin:ai:models)', () => {
    it('rejects non-admin sessions on every route with 403', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({
        status: 403,
      })
      await expect(controller.get(nonAdminReq, 'm-1')).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.create(nonAdminReq, {
          title: 'x',
          providerType: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          modelName: 'm',
        }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        controller.update(nonAdminReq, 'm-1', { title: 'y' }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(controller.remove(nonAdminReq, 'm-1')).rejects.toMatchObject({ status: 403 })
      await expect(controller.test(nonAdminReq, 'm-1')).rejects.toMatchObject({ status: 403 })
      expect(mockService.list).not.toHaveBeenCalled()
    })

    it('allows platform-admin sessions', async () => {
      mockList.mockResolvedValue([])
      await expect(controller.list(adminReq)).resolves.toEqual([])
    })
  })

  describe('POST /api/admin/ai-models', () => {
    it('rejects an invalid body and never calls the service', async () => {
      await expect(
        controller.create(adminReq, {
          title: '',
          providerType: 'bogus' as never,
          baseUrl: 'ftp://nope',
          modelName: '',
        }),
      ).rejects.toBeInstanceOf(HttpException)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('rejects a non-http(s) base URL', async () => {
      await expect(
        controller.create(adminReq, {
          title: 'x',
          providerType: 'openai_compatible',
          baseUrl: 'file:///etc/passwd',
          modelName: 'm',
        }),
      ).rejects.toBeInstanceOf(HttpException)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('creates a model with the actor and ip from the session/request', async () => {
      mockCreate.mockResolvedValue(baseModel())
      const result = await controller.create(adminReq, {
        title: 'OpenAI GPT-4o',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
        apiToken: 'sk-new',
      })
      expect(result.id).toBe('m-1')
      expect(mockCreate).toHaveBeenCalledWith({
        title: 'OpenAI GPT-4o',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
        apiToken: 'sk-new',
        actorUserId: 'admin-1',
        ip: '10.0.0.8',
      })
    })
  })

  describe('PUT /api/admin/ai-models/:id', () => {
    it('updates a model with partial fields', async () => {
      mockUpdate.mockResolvedValue(baseModel({ title: 'Renamed' }))
      const result = await controller.update(adminReq, 'm-1', { title: 'Renamed' })
      expect(result.title).toBe('Renamed')
      expect(mockUpdate).toHaveBeenCalledWith(
        'm-1',
        expect.objectContaining({ title: 'Renamed', actorUserId: 'admin-1', ip: '10.0.0.8' }),
      )
    })

    it('rejects an empty update body', async () => {
      await expect(controller.update(adminReq, 'm-1', {})).rejects.toBeInstanceOf(HttpException)
      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /api/admin/ai-models/:id', () => {
    it('deletes the model', async () => {
      mockRemove.mockResolvedValue(undefined)
      await expect(controller.remove(adminReq, 'm-1')).resolves.toBeUndefined()
      expect(mockRemove).toHaveBeenCalledWith('m-1', 'admin-1', '10.0.0.8')
    })
  })

  describe('POST /api/admin/ai-models/:id/test', () => {
    it('runs the connection test and returns the refreshed model + outcome', async () => {
      mockTest.mockResolvedValue({
        model: baseModel({ status: 'reachable' }),
        test: { ok: true, responsePreview: 'pong', latencyMs: 120 },
      })
      const result = await controller.test(adminReq, 'm-1')
      expect(result.test.ok).toBe(true)
      expect(result.model.status).toBe('reachable')
      expect(mockTest).toHaveBeenCalledWith('m-1', 'admin-1', '10.0.0.8')
    })
  })

  describe('GET routes', () => {
    it('returns a single model via get()', async () => {
      mockGet.mockResolvedValue(baseModel())
      const result = await controller.get(adminReq, 'm-1')
      expect(result.id).toBe('m-1')
      expect(mockGet).toHaveBeenCalledWith('m-1')
    })
  })
})
