/**
 * Unit tests for the VAT calculation module (T-04.1.02.04).
 *
 * Covers the pure resolution precedence (product override → category
 * default → 0%) with a mocked DB executor, plus the integer-only
 * `vatAmount` money math (half-up to nearest IRR, non-taxable lines = 0).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { VatCalculationRepository, type DbExecutor } from './vat-calculation.repository.js'
import { VatCalculationService, VAT_CALC_ERRORS } from './vat-calculation.service.js'

// A fake executor whose query() returns per-call rows from a routing map.
function makeExecutor(routes: {
  product?: Array<{ type: string }>
  override: Array<{ rate: number }>
  category: Array<{ rate: number }>
}): { executor: DbExecutor; calls: string[] } {
  const calls: string[] = []
  const executor: DbExecutor = {
    query: (async (text: string) => {
      calls.push(text)
      if (text.includes('FROM products')) {
        return { rows: routes.product ?? [] }
      }
      if (text.includes('FROM product_vat_overrides')) {
        return { rows: routes.override }
      }
      if (text.includes('FROM vat_configurations')) {
        return { rows: routes.category }
      }
      return { rows: [] }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as DbExecutor['query'],
  }
  return { executor, calls }
}

const AT = new Date('2026-08-01T12:00:00.000Z')

describe('VatCalculationRepository (T-04.1.02.04)', () => {
  let repo: VatCalculationRepository

  beforeEach(() => {
    repo = new VatCalculationRepository()
  })

  it('resolves a product override when one is active', async () => {
    const { executor } = makeExecutor({ override: [{ rate: 500 }], category: [{ rate: 900 }] })
    const result = await repo.resolveRate(executor, {
      productId: 'prod-1',
      category: 'electricity',
      at: AT,
    })
    expect(result).toEqual({ rateBasisPoints: 500, source: 'product_override' })
  })

  it('falls back to the category default when no override is active', async () => {
    const { executor } = makeExecutor({ override: [], category: [{ rate: 900 }] })
    const result = await repo.resolveRate(executor, {
      productId: 'prod-1',
      category: 'electricity',
      at: AT,
    })
    expect(result).toEqual({ rateBasisPoints: 900, source: 'category' })
  })

  it('resolves to 0% when neither override nor category rate exists', async () => {
    const { executor } = makeExecutor({ override: [], category: [] })
    const result = await repo.resolveRate(executor, {
      productId: 'prod-1',
      category: 'electricity',
      at: AT,
    })
    expect(result).toEqual({ rateBasisPoints: 0, source: 'fallback_zero' })
  })

  it('derives the category from products.type when no explicit category is given', async () => {
    const { executor, calls } = makeExecutor({
      product: [{ type: 'electricity' }],
      override: [],
      category: [{ rate: 900 }],
    })
    const result = await repo.resolveRate(executor, { productId: 'prod-1', at: AT })
    expect(result).toEqual({ rateBasisPoints: 900, source: 'category' })
    // A product-type lookup ran, and the category lookup ran.
    expect(calls.some((c) => c.includes('FROM products'))).toBe(true)
    expect(calls.some((c) => c.includes('FROM vat_configurations'))).toBe(true)
  })

  it('does not require an explicit product or category (bare resolution)', async () => {
    const { executor } = makeExecutor({ override: [], category: [] })
    const result = await repo.resolveRate(executor, { at: AT })
    expect(result).toEqual({ rateBasisPoints: 0, source: 'fallback_zero' })
  })
})

describe('VatCalculationService.vatAmount (T-04.1.02.04)', () => {
  let service: VatCalculationService

  beforeEach(() => {
    service = new VatCalculationService(new VatCalculationRepository())
  })

  it('computes half-up VAT on a taxable net base', () => {
    // 900 bps (9%) on 750,000 net = 67,500 (exact)
    expect(service.vatAmount(750_000n, 900)).toBe(67_500n)
    // 900 bps on 1,000,000 = 90,000
    expect(service.vatAmount(1_000_000n, 900)).toBe(90_000n)
  })

  it('rounds half-up to the nearest IRR (0.5 away from zero)', () => {
    // 1000 bps (10%) on 55,055 → 5505.5 → rounds to 5,506
    expect(service.vatAmount(55_055n, 1000)).toBe(5_506n)
    // 1000 bps on 55,054 → 5505.4 → rounds to 5,505
    expect(service.vatAmount(55_054n, 1000)).toBe(5_505n)
  })

  it('returns zero for a non-taxable line regardless of the rate', () => {
    expect(service.vatAmount(1_000_000n, 900, false)).toBe(0n)
  })

  it('returns zero at a 0% rate', () => {
    expect(service.vatAmount(1_000_000n, 0)).toBe(0n)
  })

  it('rejects a negative net base', () => {
    expect(() => service.vatAmount(-1n, 900)).toThrow(RangeError)
    expect(() => service.vatAmount(-1n, 900)).toThrow(VAT_CALC_ERRORS.NEGATIVE_NET())
  })

  it('rejects out-of-range, fractional and non-integer rates', () => {
    expect(() => service.vatAmount(100n, -1)).toThrow(RangeError)
    expect(() => service.vatAmount(100n, 10_001)).toThrow(RangeError)
    expect(() => service.vatAmount(100n, 9.5)).toThrow(RangeError)
    expect(() => service.vatAmount(100n, Number.NaN)).toThrow(RangeError)
  })
})
