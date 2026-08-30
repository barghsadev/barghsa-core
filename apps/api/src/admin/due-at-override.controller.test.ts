import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { DueAtOverrideController } from './due-at-override.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'
import { DUE_AT_OVERRIDE_PERMISSION } from '@barghsa/shared/finance'

const INVOICE_ID = '11111111-1111-7111-8111-111111111111'

const DTO = {
  invoiceId: INVOICE_ID,
  state: 'Unpaid' as const,
  issuedAt: '2026-08-01T10:00:00.000Z',
  payableFrom: '2026-08-01T10:00:00.000Z',
  dueAt: '2026-08-08T10:00:00.000Z',
  canOverride: true,
  dueAtOverride: null,
}

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'staff-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const BODY = {
  dueAt: '2026-09-15T08:00:00.000Z',
  reason: 'Customer requested an extension',
}

function makeController() {
  const get = vi.fn().mockResolvedValue(DTO)
  const override = vi.fn().mockResolvedValue({
    ...DTO,
    dueAt: BODY.dueAt,
    auditId: 'audit-1',
    dueAtOverride: {
      dueAt: BODY.dueAt,
      previousDueAt: DTO.dueAt,
      reason: BODY.reason,
      actorUserId: 'admin-1',
      overriddenAt: '2026-08-02T12:00:00.000Z',
      customerVisible: true as const,
    },
  })
  const service = { get, override }
  const correlationId = { getCorrelationId: vi.fn().mockReturnValue('corr-1') }
  const controller = new DueAtOverrideController(service as never, correlationId as never)
  return { controller, service, correlationId }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('dueAt override permission gate (T-04.1.03.03)', () => {
  it('rejects non-admin on get with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.get(nonAdminReq, INVOICE_ID).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(String(rejectionBody(rejection).message)).toContain(DUE_AT_OVERRIDE_PERMISSION)
    expect(service.get).not.toHaveBeenCalled()
  })

  it('rejects non-admin on override with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .override(nonAdminReq, INVOICE_ID, BODY)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(service.override).not.toHaveBeenCalled()
  })

  it('rejects a non-UUID invoiceId before calling the service', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.get(adminReq, 'not-a-uuid').catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
    expect(service.get).not.toHaveBeenCalled()
  })

  it('allows admin get and returns the service payload', async () => {
    const { controller, service } = makeController()
    const result = await controller.get(adminReq, INVOICE_ID)
    expect(result).toEqual(DTO)
    expect(service.get).toHaveBeenCalledWith(INVOICE_ID)
  })

  it('forwards body, actor, ip, and correlation id to override for admins', async () => {
    const { controller, service } = makeController()
    await controller.override(adminReq, INVOICE_ID, BODY)
    expect(service.override).toHaveBeenCalledWith({
      invoiceId: INVOICE_ID,
      raw: BODY,
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
      correlationId: 'corr-1',
    })
  })
})
