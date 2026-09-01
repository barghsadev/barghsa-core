import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import { BANK_RECEIPT_TOPUP_CHANNEL } from '@barghsa/shared/finance'
import { BankReceiptTopUpService } from './bank-receipt-topup.service.js'
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

const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const TX_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const IDEM = 'idem-bank-receipt-1'
const ACTOR_ID = 'user-1'
const AMOUNT = 250_000n
const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'

const RECEIPT = {
  paymentDate: '2026-08-15',
  payerReference: 'TRK-998877',
  attachmentKey: ATTACHMENT,
  customerNote: 'Branch transfer',
}

function makePendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    wallet_id: PROFILE_ID,
    type: 'topup',
    amount: AMOUNT.toString(),
    state: 'Pending',
    idempotency_key: IDEM,
    ref_id: null,
    description: 'Bank receipt wallet top-up',
    metadata: {
      channel: BANK_RECEIPT_TOPUP_CHANNEL,
      receipt: RECEIPT,
    },
    created_at: new Date('2026-09-01'),
    updated_at: new Date('2026-09-01'),
    ...overrides,
  }
}

function makeWalletService() {
  return {
    createWallet: vi.fn().mockResolvedValue({ profileId: PROFILE_ID }),
    credit: vi.fn(),
  }
}

type ScriptOptions = {
  wallet?: { profile_id: string } | null
  storageStatus?: string | null
  existing?: ReturnType<typeof makePendingRow> | null
  insert?: ReturnType<typeof makePendingRow> | Error
}

function scriptClient(opts: ScriptOptions = {}) {
  mockClient.query.mockImplementation(async (sql: string) => {
    if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
      return { rows: [] }
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] }
    }
    if (sql.includes('FROM storage_records')) {
      if (opts.storageStatus === null) return { rows: [] }
      return { rows: [{ status: opts.storageStatus ?? 'active' }] }
    }
    if (sql.includes('UPDATE storage_records')) {
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('FROM wallets')) {
      if (opts.wallet === null) return { rows: [] }
      return { rows: [opts.wallet ?? { profile_id: PROFILE_ID }] }
    }
    if (sql.includes('FROM wallet_transactions WHERE idempotency_key')) {
      return { rows: opts.existing ? [opts.existing] : [] }
    }
    if (sql.includes('INSERT INTO wallet_transactions')) {
      if (opts.insert instanceof Error) throw opts.insert
      return { rows: [opts.insert ?? makePendingRow()] }
    }
    return { rows: [] }
  })
}

function submitInput(overrides: Record<string, unknown> = {}) {
  return {
    profileId: PROFILE_ID,
    amount: Number(AMOUNT),
    paymentDate: RECEIPT.paymentDate,
    payerReference: RECEIPT.payerReference,
    attachmentKey: RECEIPT.attachmentKey,
    customerNote: RECEIPT.customerNote,
    idempotencyKey: IDEM,
    actorId: ACTOR_ID,
    ...overrides,
  }
}

describe('BankReceiptTopUpService (T-04.2.02.03)', () => {
  let walletService: ReturnType<typeof makeWalletService>
  let service: BankReceiptTopUpService

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
    mockClient.query.mockReset()
    walletService = makeWalletService()
    service = new BankReceiptTopUpService(walletService as unknown as WalletService)
  })

  it('rejects a blank idempotency key before touching the wallet', async () => {
    await expect(service.submit(submitInput({ idempotencyKey: '   ' }))).rejects.toMatchObject({
      status: 400,
    })
    expect(walletService.createWallet).not.toHaveBeenCalled()
    expect(mockPool.connect).not.toHaveBeenCalled()
  })

  it('rejects an invalid amount before creating a Pending row', async () => {
    await expect(service.submit(submitInput({ amount: 0 }))).rejects.toMatchObject({
      status: 400,
    })
    expect(walletService.createWallet).not.toHaveBeenCalled()
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('does not apply the online top-up limit to a large receipt amount', async () => {
    scriptClient()
    const result = await service.submit(submitInput({ amount: 3_000_000_000 }))
    expect(result.state).toBe('Pending')
    expect(walletService.credit).not.toHaveBeenCalled()
    const insert = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO wallet_transactions'),
    )
    expect(insert?.[1]?.[1]).toBe('3000000000')
  })

  it('rejects a missing storage record so fabricated keys cannot pending-credit', async () => {
    scriptClient({ storageStatus: null })
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO wallet_transactions')),
    ).toBe(false)
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('rejects a removed storage record', async () => {
    scriptClient({ storageStatus: 'removed' })
    await expect(service.submit(submitInput())).rejects.toMatchObject({ status: 400 })
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('inserts a Pending topup and does not credit the wallet', async () => {
    scriptClient()
    const result = await service.submit(submitInput())
    expect(result).toEqual({
      transactionId: TX_ID,
      amount: AMOUNT,
      state: 'Pending',
      paymentDate: RECEIPT.paymentDate,
      payerReference: RECEIPT.payerReference,
      attachmentKey: RECEIPT.attachmentKey,
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    const insert = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO wallet_transactions'),
    )
    expect(insert?.[1]?.[3]).toBe('Bank receipt wallet top-up')
    expect(JSON.parse(String(insert?.[1]?.[4]))).toMatchObject({
      channel: BANK_RECEIPT_TOPUP_CHANNEL,
      receipt: RECEIPT,
    })
    const protect = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE storage_records'),
    )
    expect(protect?.[1]).toEqual([ATTACHMENT, ACTOR_ID])
  })

  it('does not rewrite an already-immutable receipt', async () => {
    scriptClient({ storageStatus: 'immutable' })
    const result = await service.submit(submitInput())
    expect(result.state).toBe('Pending')
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE storage_records')),
    ).toBe(false)
  })

  it('reuses a matching in-flight Pending row for the same idempotency key', async () => {
    scriptClient({ existing: makePendingRow() })
    const result = await service.submit(submitInput())
    expect(result.transactionId).toBe(TX_ID)
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO wallet_transactions')),
    ).toBe(false)
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('conflicts when the same key was used for a different amount', async () => {
    scriptClient({
      existing: makePendingRow({ amount: '1000' }),
    })
    await expect(service.submit(submitInput())).rejects.toBeInstanceOf(ConflictException)
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('conflicts when the same key was used for an online top-up', async () => {
    scriptClient({
      existing: makePendingRow({ metadata: { channel: 'online' } }),
    })
    await expect(service.submit(submitInput())).rejects.toBeInstanceOf(ConflictException)
  })

  it('throws when the wallet row disappears after createWallet', async () => {
    scriptClient({ wallet: null })
    await expect(service.submit(submitInput())).rejects.toBeInstanceOf(NotFoundException)
  })
})
