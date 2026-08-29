/**
 * Table-driven tests for the manual invoice calculation module
 * (T-04.1.02.02).
 *
 * Covers the S-04.1.02 money rules with financial examples:
 *   - lineTotal = quantity × unitPrice (integer IRR)
 *   - VAT on taxable lines only, rounded half-up to the nearest IRR
 *   - totalAmount = Σ(lineTotal) + Σ(vatAmount)
 *   - every validation rejection path
 */

import { describe, it, expect } from 'vitest'
import {
  calculateManualInvoice,
  calculateManualLine,
  roundHalfUpDiv,
  MANUAL_LINE_ERRORS,
  type ManualInvoiceLineInput,
} from './manual-invoice.calculation.js'

describe('roundHalfUpDiv (half-up to nearest IRR)', () => {
  it('rounds exact halves up', () => {
    // 0.5 → 1
    expect(roundHalfUpDiv(5n, 10n)).toBe(1n)
    // 1.5 → 2
    expect(roundHalfUpDiv(15n, 10n)).toBe(2n)
  })

  it('rounds values under half down', () => {
    expect(roundHalfUpDiv(4n, 10n)).toBe(0n)
    expect(roundHalfUpDiv(14n, 10n)).toBe(1n)
  })

  it('rounds values over half up', () => {
    expect(roundHalfUpDiv(6n, 10n)).toBe(1n)
    expect(roundHalfUpDiv(19n, 10n)).toBe(2n)
  })

  it('identity when already integral', () => {
    expect(roundHalfUpDiv(20n, 10n)).toBe(2n)
    expect(roundHalfUpDiv(0n, 10_000n)).toBe(0n)
  })

  it('full 10k precision (VAT basis points)', () => {
    // 1,000,000 × 900 bps (9%) = 90,000,000 / 10,000 = 90,000 exactly
    expect(roundHalfUpDiv(1_000_000n * 900n, 10_000n)).toBe(90_000n)
    // 1 bp of 1,000,000 = 100 IRR → exact
    expect(roundHalfUpDiv(1_000_000n * 1n, 10_000n)).toBe(100n)
    // sub-IRR fractions round half-up: 100 × 1 bp = 100 / 10_000 = 0.01 → 0
    expect(roundHalfUpDiv(100n * 1n, 10_000n)).toBe(0n)
    // 500 × 1 bp = 500 / 10_000 = 0.05 → 0
    expect(roundHalfUpDiv(500n * 1n, 10_000n)).toBe(0n)
    // 5000 × 1 bp = 5000 / 10_000 = 0.5 → rounds up to 1
    expect(roundHalfUpDiv(5000n * 1n, 10_000n)).toBe(1n)
    // 9000 × 1 bp = 9000 / 10_000 = 0.9 → 1
    expect(roundHalfUpDiv(9000n * 1n, 10_000n)).toBe(1n)
  })

  it('rejects zero/negative denominators and negative numerators', () => {
    expect(() => roundHalfUpDiv(10n, 0n)).toThrow(RangeError)
    expect(() => roundHalfUpDiv(10n, -1n)).toThrow(RangeError)
    expect(() => roundHalfUpDiv(-1n, 10n)).toThrow(RangeError)
  })
})

describe('calculateManualLine', () => {
  it('computes lineTotal = quantity × unitPrice with VAT at 9%', () => {
    const line = calculateManualLine({
      description: 'برق مصرفی',
      quantity: 2,
      unitPrice: 500_000n,
      vatRate: 900,
    })
    expect(line.lineTotal).toBe(1_000_000n)
    expect(line.vatAmount).toBe(90_000n)
    expect(line.isTaxable).toBe(true)
  })

  it('zero VAT for non-taxable lines regardless of rate', () => {
    const line = calculateManualLine({
      description: 'کارمزد بدون مالیات',
      quantity: 1,
      unitPrice: 1_000_000n,
      vatRate: 900,
      isTaxable: false,
    })
    expect(line.lineTotal).toBe(1_000_000n)
    expect(line.vatAmount).toBe(0n)
    expect(line.isTaxable).toBe(false)
  })

  it('defaults isTaxable to true', () => {
    const line = calculateManualLine({
      description: 'x',
      quantity: 1,
      unitPrice: 100n,
      vatRate: 0,
    })
    expect(line.isTaxable).toBe(true)
    expect(line.vatAmount).toBe(0n)
  })

  it('rounds half-up at the line level', () => {
    // 1 IRR at 50% = 0.5 → rounds up to 1
    const line = calculateManualLine({
      description: 'rounding',
      quantity: 1,
      unitPrice: 1n,
      vatRate: 5000,
    })
    expect(line.vatAmount).toBe(1n)
  })
})

describe('calculateManualInvoice', () => {
  it('sums line totals and VAT into totalAmount', () => {
    const result = calculateManualInvoice([
      { description: 'A', quantity: 1, unitPrice: 1_000_000n, vatRate: 900 },
      { description: 'B', quantity: 2, unitPrice: 250_000n, vatRate: 0, isTaxable: false },
    ])
    // A: lineTotal 1,000,000 + vat 90,000 = 1,090,000
    // B: lineTotal 500,000 + vat 0 = 500,000
    expect(result.totalAmount).toBe(1_590_000n)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]!.vatAmount).toBe(90_000n)
    expect(result.lines[1]!.vatAmount).toBe(0n)
  })

  it('keeps staff entry order (position implied by array order)', () => {
    const result = calculateManualInvoice([
      { description: 'first', quantity: 1, unitPrice: 10n, vatRate: 0 },
      { description: 'second', quantity: 1, unitPrice: 20n, vatRate: 0 },
    ])
    expect(result.lines.map((l) => l.description)).toEqual(['first', 'second'])
  })

  it('rejects an empty line list', () => {
    expect(() => calculateManualInvoice([])).toThrow(MANUAL_LINE_ERRORS.NO_LINES())
  })

  it('rejects a zero-total invoice', () => {
    expect(() =>
      calculateManualInvoice([{ description: 'zero', quantity: 1, unitPrice: 0n, vatRate: 0 }]),
    ).toThrow(MANUAL_LINE_ERRORS.ZERO_TOTAL())
  })

  it('rejects blank descriptions', () => {
    expect(() =>
      calculateManualInvoice([{ description: '   ', quantity: 1, unitPrice: 100n, vatRate: 0 }]),
    ).toThrow(MANUAL_LINE_ERRORS.EMPTY_DESCRIPTION())
  })

  it('rejects non-positive or non-integer quantity', () => {
    const base: ManualInvoiceLineInput = { description: 'x', quantity: 1, unitPrice: 100n, vatRate: 0 }
    expect(() => calculateManualInvoice([{ ...base, quantity: 0 }])).toThrow(MANUAL_LINE_ERRORS.BAD_QUANTITY())
    expect(() => calculateManualInvoice([{ ...base, quantity: -1 }])).toThrow(MANUAL_LINE_ERRORS.BAD_QUANTITY())
    expect(() => calculateManualInvoice([{ ...base, quantity: 1.5 }])).toThrow(MANUAL_LINE_ERRORS.BAD_QUANTITY())
  })

  it('rejects negative unit price', () => {
    expect(() =>
      calculateManualInvoice([{ description: 'x', quantity: 1, unitPrice: -1n, vatRate: 0 }]),
    ).toThrow(MANUAL_LINE_ERRORS.NEGATIVE_UNIT_PRICE())
  })

  it('rejects VAT rates outside 0..10000 basis points', () => {
    const base = { description: 'x', quantity: 1, unitPrice: 100n }
    expect(() => calculateManualInvoice([{ ...base, vatRate: -1 }])).toThrow(MANUAL_LINE_ERRORS.BAD_VAT_RATE())
    expect(() => calculateManualInvoice([{ ...base, vatRate: 10_001 }])).toThrow(MANUAL_LINE_ERRORS.BAD_VAT_RATE())
    expect(() => calculateManualInvoice([{ ...base, vatRate: 1.5 }])).toThrow(MANUAL_LINE_ERRORS.BAD_VAT_RATE())
  })
})