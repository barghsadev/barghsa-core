import { describe, it, expect } from 'vitest'
import { MS_PER_DUE_DAY } from './due-at.js'
import {
  INVOICE_REMINDER_CHANNELS,
  INVOICE_REMINDER_OFFSETS,
  REMINDER_SCHEDULE_ERRORS,
  REMINDER_STOP_STATES,
  addReminderOffset,
  computeReminderInstants,
  isEligibleForReminderSchedule,
  isEligibleForReminderSend,
  isInvoiceReminderOffset,
  isReminderStopState,
  reminderChannelsFromPreferences,
} from './reminder-schedule.js'

const DUE = new Date('2026-09-07T12:00:00.000Z')
const ISSUED = new Date('2026-08-31T12:00:00.000Z')

describe('reminder schedule contract (T-04.1.04.02)', () => {
  it('exposes the S-04.1.04 canonical offsets and channels', () => {
    expect([...INVOICE_REMINDER_OFFSETS]).toEqual([-7, -3, -1, 0, 1, 7])
    expect([...INVOICE_REMINDER_CHANNELS]).toEqual(['in_app', 'email', 'sms'])
    expect([...REMINDER_STOP_STATES]).toEqual(['Paid', 'Cancelled', 'Refunded'])
  })

  describe('addReminderOffset', () => {
    it.each([
      [-7, '2026-08-31T12:00:00.000Z'],
      [-3, '2026-09-04T12:00:00.000Z'],
      [-1, '2026-09-06T12:00:00.000Z'],
      [0, '2026-09-07T12:00:00.000Z'],
      [1, '2026-09-08T12:00:00.000Z'],
      [7, '2026-09-14T12:00:00.000Z'],
    ])('adds %i exact 24-hour days to dueAt → %s', (offset, expected) => {
      expect(addReminderOffset(DUE, offset).toISOString()).toBe(expected)
      expect(addReminderOffset(DUE, offset).getTime() - DUE.getTime()).toBe(
        offset * MS_PER_DUE_DAY,
      )
    })

    it('preserves the dueAt clock time (not calendar-midnight rounding)', () => {
      const odd = new Date('2026-03-20T18:45:30.123Z')
      expect(addReminderOffset(odd, -1).toISOString()).toBe('2026-03-19T18:45:30.123Z')
    })

    it('rejects invalid dueAt or a non-integer offset', () => {
      expect(() => addReminderOffset(new Date('not-a-date'), -7)).toThrow(
        REMINDER_SCHEDULE_ERRORS.BAD_DUE_AT(),
      )
      expect(() => addReminderOffset(DUE, 1.5)).toThrow(REMINDER_SCHEDULE_ERRORS.BAD_OFFSET())
    })
  })

  describe('computeReminderInstants', () => {
    it('returns one instant per canonical offset, dueAt itself at offset 0', () => {
      const planned = computeReminderInstants(DUE)
      expect(planned.map((row) => row.offset)).toEqual([...INVOICE_REMINDER_OFFSETS])
      expect(planned.find((row) => row.offset === 0)?.instant.toISOString()).toBe(
        DUE.toISOString(),
      )
    })
  })

  describe('isInvoiceReminderOffset / isReminderStopState', () => {
    it('accepts only the canonical offset set', () => {
      expect(isInvoiceReminderOffset(-7)).toBe(true)
      expect(isInvoiceReminderOffset(0)).toBe(true)
      expect(isInvoiceReminderOffset(2)).toBe(false)
      expect(isInvoiceReminderOffset(-2)).toBe(false)
    })

    it('accepts only Paid / Cancelled / Refunded as stop states', () => {
      expect(isReminderStopState('Paid')).toBe(true)
      expect(isReminderStopState('Cancelled')).toBe(true)
      expect(isReminderStopState('Refunded')).toBe(true)
      expect(isReminderStopState('Unpaid')).toBe(false)
      expect(isReminderStopState('Overdue')).toBe(false)
    })
  })

  describe('isEligibleForReminderSchedule', () => {
    it('accepts issued Unpaid/Overdue invoices with a dueAt', () => {
      expect(isEligibleForReminderSchedule('Unpaid', ISSUED, DUE)).toBe(true)
      expect(isEligibleForReminderSchedule('Overdue', ISSUED, DUE)).toBe(true)
      expect(isEligibleForReminderSchedule('PartiallyFunded', ISSUED, DUE)).toBe(true)
    })

    it('rejects Draft, stop states, and missing timestamps', () => {
      expect(isEligibleForReminderSchedule('Draft', ISSUED, DUE)).toBe(false)
      expect(isEligibleForReminderSchedule('Paid', ISSUED, DUE)).toBe(false)
      expect(isEligibleForReminderSchedule('Cancelled', ISSUED, DUE)).toBe(false)
      expect(isEligibleForReminderSchedule('Refunded', ISSUED, DUE)).toBe(false)
      expect(isEligibleForReminderSchedule('Unpaid', null, DUE)).toBe(false)
      expect(isEligibleForReminderSchedule('Unpaid', ISSUED, null)).toBe(false)
    })
  })

  describe('isEligibleForReminderSend', () => {
    it('allows Unpaid, Overdue, and in-flight payment states', () => {
      expect(isEligibleForReminderSend('Unpaid')).toBe(true)
      expect(isEligibleForReminderSend('Overdue')).toBe(true)
      expect(isEligibleForReminderSend('PartiallyFunded')).toBe(true)
      expect(isEligibleForReminderSend('PaymentUnderReview')).toBe(true)
      expect(isEligibleForReminderSend('PartiallyRefunded')).toBe(true)
    })

    it('rejects Draft and S-04.1.04 stop states', () => {
      expect(isEligibleForReminderSend('Draft')).toBe(false)
      expect(isEligibleForReminderSend('Paid')).toBe(false)
      expect(isEligibleForReminderSend('Cancelled')).toBe(false)
      expect(isEligibleForReminderSend('Refunded')).toBe(false)
    })
  })

  describe('reminderChannelsFromPreferences', () => {
    it('always includes in_app and adds enabled external channels', () => {
      expect(reminderChannelsFromPreferences('IN_APP')).toEqual(['in_app'])
      expect(reminderChannelsFromPreferences('IN_APP,EMAIL')).toEqual(['in_app', 'email'])
      expect(reminderChannelsFromPreferences('SMS,EMAIL,IN_APP')).toEqual([
        'in_app',
        'email',
        'sms',
      ])
    })

    it('defaults to in_app when preferences are empty or unknown', () => {
      expect(reminderChannelsFromPreferences(null)).toEqual(['in_app'])
      expect(reminderChannelsFromPreferences('')).toEqual(['in_app'])
      expect(reminderChannelsFromPreferences('PAGER')).toEqual(['in_app'])
    })
  })
})
