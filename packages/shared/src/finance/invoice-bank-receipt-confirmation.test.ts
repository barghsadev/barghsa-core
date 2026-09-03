import { describe, expect, it } from 'vitest'
import { BANK_RECEIPT_CONFIRM_PERMISSION } from './wallet-bank-receipt-confirmation.js'
import { bankReceiptOverpaymentCreditIdempotencyKey } from './invoice-overpayment.js'
import {
  INVOICE_BANK_RECEIPT_CHANNEL,
  INVOICE_BANK_RECEIPT_CONFIRM_ERRORS,
  INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION,
  INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
  INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
  invoiceBankReceiptOverpaymentCreditIdempotencyKey,
  invoiceBankReceiptOverpaymentCreditMetadata,
  isInvoiceBankReceiptConfirmableState,
  readInvoiceBankReceiptOverpaymentFromCreditMetadata,
} from './invoice-bank-receipt-confirmation.js'

const RECEIPT_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'

describe('invoice bank receipt staff confirmation contract (T-04.3.01.03)', () => {
  it('uses a finance permission distinct from wallet receipt confirm', () => {
    expect(INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION).toBe(
      'admin:finance:invoices:bank-receipt-confirm',
    )
    expect(INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION).not.toBe(
      BANK_RECEIPT_CONFIRM_PERMISSION,
    )
  })

  it('derives a stable excess-credit key from the receipt id', () => {
    expect(invoiceBankReceiptOverpaymentCreditIdempotencyKey(RECEIPT_ID)).toBe(
      `invoice-bank-receipt-overpayment-credit:${RECEIPT_ID}`,
    )
    expect(invoiceBankReceiptOverpaymentCreditIdempotencyKey(RECEIPT_ID)).not.toBe(
      bankReceiptOverpaymentCreditIdempotencyKey(RECEIPT_ID),
    )
  })

  it('names the confirm audit event and credit description', () => {
    expect(INVOICE_BANK_RECEIPT_CONFIRMED_EVENT).toBe('invoice.bank_receipt.confirmed')
    expect(INVOICE_BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION).toBe(
      'Invoice bank receipt overpayment wallet credit',
    )
    expect(INVOICE_BANK_RECEIPT_CHANNEL).toBe('invoice_bank_receipt')
  })

  describe('isInvoiceBankReceiptConfirmableState', () => {
    it('allows Submitted and UnderReview only', () => {
      expect(isInvoiceBankReceiptConfirmableState('Submitted')).toBe(true)
      expect(isInvoiceBankReceiptConfirmableState('UnderReview')).toBe(true)
      expect(isInvoiceBankReceiptConfirmableState('Confirmed')).toBe(false)
      expect(isInvoiceBankReceiptConfirmableState('Rejected')).toBe(false)
    })
  })

  it('round-trips overpayment credit metadata', () => {
    const confirmedAt = new Date('2026-09-03T08:00:00.000Z')
    const metadata = invoiceBankReceiptOverpaymentCreditMetadata({
      receiptId: RECEIPT_ID,
      invoiceId: INVOICE_ID,
      confirmedBy: 'staff-1',
      confirmedAt,
      invoiceAllocation: 400_000n,
      walletCreditAmount: 800_000n,
      remainingBefore: 400_000n,
    })
    expect(metadata).toEqual({
      channel: INVOICE_BANK_RECEIPT_CHANNEL,
      purpose: 'overpayment',
      receiptId: RECEIPT_ID,
      invoiceId: INVOICE_ID,
      confirmedBy: 'staff-1',
      confirmedAt: confirmedAt.toISOString(),
      invoiceAllocation: '400000',
      walletCreditAmount: '800000',
      remainingBefore: '400000',
    })
    expect(
      readInvoiceBankReceiptOverpaymentFromCreditMetadata({
        ...metadata,
        overpaymentCreditTransactionId: 'credit-1',
      }),
    ).toEqual({
      invoiceId: INVOICE_ID,
      remainingBefore: '400000',
      invoiceAllocation: '400000',
      walletCreditAmount: '800000',
      overpaymentCreditTransactionId: 'credit-1',
    })
    expect(readInvoiceBankReceiptOverpaymentFromCreditMetadata({ channel: 'bank_receipt' })).toBe(
      null,
    )
  })

  it('describes already-confirmed and rejected conflicts', () => {
    expect(INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_CONFIRMED()).toBe(
      'Invoice bank receipt has already been confirmed',
    )
    expect(INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED()).toBe(
      'Invoice bank receipt has already been rejected',
    )
    expect(INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.NOT_CONFIRMABLE('Rejected')).toContain(
      'Rejected',
    )
  })
})
