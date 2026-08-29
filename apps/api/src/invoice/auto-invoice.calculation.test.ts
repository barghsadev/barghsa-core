/**
 * Unit tests for the auto-invoice calculation module (T-04.1.02.03).
 *
 * Table-driven financial examples: VAT half-up rounding, pre-VAT gift
 * discount, non-taxable lines, validation failures, and multi-line works
 * (richer compositions once E-03 lands).
 */

import { describe, it, expect } from 'vitest'
import {
  calculateAutoInvoice,
  calculateAutoLine,
  autoLineDescription,
  AUTO_INVOICE_ERRORS,
  type AutoInvoiceLineInput,
} from './auto-invoice.calculation.js'

function line(overrides: Partial<AutoInvoiceLineInput> = {}): AutoInvoiceLineInput {
  return {
    productId: '11111111-1111-7111-8111-111111111111',
    productType: 'electricity',
    productTitle: { fa: 'برق حرارتی', en: 'Thermal Electricity' },
    quantity: 1,
    unitPrice: 1_000_000n,
    vatRate: 900,
    ...overrides,
  }
}

describe('calculateAutoLine', () => {
  it('computes lineTotal and half-up VAT on the gross amount', () => {
    const result = calculateAutoLine(line())
    expect(result.description).toBe('برق حرارتی')
    expect(result.lineTotal).toBe(1_000_000n)
    expect(result.vatAmount).toBe(90_000n)
    expect(result.discount).toBe(0n)
    expect(result.isTaxable).toBe(true)
  })

  it('applies the pre-VAT discount to the line total', () => {
    const result = calculateAutoLine(line({ unitPrice: 2_000_000n }), 500_000n)
    expect(result.lineTotal).toBe(1_500_000n)
    // VAT on the NET amount: 1,500,000 × 9% = 135,000
    expect(result.vatAmount).toBe(135_000n)
    expect(result.discount).toBe(500_000n)
  })

  it('rounds VAT half-up to the nearest IRR', () => {
    // 1 IRR at 50% → 0.5 → rounds up to 1
    const result = calculateAutoLine(line({ unitPrice: 1n, vatRate: 5000 }))
    expect(result.vatAmount).toBe(1n)
    // 1 IRR at 9% → 0.09 → rounds down to 0
    const down = calculateAutoLine(line({ unitPrice: 1n, vatRate: 900 }))
    expect(down.vatAmount).toBe(0n)
  })

  it('carries zero VAT on non-taxable lines', () => {
    const result = calculateAutoLine(
      line({ unitPrice: 1_000_000n, vatRate: 900, isTaxable: false }),
      200_000n,
    )
    expect(result.lineTotal).toBe(800_000n)
    expect(result.vatAmount).toBe(0n)
    expect(result.isTaxable).toBe(false)
  })

  it('throws when the discount exceeds the gross subtotal', () => {
    expect(() => calculateAutoLine(line({ unitPrice: 100_000n }), 100_001n)).toThrow(
      RangeError,
    )
  })

  it('rejects bad quantity / negative price / bad VAT rate', () => {
    expect(() => calculateAutoLine(line({ quantity: 0 }))).toThrow(
      AUTO_INVOICE_ERRORS.BAD_QUANTITY(),
    )
    expect(() => calculateAutoLine(line({ unitPrice: -1n }))).toThrow(
      AUTO_INVOICE_ERRORS.NEGATIVE_UNIT_PRICE(),
    )
    expect(() => calculateAutoLine(line({ vatRate: 10_001 }))).toThrow(
      AUTO_INVOICE_ERRORS.BAD_VAT_RATE(),
    )
  })
})

describe('calculateAutoInvoice', () => {
  it('computes the invoice total as Σ(lineTotal + vatAmount)', () => {
    const result = calculateAutoInvoice([
      line({ unitPrice: 1_000_000n, vatRate: 900 }),
    ])
    expect(result.totalAmount).toBe(1_090_000n)
    expect(result.totalDiscount).toBe(0n)
  })

  it('applies the order gift discount before VAT', () => {
    // 2,000,000 − 250,000 discount = 1,750,000 net; VAT 9% = 157,500
    const result = calculateAutoInvoice(
      [line({ unitPrice: 2_000_000n, vatRate: 900 })],
      250_000n,
    )
    expect(result.totalDiscount).toBe(250_000n)
    expect(result.lines[0]!.lineTotal).toBe(1_750_000n)
    expect(result.lines[0]!.vatAmount).toBe(157_500n)
    expect(result.totalAmount).toBe(1_907_500n)
  })

  it('throws when the order discount exceeds the taxable subtotal', () => {
    expect(() =>
      calculateAutoInvoice([line({ unitPrice: 100_000n })], 100_001n),
    ).toThrow(RangeError)
  })

  it('allows a 100%-coverage gift discount (zero total)', () => {
    // fixed_irr caps at min(value, orderAmount): a full-coverage code
    // makes lineTotal 0 and total 0 — a legitimate order, not an error.
    const result = calculateAutoInvoice(
      [line({ unitPrice: 100_000n, vatRate: 900 })],
      100_000n,
    )
    expect(result.totalDiscount).toBe(100_000n)
    expect(result.lines[0]!.lineTotal).toBe(0n)
    expect(result.lines[0]!.vatAmount).toBe(0n)
    expect(result.totalAmount).toBe(0n)
  })

  it('rejects an empty line list', () => {
    expect(() => calculateAutoInvoice([])).toThrow(AUTO_INVOICE_ERRORS.NO_LINES())
  })

  it('allocates the discount across lines in order', () => {
    const result = calculateAutoInvoice(
      [
        line({ unitPrice: 1_000_000n, vatRate: 900 }),
        line({ unitPrice: 500_000n, vatRate: 900 }),
      ],
      800_000n,
    )
    // Line 1 absorbs up to its full gross (1,000,000) — takes all 800,000.
    expect(result.lines[0]!.discount).toBe(800_000n)
    expect(result.lines[1]!.discount).toBe(0n)
    // Line 1: 200,000 net + 18,000 VAT; line 2: 500,000 + 45,000
    expect(result.totalAmount).toBe(763_000n)
  })

  it('spills the discount to the next line when the first is fully covered', () => {
    const result = calculateAutoInvoice(
      [
        line({ unitPrice: 500_000n, vatRate: 900 }),
        line({ unitPrice: 500_000n, vatRate: 900 }),
      ],
      800_000n,
    )
    // Line 1 takes all 500,000 → 0; the remaining 300,000 goes to line 2.
    expect(result.lines[0]!.discount).toBe(500_000n)
    expect(result.lines[0]!.lineTotal).toBe(0n)
    expect(result.lines[1]!.discount).toBe(300_000n)
    expect(result.lines[1]!.lineTotal).toBe(200_000n)
  })

  it('throws when the discount cannot be fully applied to non-taxable lines', () => {
    // Non-taxable lines still absorb discount (zero VAT); a discount
    // larger than the combined gross must not be silently dropped.
    expect(() =>
      calculateAutoInvoice(
        [
          line({ unitPrice: 100_000n, vatRate: 900, isTaxable: false }),
          line({ unitPrice: 200_000n, vatRate: 900, isTaxable: false }),
        ],
        400_000n,
      ),
    ).toThrow(RangeError)
  })

  it('rejects a negative order discount', () => {
    expect(() => calculateAutoInvoice([line()], -1n)).toThrow(
      AUTO_INVOICE_ERRORS.NEGATIVE_DISCOUNT(),
    )
  })
})

describe('autoLineDescription', () => {
  it('prefers the fa title, falls back to en, then to the product type', () => {
    expect(autoLineDescription(line())).toBe('برق حرارتی')
    expect(
      autoLineDescription(line({ productTitle: { fa: null, en: 'Thermal' } })),
    ).toBe('Thermal')
    expect(autoLineDescription(line({ productTitle: null }))).toBe('electricity')
  })
})