/**
 * Tests for the pure invoice state machine model (invoice-state.model).
 *
 * Covers:
 *   - isInvoiceState validation
 *   - Every (from, to) pair in the ALLOWED_TRANSITIONS table
 *   - Every pair NOT in the table (rejected)
 *   - Amount-based numeric guards (Paid, Refunded, PartiallyFunded, PartialRefund)
 *   - transitionName resolution
 *   - Terminal state classification
 */

import { describe, it, expect } from 'vitest'
import {
  INVOICE_STATES,
  INVOICE_TRANSITIONS,
  INVOICE_TERMINAL_STATES,
  ALLOWED_TRANSITIONS,
  TRANSITION_ERRORS,
  isInvoiceState,
  canTransition,
  validateTransition,
  transitionName,
  TRANSITION_LABELS,
  resolveAmountError,
  TRANSITION_BY_PAIR,
  type InvoiceState,
  type TransitionContext,
} from './invoice-state.model.js'

describe('isInvoiceState', () => {
  it('returns true for all 9 enum values', () => {
    for (const s of INVOICE_STATES) {
      expect(isInvoiceState(s)).toBe(true)
    }
  })

  it('returns false for unknown strings', () => {
    expect(isInvoiceState('Unknown')).toBe(false)
    expect(isInvoiceState('')).toBe(false)
    expect(isInvoiceState('paid')).toBe(false) // case-sensitive
  })
})

describe('canTransition', () => {
  it('Draft can go to Unpaid and Cancelled only', () => {
    expect(canTransition('Draft', 'Unpaid')).toBe(true)
    expect(canTransition('Draft', 'Cancelled')).toBe(true)
    // All other destinations should be false
    for (const to of INVOICE_STATES) {
      if (to === 'Unpaid' || to === 'Cancelled') continue
      expect(canTransition('Draft', to)).toBe(false)
    }
  })

  it('Unpaid can go to PaymentUnderReview, Paid, Overdue, Cancelled', () => {
    const allowed = ['PaymentUnderReview', 'Paid', 'Overdue', 'Cancelled'] as InvoiceState[]
    for (const to of allowed) {
      expect(canTransition('Unpaid', to)).toBe(true)
    }
    for (const to of INVOICE_STATES) {
      if (allowed.includes(to)) continue
      expect(canTransition('Unpaid', to)).toBe(false)
    }
  })

  it('PaymentUnderReview can go to Unpaid, PartiallyFunded, Paid', () => {
    const allowed = ['Unpaid', 'PartiallyFunded', 'Paid'] as InvoiceState[]
    for (const to of allowed) {
      expect(canTransition('PaymentUnderReview', to)).toBe(true)
    }
    for (const to of INVOICE_STATES) {
      if (allowed.includes(to)) continue
      expect(canTransition('PaymentUnderReview', to)).toBe(false)
    }
  })

  it('PartiallyFunded can go to PaymentUnderReview, Paid, Overdue, Cancelled', () => {
    const allowed = ['PaymentUnderReview', 'Paid', 'Overdue', 'Cancelled'] as InvoiceState[]
    for (const to of allowed) {
      expect(canTransition('PartiallyFunded', to)).toBe(true)
    }
    for (const to of INVOICE_STATES) {
      if (allowed.includes(to)) continue
      expect(canTransition('PartiallyFunded', to)).toBe(false)
    }
  })

  it('Paid can go to PartiallyRefunded and Refunded', () => {
    expect(canTransition('Paid', 'PartiallyRefunded')).toBe(true)
    expect(canTransition('Paid', 'Refunded')).toBe(true)
    expect(canTransition('Paid', 'Draft')).toBe(false)
    expect(canTransition('Paid', 'Unpaid')).toBe(false)
  })

  it('Overdue can only go to Cancelled', () => {
    for (const to of INVOICE_STATES) {
      if (to === 'Cancelled') {
        expect(canTransition('Overdue', to)).toBe(true)
      } else {
        expect(canTransition('Overdue', to)).toBe(false)
      }
    }
  })

  it('Cancelled is terminal', () => {
    for (const to of INVOICE_STATES) {
      expect(canTransition('Cancelled', to)).toBe(false)
    }
  })

  it('PartiallyRefunded can only self-loop', () => {
    for (const to of INVOICE_STATES) {
      if (to === 'PartiallyRefunded') {
        expect(canTransition('PartiallyRefunded', to)).toBe(true)
      } else {
        expect(canTransition('PartiallyRefunded', to)).toBe(false)
      }
    }
  })

  it('Refunded is terminal', () => {
    for (const to of INVOICE_STATES) {
      expect(canTransition('Refunded', to)).toBe(false)
    }
  })
})

describe('validateTransition', () => {
  it('throws for unknown from state', () => {
    expect(() => validateTransition('Unknown' as any, 'Unpaid')).toThrow(RangeError)
  })

  it('throws for unknown to state', () => {
    expect(() => validateTransition('Draft', 'Unknown' as any)).toThrow(RangeError)
  })

  it('throws for illegal transition pair', () => {
    expect(() => validateTransition('Draft', 'Paid')).toThrow(
      TRANSITION_ERRORS.NOT_PART_OF_FLOW('Draft', 'Paid'),
    )
  })

  it('passes for legal transition without financials', () => {
    expect(() => validateTransition('Draft', 'Unpaid')).not.toThrow()
    expect(() => validateTransition('Unpaid', 'Overdue')).not.toThrow()
    expect(() => validateTransition('Paid', 'Refunded')).not.toThrow()
  })

  it('passes for Draft → Unpaid (Issue) with financials', () => {
    const ctx: TransitionContext = {
      paidAmount: 0n,
      totalAmount: 1_000_000n,
      refundedAmount: 0n,
    }
    expect(() => validateTransition('Draft', 'Unpaid', ctx)).not.toThrow()
  })
})

describe('resolveAmountError — numeric guards', () => {
  const base: TransitionContext = {
    paidAmount: 0n,
    totalAmount: 1_000_000n,
    refundedAmount: 0n,
  }

  describe('Paid target', () => {
    it('rejects when paid < total', () => {
      const err = resolveAmountError('Paid', { ...base, paidAmount: 500_000n })
      expect(err).toContain('confirmed amount')
    })

    it('accepts when paid >= total', () => {
      expect(resolveAmountError('Paid', { ...base, paidAmount: 1_000_000n })).toBeNull()
      expect(resolveAmountError('Paid', { ...base, paidAmount: 2_000_000n })).toBeNull()
    })

    it('uses incomingPaidAmount when provided', () => {
      const ctx: TransitionContext = {
        ...base,
        paidAmount: 0n,
        incomingPaidAmount: 1_000_000n,
      }
      expect(resolveAmountError('Paid', ctx)).toBeNull()
    })

    it('rejects when incomingPaidAmount < total', () => {
      const ctx: TransitionContext = {
        ...base,
        paidAmount: 0n,
        incomingPaidAmount: 500_000n,
      }
      expect(resolveAmountError('Paid', ctx)).toContain('confirmed amount')
    })
  })

  describe('Refunded target', () => {
    it('rejects when refunded != paid', () => {
      const err = resolveAmountError('Refunded', {
        ...base,
        paidAmount: 1_000_000n,
        refundedAmount: 500_000n,
      })
      expect(err).toContain('refunded')
    })

    it('accepts when refunded == paid', () => {
      expect(
        resolveAmountError('Refunded', {
          ...base,
          paidAmount: 1_000_000n,
          refundedAmount: 1_000_000n,
        }),
      ).toBeNull()
    })
  })

  describe('PartiallyFunded target', () => {
    it('rejects when paid is zero', () => {
      expect(resolveAmountError('PartiallyFunded', base)).toContain('zero')
    })

    it('rejects when paid >= total', () => {
      const err = resolveAmountError('PartiallyFunded', {
        ...base,
        paidAmount: 1_000_000n,
      })
      expect(err).toContain('already covers total')
    })

    it('accepts when 0 < paid < total', () => {
      expect(
        resolveAmountError('PartiallyFunded', { ...base, paidAmount: 500_000n }),
      ).toBeNull()
    })

    it('uses incomingPaidAmount when provided', () => {
      expect(
        resolveAmountError('PartiallyFunded', {
          ...base,
          paidAmount: 0n,
          incomingPaidAmount: 500_000n,
        }),
      ).toBeNull()
    })
  })

  describe('PartiallyRefunded target', () => {
    it('rejects when refunded exceeds paid', () => {
      const err = resolveAmountError('PartiallyRefunded', {
        ...base,
        paidAmount: 1_000_000n,
        refundedAmount: 1_500_000n,
      })
      expect(err).toContain('exceed paid')
    })

    it('accepts when refunded <= paid', () => {
      expect(
        resolveAmountError('PartiallyRefunded', {
          ...base,
          paidAmount: 1_000_000n,
          refundedAmount: 500_000n,
        }),
      ).toBeNull()
    })
  })

  describe('negative / zero invariants', () => {
    it('rejects negative paidAmount', () => {
      expect(resolveAmountError('Unpaid', { ...base, paidAmount: -1n })).toContain('negative')
    })

    it('rejects negative refundedAmount', () => {
      expect(resolveAmountError('Unpaid', { ...base, refundedAmount: -1n })).toContain('negative')
    })

    it('rejects negative incomingPaidAmount', () => {
      expect(
        resolveAmountError('Unpaid', { ...base, incomingPaidAmount: -1n }),
      ).toContain('negative')
    })

    it('rejects zero totalAmount', () => {
      expect(resolveAmountError('Unpaid', { ...base, totalAmount: 0n })).toContain('positive')
    })
  })

  it('returns null for Unpaid target (no amount constraint)', () => {
    expect(resolveAmountError('Unpaid', base)).toBeNull()
  })

  it('returns null for Overdue target (no amount constraint)', () => {
    expect(resolveAmountError('Overdue', base)).toBeNull()
  })

  it('returns null for Cancelled target (no amount constraint)', () => {
    expect(resolveAmountError('Cancelled', base)).toBeNull()
  })
})

describe('transitionName', () => {
  it('returns the correct transition for each legal pair', () => {
    expect(transitionName('Draft', 'Unpaid')).toBe('Issue')
    expect(transitionName('Draft', 'Cancelled')).toBe('Cancel')
    expect(transitionName('Unpaid', 'PaymentUnderReview')).toBe('SubmitBankReceipt')
    expect(transitionName('Unpaid', 'Paid')).toBe('PayFromWallet')
    expect(transitionName('Unpaid', 'Overdue')).toBe('MarkOverdue')
    expect(transitionName('Unpaid', 'Cancelled')).toBe('Cancel')
    expect(transitionName('PaymentUnderReview', 'Unpaid')).toBe('ConfirmBankReceipt')
    expect(transitionName('PaymentUnderReview', 'PartiallyFunded')).toBe('ConfirmBankReceipt')
    expect(transitionName('PaymentUnderReview', 'Paid')).toBe('ConfirmBankReceipt')
    expect(transitionName('PartiallyFunded', 'PaymentUnderReview')).toBe('SubmitBankReceipt')
    expect(transitionName('PartiallyFunded', 'Paid')).toBe('PayFromWallet')
    expect(transitionName('PartiallyFunded', 'Overdue')).toBe('MarkOverdue')
    expect(transitionName('PartiallyFunded', 'Cancelled')).toBe('Cancel')
    expect(transitionName('Paid', 'PartiallyRefunded')).toBe('PartialRefund')
    expect(transitionName('Paid', 'Refunded')).toBe('FullRefund')
    expect(transitionName('Overdue', 'Cancelled')).toBe('Cancel')
    expect(transitionName('PartiallyRefunded', 'PartiallyRefunded')).toBe('PartialRefund')
  })

  it('returns null for illegal pairs', () => {
    expect(transitionName('Draft', 'Paid')).toBeNull()
    expect(transitionName('Cancelled', 'Draft')).toBeNull()
    expect(transitionName('Refunded', 'Draft')).toBeNull()
  })
})

describe('TRANSITION_LABELS', () => {
  it('has a label for every transition', () => {
    for (const t of INVOICE_TRANSITIONS) {
      expect(TRANSITION_LABELS[t]).toBeDefined()
      expect(TRANSITION_LABELS[t].length).toBeGreaterThan(0)
    }
  })
})

describe('INVOICE_TERMINAL_STATES', () => {
  it('includes Paid, Cancelled, Refunded', () => {
    expect(INVOICE_TERMINAL_STATES).toContain('Paid')
    expect(INVOICE_TERMINAL_STATES).toContain('Cancelled')
    expect(INVOICE_TERMINAL_STATES).toContain('Refunded')
  })
})

describe('validateTransition with financials — integration of struct + amount', () => {
  it('Draft → Unpaid passes with valid financials', () => {
    expect(() =>
      validateTransition('Draft', 'Unpaid', {
        paidAmount: 0n,
        totalAmount: 1_000_000n,
        refundedAmount: 0n,
      }),
    ).not.toThrow()
  })

  it('Draft → Cancelled passes (no amount checks for Cancelled)', () => {
    expect(() =>
      validateTransition('Draft', 'Cancelled', {
        paidAmount: 0n,
        totalAmount: 1_000_000n,
        refundedAmount: 0n,
      }),
    ).not.toThrow()
  })

  it('Unpaid → Paid fails when amount insufficient', () => {
    expect(() =>
      validateTransition('Unpaid', 'Paid', {
        paidAmount: 500_000n,
        totalAmount: 1_000_000n,
        refundedAmount: 0n,
      }),
    ).toThrow(/confirmed amount/)
  })

  it('Unpaid → Paid passes when amount sufficient', () => {
    expect(() =>
      validateTransition('Unpaid', 'Paid', {
        paidAmount: 1_000_000n,
        totalAmount: 1_000_000n,
        refundedAmount: 0n,
      }),
    ).not.toThrow()
  })

  it('Paid → Refunded fails when refunded != paid', () => {
    expect(() =>
      validateTransition('Paid', 'Refunded', {
        paidAmount: 1_000_000n,
        totalAmount: 1_000_000n,
        refundedAmount: 500_000n,
      }),
    ).toThrow(/refunded/)
  })

  it('Paid → Refunded passes when refunded == paid', () => {
    expect(() =>
      validateTransition('Paid', 'Refunded', {
        paidAmount: 1_000_000n,
        totalAmount: 1_000_000n,
        refundedAmount: 1_000_000n,
      }),
    ).not.toThrow()
  })
})

describe('ALLOWED_TRANSITIONS — structural integrity', () => {
  it('every key is a valid InvoiceState', () => {
    for (const from of Object.keys(ALLOWED_TRANSITIONS)) {
      expect(isInvoiceState(from)).toBe(true)
    }
  })

  it('every value array element is a valid InvoiceState', () => {
    for (const from of Object.keys(ALLOWED_TRANSITIONS) as InvoiceState[]) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(isInvoiceState(to)).toBe(true)
      }
    }
  })

  it('every transition has a name in TRANSITION_BY_PAIR', () => {
    for (const from of Object.keys(ALLOWED_TRANSITIONS) as InvoiceState[]) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(TRANSITION_BY_PAIR[from]?.[to]).toBeDefined()
      }
    }
  })
})