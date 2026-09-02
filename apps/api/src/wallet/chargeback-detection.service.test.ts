import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BadRequestException, HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  WALLET_CHARGEBACK_REASON,
  chargebackCreditIdempotencyKey,
} from '@barghsa/shared/finance'
import { ChargebackDetectionService } from './chargeback-detection.service.js'
import type { ChargebackAlertService } from './chargeback-alert.service.js'
import { onlineTopUpCreditIdempotencyKey } from './online-topup-callback.service.js'
import { signPaymentCallback } from './payment-callback-verifier.js'
import type { WalletService } from './wallet.service.js'

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

const SECRET = 'whsec-chargeback'
const MERCHANT = 'merchant-1'
const PENDING_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const CREDIT_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const REVERSAL_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const PROFILE_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd'
const AUTHORITY = 'auth-pending-1'
const PROVIDER_REF = 'psp-ref-1'
const AMOUNT = 100_000
const EVENT_ID = 'evt-chargeback-1'

function payload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'chargeback',
    merchantId: MERCHANT,
    merchantOrderId: PENDING_ID,
    providerRefId: PROVIDER_REF,
    authority: AUTHORITY,
    amountIrR: AMOUNT,
    ...overrides,
  })
}

function signedInput(rawBody: string, eventId = EVENT_ID, now = Math.floor(Date.now() / 1000)) {
  const timestamp = String(now)
  return {
    headers: {
      eventId,
      timestamp,
      signature: signPaymentCallback(rawBody, eventId, timestamp, SECRET),
    },
    rawBody,
  }
}

function makeCreditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CREDIT_ID,
    wallet_id: PROFILE_ID,
    type: 'topup',
    amount: String(AMOUNT),
    state: 'Completed',
    idempotency_key: chargebackCreditIdempotencyKey(PENDING_ID),
    ref_id: PROVIDER_REF,
    description: 'Online wallet top-up',
    metadata: {
      channel: 'online',
      pendingTransactionId: PENDING_ID,
      authority: AUTHORITY,
    },
    reverses_transaction_id: null,
    created_at: new Date('2026-09-02'),
    updated_at: new Date('2026-09-02'),
    ...overrides,
  }
}

function claimedEventRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_ID,
    original_transaction_id: null,
    reversal_transaction_id: null,
    wallet_id: null,
    status: 'processing',
    match_method: null,
    ...overrides,
  }
}

function makeService(alertService?: ChargebackAlertService) {
  const reverseTransaction = vi.fn().mockResolvedValue({
    id: REVERSAL_ID,
    walletId: PROFILE_ID,
    type: 'reversal',
    amount: BigInt(-AMOUNT),
    state: 'Completed',
    idempotencyKey: `wallet-chargeback-reversal:${EVENT_ID}`,
    refId: PROVIDER_REF,
    description: WALLET_CHARGEBACK_REASON,
    metadata: {},
    reversesTransactionId: CREDIT_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const walletService = { reverseTransaction } as unknown as WalletService
  const service = new ChargebackDetectionService(
    walletService,
    {
      webhookSecret: SECRET,
      merchantId: MERCHANT,
    },
    alertService,
  )
  return { service, reverseTransaction }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) return error.getResponse() as Record<string, unknown>
  throw new Error(`expected HttpException, got ${String(error)}`)
}

function scriptClient(opts: {
  claimInserted?: boolean
  existingEvent?: ReturnType<typeof claimedEventRow> | null
  credit?: ReturnType<typeof makeCreditRow> | null
  existingReversal?: { id: string } | null
}) {
  mockClient.query.mockImplementation(async (sql: string) => {
    if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
      return { rows: [] }
    }
    if (sql.includes('INSERT INTO wallet_chargeback_events')) {
      if (opts.claimInserted === false) {
        return { rows: [], rowCount: 0 }
      }
      return { rows: [claimedEventRow()], rowCount: 1 }
    }
    if (sql.includes('FROM wallet_chargeback_events')) {
      return { rows: opts.existingEvent ? [opts.existingEvent] : [] }
    }
    if (sql.includes('FROM wallet_transactions') && sql.includes('reverses_transaction_id')) {
      return {
        rows: opts.existingReversal
          ? [makeCreditRow({ id: opts.existingReversal.id, type: 'reversal', amount: String(-AMOUNT) })]
          : [],
      }
    }
    if (sql.includes('FROM wallet_transactions')) {
      return { rows: opts.credit ? [opts.credit] : [] }
    }
    if (sql.includes('UPDATE wallet_chargeback_events')) {
      return { rows: [], rowCount: 1 }
    }
    return { rows: [] }
  })
}

describe('ChargebackDetectionService (T-04.2.04.02)', () => {
  beforeEach(() => {
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.query.mockReset()
    mockClient.release.mockReset()
  })

  it('keeps the credit idempotency key in lock-step with the callback handler', () => {
    expect(chargebackCreditIdempotencyKey(PENDING_ID)).toBe(
      onlineTopUpCreditIdempotencyKey(PENDING_ID),
    )
  })

  it('rejects a chargeback when the signing secret is missing', async () => {
    const service = new ChargebackDetectionService({ reverseTransaction: vi.fn() } as never, {
      webhookSecret: '',
      merchantId: MERCHANT,
    })
    const rejection = await service.handle(signedInput(payload())).catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_UNCONFIGURED.code,
    })
  })

  it('rejects a tampered signature before mapping or reversing', async () => {
    const { service, reverseTransaction } = makeService()
    const input = signedInput(payload())
    input.rawBody = payload({ amountIrR: 1 })
    const rejection = await service.handle(input).catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_INVALID.code,
    })
    expect(reverseTransaction).not.toHaveBeenCalled()
  })

  it('rejects a timestamp outside the replay window', async () => {
    const { service, reverseTransaction } = makeService()
    const rawBody = payload()
    const now = Math.floor(Date.now() / 1000)
    const timestamp = String(now - 301)
    const rejection = await service
      .handle({
        headers: {
          eventId: EVENT_ID,
          timestamp,
          signature: signPaymentCallback(rawBody, EVENT_ID, timestamp, SECRET),
        },
        rawBody,
      })
      .catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_REPLAYED.code,
    })
    expect(reverseTransaction).not.toHaveBeenCalled()
  })

  it('rejects a merchant id that does not match the configured merchant', async () => {
    const { service, reverseTransaction } = makeService()
    const rejection = await service
      .handle(signedInput(payload({ merchantId: 'other-merchant' })))
      .catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_INVALID.code,
    })
    expect(reverseTransaction).not.toHaveBeenCalled()
  })

  it('rejects a non-chargeback JSON body after a valid signature', async () => {
    const { service, reverseTransaction } = makeService()
    const rejection = await service
      .handle(signedInput(payload({ type: 'paid' })))
      .catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
    expect(reverseTransaction).not.toHaveBeenCalled()
  })

  it('maps a signed chargeback to the original top-up and reverses it', async () => {
    const { service, reverseTransaction } = makeService()
    scriptClient({ credit: makeCreditRow() })
    const result = await service.handle(signedInput(payload()))
    expect(result).toEqual({
      ok: true,
      processed: true,
      mapped: true,
      reversed: true,
      originalTransactionId: CREDIT_ID,
      reversalTransactionId: REVERSAL_ID,
      matchMethod: 'merchant_order_id',
      status: 'reversed',
    })
    expect(reverseTransaction).toHaveBeenCalledWith(
      CREDIT_ID,
      WALLET_CHARGEBACK_REASON,
      `wallet-chargeback-reversal:${EVENT_ID}`,
    )
  })

  it('records an unmatched exception when no original top-up is unique', async () => {
    const { service, reverseTransaction } = makeService()
    scriptClient({ credit: null })
    const result = await service.handle(signedInput(payload()))
    expect(result).toMatchObject({
      processed: true,
      mapped: false,
      reversed: false,
      status: 'unmatched',
    })
    expect(reverseTransaction).not.toHaveBeenCalled()
  })

  it('returns the stored outcome for a duplicate event id without reversing again', async () => {
    const { service, reverseTransaction } = makeService()
    scriptClient({
      claimInserted: false,
      existingEvent: claimedEventRow({
        status: 'reversed',
        original_transaction_id: CREDIT_ID,
        reversal_transaction_id: REVERSAL_ID,
        wallet_id: PROFILE_ID,
        match_method: 'merchant_order_id',
      }),
    })
    const result = await service.handle(signedInput(payload()))
    expect(result).toMatchObject({
      processed: false,
      mapped: true,
      reversed: true,
      originalTransactionId: CREDIT_ID,
      reversalTransactionId: REVERSAL_ID,
      status: 'reversed',
    })
    expect(reverseTransaction).not.toHaveBeenCalled()
  })

  it('does not reverse again when the original is already reversed', async () => {
    const { service, reverseTransaction } = makeService()
    scriptClient({
      credit: makeCreditRow(),
      existingReversal: { id: REVERSAL_ID },
    })
    const result = await service.handle(signedInput(payload()))
    expect(result).toMatchObject({
      mapped: true,
      reversed: true,
      reversalTransactionId: REVERSAL_ID,
      status: 'reversed',
    })
    expect(reverseTransaction).not.toHaveBeenCalled()
  })

  it('records unresolved when the mapped reversal cannot post', async () => {
    const reverseTransaction = vi.fn().mockRejectedValue(
      new BadRequestException('Insufficient balance: available=0, required=100000'),
    )
    const service = new ChargebackDetectionService(
      { reverseTransaction } as never,
      { webhookSecret: SECRET, merchantId: MERCHANT },
    )
    scriptClient({ credit: makeCreditRow() })
    const result = await service.handle(signedInput(payload()))
    expect(result).toMatchObject({
      mapped: true,
      reversed: false,
      originalTransactionId: CREDIT_ID,
      status: 'unresolved',
    })
  })

  it('pushes a finance alert when the chargeback stays unmatched', async () => {
    const notifyUnresolved = vi.fn().mockResolvedValue({ recipients: 1, inserted: 1 })
    const { service } = makeService({ notifyUnresolved } as never)
    scriptClient({ credit: null })
    await service.handle(signedInput(payload()))
    expect(notifyUnresolved).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        eventId: EVENT_ID,
        status: 'unmatched',
        walletId: null,
        originalTransactionId: null,
      }),
    )
  })

  it('pushes a finance alert when the mapped reversal cannot post', async () => {
    const notifyUnresolved = vi.fn().mockResolvedValue({ recipients: 1, inserted: 1 })
    const reverseTransaction = vi.fn().mockRejectedValue(
      new BadRequestException('Insufficient balance: available=0, required=100000'),
    )
    const service = new ChargebackDetectionService(
      { reverseTransaction } as never,
      { webhookSecret: SECRET, merchantId: MERCHANT },
      { notifyUnresolved } as never,
    )
    scriptClient({ credit: makeCreditRow() })
    await service.handle(signedInput(payload()))
    expect(notifyUnresolved).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        eventId: EVENT_ID,
        status: 'unresolved',
        walletId: PROFILE_ID,
        originalTransactionId: CREDIT_ID,
      }),
    )
  })

  it('does not alert finance when the original top-up is reversed', async () => {
    const notifyUnresolved = vi.fn()
    const { service } = makeService({ notifyUnresolved } as never)
    scriptClient({ credit: makeCreditRow() })
    await service.handle(signedInput(payload()))
    expect(notifyUnresolved).not.toHaveBeenCalled()
  })

  it('re-attempts the finance alert on a duplicate unmatched webhook', async () => {
    const notifyUnresolved = vi.fn().mockResolvedValue({ recipients: 1, inserted: 0 })
    const { service, reverseTransaction } = makeService({ notifyUnresolved } as never)
    scriptClient({
      claimInserted: false,
      existingEvent: claimedEventRow({ status: 'unmatched' }),
    })
    const result = await service.handle(signedInput(payload()))
    expect(result.status).toBe('unmatched')
    expect(reverseTransaction).not.toHaveBeenCalled()
    expect(notifyUnresolved).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ eventId: EVENT_ID, status: 'unmatched' }),
    )
  })

  it('maps by provider ref when merchant order id is omitted', async () => {
    const { service, reverseTransaction } = makeService()
    scriptClient({
      credit: makeCreditRow({ idempotency_key: 'credit-other' }),
    })
    const result = await service.handle(
      signedInput(
        payload({
          merchantOrderId: undefined,
        }),
      ),
    )
    expect(result.matchMethod).toBe('provider_ref_id')
    expect(reverseTransaction).toHaveBeenCalled()
  })

  it('maps an authority-only notification when the credit has a distinct provider ref', async () => {
    const { service, reverseTransaction } = makeService()
    scriptClient({
      credit: makeCreditRow({
        idempotency_key: 'credit-other',
        ref_id: PROVIDER_REF,
        metadata: {
          channel: 'online',
          pendingTransactionId: PENDING_ID,
          authority: AUTHORITY,
        },
      }),
    })
    const result = await service.handle(
      signedInput(
        payload({
          merchantOrderId: undefined,
          providerRefId: undefined,
        }),
      ),
    )
    expect(PROVIDER_REF).not.toBe(AUTHORITY)
    expect(result).toMatchObject({
      mapped: true,
      reversed: true,
      originalTransactionId: CREDIT_ID,
      matchMethod: 'authority',
      status: 'reversed',
    })
    expect(reverseTransaction).toHaveBeenCalledWith(
      CREDIT_ID,
      WALLET_CHARGEBACK_REASON,
      `wallet-chargeback-reversal:${EVENT_ID}`,
    )
  })
})
