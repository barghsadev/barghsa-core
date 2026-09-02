import { describe, expect, it } from 'vitest'
import {
  PAY_INVOICE_WITH_WALLET_DESCRIPTION,
  PAY_INVOICE_WITH_WALLET_ERRORS,
  WALLET_PAYABLE_INVOICE_STATES,
  isMatchingWalletInvoicePayment,
  isWalletPayableInvoiceState,
  parsePayInvoiceWithWalletIds,
  payInvoiceWithWalletMetadata,
  remainingForWalletPayment,
} from './pay-invoice-with-wallet.js'

const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'

describe('pay invoice with wallet helpers (T-04.2.03.01)', () => {
  describe('isWalletPayableInvoiceState', () => {
    it('allows Unpaid and PartiallyFunded only', () => {
      expect(WALLET_PAYABLE_INVOICE_STATES).toEqual(['Unpaid', 'PartiallyFunded'])
      expect(isWalletPayableInvoiceState('Unpaid')).toBe(true)
      expect(isWalletPayableInvoiceState('PartiallyFunded')).toBe(true)
      expect(isWalletPayableInvoiceState('Overdue')).toBe(false)
      expect(isWalletPayableInvoiceState('Paid')).toBe(false)
      expect(isWalletPayableInvoiceState('Draft')).toBe(false)
      expect(isWalletPayableInvoiceState('PaymentUnderReview')).toBe(false)
    })
  })

  describe('remainingForWalletPayment', () => {
    it('returns remaining for Unpaid and PartiallyFunded', () => {
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Unpaid',
        }),
      ).toBe(1_000_000n)
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 250_000n,
          state: 'PartiallyFunded',
        }),
      ).toBe(750_000n)
    })

    it('returns 0 for non-payable states, credit notes, and fully paid rows', () => {
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Overdue',
        }),
      ).toBe(0n)
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 1_000_000n,
          state: 'Paid',
        }),
      ).toBe(0n)
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 0n,
          state: 'Unpaid',
          adjustmentKind: 'credit',
        }),
      ).toBe(0n)
      expect(
        remainingForWalletPayment({
          totalAmount: 1_000_000n,
          paidAmount: 1_000_000n,
          state: 'Unpaid',
        }),
      ).toBe(0n)
    })
  })

  describe('parsePayInvoiceWithWalletIds', () => {
    it('canonicalizes valid UUIDs', () => {
      const parsed = parsePayInvoiceWithWalletIds(
        INVOICE_ID.toUpperCase(),
        ` ${PROFILE_ID.toUpperCase()} `,
      )
      expect(parsed).toEqual({
        ok: true,
        invoiceId: INVOICE_ID,
        profileId: PROFILE_ID,
      })
    })

    it('rejects invalid ids', () => {
      expect(parsePayInvoiceWithWalletIds('not-a-uuid', PROFILE_ID)).toEqual({
        ok: false,
        message: PAY_INVOICE_WITH_WALLET_ERRORS.BAD_INVOICE_ID(),
      })
      expect(parsePayInvoiceWithWalletIds(INVOICE_ID, '')).toEqual({
        ok: false,
        message: PAY_INVOICE_WITH_WALLET_ERRORS.BAD_PROFILE_ID(),
      })
    })
  })

  describe('payInvoiceWithWalletMetadata', () => {
    it('serializes remaining and paid amounts as strings', () => {
      expect(
        payInvoiceWithWalletMetadata({
          invoiceId: INVOICE_ID,
          remainingBefore: 750_000n,
          paidAmountAfter: 1_000_000n,
        }),
      ).toEqual({
        purpose: 'invoice_payment',
        invoiceId: INVOICE_ID,
        remainingBefore: '750000',
        paidAmountAfter: '1000000',
      })
      expect(PAY_INVOICE_WITH_WALLET_DESCRIPTION).toContain('Wallet payment')
    })
  })

  describe('isMatchingWalletInvoicePayment', () => {
    it('accepts a Completed payment debit for the invoice', () => {
      expect(
        isMatchingWalletInvoicePayment({
          walletId: PROFILE_ID,
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'payment',
          state: 'Completed',
          refId: INVOICE_ID,
          amount: -750_000n,
        }),
      ).toBe(true)
    })

    it('rejects credits, other invoices, other wallets, and pending rows', () => {
      expect(
        isMatchingWalletInvoicePayment({
          walletId: PROFILE_ID,
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'topup',
          state: 'Completed',
          refId: INVOICE_ID,
          amount: 750_000n,
        }),
      ).toBe(false)
      expect(
        isMatchingWalletInvoicePayment({
          walletId: PROFILE_ID,
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'payment',
          state: 'Completed',
          refId: '22222222-2222-7222-8222-222222222222',
          amount: -750_000n,
        }),
      ).toBe(false)
      expect(
        isMatchingWalletInvoicePayment({
          walletId: PROFILE_ID,
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'payment',
          state: 'Pending',
          refId: INVOICE_ID,
          amount: -750_000n,
        }),
      ).toBe(false)
      expect(
        isMatchingWalletInvoicePayment({
          walletId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
          expectedWalletId: PROFILE_ID,
          invoiceId: INVOICE_ID,
          type: 'payment',
          state: 'Completed',
          refId: INVOICE_ID,
          amount: -750_000n,
        }),
      ).toBe(false)
    })
  })
})
