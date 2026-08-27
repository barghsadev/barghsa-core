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
const mockService = {
  update: mockUpdate,
  create: mockCreate,
  activate: mockActivate,
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

    it('rejects a non-admin caller with 403', async () => {
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
})