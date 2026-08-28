import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { AdminController } from './admin.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DEFAULT_GREEN_ELECTRICITY_CONFIG } from '@barghsa/shared/finance'
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

const VALID_BODY = {
  simple_order: {
    mandatory_green_enabled: true,
    average_power_threshold_kw: 1000,
    mandatory_green_share_percent: 4,
  },
  advanced_order: {
    mandatory_green_enabled: false,
    average_power_threshold_kw: 1000,
    mandatory_green_share_percent: 4,
  },
}

function makeController() {
  const getGreenElectricityConfig = vi.fn().mockResolvedValue(DEFAULT_GREEN_ELECTRICITY_CONFIG)
  const setGreenElectricityConfig = vi.fn().mockResolvedValue({
    simpleOrder: {
      mandatoryGreenEnabled: true,
      averagePowerThresholdKw: 1000,
      mandatoryGreenSharePercent: 4,
    },
    advancedOrder: {
      mandatoryGreenEnabled: false,
      averagePowerThresholdKw: 1000,
      mandatoryGreenSharePercent: 4,
    },
  })
  const getGreenElectricitySafetyStatus = vi.fn().mockResolvedValue({
    product: { exists: true, status: 'active', priceIrR: 1_000_000 },
    simpleOrder: { ruleActive: true, blocked: false, reasons: [] },
    advancedOrder: { ruleActive: false, blocked: false, reasons: [] },
  })
  const adminService = {
    getGreenElectricityConfig,
    setGreenElectricityConfig,
    getGreenElectricitySafetyStatus,
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

// ─── Tests — permission gate (T-09.10.02) ─────────────────────────────

describe('green-electricity-rules config permission gate (T-09.10.02)', () => {
  it('rejects non-admin on getGreenElectricityRules with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .getGreenElectricityRules(nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on setGreenElectricityRules with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .setGreenElectricityRules(VALID_BODY, nonAdminReq)
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
      .setGreenElectricityRules(VALID_BODY, nonAdminReq)
      .catch((e: unknown) => e)
    expect(adminService.setGreenElectricityConfig).not.toHaveBeenCalled()
  })

  it('allows admin to read the rules and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    await expect(controller.getGreenElectricityRules(adminReq)).resolves.toEqual(
      DEFAULT_GREEN_ELECTRICITY_CONFIG,
    )
    expect(adminService.getGreenElectricityConfig).toHaveBeenCalledTimes(1)
  })

  it('allows admin to write the rules and passes the actor/ip to the service', async () => {
    const { controller, adminService } = makeController()
    const result = await controller.setGreenElectricityRules(VALID_BODY, adminReq)
    expect(result.simpleOrder.mandatoryGreenEnabled).toBe(true)
    expect(result.advancedOrder.mandatoryGreenEnabled).toBe(false)
    expect(adminService.setGreenElectricityConfig).toHaveBeenCalledWith(
      VALID_BODY,
      'admin-1',
      '127.0.0.1',
    )
  })

  it('rejects non-admin on getGreenElectricitySafetyStatus with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .getGreenElectricitySafetyStatus(nonAdminReq)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('allows admin to read the safety status and delegates to the service', async () => {
    const { controller, adminService } = makeController()
    const result = await controller.getGreenElectricitySafetyStatus(adminReq)
    expect(result.simpleOrder.ruleActive).toBe(true)
    expect(adminService.getGreenElectricitySafetyStatus).toHaveBeenCalledTimes(1)
  })
})
