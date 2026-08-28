import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG } from '@barghsa/shared/finance'
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
  const getWalletTopUpLimitConfig = vi.fn().mockResolvedValue(DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG)
  const setWalletTopUpLimitConfig = vi
    .fn()
    .mockResolvedValue({ limitIrR: 1_000_000_000 })
  const adminService = {
    getWalletTopUpLimitConfig,
    setWalletTopUpLimitConfig,
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

// ─── Tests — permission gate (T-09.10.01) ─────────────────────────────

describe('wallet-top-up-limit config permission gate (T-09.10.01)', () => {
  it('rejects non-admin on getWalletTopUpLimit with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .getWalletTopUpLimit(nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on setWalletTopUpLimit with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .setWalletTopUpLimit({ limit_irr: 1_000_000_000 }, nonAdminReq)
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
      .setWalletTopUpLimit({ limit_irr: 1_000_000_000 }, nonAdminReq)
      .catch((e: unknown) => e)
    expect(adminService.setWalletTopUpLimitConfig).not.toHaveBeenCalled()
  })

  it('allows admin to read the limit and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    await expect(controller.getWalletTopUpLimit(adminReq)).resolves.toEqual(
      DEFAULT_WALLET_TOP_UP_LIMIT_CONFIG,
    )
    expect(adminService.getWalletTopUpLimitConfig).toHaveBeenCalledTimes(1)
  })

  it('allows admin to write the limit and passes the actor/ip to the service', async () => {
    const { controller, adminService } = makeController()
    const body = { limit_irr: 1_000_000_000 }
    const result = await controller.setWalletTopUpLimit(body, adminReq)
    expect(result).toEqual({ limitIrR: 1_000_000_000 })
    expect(adminService.setWalletTopUpLimitConfig).toHaveBeenCalledWith(
      body,
      'admin-1',
      '127.0.0.1',
    )
  })
})