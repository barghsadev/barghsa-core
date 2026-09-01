import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common'
import { BadRequestException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import { OnlineTopUpService } from './online-topup.service.js'
import type { WalletService } from './wallet.service.js'
import type { PaymentGateway } from './payment-gateway.js'

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
}

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

const PROFILE_ID = 'profile-1'
const TX_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const IDEM = 'idem-topup-1'
const AMOUNT = 100_000n
const REDIRECT = 'https://pay.test/start?authority=auth-1'

function makePendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    wallet_id: PROFILE_ID,
    type: 'topup',
    amount: AMOUNT.toString(),
    state: 'Pending',
    idempotency_key: IDEM,
    ref_id: null,
    description: 'Online wallet top-up',
    metadata: { channel: 'online' },
    created_at: new Date('2026-09-01'),
    updated_at: new Date('2026-09-01'),
    ...overrides,
  }
}

function makeWalletService() {
  return {
    validateOnlineTopUpAmount: vi.fn().mockResolvedValue(undefined),
    createWallet: vi.fn().mockResolvedValue({ profileId: PROFILE_ID }),
  }
}

function makeGateway(overrides: Partial<PaymentGateway> = {}): PaymentGateway {
  return {
    startPayment: vi.fn().mockResolvedValue({
      authority: 'auth-1',
      redirectUrl: REDIRECT,
    }),
    ...overrides,
  }
}

describe('OnlineTopUpService (T-04.2.02.01)', () => {
  let walletService: ReturnType<typeof makeWalletService>
  let gateway: PaymentGateway
  let service: OnlineTopUpService

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
    mockClient.query.mockReset()
    mockPool.query.mockReset()
    walletService = makeWalletService()
    gateway = makeGateway()
    service = new OnlineTopUpService(walletService as unknown as WalletService, gateway)
  })

  function scriptFirstInsert() {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ profile_id: PROFILE_ID }] }) // FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // idempotency miss
      .mockResolvedValueOnce({ rows: [makePendingRow()] }) // INSERT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 })
  }

  it('rejects a blank idempotency key before touching the wallet or gateway', async () => {
    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: '   ' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(walletService.validateOnlineTopUpAmount).not.toHaveBeenCalled()
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('enforces the online top-up limit before creating a Pending row', async () => {
    walletService.validateOnlineTopUpAmount.mockRejectedValue(
      new BadRequestException('Online top-up amount 2000000001 IRR exceeds the configured per-transaction limit of 2000000000 IRR'),
    )
    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: 2_000_000_001n, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(walletService.createWallet).not.toHaveBeenCalled()
    expect(mockPool.connect).not.toHaveBeenCalled()
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('creates a Pending top-up, starts the gateway, and does not credit the wallet', async () => {
    scriptFirstInsert()
    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(walletService.validateOnlineTopUpAmount).toHaveBeenCalledWith(AMOUNT)
    expect(walletService.createWallet).toHaveBeenCalledWith(PROFILE_ID)
    expect(result).toEqual({
      transactionId: TX_ID,
      amount: AMOUNT,
      state: 'Pending',
      redirectUrl: REDIRECT,
    })
    expect(gateway.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountIrR: AMOUNT,
        merchantOrderId: TX_ID,
      }),
    )
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, 'topup', $2::bigint, 'Pending'"),
      expect.arrayContaining([PROFILE_ID, AMOUNT.toString(), IDEM]),
    )
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE wallet_transactions'),
      expect.arrayContaining([TX_ID, expect.stringContaining('auth-1'), 'auth-1']),
    )
  })

  it('replays a matching Pending row with an existing redirect without calling the gateway again', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: PROFILE_ID }] })
      .mockResolvedValueOnce({
        rows: [
          makePendingRow({
            metadata: { channel: 'online', gateway: { authority: 'auth-1', redirectUrl: REDIRECT } },
            ref_id: 'auth-1',
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] })

    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(result.redirectUrl).toBe(REDIRECT)
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('retries gateway start for a matching Pending row that has no redirect yet', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: PROFILE_ID }] })
      .mockResolvedValueOnce({ rows: [makePendingRow()] })
      .mockResolvedValueOnce({ rows: [] })
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 })

    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(gateway.startPayment).toHaveBeenCalledTimes(1)
    expect(result.redirectUrl).toBe(REDIRECT)
  })

  it('rejects a colliding idempotency key used for a different amount', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: PROFILE_ID }] })
      .mockResolvedValueOnce({ rows: [makePendingRow({ amount: '50000' })] })

    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('rejects a colliding completed credit idempotency key', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: PROFILE_ID }] })
      .mockResolvedValueOnce({ rows: [makePendingRow({ state: 'Completed' })] })

    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('returns the committed Pending row when INSERT races on the unique idempotency index', async () => {
    const uniqueError = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint: 'idx_wallet_tx_idempotency',
    })
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ profile_id: PROFILE_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(uniqueError)
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK
    mockPool.query.mockResolvedValue({
      rows: [
        makePendingRow({
          metadata: { channel: 'online', gateway: { authority: 'auth-1', redirectUrl: REDIRECT } },
        }),
      ],
    })

    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(result.redirectUrl).toBe(REDIRECT)
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('throws NotFound when the wallet row is missing after createWallet', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('surfaces a gateway failure as PROVIDER_DOWNSTREAM and leaves the Pending row', async () => {
    scriptFirstInsert()
    gateway.startPayment = vi.fn().mockRejectedValue(new Error('psp down'))

    const rejection = await service
      .initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM })
      .catch((e: unknown) => e)

    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(502)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.PROVIDER_DOWNSTREAM.code,
    })
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, 'topup', $2::bigint, 'Pending'"),
      expect.any(Array),
    )
  })
})
