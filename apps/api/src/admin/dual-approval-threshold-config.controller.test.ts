import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DEFAULT_DUAL_APPROVAL_CONFIG } from '@barghsa/shared/finance'
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
  const getDualApprovalThresholdConfig = vi.fn().mockResolvedValue(DEFAULT_DUAL_APPROVAL_CONFIG)
  const setDualApprovalThresholdConfig = vi
    .fn()
    .mockResolvedValue({ thresholdIrR: 500_000_000 })
  const adminService = {
    getDualApprovalThresholdConfig,
    setDualApprovalThresholdConfig,
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

// ─── Tests — permission gate (T-09.07.01) ─────────────────────────────

describe('dual-approval-threshold config permission gate (T-09.07.01)', () => {
  it('rejects non-admin on getDualApprovalThreshold with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .getDualApprovalThreshold(nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on setDualApprovalThreshold with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .setDualApprovalThreshold({ threshold_irr: 500_000_000 }, nonAdminReq)
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
      .setDualApprovalThreshold({ threshold_irr: 500_000_000 }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(adminService.setDualApprovalThresholdConfig).not.toHaveBeenCalled()
  })

  it('allows admin to read the threshold and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    await expect(controller.getDualApprovalThreshold(adminReq)).resolves.toEqual(
      DEFAULT_DUAL_APPROVAL_CONFIG,
    )
    expect(adminService.getDualApprovalThresholdConfig).toHaveBeenCalledTimes(1)
  })

  it('allows admin to write the threshold and passes the actor/ip to the service', async () => {
    const { controller, adminService } = makeController()
    const body = { threshold_irr: 500_000_000 }
    const result = await controller.setDualApprovalThreshold(body, adminReq)
    expect(result).toEqual({ thresholdIrR: 500_000_000 })
    expect(adminService.setDualApprovalThresholdConfig).toHaveBeenCalledWith(
      body,
      'admin-1',
      '127.0.0.1',
    )
  })
})
