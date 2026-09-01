import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common'
import { BadRequestException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import { OnlineTopUpService } from './online-topup.service.js'
import type { WalletService } from './wallet.service.js'
import {
  PaymentGatewayRejectedError,
  type PaymentGateway,
} from './payment-gateway.js'

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
    metadata: { channel: 'online', onlineTopUpLimit: 2_000_000_000, configVersion: 0 },
    created_at: new Date('2026-09-01'),
    updated_at: new Date('2026-09-01'),
    ...overrides,
  }
}

function makeWalletService() {
  return {
    validateOnlineTopUpAmount: vi.fn().mockResolvedValue({
      onlineTopUpLimit: 2_000_000_000,
      configVersion: 0,
    }),
    createWallet: vi.fn().mockResolvedValue({ profileId: PROFILE_ID }),
  }
}

function makeGateway(overrides: Partial<PaymentGateway> = {}): PaymentGateway {
  return {
    startPayment: vi.fn().mockResolvedValue({
      authority: 'auth-1',
      redirectUrl: REDIRECT,
    }),
    recoverPayment: vi.fn().mockResolvedValue(null),
    verifyPayment: vi.fn().mockResolvedValue({ paid: true, providerRefId: 'ref-1' }),
    ...overrides,
  }
}

type ScriptOptions = {
  wallet?: { profile_id: string } | null
  existing?: ReturnType<typeof makePendingRow> | null
  insert?: ReturnType<typeof makePendingRow> | Error
  claimRowCount?: number
  persistRowCount?: number
  persistError?: Error | boolean
}

function scriptClient(opts: ScriptOptions = {}) {
  mockClient.query.mockImplementation(async (sql: string) => {
    if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
      return { rows: [] }
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] }
    }
    if (sql.includes('FROM wallets')) {
      if (opts.wallet === null) return { rows: [] }
      return { rows: [opts.wallet ?? { profile_id: PROFILE_ID }] }
    }
    if (sql.includes('FROM wallet_transactions WHERE idempotency_key')) {
      if (sql.includes('FOR UPDATE') && opts.insert instanceof Error) {
        return { rows: [] }
      }
      return { rows: opts.existing ? [opts.existing] : [] }
    }
    if (sql.includes('INSERT INTO wallet_transactions')) {
      if (opts.insert instanceof Error) throw opts.insert
      return { rows: [opts.insert ?? makePendingRow()] }
    }
    if (sql.includes("metadata") && sql.includes("- 'gateway'")) {
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('ref_id = $3')) {
      if (opts.persistError) {
        throw opts.persistError instanceof Error ? opts.persistError : new Error('db down')
      }
      const rowCount = opts.persistRowCount ?? 1
      return {
        rowCount,
        rows:
          rowCount > 0
            ? [
                {
                  ref_id: 'auth-1',
                  metadata: {
                    channel: 'online',
                    gateway: { authority: 'auth-1', redirectUrl: REDIRECT, claimId: 'claim' },
                  },
                },
              ]
            : [],
      }
    }
    if (sql.includes("metadata -> 'gateway' IS NULL")) {
      const rowCount = opts.claimRowCount ?? 1
      return { rowCount, rows: rowCount > 0 ? [{ id: TX_ID }] : [] }
    }
    if (sql.includes('SELECT metadata FROM wallet_transactions')) {
      return {
        rows: [
          {
            metadata:
              opts.existing?.metadata ?? {
                channel: 'online',
                gateway: { authority: 'auth-1', redirectUrl: REDIRECT },
              },
          },
        ],
      }
    }
    return { rows: [] }
  })
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

  it('rejects a blank idempotency key before touching the wallet or gateway', async () => {
    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: '   ' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(walletService.validateOnlineTopUpAmount).not.toHaveBeenCalled()
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('enforces the online top-up limit before creating a Pending row', async () => {
    scriptClient()
    walletService.validateOnlineTopUpAmount.mockRejectedValue(
      new BadRequestException('Online top-up amount 2000000001 IRR exceeds the configured per-transaction limit of 2000000000 IRR'),
    )
    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: 2_000_000_001n, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO wallet_transactions'),
      expect.anything(),
    )
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('re-enforces the versioned onlineTopUpLimit inside the submission transaction', async () => {
    scriptClient()
    walletService.validateOnlineTopUpAmount
      .mockResolvedValueOnce({ onlineTopUpLimit: 2_000_000_000, configVersion: 0 })
      .mockRejectedValueOnce(
        new BadRequestException(
          'Online top-up amount 100000 IRR exceeds the configured per-transaction limit of 50000 IRR',
        ),
      )
    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(walletService.validateOnlineTopUpAmount).toHaveBeenNthCalledWith(2, AMOUNT, mockClient)
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO wallet_transactions'),
      expect.anything(),
    )
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('inserts the Pending row against the locked wallet canonical profile_id', async () => {
    const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
    scriptClient({
      wallet: { profile_id: canonical },
      insert: makePendingRow({ id: TX_ID, wallet_id: canonical }),
    })

    await service.initiate({
      profileId: canonical.toUpperCase(),
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, 'topup', $2::bigint, 'Pending'"),
      expect.arrayContaining([canonical, AMOUNT.toString(), IDEM]),
    )
    expect(walletService.createWallet).toHaveBeenCalledWith(canonical.toUpperCase())
  })

  it('creates a Pending top-up, starts the gateway, and does not credit the wallet', async () => {
    scriptClient()
    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(walletService.validateOnlineTopUpAmount).toHaveBeenNthCalledWith(1, AMOUNT)
    expect(walletService.validateOnlineTopUpAmount).toHaveBeenNthCalledWith(2, AMOUNT, mockClient)
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
        idempotencyKey: TX_ID,
        callbackUrl: `http://localhost:4000/api/wallet/top-ups/callback?orderId=${TX_ID}`,
      }),
    )
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, 'topup', $2::bigint, 'Pending'"),
      [
        PROFILE_ID,
        AMOUNT.toString(),
        IDEM,
        'Online wallet top-up',
        JSON.stringify({
          channel: 'online',
          onlineTopUpLimit: 2_000_000_000,
          configVersion: 0,
        }),
      ],
    )
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('ref_id = $3'),
      expect.arrayContaining([TX_ID, expect.stringContaining('auth-1'), 'auth-1']),
    )
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_lock'),
      expect.any(Array),
    )
  })

  it('replays a matching Pending row with an existing redirect without calling the gateway again', async () => {
    scriptClient({
      existing: makePendingRow({
        metadata: { channel: 'online', gateway: { authority: 'auth-1', redirectUrl: REDIRECT } },
        ref_id: 'auth-1',
      }),
    })

    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(result.redirectUrl).toBe(REDIRECT)
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('retries gateway start for a matching Pending row that has no redirect yet', async () => {
    scriptClient({ existing: makePendingRow() })

    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(gateway.startPayment).toHaveBeenCalledTimes(1)
    expect(result.redirectUrl).toBe(REDIRECT)
  })

  it('rejects a colliding idempotency key used for a different amount', async () => {
    scriptClient({ existing: makePendingRow({ amount: '50000' }) })

    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(gateway.startPayment).not.toHaveBeenCalled()
  })

  it('rejects a colliding completed credit idempotency key', async () => {
    scriptClient({ existing: makePendingRow({ state: 'Completed' }) })

    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('returns the committed Pending row when INSERT races on the unique idempotency index', async () => {
    const uniqueError = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint: 'idx_wallet_tx_idempotency',
    })
    scriptClient({
      insert: uniqueError,
      existing: makePendingRow({
        metadata: { channel: 'online', gateway: { authority: 'auth-1', redirectUrl: REDIRECT } },
      }),
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
    scriptClient({ wallet: null })

    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(gateway.startPayment).not.toHaveBeenCalled()
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      expect.any(Array),
    )
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('surfaces a gateway failure as PROVIDER_DOWNSTREAM and keeps the initializing claim after an ambiguous error', async () => {
    scriptClient()
    gateway.startPayment = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    )

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
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining("- 'gateway'"),
      expect.any(Array),
    )
    expect(gateway.recoverPayment).not.toHaveBeenCalled()
  })

  it('releases the initializing claim only after a definite provider rejection', async () => {
    scriptClient()
    gateway.startPayment = vi.fn().mockRejectedValue(
      new PaymentGatewayRejectedError('Merchant is invalid'),
    )

    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(HttpException)

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("- 'gateway'"),
      expect.any(Array),
    )
  })

  it('leaves the initializing claim when persist fails after startPayment succeeds', async () => {
    scriptClient({ persistError: true })

    const rejection = await service
      .initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM })
      .catch((e: unknown) => e)

    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(502)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.PROVIDER_DOWNSTREAM.code,
      message: 'Payment gateway session could not be stored',
    })
    expect(gateway.startPayment).toHaveBeenCalledTimes(1)
    expect(gateway.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: TX_ID }),
    )
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("metadata -> 'gateway' IS NULL"),
      expect.any(Array),
    )
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining("- 'gateway'"),
      expect.any(Array),
    )
  })

  it('recovers an initializing claim after crash without calling startPayment or minting a new provider key', async () => {
    const claimId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
    const callbackUrl = `http://localhost:4000/api/wallet/top-ups/callback?orderId=${TX_ID}`
    gateway.recoverPayment = vi.fn().mockResolvedValue({
      authority: 'auth-1',
      redirectUrl: REDIRECT,
    })
    scriptClient({
      existing: makePendingRow({
        metadata: {
          channel: 'online',
          gateway: {
            status: 'initializing',
            claimId,
            providerIdempotencyKey: TX_ID,
            merchantOrderId: TX_ID,
            amountIrR: AMOUNT.toString(),
            callbackUrl,
          },
        },
      }),
    })

    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(result.redirectUrl).toBe(REDIRECT)
    expect(gateway.startPayment).not.toHaveBeenCalled()
    expect(gateway.recoverPayment).toHaveBeenCalledTimes(1)
    expect(gateway.recoverPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountIrR: AMOUNT,
        merchantOrderId: TX_ID,
        idempotencyKey: TX_ID,
        callbackUrl,
      }),
    )
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining("metadata -> 'gateway' IS NULL"),
      expect.any(Array),
    )
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('ref_id = $3'),
      expect.arrayContaining([
        TX_ID,
        expect.stringContaining(claimId),
        'auth-1',
        claimId,
      ]),
    )
  })

  it('does not create a second authority when the provider session is created but the client times out', async () => {
    const created: string[] = []
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    })
    gateway.startPayment = vi.fn().mockImplementation(async () => {
      created.push(`auth-${created.length + 1}`)
      throw timeout
    })
    gateway.recoverPayment = vi.fn().mockImplementation(async () => {
      const authority = created[0]
      if (!authority) return null
      return {
        authority,
        redirectUrl: `https://pay.test/start?authority=${authority}`,
      }
    })

    scriptClient()
    await expect(
      service.initiate({ profileId: PROFILE_ID, amountIrR: AMOUNT, idempotencyKey: IDEM }),
    ).rejects.toBeInstanceOf(HttpException)
    expect(created).toEqual(['auth-1'])
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining("- 'gateway'"),
      expect.any(Array),
    )

    const claimId = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd'
    scriptClient({
      existing: makePendingRow({
        metadata: {
          channel: 'online',
          gateway: {
            status: 'initializing',
            claimId,
            providerIdempotencyKey: TX_ID,
            merchantOrderId: TX_ID,
            amountIrR: AMOUNT.toString(),
            callbackUrl: `http://localhost:4000/api/wallet/top-ups/callback?orderId=${TX_ID}`,
          },
        },
      }),
    })

    const result = await service.initiate({
      profileId: PROFILE_ID,
      amountIrR: AMOUNT,
      idempotencyKey: IDEM,
    })

    expect(result.redirectUrl).toBe(REDIRECT)
    expect(gateway.startPayment).toHaveBeenCalledTimes(1)
    expect(gateway.recoverPayment).toHaveBeenCalledTimes(1)
    expect(created).toEqual(['auth-1'])
  })
})
