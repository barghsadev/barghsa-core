/**
 * Unit tests for the invoice calculation snapshot builder (T-04.1.02.08).
 *
 * The snapshot is the reproducibility document stored on
 * `invoices.invoice_calculation_snapshot`: inputs, VAT half-up rounding
 * steps, and final totals. Amounts are decimal-digit strings so int8 IRR
 * survives JSON. `replayInvoiceCalculation` (T-04.1.02.09) re-runs the
 * original math from `snapshot.inputs`; these tests prove the document
 * is complete, internally consistent, and round-trippable.
 */

import { describe, it, expect } from 'vitest'
import { calculateManualInvoice } from './manual-invoice.calculation.js'
import { calculateAutoInvoice, type AutoInvoiceLineInput } from './auto-invoice.calculation.js'
import {
  INVOICE_CALCULATION_SNAPSHOT_VERSION,
  INVOICE_ROUNDING_RULE,
  VAT_BASIS_POINT_SCALE,
  irrJson,
  parseIrrJson,
  parseSnapshotTotals,
  describeVatRounding,
  buildManualInvoiceCalculationSnapshot,
  buildAutoInvoiceCalculationSnapshot,
  replayInvoiceCalculation,
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

describe('parseIrrJson', () => {
  it('parses decimal-digit strings, including int8 above MAX_SAFE_INTEGER', () => {
    expect(parseIrrJson('0')).toBe(0n)
    expect(parseIrrJson('1090000')).toBe(1_090_000n)
    expect(parseIrrJson('9007199254740993')).toBe(9_007_199_254_740_993n)
  })

  it('rejects JSON Numbers so a coerced int8 cannot silently lose precision', () => {
    expect(() => parseIrrJson(1_090_000)).toThrow(/JSON Number/)
    expect(() => parseIrrJson(Number.MAX_SAFE_INTEGER + 2)).toThrow(/JSON Number/)
  })

  it('rejects non-digit strings', () => {
    expect(() => parseIrrJson('1.5')).toThrow(/decimal-digit/)
    expect(() => parseIrrJson('')).toThrow(/decimal-digit/)
    expect(() => parseIrrJson(null)).toThrow(/decimal-digit/)
  })
})

describe('replayInvoiceCalculation', () => {
  it('reproduces manual totals from snapshot inputs alone', () => {
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
    const replayed = replayInvoiceCalculation(snapshot)
    const totals = parseSnapshotTotals(snapshot.totals)

    expect(replayed.source).toBe('manual')
    expect(replayed.totalAmount).toBe(calc.totalAmount)
    expect(replayed.totalAmount).toBe(totals.totalAmount)
    expect(replayed.subtotal).toBe(totals.subtotal)
    expect(replayed.totalVat).toBe(totals.totalVat)
    expect(replayed.totalDiscount).toBe(0n)
    expect(replayed.lines[0]!.vatAmount).toBe(90_000n)
    expect(replayed.lines[1]!.vatAmount).toBe(0n)
  })

  it('reproduces auto totals including gift-discount allocation', () => {
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
    const replayed = replayInvoiceCalculation(snapshot)
    const totals = parseSnapshotTotals(snapshot.totals)

    expect(replayed.source).toBe('auto')
    expect(replayed.totalAmount).toBe(calc.totalAmount)
    expect(replayed.totalAmount).toBe(totals.totalAmount)
    expect(replayed.totalDiscount).toBe(totals.totalDiscount)
    expect(replayed.lines[0]!.discount).toBe(400_000n)
    expect(replayed.lines[1]!.discount).toBe(100_000n)
    expect(replayed.lines[1]!.lineTotal).toBe(500_000n)
  })

  it('survives JSON round-trip, including amounts above MAX_SAFE_INTEGER', () => {
    const inputs = [
      {
        description: 'مبلغ بزرگ',
        quantity: 1,
        unitPrice: 9_007_199_254_740_993n,
        vatRate: 900,
      },
    ]
    const snapshot = buildManualInvoiceCalculationSnapshot(
      inputs,
      calculateManualInvoice(inputs),
    )
    const roundTripped = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
    const replayed = replayInvoiceCalculation(roundTripped)
    expect(typeof roundTripped.inputs.lines[0]!.unitPrice).toBe('string')
    expect(replayed.totalAmount).toBe(parseIrrJson(snapshot.totals.totalAmount))
    expect(replayed.lines[0]!.lineTotal).toBe(9_007_199_254_740_993n)
  })

  it('ignores stored totals — a tampered snapshot still recomputes from inputs', () => {
    const inputs = [
      { description: 'x', quantity: 1, unitPrice: 1_000_000n, vatRate: 900 },
    ]
    const snapshot = buildManualInvoiceCalculationSnapshot(
      inputs,
      calculateManualInvoice(inputs),
    )
    snapshot.totals.totalAmount = '1'
    snapshot.totals.subtotal = '1'
    snapshot.totals.totalVat = '1'
    const replayed = replayInvoiceCalculation(snapshot)
    expect(replayed.totalAmount).toBe(1_090_000n)
  })
})
