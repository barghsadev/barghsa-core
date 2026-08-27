import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import {
  EmailProviderConfigController,
} from './email-provider-config.controller.js'
import { EmailProviderConfigService } from './email-provider-config.service.js'

// ─── Mock service ─────────────────────────────────────────────────────────

const mockUpdate = vi.fn()
const mockCreate = vi.fn()
const mockActivate = vi.fn()
const mockList = vi.fn()
const mockService = {
  update: mockUpdate,
  create: mockCreate,
  activate: mockActivate,
  list: mockList,
} as unknown as EmailProviderConfigService

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
} as never

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
} as never

function baseResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cfg-1',
    transport: 'smtp',
    label: 'Prod',
    status: 'draft',
    createdBy: 'admin-1',
    activatedAt: null,
    activatedBy: null,
    lastTestAt: null,
    lastTestStatus: 'pending',
    lastTestError: null,
    supersedesId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    maskedConfig: {},
    ...over,
  }
}

describe('EmailProviderConfigController', () => {
  let controller: EmailProviderConfigController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new EmailProviderConfigController(mockService)
  })

  describe('PUT /api/admin/email-providers/:id', () => {
    it('updates a draft provider config and returns the updated row', async () => {
      mockUpdate.mockResolvedValue(baseResult({ label: 'Renamed' }))
      const result = await controller.update(
        adminReq,
        'cfg-1',
        { label: 'Renamed', config: { host: 'smtp.example.com' } },
      )
      expect(result.label).toBe('Renamed')
      expect(mockUpdate).toHaveBeenCalledWith('cfg-1', {
        label: 'Renamed',
        config: { host: 'smtp.example.com' },
      })
    })

    it('supports updating only the label', async () => {
      mockUpdate.mockResolvedValue(baseResult({ label: 'Only Label' }))
      const result = await controller.update(adminReq, 'cfg-1', { label: 'Only Label' })
      expect(result.label).toBe('Only Label')
      expect(mockUpdate).toHaveBeenCalledWith('cfg-1', { label: 'Only Label' })
    })

    it('rejects a caller without the provider-edit permission with 403', async () => {
      await expect(controller.update(nonAdminReq, 'cfg-1', { label: 'x' })).rejects.toBeInstanceOf(
        HttpException,
      )
    })

    it('rejects an invalid body with 400', async () => {
      await expect(controller.update(adminReq, 'cfg-1', { label: '' } as never)).rejects.toMatchObject({
        status: 400,
      })
    })
  })

  describe('permission + step-up metadata (T-09.06.01)', () => {
    it('requires step-up on create (a provider-config mutation)', () => {
      const meta =
        Reflect.getMetadata('requiresStepUp', EmailProviderConfigController.prototype.create)
      expect(meta).toBe(true)
    })

    it('requires step-up on update', () => {
      const meta =
        Reflect.getMetadata('requiresStepUp', EmailProviderConfigController.prototype.update)
      expect(meta).toBe(true)
    })

    it('requires step-up on activate', () => {
      const meta =
        Reflect.getMetadata('requiresStepUp', EmailProviderConfigController.prototype.activate)
      expect(meta).toBe(true)
    })

    it('requires step-up on disable', () => {
      const meta =
        Reflect.getMetadata('requiresStepUp', EmailProviderConfigController.prototype.disable)
      expect(meta).toBe(true)
    })

    it('requires step-up on rollback', () => {
      const meta =
        Reflect.getMetadata('requiresStepUp', EmailProviderConfigController.prototype.rollback)
      expect(meta).toBe(true)
    })

    it('requires step-up on recordTest', () => {
      const meta =
        Reflect.getMetadata('requiresStepUp', EmailProviderConfigController.prototype.recordTest)
      expect(meta).toBe(true)
    })

    it('requires step-up on testConnection', () => {
      const meta =
        Reflect.getMetadata(
          'requiresStepUp',
          EmailProviderConfigController.prototype.testConnection,
        )
      expect(meta).toBe(true)
    })

    it('does not require step-up for the read-only list', () => {
      const meta =
        Reflect.getMetadata('requiresStepUp', EmailProviderConfigController.prototype.list)
      expect(meta ?? false).toBe(false)
    })

    it('rejects non-admin on list via permission gate', async () => {
      await expect(controller.list(nonAdminReq)).rejects.toMatchObject({ status: 403 })
    })

    it('allows admin on list', async () => {
      // list() calls assertProviderEditPermission then service.list()
      await expect(controller.list(adminReq)).resolves.toBeUndefined()
    })
  })
})