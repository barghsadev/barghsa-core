import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  OnlineTopUpCallbackService,
  onlineTopUpCreditIdempotencyKey,
  zarinpalReturnEventId,
} from './online-topup-callback.service.js'
import { signPaymentCallback } from './payment-callback-verifier.js'
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

const SECRET = 'whsec-test'
const MERCHANT = 'merchant-1'
const TX_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const OTHER_TX_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd'
const CREDIT_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const PROFILE_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const AUTHORITY = 'auth-pending-1'
const AMOUNT = 100_000
const EVENT_ID = 'evt-paid-1'

function makePendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    wallet_id: PROFILE_ID,
    type: 'topup',
    amount: String(AMOUNT),
    state: 'Pending',
    idempotency_key: 'idem-init-1',
    ref_id: AUTHORITY,
    description: 'Online wallet top-up',
    metadata: { channel: 'online', gateway: { authority: AUTHORITY, redirectUrl: 'https://pay.test' } },
    created_at: new Date('2026-09-01'),
    updated_at: new Date('2026-09-01'),
    ...overrides,
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    merchantOrderId: TX_ID,
    merchantId: MERCHANT,
    authority: AUTHORITY,
    amountIrR: AMOUNT,
    status: 'paid',
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

function makeService() {
  const credit = vi.fn().mockResolvedValue({
    id: CREDIT_ID,
    walletId: PROFILE_ID,
    type: 'topup',
    amount: BigInt(AMOUNT),
    state: 'Completed',
    idempotencyKey: onlineTopUpCreditIdempotencyKey(TX_ID),
    refId: AUTHORITY,
    description: 'Online wallet top-up',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const walletService = { credit } as unknown as WalletService
  const verifyPayment = vi.fn().mockResolvedValue({ paid: true, providerRefId: 'psp-ref-1' })
  const gateway = {
    startPayment: vi.fn(),
    recoverPayment: vi.fn(),
    verifyPayment,
  } as unknown as PaymentGateway
  const service = new OnlineTopUpCallbackService(walletService, gateway, {
    webhookSecret: SECRET,
    merchantId: MERCHANT,
  })
  return { service, credit, verifyPayment }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) return error.getResponse() as Record<string, unknown>
  throw new Error(`expected HttpException, got ${String(error)}`)
}

function claimedEventRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_ID,
    pending_transaction_id: TX_ID,
    wallet_id: PROFILE_ID,
    status: 'processing',
    ...overrides,
  }
}

function scriptClient(opts: {
  pending?: ReturnType<typeof makePendingRow> | null
  existingCredit?: { id: string } | null
  claimInserted?: boolean
  existingEvent?: ReturnType<typeof claimedEventRow> | null
}) {
  mockClient.query.mockImplementation(async (sql: string) => {
    if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
      return { rows: [] }
    }
    if (sql.includes('FROM wallet_transactions WHERE id =')) {
      return { rows: opts.pending ? [opts.pending] : [] }
    }
    if (sql.includes('FROM wallet_transactions WHERE idempotency_key')) {
      return {
        rows: opts.existingCredit
          ? [
              makePendingRow({
                id: opts.existingCredit.id,
                state: 'Completed',
                idempotency_key: onlineTopUpCreditIdempotencyKey(
                  opts.pending?.id ? String(opts.pending.id) : TX_ID,
                ),
              }),
            ]
          : [],
      }
    }
    if (sql.includes('UPDATE wallet_transactions') || sql.includes('UPDATE wallet_topup_callback_events')) {
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO wallet_topup_callback_events')) {
      if (opts.claimInserted === false) {
        return { rows: [], rowCount: 0 }
      }
      return { rows: [claimedEventRow()], rowCount: 1 }
    }
    if (sql.includes('FROM wallet_topup_callback_events')) {
      return { rows: opts.existingEvent ? [opts.existingEvent] : [] }
    }
    return { rows: [] }
  })
}

describe('OnlineTopUpCallbackService (T-04.2.02.02)', () => {
  beforeEach(() => {
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.query.mockReset()
    mockClient.release.mockReset()
  })

  it('rejects a callback when the signing secret is missing', async () => {
    const { verifyPayment } = makeService()
    const service = new OnlineTopUpCallbackService(
      { credit: vi.fn() } as never,
      { verifyPayment } as never,
      { webhookSecret: '', merchantId: MERCHANT },
    )
    const rejection = await service.handle(signedInput(payload())).catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_UNCONFIGURED.code,
    })
  })

  it('rejects a tampered signature before touching the wallet', async () => {
    const { service, credit, verifyPayment } = makeService()
    const input = signedInput(payload())
    input.rawBody = payload({ amountIrR: 1 })
    const rejection = await service.handle(input).catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_INVALID.code,
    })
    expect(credit).not.toHaveBeenCalled()
    expect(verifyPayment).not.toHaveBeenCalled()
  })

  it('rejects a timestamp outside the replay window', async () => {
    const { service, credit } = makeService()
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
    expect(credit).not.toHaveBeenCalled()
  })

  it('rejects a merchant id that does not match configured merchant context', async () => {
    const { service, credit } = makeService()
    const rejection = await service
      .handle(signedInput(payload({ merchantId: 'other-merchant' })))
      .catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_INVALID.code,
    })
    expect(credit).not.toHaveBeenCalled()
    expect(mockPool.connect).not.toHaveBeenCalled()
  })

  it('credits via WalletService.credit with a stable idempotency key', async () => {
    scriptClient({ pending: makePendingRow() })
    const { service, credit, verifyPayment } = makeService()
    const result = await service.handle(signedInput(payload()))
    expect(result).toMatchObject({
      ok: true,
      processed: true,
      credited: true,
      transactionId: TX_ID,
      creditTransactionId: CREDIT_ID,
    })
    expect(verifyPayment).toHaveBeenCalledWith({
      amountIrR: BigInt(AMOUNT),
      merchantOrderId: TX_ID,
      authority: AUTHORITY,
      idempotencyKey: TX_ID,
    })
    expect(credit).toHaveBeenCalledWith(
      PROFILE_ID,
      BigInt(AMOUNT),
      expect.objectContaining({
        type: 'topup',
        refId: 'psp-ref-1',
      }),
      onlineTopUpCreditIdempotencyKey(TX_ID),
    )
    const updates = mockClient.query.mock.calls.filter((call) =>
      String(call[0]).includes("SET state = 'Released'"),
    )
    expect(updates).toHaveLength(1)
    const claim = mockClient.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO wallet_topup_callback_events'),
    )
    expect(claim).toBeDefined()
    expect(String(claim![0])).toContain('RETURNING')
  })

  it('claims the event id before gateway verify or wallet credit', async () => {
    const order: string[] = []
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO wallet_topup_callback_events')) {
        order.push('claim')
        return { rows: [claimedEventRow()], rowCount: 1 }
      }
      if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
        return { rows: [] }
      }
      if (sql.includes('FROM wallet_transactions WHERE id =')) {
        return { rows: [makePendingRow()] }
      }
      if (sql.includes('FROM wallet_transactions WHERE idempotency_key')) {
        return { rows: [] }
      }
      if (sql.includes('UPDATE wallet_transactions') || sql.includes('UPDATE wallet_topup_callback_events')) {
        return { rows: [], rowCount: 1 }
      }
      return { rows: [] }
    })
    const { service, credit, verifyPayment } = makeService()
    verifyPayment.mockImplementation(async () => {
      order.push('verify')
      return { paid: true, providerRefId: 'psp-ref-1' }
    })
    credit.mockImplementation(async () => {
      order.push('credit')
      return {
        id: CREDIT_ID,
        walletId: PROFILE_ID,
        type: 'topup',
        amount: BigInt(AMOUNT),
        state: 'Completed',
        idempotencyKey: onlineTopUpCreditIdempotencyKey(TX_ID),
        refId: AUTHORITY,
        description: 'Online wallet top-up',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    })
    await service.handle(signedInput(payload()))
    expect(order.indexOf('claim')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('claim')).toBeLessThan(order.indexOf('verify'))
    expect(order.indexOf('claim')).toBeLessThan(order.indexOf('credit'))
  })

  it('does not credit when the server-side verify reports unpaid', async () => {
    scriptClient({ pending: makePendingRow() })
    const { service, credit, verifyPayment } = makeService()
    verifyPayment.mockResolvedValue({ paid: false, providerRefId: null })
    const result = await service.handle(signedInput(payload()))
    expect(result.credited).toBe(false)
    expect(credit).not.toHaveBeenCalled()
  })

  it('replays a duplicate event id after credit without calling credit again', async () => {
    scriptClient({
      pending: makePendingRow({ state: 'Released' }),
      existingCredit: { id: CREDIT_ID },
      claimInserted: false,
      existingEvent: claimedEventRow({ status: 'credited' }),
    })
    const { service, credit, verifyPayment } = makeService()
    const result = await service.handle(signedInput(payload()))
    expect(result).toMatchObject({
      processed: false,
      credited: true,
      creditTransactionId: CREDIT_ID,
    })
    expect(credit).not.toHaveBeenCalled()
    expect(verifyPayment).not.toHaveBeenCalled()
  })

  it('does not credit a different order that reuses a claimed event id', async () => {
    scriptClient({
      pending: makePendingRow({ id: OTHER_TX_ID }),
      claimInserted: false,
      existingEvent: claimedEventRow({ status: 'credited', pending_transaction_id: TX_ID }),
    })
    const { service, credit, verifyPayment } = makeService()
    const result = await service.handle(signedInput(payload({ merchantOrderId: OTHER_TX_ID })))
    expect(result).toMatchObject({
      processed: false,
      transactionId: TX_ID,
    })
    expect(credit).not.toHaveBeenCalled()
    expect(verifyPayment).not.toHaveBeenCalled()
    const creditUpdates = mockClient.query.mock.calls.filter((call) =>
      String(call[0]).includes("SET state = 'Released'"),
    )
    expect(creditUpdates).toHaveLength(0)
  })

  it('resumes a processing claim for the same order after a crash', async () => {
    scriptClient({
      pending: makePendingRow(),
      claimInserted: false,
      existingEvent: claimedEventRow({ status: 'processing' }),
    })
    const { service, credit, verifyPayment } = makeService()
    const result = await service.handle(signedInput(payload()))
    expect(result).toMatchObject({
      processed: true,
      credited: true,
      creditTransactionId: CREDIT_ID,
    })
    expect(verifyPayment).toHaveBeenCalled()
    expect(credit).toHaveBeenCalledWith(
      PROFILE_ID,
      BigInt(AMOUNT),
      expect.objectContaining({ type: 'topup' }),
      onlineTopUpCreditIdempotencyKey(TX_ID),
    )
  })

  it('credits a ZarinPal GET return after binding orderId/Authority and server-side verify', async () => {
    scriptClient({ pending: makePendingRow() })
    const { service, credit, verifyPayment } = makeService()
    const result = await service.handleZarinpalReturn({
      orderId: TX_ID,
      authority: AUTHORITY,
      status: 'OK',
    })
    expect(result).toMatchObject({
      ok: true,
      processed: true,
      credited: true,
      transactionId: TX_ID,
      creditTransactionId: CREDIT_ID,
    })
    expect(verifyPayment).toHaveBeenCalledWith({
      amountIrR: BigInt(AMOUNT),
      merchantOrderId: TX_ID,
      authority: AUTHORITY,
      idempotencyKey: TX_ID,
    })
    expect(credit).toHaveBeenCalledWith(
      PROFILE_ID,
      BigInt(AMOUNT),
      expect.objectContaining({
        type: 'topup',
        refId: 'psp-ref-1',
        metadata: expect.objectContaining({
          eventId: zarinpalReturnEventId(TX_ID, AUTHORITY, 'paid'),
          authority: AUTHORITY,
        }),
      }),
      onlineTopUpCreditIdempotencyKey(TX_ID),
    )
    const claim = mockClient.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO wallet_topup_callback_events'),
    )
    expect(claim?.[1]?.[0]).toBe(zarinpalReturnEventId(TX_ID, AUTHORITY, 'paid'))
  })

  it('does not credit a ZarinPal GET return with Status=NOK', async () => {
    scriptClient({ pending: makePendingRow() })
    const { service, credit, verifyPayment } = makeService()
    const result = await service.handleZarinpalReturn({
      orderId: TX_ID,
      authority: AUTHORITY,
      status: 'NOK',
    })
    expect(result).toMatchObject({ processed: true, credited: false })
    expect(verifyPayment).not.toHaveBeenCalled()
    expect(credit).not.toHaveBeenCalled()
    const claim = mockClient.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO wallet_topup_callback_events'),
    )
    expect(claim?.[1]?.[0]).toBe(zarinpalReturnEventId(TX_ID, AUTHORITY, 'cancelled'))
  })

  it('credits a ZarinPal OK return after an earlier NOK for the same order and authority', async () => {
    const claimedIds: string[] = []
    mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
        return { rows: [] }
      }
      if (sql.includes('FROM wallet_transactions WHERE id =')) {
        const state = claimedIds.includes(zarinpalReturnEventId(TX_ID, AUTHORITY, 'cancelled'))
          ? 'Failed'
          : 'Pending'
        return { rows: [makePendingRow({ state })] }
      }
      if (sql.includes('FROM wallet_transactions WHERE idempotency_key')) {
        return { rows: [] }
      }
      if (sql.includes('UPDATE wallet_transactions') || sql.includes('UPDATE wallet_topup_callback_events')) {
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO wallet_topup_callback_events')) {
        const eventId = String(params?.[0])
        if (claimedIds.includes(eventId)) {
          return { rows: [], rowCount: 0 }
        }
        claimedIds.push(eventId)
        return { rows: [claimedEventRow({ event_id: eventId })], rowCount: 1 }
      }
      if (sql.includes('FROM wallet_topup_callback_events')) {
        const eventId = String(params?.[0])
        return {
          rows: [
            claimedEventRow({
              event_id: eventId,
              status: eventId === zarinpalReturnEventId(TX_ID, AUTHORITY, 'cancelled')
                ? 'unpaid'
                : 'processing',
            }),
          ],
        }
      }
      return { rows: [] }
    })
    const { service, credit, verifyPayment } = makeService()
    const nok = await service.handleZarinpalReturn({
      orderId: TX_ID,
      authority: AUTHORITY,
      status: 'NOK',
    })
    expect(nok).toMatchObject({ processed: true, credited: false })
    expect(verifyPayment).not.toHaveBeenCalled()
    expect(credit).not.toHaveBeenCalled()

    const ok = await service.handleZarinpalReturn({
      orderId: TX_ID,
      authority: AUTHORITY,
      status: 'OK',
    })
    expect(ok).toMatchObject({
      processed: true,
      credited: true,
      creditTransactionId: CREDIT_ID,
    })
    expect(verifyPayment).toHaveBeenCalledTimes(1)
    expect(credit).toHaveBeenCalledTimes(1)
    expect(claimedIds).toEqual([
      zarinpalReturnEventId(TX_ID, AUTHORITY, 'cancelled'),
      zarinpalReturnEventId(TX_ID, AUTHORITY, 'paid'),
    ])
  })

  it('re-verifies a later paid delivery after the same event id was finalized unpaid', async () => {
    scriptClient({
      pending: makePendingRow({ state: 'Failed' }),
      claimInserted: false,
      existingEvent: claimedEventRow({ status: 'unpaid' }),
    })
    const { service, credit, verifyPayment } = makeService()
    const result = await service.handle(signedInput(payload()))
    expect(result).toMatchObject({
      processed: true,
      credited: true,
      creditTransactionId: CREDIT_ID,
    })
    expect(verifyPayment).toHaveBeenCalled()
    expect(credit).toHaveBeenCalled()
    const reopen = mockClient.query.mock.calls.find((call) =>
      String(call[0]).includes("SET status = 'processing'"),
    )
    expect(reopen).toBeDefined()
  })

  it('rejects a ZarinPal GET return whose Authority does not match the pending order', async () => {
    scriptClient({ pending: makePendingRow() })
    const { service, credit, verifyPayment } = makeService()
    const rejection = await service
      .handleZarinpalReturn({
        orderId: TX_ID,
        authority: 'wrong-authority',
        status: 'OK',
      })
      .catch((e: unknown) => e)
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_INVALID.code,
    })
    expect(verifyPayment).not.toHaveBeenCalled()
    expect(credit).not.toHaveBeenCalled()
  })

  it('credits a ZarinPal GET return without a webhook HMAC secret', async () => {
    scriptClient({ pending: makePendingRow() })
    const credit = vi.fn().mockResolvedValue({
      id: CREDIT_ID,
      walletId: PROFILE_ID,
      type: 'topup',
      amount: BigInt(AMOUNT),
      state: 'Completed',
      idempotencyKey: onlineTopUpCreditIdempotencyKey(TX_ID),
      refId: AUTHORITY,
      description: 'Online wallet top-up',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const verifyPayment = vi.fn().mockResolvedValue({ paid: true, providerRefId: 'psp-ref-1' })
    const service = new OnlineTopUpCallbackService(
      { credit } as never,
      { verifyPayment } as never,
      { webhookSecret: '', merchantId: MERCHANT },
    )
    const result = await service.handleZarinpalReturn({
      orderId: TX_ID,
      authority: AUTHORITY,
      status: 'OK',
    })
    expect(result.credited).toBe(true)
    expect(verifyPayment).toHaveBeenCalled()
    expect(credit).toHaveBeenCalled()
  })
})
