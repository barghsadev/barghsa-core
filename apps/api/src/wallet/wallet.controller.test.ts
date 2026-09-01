import { describe, it, expect, vi } from 'vitest'
import { HttpException, NotFoundException } from '@nestjs/common'
import { WalletController } from './wallet.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

vi.mock('../session/session.guard.js', () => ({
  SessionAuthGuard: vi.fn(),
}))

vi.mock('../rate-limit/rate-limit.decorator.js', () => ({
  RateLimit: () => () => {},
}))

const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'

const req = {
  session: { userId: 'user-1' },
} as unknown as AuthenticatedRequest

function makeController() {
  const getAccessibleProfile = vi.fn().mockResolvedValue({ id: PROFILE_ID })
  const initiate = vi.fn().mockResolvedValue({
    transactionId: 'tx-1',
    amount: 100_000n,
    state: 'Pending',
    redirectUrl: 'https://pay.test/start?authority=abc',
  })
  const controller = new WalletController(
    {} as never,
    { getAccessibleProfile } as never,
    { initiate } as never,
  )
  return { controller, getAccessibleProfile, initiate }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('WalletController online top-up (T-04.2.02.01)', () => {
  it('rejects a non-UUID profileId before calling the service', async () => {
    const { controller, initiate, getAccessibleProfile } = makeController()
    const rejection = await controller
      .initiateOnlineTopUp('not-a-uuid', { amount: 1000 }, 'idem-1', req)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
    expect(getAccessibleProfile).not.toHaveBeenCalled()
    expect(initiate).not.toHaveBeenCalled()
  })

  it('returns 404 when the profile is not accessible', async () => {
    const { controller, initiate, getAccessibleProfile } = makeController()
    getAccessibleProfile.mockResolvedValue(null)
    await expect(
      controller.initiateOnlineTopUp(PROFILE_ID, { amount: 1000 }, 'idem-1', req),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(initiate).not.toHaveBeenCalled()
  })

  it('rejects a missing or invalid amount', async () => {
    const { controller, initiate } = makeController()
    const missing = await controller
      .initiateOnlineTopUp(PROFILE_ID, {}, 'idem-1', req)
      .catch((e: unknown) => e)
    expect(rejectionBody(missing)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })

    const invalid = await controller
      .initiateOnlineTopUp(PROFILE_ID, { amount: 0 }, 'idem-1', req)
      .catch((e: unknown) => e)
    expect(rejectionBody(invalid)).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
    expect(initiate).not.toHaveBeenCalled()
  })

  it('rejects a missing idempotency key', async () => {
    const { controller, initiate } = makeController()
    const rejection = await controller
      .initiateOnlineTopUp(PROFILE_ID, { amount: 1000 }, undefined, req)
      .catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_MISSING.code,
    })
    expect(initiate).not.toHaveBeenCalled()
  })

  it('prefers the Idempotency-Key header over the body field', async () => {
    const { controller, initiate } = makeController()
    await controller.initiateOnlineTopUp(
      PROFILE_ID,
      { amount: 100_000, idempotencyKey: 'from-body' },
      'from-header',
      req,
    )
    expect(initiate).toHaveBeenCalledWith({
      profileId: PROFILE_ID,
      amountIrR: 100_000n,
      idempotencyKey: 'from-header',
    })
  })

  it('accepts a digit-string amount and a body idempotency key', async () => {
    const { controller, initiate } = makeController()
    const result = await controller.initiateOnlineTopUp(
      PROFILE_ID,
      { amount: '250000', idempotencyKey: 'from-body' },
      undefined,
      req,
    )
    expect(initiate).toHaveBeenCalledWith({
      profileId: PROFILE_ID,
      amountIrR: 250_000n,
      idempotencyKey: 'from-body',
    })
    expect(result).toEqual({
      ok: true,
      transactionId: 'tx-1',
      amount: 100_000,
      currency: 'IRR',
      state: 'Pending',
      redirectUrl: 'https://pay.test/start?authority=abc',
    })
  })
})
