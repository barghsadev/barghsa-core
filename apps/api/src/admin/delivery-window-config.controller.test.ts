import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DEFAULT_DELIVERY_WINDOW } from '@barghsa/shared/notifications'
import { ErrorCodes } from '@barghsa/shared/errors'

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

/** Extract the HttpException payload an assertion helper can check. */
function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Tests — permission gate (T-09.06.03) ─────────────────────────────

describe('delivery-window config permission gate (T-09.06.03)', () => {
  it('rejects non-admin on getDeliveryWindow with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller.getDeliveryWindow(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on setDeliveryWindow with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .setDeliveryWindow({ timezone: 'UTC', start_hour: 8, end_hour: 20 }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('does not call the service when the permission gate rejects', async () => {
    const { controller, adminService } = makeController()
    await controller.setDeliveryWindow({ timezone: 'UTC', start_hour: 8, end_hour: 20 }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(adminService.setDeliveryWindowConfig).not.toHaveBeenCalled()
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
