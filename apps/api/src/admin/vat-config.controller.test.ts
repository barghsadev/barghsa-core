import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { VatConfigController } from './vat-config.controller.js'
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
  const service = {
    list: vi.fn().mockResolvedValue([]),
    listOverrides: vi.fn().mockResolvedValue([]),
    resolve: vi.fn().mockResolvedValue({ rateBasisPoints: 900, source: 'category' }),
    createRate: vi.fn().mockResolvedValue({ id: 'rate-1' }),
    endRate: vi.fn().mockResolvedValue({ id: 'rate-1' }),
    createProductOverride: vi.fn().mockResolvedValue({ id: 'ov-1' }),
    endProductOverride: vi.fn().mockResolvedValue({ id: 'ov-1' }),
  }
  const controller = new VatConfigController(service as never)
  return { controller, service }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

// ─── Tests — permission gate (T-09.12.02) ─────────────────────────────

describe('VAT config permission gate (T-09.12.02)', () => {
  it('rejects non-admin on list with the AUTHZ_FORBIDDEN contract', async () => {
    const { controller } = makeController()
    const rejection = await controller.list(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
  })

  it('rejects non-admin on all mutations', async () => {
    const { controller } = makeController()
    for (const attempt of [
      controller.createRate(nonAdminReq, { category: 'electricity', rateBasisPoints: 900 }),
      controller.endRate(nonAdminReq, 'rate-1', {}),
      controller.createOverride(nonAdminReq, {
        productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        vatConfigId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
      controller.endOverride(nonAdminReq, 'ov-1', {}),
      controller.resolve(nonAdminReq),
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

describe('VAT config payload validation (T-09.12.02)', () => {
  it('rejects an unknown category on createRate', async () => {
    const { controller, service } = makeController()
    await expect(
      controller.createRate(adminReq, { category: 'bogus' as never, rateBasisPoints: 900 }),
    ).rejects.toMatchObject({ status: 400 })
    expect(service.createRate).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range rate on createRate', async () => {
    const { controller, service } = makeController()
    await expect(
      controller.createRate(adminReq, { category: 'electricity', rateBasisPoints: 10_001 }),
    ).rejects.toMatchObject({ status: 400 })
    expect(service.createRate).not.toHaveBeenCalled()
  })

  it('rejects a non-UUID id on endRate', async () => {
    const { controller, service } = makeController()
    await expect(
      controller.endRate(adminReq, 'not-a-uuid', {}),
    ).rejects.toMatchObject({ status: 400 })
    expect(service.endRate).not.toHaveBeenCalled()
  })

  it('rejects a non-UUID productId on createOverride', async () => {
    const { controller, service } = makeController()
    await expect(
      controller.createOverride(adminReq, {
        productId: 'not-a-uuid',
        vatConfigId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(service.createProductOverride).not.toHaveBeenCalled()
  })

  it('forwards a valid createRate payload to the service', async () => {
    const { controller, service } = makeController()
    await controller.createRate(adminReq, { category: 'electricity', rateBasisPoints: 900 })
    expect(service.createRate).toHaveBeenCalledWith({
      category: 'electricity',
      rateBasisPoints: 900,
      effectiveFrom: undefined,
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
    })
  })
})
