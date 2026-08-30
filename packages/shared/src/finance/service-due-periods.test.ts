import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SERVICE_DUE_DAYS,
  MAX_SERVICE_DUE_DAYS,
  MIN_SERVICE_DUE_DAYS,
  SERVICE_DUE_PERIOD_TYPES,
  isServiceDuePeriodType,
  isValidDefaultDueDays,
  serviceDuePeriodWindowStatus,
} from './service-due-periods.js'

describe('service due-period shared contract (T-04.1.03.01)', () => {
  describe('service types (S-04.1.03)', () => {
    it('exposes electricity, saving_plan, consultation, and manual', () => {
      expect([...SERVICE_DUE_PERIOD_TYPES]).toEqual([
        'electricity',
        'saving_plan',
        'consultation',
        'manual',
      ])
    })

    it('recognizes known keys and rejects unknown/empty ones', () => {
      expect(isServiceDuePeriodType('electricity')).toBe(true)
      expect(isServiceDuePeriodType('saving_plan')).toBe(true)
      expect(isServiceDuePeriodType('consultation')).toBe(true)
      expect(isServiceDuePeriodType('manual')).toBe(true)
      expect(isServiceDuePeriodType('hardware')).toBe(false)
      expect(isServiceDuePeriodType('saving plan')).toBe(false)
      expect(isServiceDuePeriodType('')).toBe(false)
      expect(isServiceDuePeriodType(7)).toBe(false)
    })
  })

  describe('default due days', () => {
    it('pins the 7-day issuance fallback and 1..365 bounds', () => {
      expect(DEFAULT_SERVICE_DUE_DAYS).toBe(7)
      expect(MIN_SERVICE_DUE_DAYS).toBe(1)
      expect(MAX_SERVICE_DUE_DAYS).toBe(365)
    })

    it('accepts integers in 1..365 inclusive', () => {
      expect(isValidDefaultDueDays(1)).toBe(true)
      expect(isValidDefaultDueDays(7)).toBe(true)
      expect(isValidDefaultDueDays(365)).toBe(true)
    })

    it('rejects out-of-range, fractional, and non-number values', () => {
      expect(isValidDefaultDueDays(0)).toBe(false)
      expect(isValidDefaultDueDays(366)).toBe(false)
      expect(isValidDefaultDueDays(-1)).toBe(false)
      expect(isValidDefaultDueDays(7.5)).toBe(false)
      expect(isValidDefaultDueDays('7')).toBe(false)
      expect(isValidDefaultDueDays(null)).toBe(false)
      expect(isValidDefaultDueDays(undefined)).toBe(false)
      expect(isValidDefaultDueDays(NaN)).toBe(false)
    })
  })

  describe('window status', () => {
    const at = new Date('2026-06-15T00:00:00.000Z')

    it('marks a future window as scheduled', () => {
      expect(
        serviceDuePeriodWindowStatus(
          '2026-07-01T00:00:00.000Z',
          null,
          at,
        ),
      ).toBe('scheduled')
    })

    it('marks an open window that already started as current', () => {
      expect(
        serviceDuePeriodWindowStatus(
          '2026-01-01T00:00:00.000Z',
          null,
          at,
        ),
      ).toBe('current')
    })

    it('marks a closed window whose exclusive end has arrived as expired', () => {
      expect(
        serviceDuePeriodWindowStatus(
          '2026-01-01T00:00:00.000Z',
          '2026-06-15T00:00:00.000Z',
          at,
        ),
      ).toBe('expired')
    })

    it('keeps a window current until the exclusive until instant', () => {
      expect(
        serviceDuePeriodWindowStatus(
          '2026-01-01T00:00:00.000Z',
          '2026-06-16T00:00:00.000Z',
          at,
        ),
      ).toBe('current')
    })
  })
})
