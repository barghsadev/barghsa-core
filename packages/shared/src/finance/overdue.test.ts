import { describe, it, expect } from 'vitest'
import {
  MARK_OVERDUE_AUDIT_EVENT,
  MARK_OVERDUE_REASON,
  MARK_OVERDUE_TRANSITION,
  OVERDUE_ELIGIBLE_STATES,
  isEligibleForOverdueMark,
  isOverdueEligibleState,
  isPastDueAt,
  parseDueAt,
} from './overdue.js'

const NOW = new Date('2026-08-30T12:00:00.000Z')
const PAST = new Date('2026-08-29T12:00:00.000Z')
const FUTURE = new Date('2026-08-31T12:00:00.000Z')

describe('overdue eligibility (T-04.1.03.04)', () => {
  it('exposes the audit contract the worker writes', () => {
    expect(OVERDUE_ELIGIBLE_STATES).toEqual(['Unpaid', 'PartiallyFunded'])
    expect(MARK_OVERDUE_TRANSITION).toBe('mark_overdue')
    expect(MARK_OVERDUE_AUDIT_EVENT).toBe('invoice.mark_overdue')
    expect(MARK_OVERDUE_REASON).toBe('Marked overdue by cron')
  })

  describe('parseDueAt', () => {
    it('returns a Date instance unchanged when valid', () => {
      expect(parseDueAt(PAST)).toBe(PAST)
    })

    it('parses an ISO string', () => {
      expect(parseDueAt(PAST.toISOString())?.toISOString()).toBe(PAST.toISOString())
    })

    it('returns null for missing or invalid values', () => {
      expect(parseDueAt(null)).toBeNull()
      expect(parseDueAt(undefined)).toBeNull()
      expect(parseDueAt('')).toBeNull()
      expect(parseDueAt('   ')).toBeNull()
      expect(parseDueAt('not-a-date')).toBeNull()
      expect(parseDueAt(new Date('nope'))).toBeNull()
    })
  })

  describe('isPastDueAt', () => {
    it('is true only when dueAt is strictly before now', () => {
      expect(isPastDueAt(PAST, NOW)).toBe(true)
      expect(isPastDueAt(PAST.toISOString(), NOW)).toBe(true)
      expect(isPastDueAt(NOW, NOW)).toBe(false)
      expect(isPastDueAt(FUTURE, NOW)).toBe(false)
    })

    it('is false when dueAt or now is invalid', () => {
      expect(isPastDueAt(null, NOW)).toBe(false)
      expect(isPastDueAt(PAST, new Date('nope'))).toBe(false)
    })
  })

  describe('isOverdueEligibleState', () => {
    it('accepts Unpaid and PartiallyFunded only', () => {
      expect(isOverdueEligibleState('Unpaid')).toBe(true)
      expect(isOverdueEligibleState('PartiallyFunded')).toBe(true)
      for (const state of [
        'Draft',
        'PaymentUnderReview',
        'Paid',
        'Overdue',
        'Cancelled',
        'PartiallyRefunded',
        'Refunded',
      ]) {
        expect(isOverdueEligibleState(state)).toBe(false)
      }
    })
  })

  describe('isEligibleForOverdueMark', () => {
    it('marks Unpaid and PartiallyFunded invoices that are past dueAt', () => {
      expect(isEligibleForOverdueMark('Unpaid', PAST, NOW)).toBe(true)
      expect(isEligibleForOverdueMark('PartiallyFunded', PAST, NOW)).toBe(true)
    })

    it('refuses invoices that are not yet past due or have no dueAt', () => {
      expect(isEligibleForOverdueMark('Unpaid', NOW, NOW)).toBe(false)
      expect(isEligibleForOverdueMark('Unpaid', FUTURE, NOW)).toBe(false)
      expect(isEligibleForOverdueMark('Unpaid', null, NOW)).toBe(false)
      expect(isEligibleForOverdueMark('PartiallyFunded', null, NOW)).toBe(false)
    })

    it('refuses every non-eligible state even when past due', () => {
      for (const state of [
        'Draft',
        'PaymentUnderReview',
        'Paid',
        'Overdue',
        'Cancelled',
        'PartiallyRefunded',
        'Refunded',
      ]) {
        expect(isEligibleForOverdueMark(state, PAST, NOW)).toBe(false)
      }
    })
  })
})
