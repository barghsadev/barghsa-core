import { describe, it, expect } from 'vitest'
import {
  GREEN_ELECTRICITY_SYSTEM_KEY,
  greenProductBlockReasons,
  isGreenProductActivatable,
  evaluateGreenRuleEnforcement,
  type GreenElectricityProductState,
} from './green-electricity-safety.js'
import {
  DEFAULT_GREEN_ELECTRICITY_CONFIG,
  type GreenElectricityConfig,
} from './green-electricity-config.js'

function product(over: Partial<GreenElectricityProductState> = {}): GreenElectricityProductState {
  return {
    exists: true,
    status: 'active',
    priceIrR: 1_000_000,
    ...over,
  }
}

const CONFIG: GreenElectricityConfig = {
  simpleOrder: {
    mandatoryGreenEnabled: true,
    averagePowerThresholdKw: 1000,
    mandatoryGreenSharePercent: 4,
  },
  advancedOrder: {
    mandatoryGreenEnabled: false,
    averagePowerThresholdKw: 1000,
    mandatoryGreenSharePercent: 4,
  },
}

describe('GREEN_ELECTRICITY_SYSTEM_KEY', () => {
  it('points at the seeded green electricity product', () => {
    expect(GREEN_ELECTRICITY_SYSTEM_KEY).toBe('green_electricity')
  })
})

describe('greenProductBlockReasons', () => {
  it('returns no reasons for an active, priced product', () => {
    expect(greenProductBlockReasons(product())).toEqual([])
  })

  it('blocks a missing product', () => {
    expect(
      greenProductBlockReasons({ exists: false, status: null, priceIrR: null }),
    ).toEqual(['missing'])
  })

  it('blocks an inactive product', () => {
    expect(greenProductBlockReasons(product({ status: 'inactive' }))).toEqual(['inactive'])
  })

  it('blocks an archived product', () => {
    expect(greenProductBlockReasons(product({ status: 'archived' }))).toEqual(['archived'])
  })

  it('blocks an unpriced product', () => {
    expect(greenProductBlockReasons(product({ priceIrR: null }))).toEqual(['unpriced'])
  })

  it('blocks a zero-priced product', () => {
    expect(greenProductBlockReasons(product({ priceIrR: 0 }))).toEqual(['unpriced'])
  })

  it('combines inactive + unpriced reasons', () => {
    expect(
      greenProductBlockReasons(product({ status: 'inactive', priceIrR: null })),
    ).toEqual(['inactive', 'unpriced'])
  })
})

describe('isGreenProductActivatable', () => {
  it('is true only for an active, priced, existing product', () => {
    expect(isGreenProductActivatable(product())).toBe(true)
    expect(isGreenProductActivatable(product({ status: 'inactive' }))).toBe(false)
    expect(isGreenProductActivatable(product({ priceIrR: null }))).toBe(false)
    expect(
      isGreenProductActivatable({ exists: false, status: null, priceIrR: null }),
    ).toBe(false)
  })
})

describe('evaluateGreenRuleEnforcement (fail-closed seam)', () => {
  it('reports active + unblocked for an enabled mode with an activatable product', () => {
    const r = evaluateGreenRuleEnforcement(CONFIG, 'simpleOrder', product())
    expect(r).toEqual({ ruleActive: true, blocked: false, reasons: [] })
  })

  it('fails closed (blocked) when the rule is active but the product is not activatable', () => {
    const r = evaluateGreenRuleEnforcement(
      CONFIG,
      'simpleOrder',
      product({ status: 'inactive', priceIrR: null }),
    )
    expect(r.ruleActive).toBe(true)
    expect(r.blocked).toBe(true)
    expect(r.reasons).toEqual(['inactive', 'unpriced'])
  })

  it('is not blocked when the rule is disabled even if the product is unusable', () => {
    const r = evaluateGreenRuleEnforcement(
      CONFIG,
      'advancedOrder', // disabled in CONFIG
      product({ status: 'inactive' }),
    )
    expect(r.ruleActive).toBe(false)
    expect(r.blocked).toBe(false)
  })

  it('defaults to inactive for a malformed config (never silently enforces)', () => {
    const r = evaluateGreenRuleEnforcement(
      DEFAULT_GREEN_ELECTRICITY_CONFIG,
      'advancedOrder', // disabled by default
      product(),
    )
    expect(r.ruleActive).toBe(false)
    expect(r.blocked).toBe(false)
  })
})
