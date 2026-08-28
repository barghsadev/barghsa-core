import { describe, it, expect } from 'vitest'
import {
  GIFT_CODE_DISCOUNT_TYPES,
  GIFT_CODE_ELIGIBILITY,
  GIFT_CODE_STATUSES,
  MAX_GIFT_PERCENT_BPS,
  computeGiftDiscount,
  isGiftCodeDiscountType,
  isGiftCodeEligibility,
  isGiftCodePercentageBps,
  isGiftCodeStatus,
  isPositiveIrr,
  normalizeGiftCode,
  validateGiftCodePayload,
} from './gift-code.js'

describe('Gift code shared contract (T-09.12.03)', () => {
  describe('normalizeGiftCode (trim + uppercase)', () => {
    it('trims whitespace and uppercases', () => {
      expect(normalizeGiftCode('  sale10  ')).toBe('SALE10')
      expect(normalizeGiftCode(' winter-2026 ')).toBe('WINTER-2026')
    })
    it('is idempotent', () => {
      expect(normalizeGiftCode(normalizeGiftCode(' x '))).toBe('X')
    })
  })

  describe('discriminators', () => {
    it('accepts only known values', () => {
      expect(isGiftCodeDiscountType('fixed_irr')).toBe(true)
      expect(isGiftCodeDiscountType('percentage')).toBe(true)
      expect(isGiftCodeDiscountType('percent')).toBe(false)
      expect(isGiftCodeEligibility('public')).toBe(true)
      expect(isGiftCodeEligibility('profile')).toBe(true)
      expect(isGiftCodeEligibility('everyone')).toBe(false)
      expect(isGiftCodeStatus('active')).toBe(true)
      expect(isGiftCodeStatus('inactive')).toBe(true)
      expect(isGiftCodeStatus('paused')).toBe(false)
    })
    it('exposes the canonical lists', () => {
      expect(GIFT_CODE_DISCOUNT_TYPES).toEqual(['fixed_irr', 'percentage'])
      expect(GIFT_CODE_ELIGIBILITY).toEqual(['public', 'profile'])
      expect(GIFT_CODE_STATUSES).toEqual(['active', 'inactive'])
    })
  })

  describe('percentage basis points', () => {
    it('accepts 1..10000', () => {
      expect(isGiftCodePercentageBps(1)).toBe(true)
      expect(isGiftCodePercentageBps(2500)).toBe(true)
      expect(isGiftCodePercentageBps(MAX_GIFT_PERCENT_BPS)).toBe(true)
    })
    it('accepts the numeric-string form used by the API payloads', () => {
      expect(isGiftCodePercentageBps('1')).toBe(true)
      expect(isGiftCodePercentageBps('2500')).toBe(true)
      expect(isGiftCodePercentageBps('10000')).toBe(true)
    })
    it('rejects 0, negatives, floats, junk strings, and out-of-range', () => {
      expect(isGiftCodePercentageBps(0)).toBe(false)
      expect(isGiftCodePercentageBps(-100)).toBe(false)
      expect(isGiftCodePercentageBps(10001)).toBe(false)
      expect(isGiftCodePercentageBps(12.5)).toBe(false)
      expect(isGiftCodePercentageBps('0')).toBe(false)
      expect(isGiftCodePercentageBps('10001')).toBe(false)
      expect(isGiftCodePercentageBps('12.5')).toBe(false)
      expect(isGiftCodePercentageBps('abc')).toBe(false)
      expect(isGiftCodePercentageBps('')).toBe(false)
    })
  })

  describe('isPositiveIrr', () => {
    it('accepts positive bigints and decimal strings', () => {
      expect(isPositiveIrr('1')).toBe(true)
      expect(isPositiveIrr(100n)).toBe(true)
    })
    it('rejects zero, negatives, and junk', () => {
      expect(isPositiveIrr('0')).toBe(false)
      expect(isPositiveIrr('12.5')).toBe(false)
      expect(isPositiveIrr('abc')).toBe(false)
      expect(isPositiveIrr(0n)).toBe(false)
    })
  })

  describe('computeGiftDiscount', () => {
    it('fixed_irr below order amount discounts the full value', () => {
      expect(computeGiftDiscount({
        discountType: 'fixed_irr',
        discountValue: '500000',
        maxCapIrr: null,
        orderAmount: '2000000',
      })).toBe('500000')
    })
    it('fixed_irr never discounts below zero', () => {
      expect(computeGiftDiscount({
        discountType: 'fixed_irr',
        discountValue: '5000000',
        maxCapIrr: null,
        orderAmount: '2000000',
      })).toBe('2000000')
    })
    it('percentage applies bps to the order amount', () => {
      // 25% of 2 000 000 = 500 000
      expect(computeGiftDiscount({
        discountType: 'percentage',
        discountValue: '2500',
        maxCapIrr: '1000000',
        orderAmount: '2000000',
      })).toBe('500000')
    })
    it('percentage is capped at maxCapIrr', () => {
      expect(computeGiftDiscount({
        discountType: 'percentage',
        discountValue: '2500',
        maxCapIrr: '300000',
        orderAmount: '2000000',
      })).toBe('300000')
    })
    it('percentage rounds down (floor) to exact IRR', () => {
      // 12.5% of 1 000 001 = 125 000.125 -> 125 000
      expect(computeGiftDiscount({
        discountType: 'percentage',
        discountValue: '1250',
        maxCapIrr: '10000000',
        orderAmount: '1000001',
      })).toBe('125000')
    })
    it('rejects a missing cap for percentage', () => {
      expect(() =>
        computeGiftDiscount({
          discountType: 'percentage',
          discountValue: '2500',
          maxCapIrr: null,
          orderAmount: '1000000',
        }),
      ).toThrow('max IRR cap')
    })
  })

  describe('validateGiftCodePayload', () => {
    it('accepts a valid fixed_irr payload', () => {
      const result = validateGiftCodePayload({
        discountType: 'fixed_irr',
        discountValue: '500000',
        maxCapIrr: null,
      })
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    })
    it('accepts a valid percentage payload with string basis points and cap', () => {
      const result = validateGiftCodePayload({
        discountType: 'percentage',
        discountValue: '2500',
        maxCapIrr: '1000000',
      })
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    })
    it('requires maxCapIrr for percentage', () => {
      const result = validateGiftCodePayload({
        discountType: 'percentage',
        discountValue: '2500',
        maxCapIrr: null,
      })
      expect(result.ok).toBe(false)
      expect(result.errors.some((e) => e.path === 'maxCapIrr')).toBe(true)
    })
    it('forbids maxCapIrr on fixed_irr', () => {
      const result = validateGiftCodePayload({
        discountType: 'fixed_irr',
        discountValue: '500000',
        maxCapIrr: '100000',
      })
      expect(result.ok).toBe(false)
      expect(result.errors.some((e) => e.path === 'maxCapIrr')).toBe(true)
    })
    it('rejects percentage value outside bps range', () => {
      const result = validateGiftCodePayload({
        discountType: 'percentage',
        discountValue: '15000',
        maxCapIrr: '1000000',
      })
      expect(result.ok).toBe(false)
      expect(result.errors.some((e) => e.path === 'discountValue')).toBe(true)
    })
    it('rejects limits below 1', () => {
      const result = validateGiftCodePayload({
        discountType: 'fixed_irr',
        discountValue: '100000',
        maxCapIrr: null,
        totalLimit: 0,
        perProfileLimit: -1,
      })
      expect(result.ok).toBe(false)
      expect(result.errors.map((e) => e.path).sort()).toEqual(['perProfileLimit', 'totalLimit'])
    })
    it('rejects validUntil at or before validFrom', () => {
      const result = validateGiftCodePayload({
        discountType: 'fixed_irr',
        discountValue: '100000',
        maxCapIrr: null,
        validFrom: '2026-09-01T00:00:00Z',
        validUntil: '2026-09-01T00:00:00Z',
      })
      expect(result.ok).toBe(false)
      expect(result.errors.some((e) => e.path === 'validUntil')).toBe(true)
    })
  })
})
