import { describe, it, expect } from 'vitest'
import {
  SERVICE_RESPONSE_TARGET_TYPES,
  DEFAULT_SERVICE_RESPONSE_TARGETS,
  MAX_SERVICE_RESPONSE_TARGET_HOURS,
  validateServiceResponseTargets,
  toServiceResponseTargets,
  isValidServiceResponseTargetHours,
} from './service-response-targets.js'

describe('service response targets contract (T-09.08.01)', () => {
  it('defaults every service type to no target (disabled)', () => {
    expect(DEFAULT_SERVICE_RESPONSE_TARGETS).toEqual({
      ticket: null,
      verification_case: null,
    })
  })

  it('catalog covers exactly the domains with open items today', () => {
    expect([...SERVICE_RESPONSE_TARGET_TYPES].sort()).toEqual([
      'ticket',
      'verification_case',
    ])
  })

  describe('isValidServiceResponseTargetHours', () => {
    it('accepts positive safe integers within the range', () => {
      expect(isValidServiceResponseTargetHours(1)).toBe(true)
      expect(isValidServiceResponseTargetHours(48)).toBe(true)
      expect(isValidServiceResponseTargetHours(MAX_SERVICE_RESPONSE_TARGET_HOURS)).toBe(true)
    })

    it('rejects null, zero, negatives, floats, strings, and booleans', () => {
      expect(isValidServiceResponseTargetHours(null)).toBe(false)
      expect(isValidServiceResponseTargetHours(0)).toBe(false)
      expect(isValidServiceResponseTargetHours(-1)).toBe(false)
      expect(isValidServiceResponseTargetHours(1.5)).toBe(false)
      expect(isValidServiceResponseTargetHours('48')).toBe(false)
      expect(isValidServiceResponseTargetHours(true)).toBe(false)
      expect(isValidServiceResponseTargetHours(MAX_SERVICE_RESPONSE_TARGET_HOURS + 1)).toBe(false)
    })
  })

  describe('validateServiceResponseTargets', () => {
    it('accepts an empty map (all disabled)', () => {
      const result = validateServiceResponseTargets({})
      expect(result.ok).toBe(true)
    })

    it('accepts a full map with valid integer targets and nulls', () => {
      const result = validateServiceResponseTargets({
        ticket: 48,
        verification_case: null,
      })
      expect(result.ok).toBe(true)
      expect(result.issues).toEqual([])
    })

    it('rejects unknown service types so typos cannot create dead config', () => {
      const result = validateServiceResponseTargets({
        ticket: 48,
        consultation: 24,
      })
      expect(result.ok).toBe(false)
      expect(result.issues.join(' ')).toContain("Unknown service type 'consultation'")
    })

    it('rejects non-object input', () => {
      for (const bad of [null, undefined, 42, 'ticket', [48]]) {
        const result = validateServiceResponseTargets(bad)
        expect(result.ok).toBe(false)
      }
    })

    it('rejects zero, negatives, floats, and out-of-range values', () => {
      for (const bad of [0, -1, 1.5, MAX_SERVICE_RESPONSE_TARGET_HOURS + 1]) {
        const result = validateServiceResponseTargets({ ticket: bad })
        expect(result.ok).toBe(false)
        expect(result.issues.join(' ')).toContain('ticket target must be')
      }
    })
  })

  describe('toServiceResponseTargets', () => {
    it('preserves valid integers and fills omitted types with null', () => {
      expect(toServiceResponseTargets({ ticket: 48 })).toEqual({
        ticket: 48,
        verification_case: null,
      })
    })

    it('degrades malformed values per-type to null instead of throwing', () => {
      expect(
        toServiceResponseTargets({
          ticket: 'soon',
          verification_case: 24,
        }),
      ).toEqual({
        ticket: null,
        verification_case: 24,
      })
    })

    it('is the corruption-tolerant read-path normalizer for stored values', () => {
      // A stored map parses as-is when valid…
      expect(toServiceResponseTargets({ ticket: 48, verification_case: 72 })).toEqual({
        ticket: 48,
        verification_case: 72,
      })
      // …and degrades every malformed type to disabled, never throwing.
      expect(toServiceResponseTargets(null)).toEqual(DEFAULT_SERVICE_RESPONSE_TARGETS)
      expect(toServiceResponseTargets('corrupt')).toEqual(DEFAULT_SERVICE_RESPONSE_TARGETS)
      expect(toServiceResponseTargets([48])).toEqual(DEFAULT_SERVICE_RESPONSE_TARGETS)
      // A stored zero must never mean "alert everything immediately" — it
      // degrades to null (disabled) exactly like any other corrupt value.
      expect(toServiceResponseTargets({ ticket: 0 })).toEqual({
        ticket: null,
        verification_case: null,
      })
    })
  })
})
