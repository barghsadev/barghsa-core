import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ContractElectricityLimitsController } from './contract-electricity-limits.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const DEFAULT_DTO = {
  maxQuantityIncreasePercent: 20,
  maxContractDuration: 24,
  leadTimeDays: 0,
}

const VALID_BODY = {
  max_quantity_increase_percent: 20,
  max_contract_duration_months: 24,
  lead_time_days: 0,
}

function makeController() {
  const get = vi.fn().mockResolvedValue(DEFAULT_DTO)
  const update = vi.fn().mockResolvedValue(DEFAULT_DTO)
  const service = { get, update }
  const controller = new ContractElectricityLimitsController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('contract electricity limits permission gate (T-09.12.06)', () => {
  it('rejects non-admin on get with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.get(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(service.get).not.toHaveBeenCalled()
  })

  it('rejects non-admin on update with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller, service } = makeController()
    const rejection = await controller
      .update(nonAdminReq, VALID_BODY)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(service.update).not.toHaveBeenCalled()
  })

  it('allows admin get and returns the service payload', async () => {
    const { controller, service } = makeController()
    const result = await controller.get(adminReq)
    expect(result).toEqual(DEFAULT_DTO)
    expect(service.get).toHaveBeenCalledTimes(1)
  })

  it('forwards the parsed body, actor, and ip to update for admins', async () => {
    const { controller, service } = makeController()
    await controller.update(adminReq, VALID_BODY)
    expect(service.update).toHaveBeenCalledWith({
      raw: VALID_BODY,
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
  })

  it('passes through a validation HttpException from the service unchanged', async () => {
    const update = vi
      .fn()
      .mockRejectedValue(
        new HttpException(
          {
            statusCode: 400,
            error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: 'max_quantity_increase_percent is required; lead_time_days must be an integer between 0 and 36500',
          },
          400,
        ),
      )
    const controller = new ContractElectricityLimitsController({ get: vi.fn(), update } as never)
    const rejection = await controller
      .update(adminReq, { max_contract_duration_months: 24 })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
  })
})