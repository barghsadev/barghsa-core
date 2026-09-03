import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  BANK_RECEIPT_OVERPAYMENT_ERRORS,
  INVOICE_BANK_RECEIPT_CONFIRM_ERRORS,
  INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
  INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
  invoiceBankReceiptOverpaymentCreditIdempotencyKey,
} from '@barghsa/shared/finance'
import { InvoiceBankReceiptConfirmationService } from './invoice-bank-receipt-confirmation.service.js'
import type { WalletService } from '../wallet/wallet.service.js'
import type { InvoiceStateMachineService } from './invoice-state-machine.service.js'

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
const RECEIPT_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const CREDIT_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const ACTOR_ID = 'staff-1'
const AMOUNT = 250_000n
const OVERPAY_RECEIPT = 1_200_000n
const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
const NOW = new Date('2026-09-03T08:00:00.000Z')

function makeReceiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RECEIPT_ID,
    invoice_id: INVOICE_ID,
    profile_id: PROFILE_ID,
    amount: AMOUNT.toString(),
    payment_date: '2026-08-15',
    payer_reference: 'TRK-998877',
    attachment_key: ATTACHMENT,
    customer_note: 'Branch transfer',
    state: 'Submitted',
    confirmed_by: null,
    confirmed_at: null,
    rejection_reason: null,
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
      amount: 800_000n,
      state: 'Completed',
      idempotencyKey: invoiceBankReceiptOverpaymentCreditIdempotencyKey(RECEIPT_ID),
      refId: RECEIPT_ID,
      description: INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
      metadata: {},
      reversesTransactionId: null,
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
    refunded_amount: '0',
    adjustment_kind: null,
    ...overrides,
  }
}

type ScriptOptions = {
  locked?: ReturnType<typeof makeReceiptRow> | null
  confirmed?: ReturnType<typeof makeReceiptRow> | null
  listed?: ReturnType<typeof makeReceiptRow>[]
  getRow?: ReturnType<typeof makeReceiptRow> | null
  existingCredit?: Record<string, unknown> | null
  invoice?: ReturnType<typeof makeInvoiceRow> | null
  invoiceUpdated?: boolean
  wallet?: { profile_id: string } | null
}

function script(opts: ScriptOptions = {}) {
  mockClient.query.mockImplementation(async (sql: string) => {
    if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
      return { rows: [] }
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] }
    }
    if (sql.includes('FROM bank_receipts WHERE id = $1 FOR UPDATE')) {
      if (opts.locked === null) return { rows: [] }
      return { rows: [opts.locked ?? makeReceiptRow()] }
    }
    if (sql.includes('INSERT INTO wallets')) {
      return { rows: [] }
    }
    if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) {
      if (opts.wallet === null) return { rows: [] }
      return { rows: [{ profile_id: PROFILE_ID }] }
    }
    if (sql.includes('WHERE idempotency_key')) {
      return { rows: opts.existingCredit ? [opts.existingCredit] : [] }
    }
    if (sql.includes("SET state = 'Confirmed'")) {
      return {
        rows: [
          opts.confirmed ??
            makeReceiptRow({
              state: 'Confirmed',
              confirmed_by: ACTOR_ID,
              confirmed_at: NOW,
            }),
        ],
      }
    }
    if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
      if (opts.invoice === null) return { rows: [] }
      return { rows: [opts.invoice ?? makeInvoiceRow()] }
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
    if (sql.includes("state IN ('Submitted', 'UnderReview')")) {
      return { rows: opts.listed ?? [makeReceiptRow()] }
    }
    if (sql.includes('WHERE idempotency_key')) {
      return { rows: opts.existingCredit ? [opts.existingCredit] : [] }
    }
    if (sql.includes('FROM bank_receipts WHERE id')) {
      if (opts.getRow === null) return { rows: [] }
      return { rows: [opts.getRow ?? makeReceiptRow()] }
    }
    if (sql.includes('FROM invoices')) {
      if (opts.invoice === null) return { rows: [] }
      return { rows: [opts.invoice ?? makeInvoiceRow()] }
    }
    return { rows: [] }
  })
}

describe('InvoiceBankReceiptConfirmationService (T-04.3.01.03)', () => {
  let walletService: ReturnType<typeof makeWalletService>
  let invoiceStateMachine: { transition: ReturnType<typeof vi.fn> }
  let service: InvoiceBankReceiptConfirmationService

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
    mockClient.query.mockReset()
    mockPool.query.mockReset()
    walletService = makeWalletService()
    invoiceStateMachine = {
      transition: vi.fn().mockResolvedValue({
        invoiceId: INVOICE_ID,
        fromState: 'Unpaid',
        toState: 'Paid',
        transition: 'ConfirmBankReceipt',
        auditId: 'invoice-audit-1',
      }),
    }
    service = new InvoiceBankReceiptConfirmationService(
      walletService as unknown as WalletService,
      null,
      invoiceStateMachine as unknown as InvoiceStateMachineService,
    )
  })

  it('lists Submitted receipts and skips credit', async () => {
    script()
    const items = await service.listPending()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      receiptId: RECEIPT_ID,
      amount: '250000',
      state: 'Submitted',
      canConfirm: true,
      payerReference: 'TRK-998877',
      attachmentKey: ATTACHMENT,
    })
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing receipt', async () => {
    script({ getRow: null })
    const rejection = await service.get(RECEIPT_ID).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(404)
  })

  it('credits only the excess via WalletService.credit() on overpayment confirm', async () => {
    script({
      locked: makeReceiptRow({ amount: OVERPAY_RECEIPT.toString() }),
      invoice: makeInvoiceRow({ paid_amount: '600000', total_amount: '1000000' }),
    })
    const result = await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      correlationId: 'corr-1',
      now: NOW,
    })
    expect(walletService.credit).toHaveBeenCalledWith(
      PROFILE_ID,
      800_000n,
      expect.objectContaining({
        type: 'topup',
        refId: RECEIPT_ID,
        description: INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
      }),
      invoiceBankReceiptOverpaymentCreditIdempotencyKey(RECEIPT_ID),
      mockClient,
    )
    expect(invoiceStateMachine.transition).toHaveBeenNthCalledWith(
      1,
      INVOICE_ID,
      'Unpaid',
      'PaymentUnderReview',
      expect.objectContaining({ actorUserId: ACTOR_ID }),
    )
    expect(invoiceStateMachine.transition).toHaveBeenNthCalledWith(
      2,
      INVOICE_ID,
      'PaymentUnderReview',
      'Paid',
      expect.objectContaining({
        reason: 'Bank receipt confirmed against invoice',
      }),
    )
    expect(result.state).toBe('Confirmed')
    expect(result.canConfirm).toBe(false)
    expect(result.overpayment).toMatchObject({
      invoiceId: INVOICE_ID,
      remainingBefore: '400000',
      invoiceAllocation: '400000',
      walletCreditAmount: '800000',
      overpaymentCreditTransactionId: CREDIT_ID,
    })
    const audit = mockClient.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO audit_log'),
    )
    expect(audit?.[1]?.[2]).toBe(INVOICE_BANK_RECEIPT_CONFIRMED_EVENT)
  })

  it('does not credit the wallet when the receipt equals remaining', async () => {
    script({
      locked: makeReceiptRow({ amount: '400000' }),
      invoice: makeInvoiceRow({ paid_amount: '600000', total_amount: '1000000' }),
    })
    const result = await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(result.overpayment?.walletCreditAmount).toBe('0')
    expect(result.overpayment?.overpaymentCreditTransactionId).toBeNull()
    expect(result.state).toBe('Confirmed')
  })

  it('marks a partial allocation PartiallyFunded', async () => {
    script({
      locked: makeReceiptRow({ amount: '300000' }),
      invoice: makeInvoiceRow({ paid_amount: '0', total_amount: '1000000' }),
    })
    await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(invoiceStateMachine.transition).toHaveBeenNthCalledWith(
      2,
      INVOICE_ID,
      'PaymentUnderReview',
      'PartiallyFunded',
      expect.anything(),
    )
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('credits the full receipt when the invoice is already Paid', async () => {
    script({
      locked: makeReceiptRow({ amount: '200000' }),
      invoice: makeInvoiceRow({
        state: 'Paid',
        paid_amount: '500000',
        total_amount: '500000',
      }),
    })
    const result = await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(invoiceStateMachine.transition).not.toHaveBeenCalled()
    expect(walletService.credit).toHaveBeenCalledWith(
      PROFILE_ID,
      200_000n,
      expect.anything(),
      invoiceBankReceiptOverpaymentCreditIdempotencyKey(RECEIPT_ID),
      mockClient,
    )
    expect(result.overpayment).toMatchObject({
      remainingBefore: '0',
      invoiceAllocation: '0',
      walletCreditAmount: '200000',
    })
  })

  it('returns the existing Confirmed receipt without re-allocating', async () => {
    script({
      locked: makeReceiptRow({
        state: 'Confirmed',
        confirmed_by: ACTOR_ID,
        confirmed_at: NOW,
      }),
      existingCredit: {
        id: CREDIT_ID,
        wallet_id: PROFILE_ID,
        type: 'topup',
        amount: '800000',
        state: 'Completed',
        idempotency_key: invoiceBankReceiptOverpaymentCreditIdempotencyKey(RECEIPT_ID),
        metadata: {
          channel: 'invoice_bank_receipt',
          invoiceId: INVOICE_ID,
          remainingBefore: '400000',
          invoiceAllocation: '400000',
          walletCreditAmount: '800000',
        },
      },
    })
    const result = await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(invoiceStateMachine.transition).not.toHaveBeenCalled()
    expect(result.state).toBe('Confirmed')
    expect(result.overpayment?.overpaymentCreditTransactionId).toBe(CREDIT_ID)
  })

  it('rejects confirmation of a Rejected receipt', async () => {
    script({ locked: makeReceiptRow({ state: 'Rejected', rejection_reason: 'Illegible' }) })
    const rejection = await service
      .confirm({
        receiptId: RECEIPT_ID,
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.CONFLICT_STATE.code,
      message: INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED(),
    })
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('rejects confirmation against a Cancelled invoice', async () => {
    script({
      invoice: makeInvoiceRow({ state: 'Cancelled' }),
    })
    const rejection = await service
      .confirm({
        receiptId: RECEIPT_ID,
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: BANK_RECEIPT_OVERPAYMENT_ERRORS.INVOICE_STATE_NOT_SETTLEABLE('Cancelled'),
    })
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('rejects confirmation against a credit note', async () => {
    script({
      invoice: makeInvoiceRow({ adjustment_kind: 'credit' }),
    })
    const rejection = await service
      .confirm({
        receiptId: RECEIPT_ID,
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.CREDIT_NOTE(),
    })
  })
})
