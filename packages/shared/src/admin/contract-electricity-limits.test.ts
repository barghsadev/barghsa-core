import { describe, it, expect } from 'vitest'
import {
  CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
  DEFAULT_CONTRACT_ELECTRICITY_LIMITS,
  MAX_CONTRACT_DURATION_MONTHS,
  MAX_CONTRACT_LEAD_TIME_DAYS,
  MAX_CONTRACT_QUANTITY_INCREASE_PERCENT,
  contractElectricityLimitsToStored,
  isValidContractDuration,
  isValidLeadTimeDays,
  isValidQuantityIncreasePercent,
  toContractElectricityLimits,
  validateContractElectricityLimits,
} from './contract-electricity-limits.js'

describe('contract electricity limits defaults (T-09.12.06)', () => {
  it('exposes the documented default config', () => {
    expect(DEFAULT_CONTRACT_ELECTRICITY_LIMITS).toEqual({
      maxQuantityIncreasePercent: 20,
      maxContractDuration: 24,
      leadTimeDays: 0,
    })
  })

  it('uses the canonical app_config key under the electricity namespace', () => {
    expect(CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY).toBe('electricity.contract_limits')
  })
})

describe('value validators (T-09.12.06)', () => {
  it('accepts integer percentages within 0..max', () => {
    expect(isValidQuantityIncreasePercent(0)).toBe(true)
    expect(isValidQuantityIncreasePercent(1)).toBe(true)
    expect(isValidQuantityIncreasePercent(20)).toBe(true)
    expect(isValidQuantityIncreasePercent(MAX_CONTRACT_QUANTITY_INCREASE_PERCENT)).toBe(true)
  })

  it('rejects negative, fractional, over-max and non-number percentages', () => {
    expect(isValidQuantityIncreasePercent(-1)).toBe(false)
    expect(isValidQuantityIncreasePercent(2.5)).toBe(false)
    expect(isValidQuantityIncreasePercent(MAX_CONTRACT_QUANTITY_INCREASE_PERCENT + 1)).toBe(false)
    expect(isValidQuantityIncreasePercent('20')).toBe(false)
    expect(isValidQuantityIncreasePercent(null)).toBe(false)
    expect(isValidQuantityIncreasePercent(undefined)).toBe(false)
    expect(isValidQuantityIncreasePercent(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidQuantityIncreasePercent(Number.NaN)).toBe(false)
  })

  it('accepts durations from 1 month up to the max', () => {
    expect(isValidContractDuration(1)).toBe(true)
    expect(isValidContractDuration(24)).toBe(true)
    expect(isValidContractDuration(MAX_CONTRACT_DURATION_MONTHS)).toBe(true)
  })

  it('rejects zero, negative, fractional, over-max and non-number durations', () => {
    expect(isValidContractDuration(0)).toBe(false)
    expect(isValidContractDuration(-1)).toBe(false)
    expect(isValidContractDuration(24.5)).toBe(false)
    expect(isValidContractDuration(MAX_CONTRACT_DURATION_MONTHS + 1)).toBe(false)
    expect(isValidContractDuration('24')).toBe(false)
    expect(isValidContractDuration(true)).toBe(false)
  })

  it('accepts lead times from 0 days up to the max', () => {
    expect(isValidLeadTimeDays(0)).toBe(true)
    expect(isValidLeadTimeDays(1)).toBe(true)
    expect(isValidLeadTimeDays(30)).toBe(true)
    expect(isValidLeadTimeDays(MAX_CONTRACT_LEAD_TIME_DAYS)).toBe(true)
  })

  it('rejects negative, fractional, over-max and non-number lead times', () => {
    expect(isValidLeadTimeDays(-1)).toBe(false)
    expect(isValidLeadTimeDays(1.5)).toBe(false)
    expect(isValidLeadTimeDays(MAX_CONTRACT_LEAD_TIME_DAYS + 1)).toBe(false)
    expect(isValidLeadTimeDays('0')).toBe(false)
    expect(isValidLeadTimeDays([])).toBe(false)
  })
})

describe('validateContractElectricityLimits (T-09.12.06)', () => {
  it('accepts a complete snake_case wire payload', () => {
    const result = validateContractElectricityLimits({
      max_quantity_increase_percent: 20,
      max_contract_duration_months: 24,
      lead_time_days: 0,
    })
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('accepts the camelCase domain shape', () => {
    const result = validateContractElectricityLimits({
      maxQuantityIncreasePercent: 50,
      maxContractDuration: 36,
      leadTimeDays: 7,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(validateContractElectricityLimits(null).ok).toBe(false)
    expect(validateContractElectricityLimits('x').ok).toBe(false)
    expect(validateContractElectricityLimits(42).ok).toBe(false)
    expect(validateContractElectricityLimits(undefined).ok).toBe(false)
  })

  it('collects issues for missing fields', () => {
    const result = validateContractElectricityLimits({})
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'max_quantity_increase_percent is required',
        'max_contract_duration_months is required',
        'lead_time_days is required',
      ]),
    )
  })

  it('collects issues for out-of-range fields', () => {
    const result = validateContractElectricityLimits({
      max_quantity_increase_percent: 5000,
      max_contract_duration_months: 0,
      lead_time_days: -3,
    })
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBe(3)
  })

  it('rejects wrong types rather than coercing them', () => {
    const result = validateContractElectricityLimits({
      max_quantity_increase_percent: '20',
      max_contract_duration_months: true,
      lead_time_days: null,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown top-level fields with their key named', () => {
    const result = validateContractElectricityLimits({
      max_quantity_increase_percent: 20,
      max_contract_duration_months: 24,
      lead_time_days: 0,
      lead_days: 5,
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toContain('unknown field "lead_days"')
  })
})

describe('toContractElectricityLimits / stored shape (T-09.12.06)', () => {
  it('normalizes a valid snake_case payload', () => {
    expect(
      toContractElectricityLimits({
        max_quantity_increase_percent: 50,
        max_contract_duration_months: 36,
        lead_time_days: 7,
      }),
    ).toEqual({ maxQuantityIncreasePercent: 50, maxContractDuration: 36, leadTimeDays: 7 })
  })

  it('falls back to defaults per-field for malformed input', () => {
    expect(
      toContractElectricityLimits({
        max_quantity_increase_percent: -1,
        max_contract_duration_months: 'x',
      }),
    ).toEqual(DEFAULT_CONTRACT_ELECTRICITY_LIMITS)
    expect(toContractElectricityLimits(null)).toEqual(DEFAULT_CONTRACT_ELECTRICITY_LIMITS)
    expect(toContractElectricityLimits(undefined)).toEqual(DEFAULT_CONTRACT_ELECTRICITY_LIMITS)
  })

  it('maps the domain config to the stored snake_case shape', () => {
    expect(
      contractElectricityLimitsToStored({
        maxQuantityIncreasePercent: 20,
        maxContractDuration: 24,
        leadTimeDays: 0,
      }),
    ).toEqual({
      max_quantity_increase_percent: 20,
      max_contract_duration_months: 24,
      lead_time_days: 0,
    })
  })
})