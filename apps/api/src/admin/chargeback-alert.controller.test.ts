import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import { FINANCE_CHARGEBACK_ALERT_PERMISSION } from '@barghsa/shared/finance'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ChargebackAlertController } from './chargeback-alert.controller.js'

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'staff-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) return error.getResponse() as Record<string, unknown>
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('ChargebackAlertController (T-04.2.04.03)', () => {
  it('rejects non-admin viewers with AUTHZ_FORBIDDEN', async () => {
    const getDashboardWarning = vi.fn()
    const controller = new ChargebackAlertController({ getDashboardWarning } as never)
    const rejection = await controller.unresolvedWarning(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(String(rejectionBody(rejection).message)).toContain(FINANCE_CHARGEBACK_ALERT_PERMISSION)
    expect(getDashboardWarning).not.toHaveBeenCalled()
  })

  it('returns the dashboard warning for an admin session', async () => {
    const warning = {
      count: 1,
      unmatchedCount: 1,
      reversalFailedCount: 0,
      items: [],
    }
    const getDashboardWarning = vi.fn().mockResolvedValue(warning)
    const controller = new ChargebackAlertController({ getDashboardWarning } as never)
    await expect(controller.unresolvedWarning(adminReq)).resolves.toEqual(warning)
    expect(getDashboardWarning).toHaveBeenCalledTimes(1)
  })
})
