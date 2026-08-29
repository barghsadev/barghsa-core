import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
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
  const listStaffAudit = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 })
  const adminService = { listStaffAudit }
  const controller = new AdminController(
    adminService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { controller, listStaffAudit }
}

/** Extract the HttpException payload an assertion helper can check. */
function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Tests — staff permission audit endpoint (T-10.01.02) ─────────────

describe('staff permission audit endpoint (T-10.01.02)', () => {
  it('rejects non-admin with the AUTHZ_FORBIDDEN contract and does not call the service', async () => {
    const { controller, listStaffAudit } = makeController()
    const rejection = await controller.listStaffAudit(undefined, undefined, undefined, undefined, undefined, nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(listStaffAudit).not.toHaveBeenCalled()
  })

  it('delegates to the service with no filters for an admin', async () => {
    const { controller, listStaffAudit } = makeController()
    await controller.listStaffAudit(undefined, undefined, undefined, undefined, undefined, adminReq)
    expect(listStaffAudit).toHaveBeenCalledTimes(1)
    expect(listStaffAudit).toHaveBeenCalledWith({})
  })

  it('passes userId/from/to and finite limit/offset through to the service', async () => {
    const { controller, listStaffAudit } = makeController()
    await controller.listStaffAudit(
      '11111111-2222-4333-8444-555555555555',
      '2026-08-01T00:00:00Z',
      '2026-08-31T23:59:59Z',
      '25',
      '10',
      adminReq,
    )
    expect(listStaffAudit).toHaveBeenCalledWith({
      userId: '11111111-2222-4333-8444-555555555555',
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T23:59:59Z',
      limit: 25,
      offset: 10,
    })
  })

  it('ignores non-numeric limit/offset query values', async () => {
    const { controller, listStaffAudit } = makeController()
    await controller.listStaffAudit(undefined, undefined, undefined, 'abc', 'xyz', adminReq)
    expect(listStaffAudit).toHaveBeenCalledWith({})
  })

  it('returns the service result to the caller', async () => {
    const { controller, listStaffAudit } = makeController()
    const payload = {
      items: [{ id: 'audit-1' }],
      total: 1,
      limit: 50,
      offset: 0,
    }
    listStaffAudit.mockResolvedValue(payload)
    await expect(controller.listStaffAudit(undefined, undefined, undefined, undefined, undefined, adminReq)).resolves.toEqual(payload)
  })
})