/**
 * Unit tests for the invoice calculation snapshot builder (T-04.1.02.08).
 *
 * The snapshot is the reproducibility document stored on
 * `invoices.invoice_calculation_snapshot`: inputs, VAT half-up rounding
 * steps, and final totals. Amounts are decimal-digit strings so int8 IRR
 * survives JSON. T-04.1.02.09 will replay these inputs against PostgreSQL;
 * these tests prove the document is complete and internally consistent.
 */

import { describe, it, expect } from 'vitest'
import { calculateManualInvoice } from './manual-invoice.calculation.js'
import { calculateAutoInvoice, type AutoInvoiceLineInput } from './auto-invoice.calculation.js'
import {
  INVOICE_CALCULATION_SNAPSHOT_VERSION,
  INVOICE_ROUNDING_RULE,
  VAT_BASIS_POINT_SCALE,
  irrJson,
  describeVatRounding,
  buildManualInvoiceCalculationSnapshot,
  buildAutoInvoiceCalculationSnapshot,
} from './invoice-calculation-snapshot.js'

function autoLine(overrides: Partial<AutoInvoiceLineInput> = {}): AutoInvoiceLineInput {
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

describe('irrJson', () => {
  it('serializes bigint IRR as a decimal-digit string (JSON-safe)', () => {
    expect(irrJson(0n)).toBe('0')
    expect(irrJson(1_090_000n)).toBe('1090000')
    // Above Number.MAX_SAFE_INTEGER — must not become a JSON Number.
    expect(irrJson(9_007_199_254_740_993n)).toBe('9007199254740993')
    expect(JSON.parse(JSON.stringify({ n: irrJson(9_007_199_254_740_993n) }))).toEqual({
      n: '9007199254740993',
    })
  })
})

describe('describeVatRounding', () => {
  it('records exact-half as roundedUp with result = truncated + 1', () => {
    // 1 IRR at 50% → 0.5 → half-up to 1
    const step = describeVatRounding(0, 1n, 5000, true)
    expect(step.numerator).toBe('5000')
    expect(step.denominator).toBe('10000')
    expect(step.truncatedQuotient).toBe('0')
    expect(step.remainder).toBe('5000')
    expect(step.roundedUp).toBe(true)
    expect(step.result).toBe('1')
  })

  it('does not round up when the remainder is below half', () => {
    // 1 IRR at 49% → 0.49 → 0
    const step = describeVatRounding(0, 1n, 4900, true)
    expect(step.remainder).toBe('4900')
    expect(step.roundedUp).toBe(false)
    expect(step.result).toBe('0')
  })

  it('skips division for non-taxable lines (VAT is always 0)', () => {
    const step = describeVatRounding(2, 1_000_000n, 900, false)
    expect(step.isTaxable).toBe(false)
    expect(step.numerator).toBe('0')
    expect(step.result).toBe('0')
    expect(step.roundedUp).toBe(false)
  })

  it('matches product VAT examples: 9% of 1,000,000 and 10% of 55,055', () => {
    expect(describeVatRounding(0, 1_000_000n, 900, true).result).toBe('90000')
    // 55,055 × 10% = 5,505.5 → 5,506
    const half = describeVatRounding(0, 55_055n, 1000, true)
    expect(half.numerator).toBe('55055000')
    expect(half.truncatedQuotient).toBe('5505')
    expect(half.remainder).toBe('5000')
    expect(half.roundedUp).toBe(true)
    expect(half.result).toBe('5506')
  })
})

describe('buildManualInvoiceCalculationSnapshot', () => {
  it('stores inputs, per-line rounding steps, and invoice totals', () => {
    const inputs = [
      { description: 'برق مصرفی', quantity: 1, unitPrice: 1_000_000n, vatRate: 900 },
      {
        description: 'کارمزد',
        quantity: 1,
        unitPrice: 100_000n,
        vatRate: 0,
        isTaxable: false,
      },
    ]
    const calc = calculateManualInvoice(inputs)
    const snapshot = buildManualInvoiceCalculationSnapshot(inputs, calc)

    expect(snapshot.version).toBe(INVOICE_CALCULATION_SNAPSHOT_VERSION)
    expect(snapshot.source).toBe('manual')
    expect(snapshot.rounding).toEqual({
      rule: INVOICE_ROUNDING_RULE,
      vatScale: VAT_BASIS_POINT_SCALE,
    })
    expect(snapshot.inputs.orderDiscount).toBe('0')
    expect(snapshot.inputs.lines).toHaveLength(2)
    expect(snapshot.inputs.lines[0]).toEqual({
      description: 'برق مصرفی',
      quantity: 1,
      unitPrice: '1000000',
      vatRate: 900,
      isTaxable: true,
    })
    expect(snapshot.inputs.lines[1]!.isTaxable).toBe(false)

    expect(snapshot.steps).toHaveLength(2)
    expect(snapshot.steps[0]!.gross).toBe('1000000')
    expect(snapshot.steps[0]!.discount).toBe('0')
    expect(snapshot.steps[0]!.vat.result).toBe('90000')
    expect(snapshot.steps[1]!.vat.result).toBe('0')

    expect(snapshot.totals).toEqual({
      subtotal: '1100000',
      totalVat: '90000',
      totalDiscount: '0',
      totalAmount: '1190000',
    })
    expect(snapshot.totals.totalAmount).toBe(calc.totalAmount.toString())
  })

  it('JSON round-trips without bigint or Number coercion', () => {
    const inputs = [
      { description: 'x', quantity: 1, unitPrice: 1_000_000n, vatRate: 900 },
    ]
    const snapshot = buildManualInvoiceCalculationSnapshot(
      inputs,
      calculateManualInvoice(inputs),
    )
    const roundTripped = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
    expect(roundTripped).toEqual(snapshot)
    expect(typeof roundTripped.totals.totalAmount).toBe('string')
  })
})

describe('buildAutoInvoiceCalculationSnapshot', () => {
  it('records gift-discount allocation and VAT-on-net rounding', () => {
    const inputs = [autoLine()]
    const discount = 250_000n
    const calc = calculateAutoInvoice(inputs, discount)
    const snapshot = buildAutoInvoiceCalculationSnapshot(inputs, discount, calc)

    expect(snapshot.source).toBe('auto')
    expect(snapshot.inputs.orderDiscount).toBe('250000')
    expect(snapshot.inputs.lines[0]!.productId).toBe(inputs[0]!.productId)
    expect(snapshot.inputs.lines[0]!.productType).toBe('electricity')
    expect(snapshot.inputs.lines[0]!.description).toBe('برق حرارتی')

    expect(snapshot.steps[0]!.gross).toBe('1000000')
    expect(snapshot.steps[0]!.discount).toBe('250000')
    expect(snapshot.steps[0]!.remainingDiscountAfter).toBe('0')
    expect(snapshot.steps[0]!.lineTotal).toBe('750000')
    // 9% of 750,000 = 67,500 exactly
    expect(snapshot.steps[0]!.vat.numerator).toBe('675000000')
    expect(snapshot.steps[0]!.vat.roundedUp).toBe(false)
    expect(snapshot.steps[0]!.vat.result).toBe('67500')
    expect(snapshot.totals).toEqual({
      subtotal: '750000',
      totalVat: '67500',
      totalDiscount: '250000',
      totalAmount: '817500',
    })
  })

  it('allocates a multi-line discount in composition order', () => {
    const inputs = [
      autoLine({ quantity: 1, unitPrice: 400_000n, vatRate: 0, isTaxable: false }),
      autoLine({
        productId: '22222222-2222-7222-8222-222222222222',
        productType: 'hardware',
        productTitle: { fa: 'کنتور', en: 'Meter' },
        unitPrice: 600_000n,
        vatRate: 900,
      }),
    ]
    const discount = 500_000n
    const calc = calculateAutoInvoice(inputs, discount)
    const snapshot = buildAutoInvoiceCalculationSnapshot(inputs, discount, calc)

    // Line 0 absorbs 400,000 (its full gross); 100,000 remains for line 1.
    expect(snapshot.steps[0]!.discount).toBe('400000')
    expect(snapshot.steps[0]!.remainingDiscountAfter).toBe('100000')
    expect(snapshot.steps[1]!.discount).toBe('100000')
    expect(snapshot.steps[1]!.remainingDiscountAfter).toBe('0')
    expect(snapshot.steps[1]!.lineTotal).toBe('500000')
    expect(snapshot.totals.totalDiscount).toBe('500000')
  })
})
