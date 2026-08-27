import { describe, it, expect, vi } from 'vitest'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DEFAULT_DELIVERY_WINDOW } from '@barghsa/shared/notifications'

// ─── Fixtures ──────────────────────────────────────────────────────────

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

function makeController() {
  const getDeliveryWindowConfig = vi.fn().mockResolvedValue(DEFAULT_DELIVERY_WINDOW)
  const setDeliveryWindowConfig = vi
    .fn()
    .mockResolvedValue({ timezone: 'Asia/Tehran', startHour: 8, endHour: 20 })
  const adminService = {
    getDeliveryWindowConfig,
    setDeliveryWindowConfig,
  }
  const controller = new AdminController(
    adminService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { controller, adminService }
}

// ─── Tests — permission + step-up metadata (T-09.06.03) ──────────────

describe('delivery-window config auth (T-09.06.03)', () => {
  it('requires step-up on setDeliveryWindow (a config mutation)', () => {
    const meta = Reflect.getMetadata('requiresStepUp', AdminController.prototype.setDeliveryWindow)
    expect(meta).toBe(true)
  })

  it('does not require step-up for the read-only getDeliveryWindow', () => {
    const meta = Reflect.getMetadata('requiresStepUp', AdminController.prototype.getDeliveryWindow)
    expect(meta ?? false).toBe(false)
  })

  it('rejects non-admin on getDeliveryWindow via the permission gate', async () => {
    const { controller } = makeController()
    await expect(controller.getDeliveryWindow(nonAdminReq)).rejects.toMatchObject({ status: 403 })
  })

  it('rejects non-admin on setDeliveryWindow via the permission gate', async () => {
    const { controller } = makeController()
    await expect(
      controller.setDeliveryWindow({ timezone: 'UTC', start_hour: 8, end_hour: 20 }, nonAdminReq),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('allows admin to read the window and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    await expect(controller.getDeliveryWindow(adminReq)).resolves.toEqual(DEFAULT_DELIVERY_WINDOW)
    expect(adminService.getDeliveryWindowConfig).toHaveBeenCalledTimes(1)
  })

  it('allows admin to write the window and passes the actor/ip to the service', async () => {
    const { controller, adminService } = makeController()
    const body = { timezone: 'Asia/Tehran', start_hour: 8, end_hour: 20 }
    const result = await controller.setDeliveryWindow(body, adminReq)
    expect(result).toEqual({ timezone: 'Asia/Tehran', startHour: 8, endHour: 20 })
    expect(adminService.setDeliveryWindowConfig).toHaveBeenCalledWith(
      body,
      'admin-1',
      '127.0.0.1',
    )
  })
})