/**
 * Table-driven tests for the invoice calculation snapshot builder
 * (T-04.1.02.08).
 *
 * The snapshot is the reproducibility audit: inputs, per-line VAT
 * half-up rounding steps, and final totals. Replay (T-04.1.02.09) feeds
 * `inputs` back into the calculator and asserts `totals`.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateManualInvoice,
  type ManualInvoiceLineInput,
} from './manual-invoice.calculation.js'
import {
  calculateAutoInvoice,
  type AutoInvoiceLineInput,
} from './auto-invoice.calculation.js'
import {
  buildAutoCalculationSnapshot,
  buildManualCalculationSnapshot,
  irrString,
  recordVatRoundingStep,
} from './invoice-calculation-snapshot.js'

function manualLine(
  overrides: Partial<ManualInvoiceLineInput> = {},
): ManualInvoiceLineInput {
  return {
    description: 'برق مصرفی',
    quantity: 1,
    unitPrice: 1_000_000n,
    vatRate: 900,
    ...overrides,
  }
}

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

describe('recordVatRoundingStep', () => {
  it('records exact VAT (9% of 1,000,000 = 90,000)', () => {
    const step = recordVatRoundingStep(1_000_000n, 900, true)
    expect(step.numerator).toBe('900000000')
    expect(step.denominator).toBe('10000')
    expect(step.truncated).toBe('90000')
    expect(step.remainder).toBe('0')
    expect(step.exactHalf).toBe(false)
    expect(step.rounded).toBe('90000')
  })

  it('records the canonical README half-up: 10% of 55,055 → 5,506', () => {
    const step = recordVatRoundingStep(55_055n, 1000, true)
    expect(step.numerator).toBe('55055000')
    expect(step.truncated).toBe('5505')
    expect(step.remainder).toBe('5000')
    expect(step.exactHalf).toBe(true)
    expect(step.rounded).toBe('5506')
  })

  it('records 10% of 55,054 → 5,505 (under half)', () => {
    const step = recordVatRoundingStep(55_054n, 1000, true)
    expect(step.remainder).toBe('4000')
    expect(step.exactHalf).toBe(false)
    expect(step.rounded).toBe('5505')
  })

  it('records 10% of 55,056 → 5,506 (over half)', () => {
    const step = recordVatRoundingStep(55_056n, 1000, true)
    expect(step.remainder).toBe('6000')
    expect(step.exactHalf).toBe(false)
    expect(step.rounded).toBe('5506')
  })

  it('zeros the VAT step on non-taxable lines without rounding', () => {
    const step = recordVatRoundingStep(1_000_000n, 900, false)
    expect(step.isTaxable).toBe(false)
    expect(step.rateBps).toBe(900)
    expect(step.numerator).toBe('0')
    expect(step.rounded).toBe('0')
    expect(step.exactHalf).toBe(false)
  })
})

describe('buildManualCalculationSnapshot', () => {
  it('stores inputs, rounding steps, and totals for a two-line invoice', () => {
    const calculation = calculateManualInvoice([
      manualLine({ quantity: 2, unitPrice: 500_000n, vatRate: 900 }),
      manualLine({
        description: 'کارمزد اداری',
        unitPrice: 100_000n,
        vatRate: 0,
        isTaxable: false,
      }),
    ])
    const snapshot = buildManualCalculationSnapshot(calculation)

    expect(snapshot.version).toBe(1)
    expect(snapshot.rounding).toBe('half-up-to-nearest-IRR')
    expect(snapshot.source).toBe('manual')
    expect(snapshot.inputs.orderDiscount).toBe('0')
    expect(snapshot.inputs.lines).toHaveLength(2)
    expect(snapshot.inputs.lines[0]).toEqual({
      description: 'برق مصرفی',
      quantity: 2,
      unitPrice: '500000',
      vatRate: 900,
      isTaxable: true,
    })

    expect(snapshot.steps[0]!.gross).toBe('1000000')
    expect(snapshot.steps[0]!.discount).toBe('0')
    expect(snapshot.steps[0]!.lineTotal).toBe('1000000')
    expect(snapshot.steps[0]!.vat.rounded).toBe('90000')
    expect(snapshot.steps[1]!.vat.isTaxable).toBe(false)
    expect(snapshot.steps[1]!.vat.rounded).toBe('0')
    expect(snapshot.steps[0]!.vat.rounded).toBe(
      irrString(calculation.lines[0]!.vatAmount),
    )

    expect(snapshot.totals).toEqual({
      subtotal: '1100000',
      totalVat: '90000',
      totalDiscount: '0',
      totalAmount: '1190000',
    })
    expect(snapshot.totals.totalAmount).toBe(irrString(calculation.totalAmount))
  })

  it('JSON-serializes without bigint (replay-safe)', () => {
    const snapshot = buildManualCalculationSnapshot(
      calculateManualInvoice([manualLine()]),
    )
    const json = JSON.stringify(snapshot)
    const parsed = JSON.parse(json) as typeof snapshot
    expect(parsed.totals.totalAmount).toBe('1090000')
    expect(typeof parsed.steps[0]!.vat.numerator).toBe('string')
    expect(typeof parsed.steps[0]!.vat.rounded).toBe('string')
  })
})

describe('buildAutoCalculationSnapshot', () => {
  it('records gift-discount allocation before VAT', () => {
    const calculation = calculateAutoInvoice([autoLine()], 250_000n)
    const snapshot = buildAutoCalculationSnapshot(calculation, 250_000n)

    expect(snapshot.source).toBe('auto')
    expect(snapshot.inputs.orderDiscount).toBe('250000')
    expect(snapshot.inputs.lines[0]!.productId).toBe(
      '11111111-1111-7111-8111-111111111111',
    )
    expect(snapshot.steps[0]!.gross).toBe('1000000')
    expect(snapshot.steps[0]!.discount).toBe('250000')
    expect(snapshot.steps[0]!.remainingDiscountBefore).toBe('250000')
    expect(snapshot.steps[0]!.remainingDiscountAfter).toBe('0')
    expect(snapshot.steps[0]!.lineTotal).toBe('750000')
    // 9% of 750,000 = 67,500 exactly
    expect(snapshot.steps[0]!.vat.rounded).toBe('67500')
    expect(snapshot.totals.totalAmount).toBe(irrString(calculation.totalAmount))
    expect(snapshot.totals.totalDiscount).toBe('250000')
  })

  it('walks remaining discount across multiple lines', () => {
    const calculation = calculateAutoInvoice(
      [
        autoLine({ unitPrice: 400_000n }),
        autoLine({
          productId: '22222222-2222-7222-8222-222222222222',
          productType: 'hardware',
          productTitle: { fa: 'کنتور', en: 'Meter' },
          unitPrice: 600_000n,
        }),
      ],
      500_000n,
    )
    const snapshot = buildAutoCalculationSnapshot(calculation, 500_000n)

    expect(snapshot.steps[0]!.discount).toBe('400000')
    expect(snapshot.steps[0]!.remainingDiscountAfter).toBe('100000')
    expect(snapshot.steps[1]!.discount).toBe('100000')
    expect(snapshot.steps[1]!.remainingDiscountBefore).toBe('100000')
    expect(snapshot.steps[1]!.remainingDiscountAfter).toBe('0')
    expect(snapshot.totals.totalDiscount).toBe('500000')
  })
})
