import { describe, it, expect } from 'vitest'
import {
  ADJUSTMENT_KINDS,
  CUSTOMER_PAYABLE_STATES,
  CUSTOMER_PAYMENT_TRANSITIONS,
  NET_CUSTOMER_LIABILITY_SELECT,
  UNPAID_CUSTOMER_INVOICE_PREDICATE,
  isAdjustmentKind,
  isCreditAdjustmentKind,
  isCustomerPayableInvoice,
  isCustomerPaymentTransition,
} from './invoice-adjustment.js'

describe('invoice adjustment accounting (T-04.1.05.03)', () => {
  it('exposes charge/credit as the first-class kinds', () => {
    expect(ADJUSTMENT_KINDS).toEqual(['charge', 'credit'])
    expect(isAdjustmentKind('charge')).toBe(true)
    expect(isAdjustmentKind('credit')).toBe(true)
    expect(isAdjustmentKind(null)).toBe(false)
    expect(isAdjustmentKind('manual')).toBe(false)
  })

  it('treats only adjustment_kind=credit as a credit note', () => {
    expect(isCreditAdjustmentKind('credit')).toBe(true)
    expect(isCreditAdjustmentKind('charge')).toBe(false)
    expect(isCreditAdjustmentKind(null)).toBe(false)
    expect(isCreditAdjustmentKind(undefined)).toBe(false)
  })

  it('never treats a credit note as a customer payable', () => {
    expect(
      isCustomerPayableInvoice({ state: 'Unpaid', adjustmentKind: 'credit' }),
    ).toBe(false)
    expect(
      isCustomerPayableInvoice({ state: 'Overdue', adjustmentKind: 'credit' }),
    ).toBe(false)
    expect(
      isCustomerPayableInvoice({
        state: 'PartiallyFunded',
        adjustmentKind: 'credit',
      }),
    ).toBe(false)
  })

  it('treats open charge and ordinary invoices as payables', () => {
    for (const state of CUSTOMER_PAYABLE_STATES) {
      expect(isCustomerPayableInvoice({ state, adjustmentKind: null })).toBe(true)
      expect(isCustomerPayableInvoice({ state, adjustmentKind: 'charge' })).toBe(
        true,
      )
    }
    expect(isCustomerPayableInvoice({ state: 'Paid' })).toBe(false)
    expect(isCustomerPayableInvoice({ state: 'Draft' })).toBe(false)
  })

  it('names the payment-flow transitions credits must not enter', () => {
    expect(CUSTOMER_PAYMENT_TRANSITIONS).toEqual([
      'PayFromWallet',
      'SubmitBankReceipt',
      'MarkOverdue',
    ])
    expect(isCustomerPaymentTransition('PayFromWallet')).toBe(true)
    expect(isCustomerPaymentTransition('SubmitBankReceipt')).toBe(true)
    expect(isCustomerPaymentTransition('MarkOverdue')).toBe(true)
    expect(isCustomerPaymentTransition('Issue')).toBe(false)
    expect(isCustomerPaymentTransition('Cancel')).toBe(false)
  })

  it('unpaid outstanding SQL excludes credit notes', () => {
    expect(UNPAID_CUSTOMER_INVOICE_PREDICATE).toContain(
      "state IN ('Unpaid', 'Overdue')",
    )
    expect(UNPAID_CUSTOMER_INVOICE_PREDICATE).toContain(
      "adjustment_kind IS DISTINCT FROM 'credit'",
    )
  })

  it('net-liability SQL subtracts issued credits from open charges', () => {
    expect(NET_CUSTOMER_LIABILITY_SELECT).toContain("adjustment_kind = 'credit'")
    expect(NET_CUSTOMER_LIABILITY_SELECT).toContain('THEN accounting_amount')
    expect(NET_CUSTOMER_LIABILITY_SELECT).toContain('total_amount - paid_amount')
  })
})
