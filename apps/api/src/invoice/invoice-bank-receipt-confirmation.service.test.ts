import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  BANK_RECEIPT_OVERPAYMENT_ERRORS,
  INVOICE_BANK_RECEIPT_CONFIRM_ERRORS,
  INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT,
  INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
  INVOICE_BANK_RECEIPT_REJECT_ERRORS,
  INVOICE_BANK_RECEIPT_REJECTED_EVENT,
  INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY,
  invoiceBankReceiptOverpaymentCreditIdempotencyKey,
} from '@barghsa/shared/finance'
import { InvoiceBankReceiptConfirmationService } from './invoice-bank-receipt-confirmation.service.js'
import type { WalletService } from '../wallet/wallet.service.js'
import type { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { APPROVAL_REQUEST_APPROVED_EVENT } from '../admin/dual-approval-resolution.js'

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
  rejected?: ReturnType<typeof makeReceiptRow> | null
  listed?: ReturnType<typeof makeReceiptRow>[]
  getRow?: ReturnType<typeof makeReceiptRow> | null
  existingCredit?: Record<string, unknown> | null
  invoice?: ReturnType<typeof makeInvoiceRow> | null
  invoiceUpdated?: boolean
  wallet?: { profile_id: string } | null
  profile?: { userId: string } | null
  outboxInserted?: boolean
  threshold?: unknown
  pendingApproval?: {
    id: string
    initiator_id: string
    status: string
    review_reason?: string | null
    reviewer_id?: string | null
    action_type?: string
    amount_irr?: string
  } | null
  underReview?: ReturnType<typeof makeReceiptRow> | null
}

function thresholdRows(opts: ScriptOptions): { rows: Array<{ value: unknown }> } {
  if (opts.threshold === undefined) return { rows: [] }
  return { rows: [{ value: opts.threshold }] }
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
    if (sql.includes('FROM app_config')) {
      return thresholdRows(opts)
    }
    if (sql.includes('FROM approval_requests')) {
      return { rows: opts.pendingApproval ? [opts.pendingApproval] : [] }
    }
    if (sql.includes('INSERT INTO approval_requests')) {
      return { rows: [] }
    }
    if (sql.includes('UPDATE approval_requests')) {
      return { rows: [] }
    }
    if (sql.includes("SET state = 'UnderReview'")) {
      return {
        rows: [
          opts.underReview ??
            makeReceiptRow({
              state: 'UnderReview',
            }),
        ],
      }
    }
    if (sql.includes('INSERT INTO wallets')) {
      return { rows: [] }
    }
    if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) {
      if (opts.wallet === null) return { rows: [] }
      return { rows: [{ profile_id: PROFILE_ID }] }
    }
    if (sql.includes('FROM wallet_transactions WHERE idempotency_key')) {
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
    if (sql.includes("SET state = 'Rejected'")) {
      return {
        rows: [
          opts.rejected ??
            makeReceiptRow({
              state: 'Rejected',
              rejection_reason: 'Illegible scan',
            }),
        ],
      }
    }
    if (sql.includes('FROM profiles WHERE id')) {
      if (opts.profile === null) return { rows: [] }
      return { rows: [{ user_id: opts.profile?.userId ?? 'customer-1' }] }
    }
    if (sql.includes('INSERT INTO notification_outbox')) {
      if (opts.outboxInserted === false) return { rows: [] }
      return { rows: [{ id: 'outbox-1' }] }
    }
    if (sql.includes('FROM notification_outbox WHERE idempotency_key')) {
      return { rows: [{ id: 'outbox-1' }] }
    }
    if (sql.includes('INSERT INTO notification_job')) {
      return { rows: [] }
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
    if (sql.includes('FROM app_config')) {
      return thresholdRows(opts)
    }
    if (sql.includes('FROM approval_requests')) {
      return { rows: opts.pendingApproval ? [opts.pendingApproval] : [] }
    }
    if (sql.includes('FROM wallet_transactions WHERE idempotency_key')) {
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

describe('InvoiceBankReceiptConfirmationService (T-04.3.01.03 / T-04.3.01.04)', () => {
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

  it('rejects a Submitted receipt, stores the reason, and notifies the customer', async () => {
    script()
    const result = await service.reject({
      receiptId: RECEIPT_ID,
      raw: { reason: '  Illegible scan  ' },
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(invoiceStateMachine.transition).not.toHaveBeenCalled()
    expect(result.state).toBe('Rejected')
    expect(result.canReject).toBe(false)
    expect(result.rejectionReason).toBe('Illegible scan')
    const update = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes("SET state = 'Rejected'"),
    )
    expect(update?.[1]).toEqual([RECEIPT_ID, 'Illegible scan'])
    const outbox = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO notification_outbox'),
    )
    expect(outbox?.[1]?.[2]).toBe(INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY)
    expect(outbox?.[1]?.[1]).toBe('customer-1')
    const audit = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_log'),
    )
    expect(audit?.[1]?.[2]).toBe(INVOICE_BANK_RECEIPT_REJECTED_EVENT)
  })

  it('requires a customer-visible reject reason before locking', async () => {
    const rejection = await service
      .reject({
        receiptId: RECEIPT_ID,
        raw: { reason: '   ' },
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON(),
    })
    expect(mockPool.connect).not.toHaveBeenCalled()
    expect(walletService.credit).not.toHaveBeenCalled()
  })

  it('conflicts when rejecting an already confirmed receipt', async () => {
    script({
      locked: makeReceiptRow({
        state: 'Confirmed',
        confirmed_by: ACTOR_ID,
        confirmed_at: NOW,
      }),
    })
    const rejection = await service
      .reject({
        receiptId: RECEIPT_ID,
        raw: { reason: 'Too late' },
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_CONFIRMED(),
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes("SET state = 'Rejected'")),
    ).toBe(false)
  })

  it('returns the existing Rejected receipt when the reason matches', async () => {
    script({
      locked: makeReceiptRow({ state: 'Rejected', rejection_reason: 'Illegible scan' }),
    })
    const result = await service.reject({
      receiptId: RECEIPT_ID,
      raw: { reason: 'Illegible scan' },
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('Rejected')
    expect(result.rejectionReason).toBe('Illegible scan')
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes("SET state = 'Rejected'")),
    ).toBe(false)
    expect(
      mockClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO notification_outbox'),
      ),
    ).toBe(false)
  })

  it('conflicts when re-rejecting with a different reason', async () => {
    script({
      locked: makeReceiptRow({ state: 'Rejected', rejection_reason: 'Illegible scan' }),
    })
    const rejection = await service
      .reject({
        receiptId: RECEIPT_ID,
        raw: { reason: 'Wrong amount' },
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED(),
    })
  })

  it('conflicts when the profile owner cannot be notified', async () => {
    script({ profile: null })
    const rejection = await service
      .reject({
        receiptId: RECEIPT_ID,
        raw: { reason: 'Illegible scan' },
        actorUserId: ACTOR_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.OWNER_UNNOTIFIABLE(),
    })
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes("SET state = 'Rejected'")),
    ).toBe(false)
  })
})

describe('InvoiceBankReceiptConfirmationService dual-approval (T-04.3.01.05)', () => {
  let walletService: ReturnType<typeof makeWalletService>
  let invoiceStateMachine: { transition: ReturnType<typeof vi.fn> }
  let service: InvoiceBankReceiptConfirmationService
  const SECOND_ACTOR = 'staff-2'
  const REQUEST_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee'
  const THRESHOLD = 200_000

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

  it('settles immediately when the amount is below the threshold', async () => {
    script({
      locked: makeReceiptRow({ amount: '199999' }),
      invoice: makeInvoiceRow({ paid_amount: '0', total_amount: '1000000' }),
      threshold: { threshold_irr: THRESHOLD },
    })
    const result = await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('Confirmed')
    expect(result.dualApprovalPending).toBe(false)
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(
      mockClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO approval_requests'),
      ),
    ).toBe(false)
  })

  it('parks the first confirmation when the amount equals the threshold', async () => {
    script({
      locked: makeReceiptRow({ amount: String(THRESHOLD) }),
      threshold: { threshold_irr: THRESHOLD },
      underReview: makeReceiptRow({ amount: String(THRESHOLD), state: 'UnderReview' }),
    })
    const result = await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('UnderReview')
    expect(result.dualApprovalPending).toBe(true)
    expect(result.requiresDualApproval).toBe(true)
    expect(result.dualApprovalInitiatedBy).toBe(ACTOR_ID)
    expect(result.dualApprovalThresholdIrR).toBe(String(THRESHOLD))
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(invoiceStateMachine.transition).not.toHaveBeenCalled()
    const insert = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO approval_requests'),
    )
    expect(insert?.[1]?.[1]).toBe(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE)
    expect(insert?.[1]?.[3]).toBe(ACTOR_ID)
    const audit = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_log'),
    )
    expect(audit?.[1]?.[2]).toBe(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT)
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes("SET state = 'Confirmed'")),
    ).toBe(false)
  })

  it('does not settle when the same staff retries a parked dual-approval confirm', async () => {
    script({
      locked: makeReceiptRow({ amount: String(THRESHOLD), state: 'UnderReview' }),
      threshold: { threshold_irr: THRESHOLD },
      pendingApproval: { id: REQUEST_ID, initiator_id: ACTOR_ID, status: 'pending' },
      underReview: makeReceiptRow({ amount: String(THRESHOLD), state: 'UnderReview' }),
    })
    const result = await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: ACTOR_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('UnderReview')
    expect(result.dualApprovalPending).toBe(true)
    expect(result.dualApprovalRequestId).toBe(REQUEST_ID)
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(
      mockClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO approval_requests'),
      ),
    ).toBe(false)
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes("SET state = 'Confirmed'")),
    ).toBe(false)
  })

  it('lets a second finance staff member complete the parked confirmation', async () => {
    script({
      locked: makeReceiptRow({ amount: String(THRESHOLD), state: 'UnderReview' }),
      invoice: makeInvoiceRow({ paid_amount: '0', total_amount: '1000000' }),
      threshold: { threshold_irr: THRESHOLD },
      pendingApproval: {
        id: REQUEST_ID,
        initiator_id: ACTOR_ID,
        status: 'pending',
        action_type: INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE,
        amount_irr: String(THRESHOLD),
      },
      confirmed: makeReceiptRow({
        amount: String(THRESHOLD),
        state: 'Confirmed',
        confirmed_by: SECOND_ACTOR,
        confirmed_at: NOW,
      }),
    })
    const result = await service.confirm({
      receiptId: RECEIPT_ID,
      actorUserId: SECOND_ACTOR,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('Confirmed')
    expect(result.dualApprovalPending).toBe(false)
    expect(result.dualApprovalRequestId).toBe(REQUEST_ID)
    expect(result.dualApprovalInitiatedBy).toBe(ACTOR_ID)
    expect(result.confirmedBy).toBe(SECOND_ACTOR)
    expect(
      mockClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE approval_requests'),
      ),
    ).toBe(true)
    const audits = mockClient.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO audit_log'),
    )
    expect(audits.map((call) => call[1]?.[2])).toEqual([
      APPROVAL_REQUEST_APPROVED_EVENT,
      INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
    ])
    expect(String(audits[0]?.[1]?.[3])).toContain(`"requestId":"${REQUEST_ID}"`)
    expect(String(audits[0]?.[1]?.[3])).toContain(`"initiatorUserId":"${ACTOR_ID}"`)
    expect(String(audits[0]?.[1]?.[3])).toContain(`"reviewerUserId":"${SECOND_ACTOR}"`)
  })

  it('fails closed when the stored dual-approval threshold is corrupt', async () => {
    script({
      threshold: { threshold_irr: -5 },
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
      error: ErrorCodes.CONFLICT_STATE.code,
      message: INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.CONFIG_CORRUPT(),
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes("SET state = 'Confirmed'")),
    ).toBe(false)
  })

  it('does not restart dual approval after the latest request was rejected', async () => {
    const reviewReason = 'Payer name does not match'
    script({
      locked: makeReceiptRow({ amount: String(THRESHOLD), state: 'UnderReview' }),
      threshold: { threshold_irr: THRESHOLD },
      pendingApproval: {
        id: REQUEST_ID,
        initiator_id: ACTOR_ID,
        status: 'rejected',
        review_reason: reviewReason,
        reviewer_id: SECOND_ACTOR,
      },
      rejected: makeReceiptRow({
        amount: String(THRESHOLD),
        state: 'Rejected',
        rejection_reason: reviewReason,
      }),
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
      error: ErrorCodes.CONFLICT_STATE.code,
      message: INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.APPROVAL_REJECTED(),
    })
    expect(walletService.credit).not.toHaveBeenCalled()
    expect(invoiceStateMachine.transition).not.toHaveBeenCalled()
    expect(
      mockClient.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO approval_requests'),
      ),
    ).toBe(false)
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes("SET state = 'Rejected'")),
    ).toBe(true)
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes("SET state = 'Confirmed'")),
    ).toBe(false)
    const audit = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO audit_log'),
    )
    expect(audit?.[1]?.[2]).toBe(INVOICE_BANK_RECEIPT_REJECTED_EVENT)
  })
})
