import { describe, expect, it } from 'vitest'
import {
  BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
  BANK_RECEIPT_OVERPAYMENT_ERRORS,
  allocateReceiptAgainstInvoice,
  bankReceiptOverpaymentCreditIdempotencyKey,
  bankReceiptOverpaymentCreditMetadata,
  bankReceiptOverpaymentCompletedNoticeFields,
  bankReceiptOverpaymentSnapshot,
  invoiceRemainingAmount,
  invoiceStateAfterBankReceiptAllocation,
  parseOptionalInvoiceId,
  readBankReceiptOverpaymentSnapshot,
  isBankReceiptInvoiceLinkAllowedState,
  remainingForBankReceiptSettlement,
} from './invoice-overpayment.js'

const PENDING_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'

describe('invoice overpayment allocation (T-04.2.02.05)', () => {
  describe('invoiceRemainingAmount', () => {
    it('returns total minus paid and never goes negative', () => {
      expect(invoiceRemainingAmount(1_000_000n, 400_000n)).toBe(600_000n)
      expect(invoiceRemainingAmount(1_000_000n, 1_000_000n)).toBe(0n)
      expect(invoiceRemainingAmount(1_000_000n, 1_000_001n)).toBe(0n)
      expect(invoiceRemainingAmount(0n, 0n)).toBe(0n)
    })
  })

  describe('remainingForBankReceiptSettlement', () => {
    it('uses remaining for settleable states and zero otherwise', () => {
      expect(
        remainingForBankReceiptSettlement({
          totalAmount: 1_000_000n,
          paidAmount: 250_000n,
          state: 'Unpaid',
        }),
      ).toBe(750_000n)
      expect(
        remainingForBankReceiptSettlement({
          totalAmount: 1_000_000n,
          paidAmount: 250_000n,
          state: 'PartiallyFunded',
        }),
      ).toBe(750_000n)
      expect(
        remainingForBankReceiptSettlement({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'PaymentUnderReview',
        }),
      ).toBe(1_000_000n)
      expect(
        remainingForBankReceiptSettlement({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Overdue',
        }),
      ).toBe(0n)
      expect(
        remainingForBankReceiptSettlement({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Paid',
        }),
      ).toBe(0n)
      expect(
        remainingForBankReceiptSettlement({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Cancelled',
        }),
      ).toBe(0n)
    })
  })

  describe('isBankReceiptInvoiceLinkAllowedState', () => {
    it('allows payable states and Paid (remaining-0 excess), not closed states', () => {
      expect(isBankReceiptInvoiceLinkAllowedState('Unpaid')).toBe(true)
      expect(isBankReceiptInvoiceLinkAllowedState('PaymentUnderReview')).toBe(true)
      expect(isBankReceiptInvoiceLinkAllowedState('PartiallyFunded')).toBe(true)
      expect(isBankReceiptInvoiceLinkAllowedState('Paid')).toBe(true)
      expect(isBankReceiptInvoiceLinkAllowedState('Overdue')).toBe(false)
      expect(isBankReceiptInvoiceLinkAllowedState('Draft')).toBe(false)
      expect(isBankReceiptInvoiceLinkAllowedState('Cancelled')).toBe(false)
      expect(isBankReceiptInvoiceLinkAllowedState('Refunded')).toBe(false)
      expect(isBankReceiptInvoiceLinkAllowedState('PartiallyRefunded')).toBe(false)
    })
  })

  describe('invoiceStateAfterBankReceiptAllocation', () => {
    it('returns Paid when confirmed amount covers the total', () => {
      expect(
        invoiceStateAfterBankReceiptAllocation({
          paidAmount: 1_000_000n,
          totalAmount: 1_000_000n,
        }),
      ).toBe('Paid')
      expect(
        invoiceStateAfterBankReceiptAllocation({
          paidAmount: 1_000_001n,
          totalAmount: 1_000_000n,
        }),
      ).toBe('Paid')
    })

    it('returns PartiallyFunded when confirmed amount is still below total', () => {
      expect(
        invoiceStateAfterBankReceiptAllocation({
          paidAmount: 1n,
          totalAmount: 1_000_000n,
        }),
      ).toBe('PartiallyFunded')
      expect(
        invoiceStateAfterBankReceiptAllocation({
          paidAmount: 999_999n,
          totalAmount: 1_000_000n,
        }),
      ).toBe('PartiallyFunded')
    })
  })

  describe('allocateReceiptAgainstInvoice', () => {
    it('credits the full receipt to the invoice when remaining covers it', () => {
      expect(
        allocateReceiptAgainstInvoice({ receiptAmount: 400_000n, remaining: 1_000_000n }),
      ).toEqual({
        invoiceAllocation: 400_000n,
        walletCreditAmount: 0n,
        isOverpayment: false,
      })
    })

    it('splits excess to wallet when receipt exceeds remaining', () => {
      expect(
        allocateReceiptAgainstInvoice({ receiptAmount: 1_200_000n, remaining: 400_000n }),
      ).toEqual({
        invoiceAllocation: 400_000n,
        walletCreditAmount: 800_000n,
        isOverpayment: true,
      })
    })

    it('credits the entire receipt to wallet when remaining is zero', () => {
      expect(
        allocateReceiptAgainstInvoice({ receiptAmount: 250_000n, remaining: 0n }),
      ).toEqual({
        invoiceAllocation: 0n,
        walletCreditAmount: 250_000n,
        isOverpayment: true,
      })
    })

    it('never allocates more than remaining (exact remaining is not over-settlement)', () => {
      expect(
        allocateReceiptAgainstInvoice({ receiptAmount: 500_000n, remaining: 500_000n }),
      ).toEqual({
        invoiceAllocation: 500_000n,
        walletCreditAmount: 0n,
        isOverpayment: false,
      })
    })

    it('rejects non-positive receipt amounts', () => {
      expect(() =>
        allocateReceiptAgainstInvoice({ receiptAmount: 0n, remaining: 100n }),
      ).toThrow(BANK_RECEIPT_OVERPAYMENT_ERRORS.BAD_RECEIPT_AMOUNT())
      expect(() =>
        allocateReceiptAgainstInvoice({ receiptAmount: -1n, remaining: 100n }),
      ).toThrow(BANK_RECEIPT_OVERPAYMENT_ERRORS.BAD_RECEIPT_AMOUNT())
    })
  })

  it('uses a distinct overpayment credit idempotency key', () => {
    expect(bankReceiptOverpaymentCreditIdempotencyKey(PENDING_ID)).toBe(
      `wallet-bank-receipt-overpayment-credit:${PENDING_ID}`,
    )
    expect(BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION).toBe(
      'Bank receipt overpayment wallet credit',
    )
  })

  describe('parseOptionalInvoiceId', () => {
    it('treats missing or blank invoiceId as wallet-only confirmation', () => {
      expect(parseOptionalInvoiceId(undefined)).toEqual({ ok: true, invoiceId: null })
      expect(parseOptionalInvoiceId(null)).toEqual({ ok: true, invoiceId: null })
      expect(parseOptionalInvoiceId({})).toEqual({ ok: true, invoiceId: null })
      expect(parseOptionalInvoiceId({ invoiceId: '' })).toEqual({ ok: true, invoiceId: null })
    })

    it('normalizes a UUID invoiceId', () => {
      expect(parseOptionalInvoiceId({ invoiceId: `  ${INVOICE_ID.toUpperCase()}  ` })).toEqual({
        ok: true,
        invoiceId: INVOICE_ID,
      })
    })

    it('rejects a non-UUID invoiceId', () => {
      const failed = parseOptionalInvoiceId({ invoiceId: 'not-an-invoice' })
      expect(failed.ok).toBe(false)
      if (failed.ok) return
      expect(failed.message).toBe(BANK_RECEIPT_OVERPAYMENT_ERRORS.BAD_INVOICE_ID())
    })
  })

  it('round-trips the overpayment snapshot and credit metadata', () => {
    const confirmedAt = new Date('2026-09-02T08:00:00.000Z')
    const snapshot = bankReceiptOverpaymentSnapshot({
      invoiceId: INVOICE_ID,
      remainingBefore: 400_000n,
      invoiceAllocation: 400_000n,
      walletCreditAmount: 800_000n,
      overpaymentCreditTransactionId: 'credit-overpay',
    })
    expect(readBankReceiptOverpaymentSnapshot({ overpayment: snapshot })).toEqual(snapshot)
    expect(
      bankReceiptOverpaymentCreditMetadata({
        pendingTransactionId: PENDING_ID,
        invoiceId: INVOICE_ID,
        confirmedBy: 'staff-1',
        confirmedAt,
        invoiceAllocation: 400_000n,
        walletCreditAmount: 800_000n,
        remainingBefore: 400_000n,
      }),
    ).toMatchObject({
      purpose: 'overpayment',
      invoiceId: INVOICE_ID,
      invoiceAllocation: '400000',
      walletCreditAmount: '800000',
    })
  })

  describe('bankReceiptOverpaymentCompletedNoticeFields', () => {
    it('returns the excess split for the customer completed notice', () => {
      expect(
        bankReceiptOverpaymentCompletedNoticeFields({
          invoiceId: INVOICE_ID,
          remainingBefore: '400000',
          invoiceAllocation: '400000',
          walletCreditAmount: '800000',
          overpaymentCreditTransactionId: 'credit-overpay',
        }),
      ).toEqual({
        invoice_id: INVOICE_ID,
        invoice_allocation: '400000',
        remaining_before: '400000',
        wallet_credit_amount: '800000',
        is_overpayment: true,
      })
    })

    it('is null when there is no excess wallet credit', () => {
      expect(bankReceiptOverpaymentCompletedNoticeFields(null)).toBeNull()
      expect(
        bankReceiptOverpaymentCompletedNoticeFields({
          invoiceId: INVOICE_ID,
          remainingBefore: '500000',
          invoiceAllocation: '500000',
          walletCreditAmount: '0',
          overpaymentCreditTransactionId: null,
        }),
      ).toBeNull()
    })
  })
})
