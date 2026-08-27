import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { SmsProviderConfigController } from './sms-provider-config.controller.js'
import { SmsProviderConfigService } from './sms-provider-config.service.js'

// ─── Mock service ─────────────────────────────────────────────────────────

const mockUpdate = vi.fn()
const mockCreate = vi.fn()
const mockActivate = vi.fn()
const mockDisable = vi.fn()
const mockRollback = vi.fn()
const mockTestConnection = vi.fn()
const mockList = vi.fn()
const mockAvailableEvents = vi.fn()
const mockService = {
  update: mockUpdate,
  create: mockCreate,
  activate: mockActivate,
  disable: mockDisable,
  rollback: mockRollback,
  testConnection: mockTestConnection,
  list: mockList,
  availableTemplateEventKeys: mockAvailableEvents,
} as unknown as SmsProviderConfigService

const adminReq = { session: { isAdmin: true, userId: 'admin-1' } } as never
const nonAdminReq = { session: { isAdmin: false, userId: 'admin-1' } } as never

function baseResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cfg-1',
    transport: 'smsir',
    label: 'Prod SMS',
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

describe('SmsProviderConfigController (T-09.06.02)', () => {
  let controller: SmsProviderConfigController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new SmsProviderConfigController(mockService)
  })

  describe('POST /api/admin/sms-providers', () => {
    it('creates a draft config for an admin', async () => {
      mockCreate.mockResolvedValue(baseResult({ label: 'Prod SMS' }))
      const result = await controller.create(adminReq, {
        label: 'Prod SMS',
        config: {
          api_key: 'k',
          sender: '9830000000',
          timeout: 15,
          throughput_limit: 100,
          low_credit_threshold: 0,
        },
      })
      expect(result.label).toBe('Prod SMS')
      expect(mockCreate).toHaveBeenCalledWith({
        label: 'Prod SMS',
        config: expect.objectContaining({ api_key: 'k', sender: '9830000000' }),
        createdBy: 'admin-1',
      })
    })

    it('rejects a caller without admin with 403', async () => {
      await expect(
        controller.create(nonAdminReq, {
          label: 'x',
          config: { api_key: 'k', sender: 's', timeout: 15, throughput_limit: 100, low_credit_threshold: 0 },
        }),
      ).rejects.toBeInstanceOf(HttpException)
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  describe('PUT /api/admin/sms-providers/:id', () => {
    it('updates a draft config for an admin', async () => {
      mockUpdate.mockResolvedValue(baseResult({ label: 'Renamed' }))
      const result = await controller.update(adminReq, 'cfg-1', { label: 'Renamed' })
      expect(result.label).toBe('Renamed')
      expect(mockUpdate).toHaveBeenCalledWith('cfg-1', { label: 'Renamed' })
    })

    it('rejects a non-admin with 403', async () => {
      await expect(controller.update(nonAdminReq, 'cfg-1', { label: 'x' })).rejects.toBeInstanceOf(
        HttpException,
      )
      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })

  describe('POST :id/test-connection', () => {
    it('runs the connection test and returns outcome + state', async () => {
      mockTestConnection.mockResolvedValue({
        ok: true,
        error: null,
        result: baseResult({ lastTestStatus: 'passed' }),
      })
      const result = await controller.testConnection(adminReq, 'cfg-1', {
        recipient: '989121234567',
        eventKey: 'otp:login',
      })
      expect(result.test.ok).toBe(true)
      expect(result.lastTestStatus).toBe('passed')
      expect(mockTestConnection).toHaveBeenCalledWith('cfg-1', '989121234567', 'otp:login')
    })

    it('rejects an invalid recipient mobile with 400', async () => {
      await expect(
        controller.testConnection(adminReq, 'cfg-1', { recipient: 'not-a-number' }),
      ).rejects.toBeInstanceOf(HttpException)
      expect(mockTestConnection).not.toHaveBeenCalled()
    })
  })

  describe('activate / disable / rollback', () => {
    it('activates a config for an admin', async () => {
      mockActivate.mockResolvedValue(baseResult({ status: 'active' }))
      const result = await controller.activate(adminReq, 'cfg-1')
      expect(result.status).toBe('active')
      expect(mockActivate).toHaveBeenCalledWith('cfg-1', 'admin-1')
    })

    it('disables a config for an admin', async () => {
      mockDisable.mockResolvedValue(baseResult({ status: 'disabled' }))
      const result = await controller.disable(adminReq, 'cfg-1')
      expect(result.status).toBe('disabled')
    })

    it('rolls back for an admin', async () => {
      mockRollback.mockResolvedValue(baseResult({ status: 'active' }))
      const result = await controller.rollback(adminReq, 'cfg-9')
      expect(mockRollback).toHaveBeenCalledWith('cfg-9', 'admin-1')
      expect(result.status).toBe('active')
    })
  })

  describe('template-event-keys', () => {
    it('returns the set of mappable event keys', async () => {
      mockAvailableEvents.mockResolvedValue(new Set(['otp:login', 'invoice:created']))
      const result = await controller.templateEventKeys(adminReq)
      expect(result.sort()).toEqual(['invoice:created', 'otp:login'])
    })
  })
})