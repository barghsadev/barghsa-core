import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { GiftCodeController } from './gift-code.controller.js'
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

const CODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROFILE_ID = '11111111-1111-4111-8111-111111111111'

const giftCodeDto = {
  id: CODE_ID,
  code: 'SALE10',
  discountType: 'fixed_irr',
  discountValue: '500000',
  maxCapIrr: null,
  eligibility: 'public',
  profileIds: [],
  totalLimit: null,
  perProfileLimit: null,
  validFrom: '2026-01-01T00:00:00Z',
  validUntil: null,
  minOrderAmount: '0',
  categories: [],
  status: 'active',
  createdBy: 'admin-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  usage: { consumed: 0, released: 0, totalDiscountIrr: '0' },
}

function makeController() {
  const service = {
    list: vi.fn().mockResolvedValue([]),
    stats: vi.fn().mockResolvedValue({
      code: giftCodeDto,
      perProfile: [],
      recentRedemptions: [],
    }),
    create: vi.fn().mockResolvedValue(giftCodeDto),
    update: vi.fn().mockResolvedValue(giftCodeDto),
    setStatus: vi.fn().mockResolvedValue(giftCodeDto),
  }
  const controller = new GiftCodeController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Tests — permission gate (T-09.12.03) ─────────────────────────────

describe('Gift code permission gate (T-09.12.03)', () => {
  it('rejects non-admin on list with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller.list(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on stats and all mutations', async () => {
    const { controller } = makeController()
    const basePayload = {
      code: 'SALE10',
      discountType: 'fixed_irr' as const,
      discountValue: '500000',
      eligibility: 'public' as const,
      profileIds: [],
      minOrderAmount: '0',
      categories: [],
    }
    for (const attempt of [
      controller.stats(nonAdminReq, CODE_ID),
      controller.create(nonAdminReq, basePayload),
      controller.update(nonAdminReq, CODE_ID, { code: 'SALE20' }),
      controller.setStatus(nonAdminReq, CODE_ID, { status: 'inactive' }),
    ]) {
      const rejection = await attempt.catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 403 })
      expect(rejectionBody(rejection)).toMatchObject({
        error: ErrorCodes.AUTHZ_FORBIDDEN.code,
      })
    }
  })

  it('allows admins through the service', async () => {
    const { controller, service } = makeController()
    await controller.list(adminReq)
    expect(service.list).toHaveBeenCalled()
  })
})

// ─── Tests — validation ────────────────────────────────────────────────

describe('Gift code validation (T-09.12.03)', () => {
  it('normalizes the code before persisting (trim + uppercase)', async () => {
    const { controller, service } = makeController()
    await controller.create(adminReq, {
      code: ' sale10 ',
      discountType: 'fixed_irr',
      discountValue: '500000',
      eligibility: 'public',
      profileIds: [],
      minOrderAmount: '0',
      categories: [],
    })

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SALE10' }),
    )
  })

  it('rejects a percentage code without maxCapIrr', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .create(adminReq, {
        code: 'PCT25',
        discountType: 'percentage',
        discountValue: '2500',
        maxCapIrr: null,
        eligibility: 'public',
        profileIds: [],
        minOrderAmount: '0',
        categories: [],
      })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
  })

  it('rejects maxCapIrr on a fixed_irr code', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .create(adminReq, {
        code: 'SALE10',
        discountType: 'fixed_irr',
        discountValue: '500000',
        maxCapIrr: '100000',
        eligibility: 'public',
        profileIds: [],
        minOrderAmount: '0',
        categories: [],
      })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 400,
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
  })

  it('validates profileIds as UUIDs', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .create(adminReq, {
        code: 'SALE10',
        discountType: 'fixed_irr',
        discountValue: '500000',
        eligibility: 'profile',
        profileIds: ['not-a-uuid'],
        minOrderAmount: '0',
        categories: [],
      })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
  })

  it('rejects a malformed discountValue', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .create(adminReq, {
        code: 'SALE10',
        discountType: 'fixed_irr',
        discountValue: '12.5',
        eligibility: 'public',
        profileIds: [],
        minOrderAmount: '0',
        categories: [],
      })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
  })

  it('normalizes the search filter on list', async () => {
    const { controller, service } = makeController()
    await controller.list(adminReq, ' sale ', undefined, undefined)
    expect(service.list).toHaveBeenCalledWith({ search: 'SALE' })
  })

  it('rejects an invalid status filter', async () => {
    const { controller } = makeController()
    const rejection = await controller
      .list(adminReq, undefined, 'paused', undefined)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
  })

  it('rejects a non-UUID route param with 400', async () => {
    const { controller } = makeController()
    for (const attempt of [
      controller.stats(adminReq, 'not-a-uuid'),
      controller.update(adminReq, 'nope', { code: 'SALE20' }),
      controller.setStatus(adminReq, 'nope', { status: 'inactive' }),
    ]) {
      const rejection = await attempt.catch((e: unknown) => e)
      expect(rejection).toMatchObject({ status: 400 })
    }
  })

  it('forwards the full create payload to the service', async () => {
    const { controller, service } = makeController()
    await controller.create(adminReq, {
      code: 'PCT25',
      discountType: 'percentage',
      discountValue: '2500',
      maxCapIrr: '1000000',
      eligibility: 'public',
      profileIds: [],
      validUntil: null,
      minOrderAmount: '100000',
      categories: ['electricity'],
    })

    expect(service.create).toHaveBeenCalledWith({
      code: 'PCT25',
      discountType: 'percentage',
      discountValue: '2500',
      maxCapIrr: '1000000',
      eligibility: 'public',
      profileIds: [],
      totalLimit: null,
      perProfileLimit: null,
      validUntil: null,
      minOrderAmount: '100000',
      categories: ['electricity'],
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
  })

  it('forwards a percentage payload with its mandatory cap to the service', async () => {
    const { controller, service } = makeController()
    await controller.create(adminReq, {
      code: 'PCT25',
      discountType: 'percentage',
      discountValue: '2500',
      maxCapIrr: '1000000',
      eligibility: 'public',
      profileIds: [],
      minOrderAmount: '0',
      categories: [],
    })

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        discountType: 'percentage',
        discountValue: '2500',
        maxCapIrr: '1000000',
      }),
    )
  })

  it('forwards toggle status to the service', async () => {
    const { controller, service } = makeController()
    await controller.setStatus(adminReq, CODE_ID, { status: 'inactive' })
    expect(service.setStatus).toHaveBeenCalledWith(
      CODE_ID,
      'inactive',
      'admin-1',
      '127.0.0.1',
    )
  })
})