import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ReminderOffsetToggleController } from './reminder-offset-toggle.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  REMINDER_OFFSET_TOGGLE_PERMISSION,
  defaultReminderOffsetToggles,
} from '@barghsa/shared/finance'

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'staff-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const BODY = { serviceType: 'electricity', offset: -7, enabled: false }

function makeController() {
  const matrix = defaultReminderOffsetToggles().map((row) =>
    row.serviceType === 'electricity' && row.offset === -7 ? { ...row, enabled: false } : row,
  )
  const list = vi.fn().mockResolvedValue(defaultReminderOffsetToggles())
  const set = vi.fn().mockResolvedValue(matrix)
  const service = { list, set }
  const controller = new ReminderOffsetToggleController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('reminder offset toggle permission gate (T-04.1.04.05)', () => {
  it('rejects non-admin on list with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.list(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(String(rejectionBody(rejection).message)).toContain(REMINDER_OFFSET_TOGGLE_PERMISSION)
    expect(service.list).not.toHaveBeenCalled()
  })

  it('rejects non-admin on set with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.set(nonAdminReq, BODY).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(service.set).not.toHaveBeenCalled()
  })

  it('allows admin list and returns the service payload', async () => {
    const { controller, service } = makeController()
    const result = await controller.list(adminReq)
    expect(result).toHaveLength(24)
    expect(result.every((row) => row.enabled)).toBe(true)
    expect(service.list).toHaveBeenCalledTimes(1)
  })

  it('allows admin set and delegates actor + ip to the service', async () => {
    const { controller, service } = makeController()
    const result = await controller.set(adminReq, BODY)
    expect(result.find((row) => row.serviceType === 'electricity' && row.offset === -7)?.enabled).toBe(
      false,
    )
    expect(service.set).toHaveBeenCalledWith({
      raw: BODY,
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
  })
})
