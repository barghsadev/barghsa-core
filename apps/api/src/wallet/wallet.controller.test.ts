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

const RECEIPT_KEY = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'

function makeController() {
  const getAccessibleProfile = vi.fn().mockResolvedValue({ id: PROFILE_ID })
  const getWallet = vi.fn().mockResolvedValue(null)
  const resolveOnlineTopUpLimit = vi.fn().mockResolvedValue({
    onlineTopUpLimit: 2_000_000_000,
    configVersion: 0,
  })
  const initiate = vi.fn().mockResolvedValue({
    transactionId: 'tx-1',
    amount: 100_000n,
    state: 'Pending',
    redirectUrl: 'https://pay.test/start?authority=abc',
  })
  const submit = vi.fn().mockResolvedValue({
    transactionId: 'tx-receipt-1',
    amount: 250_000n,
    state: 'Pending',
    paymentDate: '2026-08-15',
    payerReference: 'TRK-998877',
    attachmentKey: RECEIPT_KEY,
  })
  const controller = new WalletController(
    { getWallet, resolveOnlineTopUpLimit } as never,
    { getAccessibleProfile } as never,
    { initiate } as never,
    { submit } as never,
  )
  return { controller, getAccessibleProfile, initiate, submit, getWallet, resolveOnlineTopUpLimit }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('WalletController online top-up (T-04.2.02.01)', () => {
  it('returns the versioned onlineTopUpLimit with the wallet balance', async () => {
    const { controller, getWallet, resolveOnlineTopUpLimit } = makeController()
    getWallet.mockResolvedValue({
      availableBalance: 1_500_000n,
      postedBalance: 1_500_000n,
      reservedBalance: 0n,
    })
    resolveOnlineTopUpLimit.mockResolvedValue({
      onlineTopUpLimit: 50_000,
      configVersion: 4,
    })
    await expect(controller.getWallet(PROFILE_ID, req)).resolves.toEqual({
      balance: 1_500_000,
      postedBalance: 1_500_000,
      reservedBalance: 0,
      currency: 'IRR',
      onlineTopUpLimit: 50_000,
      configVersion: 4,
    })
  })
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

describe('WalletController bank-receipt top-up (T-04.2.02.03)', () => {
  const body = {
    amount: 250_000,
    paymentDate: '2026-08-15',
    payerReference: 'TRK-998877',
    attachmentKey: RECEIPT_KEY,
    customerNote: 'Branch transfer',
  }

  it('rejects a non-UUID profileId before calling the service', async () => {
    const { controller, submit, getAccessibleProfile } = makeController()
    const rejection = await controller
      .submitBankReceiptTopUp('not-a-uuid', body, 'idem-1', req)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
    expect(getAccessibleProfile).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('returns 404 when the profile is not accessible', async () => {
    const { controller, submit, getAccessibleProfile } = makeController()
    getAccessibleProfile.mockResolvedValue(null)
    await expect(
      controller.submitBankReceiptTopUp(PROFILE_ID, body, 'idem-1', req),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(submit).not.toHaveBeenCalled()
  })

  it('rejects a missing required field', async () => {
    const { controller, submit } = makeController()
    const rejection = await controller
      .submitBankReceiptTopUp(PROFILE_ID, { amount: 250_000 }, 'idem-1', req)
      .catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
    expect(submit).not.toHaveBeenCalled()
  })

  it('rejects a missing idempotency key', async () => {
    const { controller, submit } = makeController()
    const rejection = await controller
      .submitBankReceiptTopUp(PROFILE_ID, body, undefined, req)
      .catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_MISSING.code,
    })
    expect(submit).not.toHaveBeenCalled()
  })

  it('submits a pending bank-receipt top-up without a gateway redirect', async () => {
    const { controller, submit } = makeController()
    const result = await controller.submitBankReceiptTopUp(
      PROFILE_ID,
      body,
      'from-header',
      req,
    )
    expect(submit).toHaveBeenCalledWith({
      profileId: PROFILE_ID,
      amount: 250_000,
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey: RECEIPT_KEY,
      customerNote: 'Branch transfer',
      idempotencyKey: 'from-header',
      actorId: 'user-1',
    })
    expect(result).toEqual({
      ok: true,
      transactionId: 'tx-receipt-1',
      amount: '250000',
      currency: 'IRR',
      state: 'Pending',
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey: RECEIPT_KEY,
    })
    expect(result).not.toHaveProperty('redirectUrl')
  })

  it('serializes an int8 amount above Number.MAX_SAFE_INTEGER as a decimal string', async () => {
    const unsafeAmount = 9_007_199_254_740_993n
    const { controller, submit } = makeController()
    submit.mockResolvedValue({
      transactionId: 'tx-receipt-unsafe',
      amount: unsafeAmount,
      state: 'Pending',
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey: RECEIPT_KEY,
    })

    const result = await controller.submitBankReceiptTopUp(
      PROFILE_ID,
      { ...body, amount: unsafeAmount.toString() },
      'idem-unsafe',
      req,
    )

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: unsafeAmount.toString(),
        actorId: 'user-1',
      }),
    )
    expect(result.amount).toBe('9007199254740993')
    expect(typeof result.amount).toBe('string')
    expect(result.amount).not.toBe(Number(unsafeAmount))
    expect(Number(unsafeAmount)).toBe(9_007_199_254_740_992)
  })
})
