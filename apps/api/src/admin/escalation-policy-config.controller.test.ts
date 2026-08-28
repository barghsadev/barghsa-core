import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DEFAULT_ESCALATION_POLICIES } from '@barghsa/shared/admin'
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
  const getEscalationPolicy = vi
    .fn()
    .mockResolvedValue(DEFAULT_ESCALATION_POLICIES)
  const setEscalationPolicy = vi.fn().mockResolvedValue(DEFAULT_ESCALATION_POLICIES)
  const adminService = {
    getEscalationPolicy,
    setEscalationPolicy,
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

// ─── Tests — permission gate (T-09.08.03) ─────────────────────────────

describe('escalation-policy config permission gate (T-09.08.03)', () => {
  it('rejects non-admin on getEscalationPolicy with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .getEscalationPolicy(nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on setEscalationPolicy with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .setEscalationPolicy({ ticket: null }, nonAdminReq)
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
      .setEscalationPolicy({ ticket: null }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(adminService.setEscalationPolicy).not.toHaveBeenCalled()
  })

  it('allows admin to read the policy and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    await expect(controller.getEscalationPolicy(adminReq)).resolves.toEqual(
      DEFAULT_ESCALATION_POLICIES,
    )
    expect(adminService.getEscalationPolicy).toHaveBeenCalledTimes(1)
  })

  it('allows admin to write the policy and passes the actor/ip to the service', async () => {
    const { controller, adminService } = makeController()
    const body = {
      ticket: {
        level2: { delayHours: 24, channels: ['in_app'] },
        level3: { delayHours: 48, channels: ['in_app'] },
      },
    }
    const result = await controller.setEscalationPolicy(body, adminReq)
    expect(result).toEqual(DEFAULT_ESCALATION_POLICIES)
    expect(adminService.setEscalationPolicy).toHaveBeenCalledWith(
      body,
      'admin-1',
      '127.0.0.1',
    )
  })
})