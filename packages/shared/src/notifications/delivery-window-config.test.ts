import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DELIVERY_WINDOW,
  DELIVERY_WINDOW_CONFIG_KEY,
  MIN_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
  toDeliveryWindowConfig,
  validateWindowConfig,
  isValidTimeZone,
} from './delivery-window-config.js'

describe('delivery-window configuration contract (T-05.03.03)', () => {
  it('defaults to 09:00–21:00 Asia/Tehran', () => {
    expect(DEFAULT_DELIVERY_WINDOW).toEqual({ timezone: 'Asia/Tehran', startHour: 9, endHour: 21 })
    expect(MIN_WINDOW_HOURS).toBe(4)
    expect(MAX_WINDOW_HOURS).toBe(24)
    expect(DELIVERY_WINDOW_CONFIG_KEY).toBe('notification.delivery_window')
  })

  describe('validateWindowConfig', () => {
    it('accepts a valid window within the same calendar day', () => {
      const r = validateWindowConfig({ timezone: 'Asia/Tehran', start_hour: 9, end_hour: 21 })
      expect(r.ok).toBe(true)
      expect(r.issues).toEqual([])
    })

    it('accepts a 4-hour exactly-minimum window', () => {
      const r = validateWindowConfig({ timezone: 'UTC', start_hour: 8, end_hour: 12 })
      expect(r.ok).toBe(true)
    })

    it('rejects start >= end', () => {
      const r = validateWindowConfig({ timezone: 'UTC', start_hour: 21, end_hour: 9 })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toMatch(/before end/i)
    })

    it('rejects equal start/end', () => {
      const r = validateWindowConfig({ timezone: 'UTC', start_hour: 10, end_hour: 10 })
      expect(r.ok).toBe(false)
    })

    it('rejects a window shorter than 4 hours', () => {
      const r = validateWindowConfig({ timezone: 'UTC', start_hour: 9, end_hour: 11 })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toMatch(/at least 4 hours/i)
    })

    it('rejects hours out of 0–23 range', () => {
      const r = validateWindowConfig({ timezone: 'UTC', start_hour: -1, end_hour: 24 })
      expect(r.ok).toBe(false)
      expect(r.issues.length).toBe(2)
    })

    it('rejects a non-integer hour', () => {
      const r = validateWindowConfig({ timezone: 'UTC', start_hour: 9.5, end_hour: 20 })
      expect(r.ok).toBe(false)
    })

    it('rejects an invalid / empty timezone', () => {
      const r = validateWindowConfig({ timezone: 'Not/AZone', start_hour: 9, end_hour: 20 })
      expect(r.ok).toBe(false)
      expect(r.issues.join(' ')).toMatch(/timezone/i)
    })

    it('rejects non-object input', () => {
      expect(validateWindowConfig(null).ok).toBe(false)
      expect(validateWindowConfig(undefined).ok).toBe(false)
      expect(validateWindowConfig('nope').ok).toBe(false)
    })
  })

  describe('isValidTimeZone', () => {
    it('recognizes real IANA zones', () => {
      expect(isValidTimeZone('Asia/Tehran')).toBe(true)
      expect(isValidTimeZone('UTC')).toBe(true)
      expect(isValidTimeZone('Europe/Berlin')).toBe(true)
    })

    it('rejects unknown zones and empty strings', () => {
      expect(isValidTimeZone('Mars/Olympus')).toBe(false)
      expect(isValidTimeZone('')).toBe(false)
      expect(isValidTimeZone('   ')).toBe(false)
    })
  })

  describe('toDeliveryWindowConfig', () => {
    it('reads snake_case persistence fields', () => {
      expect(toDeliveryWindowConfig({ timezone: 'UTC', start_hour: 8, end_hour: 20 })).toEqual({
        timezone: 'UTC',
        startHour: 8,
        endHour: 20,
      })
    })

    it('reads camelCase as a defensive fallback', () => {
      expect(toDeliveryWindowConfig({ timezone: 'UTC', startHour: 7, endHour: 19 })).toEqual({
        timezone: 'UTC',
        startHour: 7,
        endHour: 19,
      })
    })

    it('falls back to defaults per-field on malformed input', () => {
      expect(toDeliveryWindowConfig(null)).toEqual(DEFAULT_DELIVERY_WINDOW)
      expect(toDeliveryWindowConfig('x')).toEqual(DEFAULT_DELIVERY_WINDOW)
      expect(toDeliveryWindowConfig({ timezone: 'UTC', start_hour: 99, end_hour: -1 })).toEqual({
        timezone: 'UTC',
        startHour: DEFAULT_DELIVERY_WINDOW.startHour,
        endHour: DEFAULT_DELIVERY_WINDOW.endHour,
      })
    })
  })
})
