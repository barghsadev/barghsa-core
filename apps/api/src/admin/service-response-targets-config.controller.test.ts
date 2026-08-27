import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DEFAULT_SERVICE_RESPONSE_TARGETS } from '@barghsa/shared/admin'
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
  const getServiceResponseTargets = vi
    .fn()
    .mockResolvedValue(DEFAULT_SERVICE_RESPONSE_TARGETS)
  const setServiceResponseTargets = vi.fn().mockResolvedValue({ ticket: 48, verification_case: null })
  const adminService = {
    getServiceResponseTargets,
    setServiceResponseTargets,
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

// ─── Tests — permission gate (T-09.08.01) ─────────────────────────────

describe('service-response-targets config permission gate (T-09.08.01)', () => {
  it('rejects non-admin on getServiceResponseTargets with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .getServiceResponseTargets(nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on setServiceResponseTargets with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .setServiceResponseTargets({ ticket: 48 }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('does not call the service when the permission gate rejects', async () => {
    const { controller, adminService } = makeController()
    await controller
      .setServiceResponseTargets({ ticket: 48 }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(adminService.setServiceResponseTargets).not.toHaveBeenCalled()
  })

  it('allows admin to read the targets and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    await expect(controller.getServiceResponseTargets(adminReq)).resolves.toEqual(
      DEFAULT_SERVICE_RESPONSE_TARGETS,
    )
    expect(adminService.getServiceResponseTargets).toHaveBeenCalledTimes(1)
  })

  it('allows admin to write the targets and passes the actor/ip to the service', async () => {
    const { controller, adminService } = makeController()
    const body = { ticket: 48 }
    const result = await controller.setServiceResponseTargets(body, adminReq)
    expect(result).toEqual({ ticket: 48, verification_case: null })
    expect(adminService.setServiceResponseTargets).toHaveBeenCalledWith(
      body,
      'admin-1',
      '127.0.0.1',
    )
  })
})
