import { describe, it, expect } from 'vitest'
import { DEFAULT_SERVICE_DUE_DAYS } from './service-due-periods.js'
import {
  DUE_AT_ERRORS,
  MS_PER_DUE_DAY,
  addDueDays,
  duePeriodTypeForManual,
  duePeriodTypeForProduct,
  resolveDueAt,
} from './due-at.js'

const ISSUED = new Date('2026-08-01T10:00:00.000Z')

describe('dueAt calculation (T-04.1.03.02)', () => {
  describe('addDueDays', () => {
    it.each([
      [1, '2026-08-02T10:00:00.000Z'],
      [7, '2026-08-08T10:00:00.000Z'],
      [14, '2026-08-15T10:00:00.000Z'],
      [30, '2026-08-31T10:00:00.000Z'],
      [365, '2027-08-01T10:00:00.000Z'],
    ])('adds %i exact 24-hour days to issuedAt → %s', (days, expected) => {
      expect(addDueDays(ISSUED, days).toISOString()).toBe(expected)
      expect(addDueDays(ISSUED, days).getTime() - ISSUED.getTime()).toBe(
        days * MS_PER_DUE_DAY,
      )
    })

    it('preserves the issuedAt clock time (not calendar-midnight rounding)', () => {
      const odd = new Date('2026-03-20T18:45:30.123Z')
      expect(addDueDays(odd, 3).toISOString()).toBe('2026-03-23T18:45:30.123Z')
    })

    it('rejects invalid issuedAt', () => {
      expect(() => addDueDays(new Date('not-a-date'), 7)).toThrow(DUE_AT_ERRORS.BAD_ISSUED_AT())
      expect(() => addDueDays('2026-08-01T10:00:00.000Z' as unknown as Date, 7)).toThrow(
        DUE_AT_ERRORS.BAD_ISSUED_AT(),
      )
    })

    it('rejects configDays outside the admin 1..365 integer range', () => {
      expect(() => addDueDays(ISSUED, 0)).toThrow(DUE_AT_ERRORS.BAD_CONFIG_DAYS())
      expect(() => addDueDays(ISSUED, 366)).toThrow(DUE_AT_ERRORS.BAD_CONFIG_DAYS())
      expect(() => addDueDays(ISSUED, 7.5)).toThrow(DUE_AT_ERRORS.BAD_CONFIG_DAYS())
      expect(() => addDueDays(ISSUED, -1)).toThrow(DUE_AT_ERRORS.BAD_CONFIG_DAYS())
    })
  })

  describe('resolveDueAt', () => {
    it('uses issuedAt + configDays when no staff override is given', () => {
      const resolved = resolveDueAt({ issuedAt: ISSUED, configDays: 14 })
      expect(resolved.source).toBe('config')
      expect(resolved.configDays).toBe(14)
      expect(resolved.dueAt.toISOString()).toBe('2026-08-15T10:00:00.000Z')
    })

    it('lets a staff override win over configDays', () => {
      const override = new Date('2026-09-01T00:00:00.000Z')
      const resolved = resolveDueAt({
        issuedAt: ISSUED,
        configDays: 7,
        staffOverride: override,
      })
      expect(resolved.source).toBe('staff_override')
      expect(resolved.configDays).toBeNull()
      expect(resolved.dueAt.getTime()).toBe(override.getTime())
    })

    it('falls back to DEFAULT_SERVICE_DUE_DAYS when configDays is absent', () => {
      const resolved = resolveDueAt({ issuedAt: ISSUED })
      expect(resolved.source).toBe('fallback')
      expect(resolved.configDays).toBe(DEFAULT_SERVICE_DUE_DAYS)
      expect(resolved.dueAt.toISOString()).toBe('2026-08-08T10:00:00.000Z')
    })

    it('treats null configDays as fallback (no active period row)', () => {
      const resolved = resolveDueAt({ issuedAt: ISSUED, configDays: null })
      expect(resolved.source).toBe('fallback')
      expect(resolved.configDays).toBe(DEFAULT_SERVICE_DUE_DAYS)
    })

    it('does not consult configDays when a staff override is present', () => {
      const override = new Date('2026-08-03T10:00:00.000Z')
      const resolved = resolveDueAt({
        issuedAt: ISSUED,
        configDays: 365,
        staffOverride: override,
      })
      expect(resolved.source).toBe('staff_override')
      expect(resolved.dueAt.getTime()).toBe(override.getTime())
    })

    it('rejects an invalid staff override', () => {
      expect(() =>
        resolveDueAt({
          issuedAt: ISSUED,
          staffOverride: new Date('nope'),
        }),
      ).toThrow(DUE_AT_ERRORS.BAD_OVERRIDE())
    })
  })

  describe('service-type mapping', () => {
    it('maps product types that match the admin due-period set', () => {
      expect(duePeriodTypeForProduct('electricity')).toBe('electricity')
      expect(duePeriodTypeForProduct('saving_plan')).toBe('saving_plan')
      expect(duePeriodTypeForProduct('consultation')).toBe('consultation')
      expect(duePeriodTypeForProduct('manual')).toBe('manual')
    })

    it('returns null for hardware and unknown product types', () => {
      expect(duePeriodTypeForProduct('hardware')).toBeNull()
      expect(duePeriodTypeForProduct('solar')).toBeNull()
      expect(duePeriodTypeForProduct('savings')).toBeNull()
      expect(duePeriodTypeForProduct('')).toBeNull()
    })

    it('pins manual invoices to the manual due-period type', () => {
      expect(duePeriodTypeForManual()).toBe('manual')
    })
  })
})
