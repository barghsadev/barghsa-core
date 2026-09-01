import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  BANK_RECEIPT_CONFIRM_ERRORS,
  BANK_RECEIPT_CONFIRMED_EVENT,
  BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
  BANK_RECEIPT_OVERPAYMENT_ERRORS,
  BANK_RECEIPT_REJECTED_EVENT,
  BANK_RECEIPT_TOPUP_CHANNEL,
  bankReceiptCreditIdempotencyKey,
  bankReceiptOverpaymentCreditIdempotencyKey,
} from '@barghsa/shared/finance'
import { BankReceiptConfirmationService } from './bank-receipt-confirmation.service.js'
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
const OTHER_PROFILE = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const TX_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const CREDIT_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const ACTOR_ID = 'staff-1'
const AMOUNT = 250_000n
const OVERPAY_RECEIPT = 1_200_000n
const INVOICE_REMAINING = 400_000n
const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
const NOW = new Date('2026-09-02T08:00:00.000Z')

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
    idempotency_key: 'idem-bank-receipt-1',
    ref_id: null,
    description: 'Bank receipt wallet top-up',
    metadata: {
      channel: BANK_RECEIPT_TOPUP_CHANNEL,
      receipt: RECEIPT,
    },
    receipt_attachment_key: ATTACHMENT,
    created_at: new Date('2026-09-01T10:00:00.000Z'),
    updated_at: new Date('2026-09-01T10:00:00.000Z'),
    ...overrides,
  }
}

function makeWalletService() {
  return {
    credit: vi.fn().mockResolvedValue({
      id: CREDIT_ID,
      walletId: PROFILE_ID,
      type: 'topup',
      amount: AMOUNT,
      state: 'Completed',
      idempotencyKey: bankReceiptCreditIdempotencyKey(TX_ID),
      refId: TX_ID,
      description: 'Bank receipt wallet top-up',
      metadata: {},
      createdAt: NOW,
      updatedAt: NOW,
    }),
  }
}

function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    profile_id: PROFILE_ID,
    state: 'Unpaid',
    total_amount: '1000000',
    paid_amount: '600000',
    ...overrides,
  }
}

type ScriptOptions = {
  locked?: ReturnType<typeof makePendingRow> | null
  released?: ReturnType<typeof makePendingRow> | null
  rejected?: ReturnType<typeof makePendingRow> | null
  listed?: ReturnType<typeof makePendingRow>[]
  getRow?: ReturnType<typeof makePendingRow> | null
  existingCredit?: ReturnType<typeof makePendingRow> | null
  invoice?: ReturnType<typeof makeInvoiceRow> | null
  invoiceUpdated?: boolean
}

function script(opts: ScriptOptions = {}) {
  mockClient.query.mockImplementation(async (sql: string) => {
    if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
      return { rows: [] }
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] }
    }
    if (sql.includes('FROM wallet_transactions WHERE id = $1 FOR UPDATE')) {
      if (opts.locked === null) return { rows: [] }
      return { rows: [opts.locked ?? makePendingRow()] }
    }
    if (sql.includes("SET state = 'Released'")) {
      return {
        rows: [
          opts.released ??
            makePendingRow({
              state: 'Released',
              metadata: {
                channel: BANK_RECEIPT_TOPUP_CHANNEL,
                receipt: RECEIPT,
                staffDecision: {
                  decision: 'confirmed',
                  actorUserId: ACTOR_ID,
                  decidedAt: NOW.toISOString(),
                  reason: null,
                  customerVisible: false,
                  creditTransactionId: CREDIT_ID,
                },
              },
            }),
        ],
      }
    }
    if (sql.includes("SET state = 'Rejected'")) {
      return {
        rows: [
          opts.rejected ??
            makePendingRow({
              state: 'Rejected',
              metadata: {
                channel: BANK_RECEIPT_TOPUP_CHANNEL,
                receipt: RECEIPT,
                staffDecision: {
                  decision: 'rejected',
                  actorUserId: ACTOR_ID,
                  decidedAt: NOW.toISOString(),
                  reason: 'Illegible scan',
                  customerVisible: true,
                  creditTransactionId: null,
                },
              },
            }),
        ],
      }
    }
    if (sql.includes('FROM invoices')) {
      if (opts.invoice === null) return { rows: [] }
      return { rows: [opts.invoice ?? makeInvoiceRow()] }
    }
    if (sql.includes('UPDATE invoices')) {
      if (opts.invoiceUpdated === false) return { rows: [] }
      return { rows: [{ id: INVOICE_ID }] }
    }
    if (sql.includes('INSERT INTO audit_log')) {
      return { rows: [] }
    }
    return { rows: [] }
  })

  mockPool.query.mockImplementation(async (sql: string) => {
    if (sql.includes("metadata->>'channel'")) {
      return { rows: opts.listed ?? [makePendingRow()] }
    }
    if (sql.includes('WHERE idempotency_key')) {
      return { rows: opts.existingCredit ? [opts.existingCredit] : [] }
    }
    if (sql.includes('FROM wallet_transactions WHERE id')) {
      if (opts.getRow === null) return { rows: [] }
      return { rows: [opts.getRow ?? makePendingRow()] }
    }
    return { rows: [] }
  })
}

describe('BankReceiptConfirmationService (T-04.2.02.04)', () => {
  let walletService: ReturnType<typeof makeWalletService>
  let service: BankReceiptConfirmationService

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
    mockClient.query.mockReset()
    mockPool.query.mockReset()
    walletService = makeWalletService()
    service = new BankReceiptConfirmationService(walletService as unknown as WalletService, null)
  })

  it('lists pending bank-receipt top-ups and skips credit', async () => {
    script()
    const items = await service.listPending()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      transactionId: TX_ID,
      amount: '250000',
      state: 'Pending',
      canDecide: true,
      payerReference: 'TRK-998877',
      attachmentKey: ATTACHMENT,
    })
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing or non-receipt transaction', async () => {
    script({ getRow: null })
    const rejection = await service.get(TX_ID).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(404)
  })

  it('credits the wallet via WalletService.credit() on confirm', async () => {
    script()
    const result = await service.confirm({
      transactionId: TX_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      correlationId: 'corr-1',
      now: NOW,
    })
    expect(walletService.credit).toHaveBeenCalledWith(
      PROFILE_ID,
      AMOUNT,
      expect.objectContaining({
        type: 'topup',
        refId: TX_ID,
      }),
      bankReceiptCreditIdempotencyKey(TX_ID),
      mockClient,
    )
    expect(result.state).toBe('Released')
    expect(result.canDecide).toBe(false)
    expect(result.creditTransactionId).toBe(CREDIT_ID)
    expect(result.overpayment).toBeNull()
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_log')),
    ).toBe(true)
    const audit = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_log'),
    )
    expect(audit?.[1]?.[2]).toBe(BANK_RECEIPT_CONFIRMED_EVENT)
  })

  it('rejects a receipt without calling credit', async () => {
    script()
    const result = await service.reject({
      transactionId: TX_ID,
      raw: { reason: '  Illegible scan  ' },
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(result.state).toBe('Rejected')
    expect(result.canDecide).toBe(false)
    expect(result.staffDecision?.reason).toBe('Illegible scan')
    const audit = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_log'),
    )
    expect(audit?.[1]?.[2]).toBe(BANK_RECEIPT_REJECTED_EVENT)
  })

  it('requires a customer-visible reject reason before locking', async () => {
    const rejection = await service
      .reject({
        transactionId: TX_ID,
        raw: { reason: '   ' },
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: BANK_RECEIPT_CONFIRM_ERRORS.BAD_REASON(),
    })
    expect(mockPool.connect).not.toHaveBeenCalled()
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('conflicts when confirming an already rejected receipt', async () => {
    script({ locked: makePendingRow({ state: 'Rejected' }) })
    const rejection = await service
      .confirm({
        transactionId: TX_ID,
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
      })
      .catch((error: unknown) => error)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('conflicts when rejecting an already confirmed receipt', async () => {
    script({ locked: makePendingRow({ state: 'Released' }) })
    const rejection = await service
      .reject({
        transactionId: TX_ID,
        raw: { reason: 'Too late' },
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
      })
      .catch((error: unknown) => error)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('credits only the excess when the receipt exceeds invoice remaining', async () => {
    script({
      locked: makePendingRow({ amount: OVERPAY_RECEIPT.toString() }),
      invoice: makeInvoiceRow({ total_amount: '1000000', paid_amount: '600000' }),
    })
    const result = await service.confirm({
      transactionId: TX_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      invoiceId: INVOICE_ID,
      now: NOW,
    })
    expect(walletService.credit).toHaveBeenCalledTimes(1)
    expect(walletService.credit).toHaveBeenCalledWith(
      PROFILE_ID,
      OVERPAY_RECEIPT - INVOICE_REMAINING,
      expect.objectContaining({
        type: 'topup',
        description: BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
      }),
      bankReceiptOverpaymentCreditIdempotencyKey(TX_ID),
      mockClient,
    )
    expect(
      mockClient.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes('UPDATE invoices') &&
          Array.isArray(params) &&
          params[1] === INVOICE_REMAINING.toString(),
      ),
    ).toBe(true)
    expect(result.overpayment).toMatchObject({
      invoiceId: INVOICE_ID,
      remainingBefore: INVOICE_REMAINING.toString(),
      invoiceAllocation: INVOICE_REMAINING.toString(),
      walletCreditAmount: (OVERPAY_RECEIPT - INVOICE_REMAINING).toString(),
    })
    const audit = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_log'),
    )
    expect(audit?.[1]?.[3]).toContain('"walletCreditAmount":"800000"')
  })

  it('does not credit the wallet when the receipt equals invoice remaining', async () => {
    script({
      locked: makePendingRow({ amount: INVOICE_REMAINING.toString() }),
      invoice: makeInvoiceRow({ total_amount: '1000000', paid_amount: '600000' }),
    })
    const result = await service.confirm({
      transactionId: TX_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      invoiceId: INVOICE_ID,
      now: NOW,
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(result.overpayment).toMatchObject({
      invoiceAllocation: INVOICE_REMAINING.toString(),
      walletCreditAmount: '0',
      overpaymentCreditTransactionId: null,
    })
  })

  it('credits the full receipt to the wallet when the invoice is already paid', async () => {
    script({
      invoice: makeInvoiceRow({ state: 'Paid', total_amount: '1000000', paid_amount: '1000000' }),
    })
    await service.confirm({
      transactionId: TX_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      invoiceId: INVOICE_ID,
      now: NOW,
    })
    expect(walletService.credit).toHaveBeenCalledWith(
      PROFILE_ID,
      AMOUNT,
      expect.objectContaining({ description: BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION }),
      bankReceiptOverpaymentCreditIdempotencyKey(TX_ID),
      mockClient,
    )
    expect(mockClient.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE invoices'))).toBe(
      false,
    )
  })

  it('rejects an invoice that belongs to a different profile', async () => {
    script({ invoice: makeInvoiceRow({ profile_id: OTHER_PROFILE }) })
    const rejection = await service
      .confirm({
        transactionId: TX_ID,
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
        invoiceId: INVOICE_ID,
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.CONFLICT_STATE.code,
      message: BANK_RECEIPT_OVERPAYMENT_ERRORS.PROFILE_MISMATCH(),
    })
    expect(walletService.credit).not.toHaveBeenCalled()
  })
})
