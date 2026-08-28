import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GREEN_ELECTRICITY_CONFIG,
  GREEN_ELECTRICITY_CONFIG_KEY,
  validateGreenElectricityConfig,
  toGreenElectricityConfig,
  isGreenRuleActive,
  greenElectricityConfigToStored,
  isValidAveragePowerThresholdKw,
  isValidMandatoryGreenSharePercent,
} from './green-electricity-config.js'

const VALID_INPUT = {
  simple_order: {
    mandatory_green_enabled: true,
    average_power_threshold_kw: 1000,
    mandatory_green_share_percent: 4,
  },
  advanced_order: {
    mandatory_green_enabled: false,
    average_power_threshold_kw: 500,
    mandatory_green_share_percent: 10,
  },
}

describe('green-electricity config contract (T-09.10.02)', () => {
  it('exports the expected app_config key', () => {
    expect(GREEN_ELECTRICITY_CONFIG_KEY).toBe('electricity.green_mandatory_rules')
  })

  describe('defaults', () => {
    it('matches T-09.10.02: simple enabled, advanced disabled, 1000 kW, 4%', () => {
      expect(DEFAULT_GREEN_ELECTRICITY_CONFIG).toEqual({
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
      })
    })
  })

  describe('validateGreenElectricityConfig', () => {
    it('accepts a fully valid snake_case payload', () => {
      const r = validateGreenElectricityConfig(VALID_INPUT)
      expect(r.ok).toBe(true)
      expect(r.issues).toEqual([])
    })

    it('accepts camelCase aliases', () => {
      const r = validateGreenElectricityConfig({
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
      })
      expect(r.ok).toBe(true)
    })

    it('rejects a non-object input', () => {
      const r = validateGreenElectricityConfig('nope')
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toContain('must be an object')
    })

    it('rejects a missing mode object', () => {
      const r = validateGreenElectricityConfig({ simple_order: VALID_INPUT.simple_order })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toContain('advanced_order must be an object')
    })

    it('rejects a non-boolean mandatory_green_enabled', () => {
      const r = validateGreenElectricityConfig({
        simple_order: {
          mandatory_green_enabled: 'yes',
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
        advanced_order: VALID_INPUT.advanced_order,
      })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toContain('mandatory_green_enabled must be a boolean')
    })

    it('rejects string coercion of threshold (does not coerce)', () => {
      const r = validateGreenElectricityConfig({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: '1000',
          mandatory_green_share_percent: 4,
        },
        advanced_order: VALID_INPUT.advanced_order,
      })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toContain('average_power_threshold_kw must be an integer')
    })

    it('rejects a negative threshold', () => {
      const r = validateGreenElectricityConfig({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: -1,
          mandatory_green_share_percent: 4,
        },
        advanced_order: VALID_INPUT.advanced_order,
      })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toContain('average_power_threshold_kw')
    })

    it('rejects a share above 100', () => {
      const r = validateGreenElectricityConfig({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 101,
        },
        advanced_order: VALID_INPUT.advanced_order,
      })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toContain('mandatory_green_share_percent')
    })

    it('accepts a fractional share (e.g. 4.5%)', () => {
      const r = validateGreenElectricityConfig({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4.5,
        },
        advanced_order: VALID_INPUT.advanced_order,
      })
      expect(r.ok).toBe(true)
    })

    it('rejects a missing mandatory_green_enabled flag', () => {
      const r = validateGreenElectricityConfig({
        simple_order: {
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
        advanced_order: VALID_INPUT.advanced_order,
      })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toContain('mandatory_green_enabled is required')
    })

    it('accepts a camelCase payload with mandatoryGreenEnabled:false', () => {
      const r = validateGreenElectricityConfig({
        simple_order: {
          mandatory_green_enabled: false,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
        advanced_order: {
          mandatory_green_enabled: false,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
      })
      expect(r.ok).toBe(true)
      const c = toGreenElectricityConfig({
        simple_order: {
          mandatory_green_enabled: false,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
        advanced_order: {
          mandatory_green_enabled: false,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
      })
      expect(c.simpleOrder.mandatoryGreenEnabled).toBe(false)
    })
  })

  describe('validators', () => {
    it('isValidAveragePowerThresholdKw', () => {
      expect(isValidAveragePowerThresholdKw(0)).toBe(true)
      expect(isValidAveragePowerThresholdKw(1000)).toBe(true)
      expect(isValidAveragePowerThresholdKw(-1)).toBe(false)
      expect(isValidAveragePowerThresholdKw(1.5)).toBe(false)
      expect(isValidAveragePowerThresholdKw('1000')).toBe(false)
    })
    it('isValidMandatoryGreenSharePercent', () => {
      expect(isValidMandatoryGreenSharePercent(0)).toBe(true)
      expect(isValidMandatoryGreenSharePercent(4)).toBe(true)
      expect(isValidMandatoryGreenSharePercent(100)).toBe(true)
      expect(isValidMandatoryGreenSharePercent(101)).toBe(false)
      expect(isValidMandatoryGreenSharePercent(-1)).toBe(false)
    })
  })

  describe('toGreenElectricityConfig', () => {
    it('normalizes a valid payload to camelCase', () => {
      const c = toGreenElectricityConfig(VALID_INPUT)
      expect(c.simpleOrder).toEqual({
        mandatoryGreenEnabled: true,
        averagePowerThresholdKw: 1000,
        mandatoryGreenSharePercent: 4,
      })
      expect(c.advancedOrder).toEqual({
        mandatoryGreenEnabled: false,
        averagePowerThresholdKw: 500,
        mandatoryGreenSharePercent: 10,
      })
    })

    it('falls back to defaults on malformed input', () => {
      const c = toGreenElectricityConfig({})
      expect(c).toEqual(DEFAULT_GREEN_ELECTRICITY_CONFIG)
      // A mode with a bad threshold falls back per-field.
      const c2 = toGreenElectricityConfig({
        simple_order: { mandatory_green_enabled: true, average_power_threshold_kw: -5, mandatory_green_share_percent: 4 },
        advanced_order: VALID_INPUT.advanced_order,
      })
      expect(c2.simpleOrder.averagePowerThresholdKw).toBe(1000)
      expect(c2.simpleOrder.mandatoryGreenEnabled).toBe(true)
    })
  })

  describe('greenElectricityConfigToStored', () => {
    it('produces the snake_case persisted shape', () => {
      const stored = greenElectricityConfigToStored(
        toGreenElectricityConfig(VALID_INPUT),
      )
      expect(stored).toEqual({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
        advanced_order: {
          mandatory_green_enabled: false,
          average_power_threshold_kw: 500,
          mandatory_green_share_percent: 10,
        },
      })
    })
  })

  describe('isGreenRuleActive', () => {
    it('reflects the mode enablement flag', () => {
      const c = toGreenElectricityConfig(VALID_INPUT)
      expect(isGreenRuleActive(c, 'simpleOrder')).toBe(true)
      expect(isGreenRuleActive(c, 'advancedOrder')).toBe(false)
    })

    it('fails closed on a malformed config', () => {
      expect(isGreenRuleActive(undefined as never, 'simpleOrder')).toBe(false)
      const bad = { simpleOrder: { mandatoryGreenEnabled: 'yes' as never } }
      expect(isGreenRuleActive(bad as never, 'simpleOrder')).toBe(false)
    })
  })
})
