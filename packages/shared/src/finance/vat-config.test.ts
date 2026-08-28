import { describe, it, expect } from 'vitest'
import {
  CHARGE_CATEGORIES,
  isChargeCategory,
  isValidVatBasisPoints,
  MAX_VAT_BASIS_POINTS,
  MIN_VAT_BASIS_POINTS,
  vatBasisPointsToPercent,
  vatPercentToBasisPoints,
  resolveVatRate,
  vatWindowStatus,
  type VatResolution,
} from './vat-config.js'

describe('VAT shared contract (T-09.12.02)', () => {
  describe('basis point validation (0 <= rate <= 100%)', () => {
    it('accepts 0, 10000, and everything between', () => {
      expect(isValidVatBasisPoints(0)).toBe(true)
      expect(isValidVatBasisPoints(900)).toBe(true)
      expect(isValidVatBasisPoints(10_000)).toBe(true)
    })

    it('rejects out-of-range, fractional, and non-number values', () => {
      expect(isValidVatBasisPoints(-1)).toBe(false)
      expect(isValidVatBasisPoints(10_001)).toBe(false)
      expect(isValidVatBasisPoints(9.5)).toBe(false)
      expect(isValidVatBasisPoints('900')).toBe(false)
      expect(isValidVatBasisPoints(null)).toBe(false)
      expect(isValidVatBasisPoints(undefined)).toBe(false)
      expect(isValidVatBasisPoints(NaN)).toBe(false)
    })

    it('pins the basis-point bounds as constants', () => {
      expect(MIN_VAT_BASIS_POINTS).toBe(0)
      expect(MAX_VAT_BASIS_POINTS).toBe(10_000)
    })
  })

  describe('basis point <-> percent conversion', () => {
    it('converts bps to percent (900 -> 9)', () => {
      expect(vatBasisPointsToPercent(900)).toBe(9)
      expect(vatBasisPointsToPercent(0)).toBe(0)
      expect(vatBasisPointsToPercent(10_000)).toBe(100)
    })

    it('converts percent to bps (9 -> 900)', () => {
      expect(vatPercentToBasisPoints(9)).toBe(900)
      expect(vatPercentToBasisPoints(0)).toBe(0)
      expect(vatPercentToBasisPoints(0.5)).toBe(50)
      expect(vatPercentToBasisPoints(100)).toBe(10_000)
    })
  })

  describe('charge category keys', () => {
    it('exposes the canonical category set', () => {
      expect(CHARGE_CATEGORIES).toContain('consultation')
      expect(CHARGE_CATEGORIES).toContain('electricity')
      expect(CHARGE_CATEGORIES).toContain('hardware')
      expect(CHARGE_CATEGORIES).toContain('saving_plan')
      expect(CHARGE_CATEGORIES).toContain('thermal_electricity')
      expect(CHARGE_CATEGORIES).toContain('green_electricity')
    })

    it('recognizes known keys and rejects unknown/empty ones', () => {
      expect(isChargeCategory('electricity')).toBe(true)
      expect(isChargeCategory('thermal_electricity')).toBe(true)
      expect(isChargeCategory('vat_on_moon_shuttles')).toBe(false)
      expect(isChargeCategory('')).toBe(false)
      expect(isChargeCategory(42)).toBe(false)
    })
  })

  describe('resolution rules (override > category > 0%)', () => {
    it('uses the product override when one is active', () => {
      const result = resolveVatRate(500, 900)
      expect(result).toEqual<VatResolution>({ rateBasisPoints: 500, source: 'product_override' })
    })

    it('falls back to the category default when no override is active', () => {
      const result = resolveVatRate(null, 900)
      expect(result).toEqual<VatResolution>({ rateBasisPoints: 900, source: 'category' })
    })

    it('resolves to 0% when neither applies', () => {
      const result = resolveVatRate(null, null)
      expect(result).toEqual<VatResolution>({ rateBasisPoints: 0, source: 'fallback_zero' })
    })

    it('a zero-rate override still wins over a non-zero category rate', () => {
      const result = resolveVatRate(0, 900)
      expect(result).toEqual<VatResolution>({ rateBasisPoints: 0, source: 'product_override' })
    })
  })

  describe('effective-window status derivation', () => {
    const now = new Date('2026-08-28T12:00:00Z')

    it('marks an open window that started in the past as current', () => {
      expect(vatWindowStatus('2026-01-01T00:00:00Z', null, now)).toBe('current')
    })

    it('marks a future effective date as scheduled', () => {
      expect(vatWindowStatus('2026-12-01T00:00:00Z', null, now)).toBe('scheduled')
    })

    it('marks an ended window as expired', () => {
      expect(vatWindowStatus('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z', now)).toBe('expired')
    })

    it('a window ending exactly at `at` is expired (exclusive until)', () => {
      expect(vatWindowStatus('2026-01-01T00:00:00Z', '2026-08-28T12:00:00Z', now)).toBe('expired')
    })

    it('a window ending after `at` is current', () => {
      expect(vatWindowStatus('2026-01-01T00:00:00Z', '2026-12-01T00:00:00Z', now)).toBe('current')
    })
  })
})