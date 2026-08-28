import { describe, it, expect } from 'vitest'
import {
  ESCALATION_POLICY_CONFIG_KEY,
  DEFAULT_ESCALATION_POLICIES,
  ESCALATION_CHANNELS,
  isValidEscalationDelayHours,
  isValidEscalationChannels,
  validateEscalationPolicies,
  toEscalationPolicies,
} from './escalation-policy.js'

/**
 * Escalation policy contract tests (S-09.08, T-09.08.03).
 *
 * Covers the config shape the admin API must enforce and the worker
 * escalation scan must consume: opt-in per service type, per-level delays,
 * and per-level channel sets (in-app mandatory, email optional).
 */

describe('escalation-policy defaults & keys', () => {
  it('uses the admin.escalation_policy app_config key', () => {
    expect(ESCALATION_POLICY_CONFIG_KEY).toBe('admin.escalation_policy')
  })

  it('defaults every service type to escalation disabled', () => {
    expect(DEFAULT_ESCALATION_POLICIES).toEqual({ ticket: null, verification_case: null })
  })

  it('exposes only in-app and email as escalation channels', () => {
    expect(ESCALATION_CHANNELS).toEqual(['in_app', 'email'])
  })
})

describe('isValidEscalationDelayHours', () => {
  it('accepts positive integers within the 1..8760 bound', () => {
    expect(isValidEscalationDelayHours(1)).toBe(true)
    expect(isValidEscalationDelayHours(48)).toBe(true)
    expect(isValidEscalationDelayHours(8760)).toBe(true)
  })

  it('accepts null (level disabled)', () => {
    expect(isValidEscalationDelayHours(null)).toBe(false) // null is handled separately
  })

  it('rejects non-positive, fractional, string and oversized values', () => {
    expect(isValidEscalationDelayHours(0)).toBe(false)
    expect(isValidEscalationDelayHours(-3)).toBe(false)
    expect(isValidEscalationDelayHours(48.5)).toBe(false)
    expect(isValidEscalationDelayHours('48')).toBe(false)
    expect(isValidEscalationDelayHours(8761)).toBe(false)
    expect(isValidEscalationDelayHours(NaN)).toBe(false)
  })
})

describe('isValidEscalationChannels', () => {
  it('requires a non-empty array that includes in_app', () => {
    expect(isValidEscalationChannels(['in_app'])).toBe(true)
    expect(isValidEscalationChannels(['in_app', 'email'])).toBe(true)
  })

  it('rejects missing in_app, empty, unknown, or non-array channel sets', () => {
    expect(isValidEscalationChannels([])).toBe(false)
    expect(isValidEscalationChannels(['email'])).toBe(false)
    expect(isValidEscalationChannels(['in_app', 'sms'])).toBe(false)
    expect(isValidEscalationChannels(['in_app', 'bogus'])).toBe(false)
    expect(isValidEscalationChannels('in_app')).toBe(false)
    expect(isValidEscalationChannels(null)).toBe(false)
  })
})

describe('validateEscalationPolicies', () => {
  it('accepts a fully specified per-type policy', () => {
    const input = {
      ticket: {
        level2: { delayHours: 24, channels: ['in_app', 'email'] },
        level3: { delayHours: 48, channels: ['in_app'] },
      },
      verification_case: null,
    }
    expect(validateEscalationPolicies(input).ok).toBe(true)
  })

  it('accepts a partial map — omitted types are valid (disabled)', () => {
    const input = {
      ticket: {
        level2: { delayHours: 24, channels: ['in_app'] },
        // Disable level 3 via a null delay, keeping the object shape.
        level3: { delayHours: null, channels: ['in_app'] },
      },
    }
    expect(validateEscalationPolicies(input).ok).toBe(true)
    expect(validateEscalationPolicies({}).ok).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(validateEscalationPolicies(null).ok).toBe(false)
    expect(validateEscalationPolicies([]).ok).toBe(false)
    expect(validateEscalationPolicies('nope').ok).toBe(false)
  })

  it('rejects unknown service types so a typo cannot create dead config', () => {
    const input = { consultation: { level2: { delayHours: 24, channels: ['in_app'] } } }
    const result = validateEscalationPolicies(input)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.includes("Unknown service type 'consultation'"))).toBe(true)
  })

  it('rejects a type whose value is not an object or null', () => {
    expect(validateEscalationPolicies({ ticket: 'escalate!' }).ok).toBe(false)
    expect(validateEscalationPolicies({ ticket: 42 }).ok).toBe(false)
  })

  it('rejects a level with an invalid delayHours', () => {
    const input = { ticket: { level2: { delayHours: 0, channels: ['in_app'] }, level3: { delayHours: 24, channels: ['in_app'] } } }
    const result = validateEscalationPolicies(input)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.includes('ticket level2 delayHours'))).toBe(true)
  })

  it('rejects a level with missing/unknown channels', () => {
    const input = { ticket: { level2: { delayHours: 24, channels: [] }, level3: { delayHours: 24, channels: ['email'] } } }
    const result = validateEscalationPolicies(input)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.includes('ticket level2 channels'))).toBe(true)
    expect(result.issues.some((i) => i.includes('ticket level3 channels'))).toBe(true)
  })

  it('collects issues across both levels and unknown keys', () => {
    const input = {
      bogusType: 1,
      ticket: { level2: { delayHours: 0, channels: ['sms'] } },
    }
    const result = validateEscalationPolicies(input)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThanOrEqual(3)
  })
})

describe('toEscalationPolicies', () => {
  it('normalizes a full policy, preserving levels and channels', () => {
    const input = {
      ticket: {
        level2: { delayHours: 24, channels: ['in_app', 'email'] },
        level3: { delayHours: 48, channels: ['in_app'] },
      },
      verification_case: null,
    }
    const result = toEscalationPolicies(input)
    expect(result).toEqual(input)
  })

  it('turns omitted types into null (disabled)', () => {
    const result = toEscalationPolicies({ ticket: { level2: { delayHours: 12, channels: ['in_app'] }, level3: { delayHours: 24, channels: ['in_app'] } } })
    expect(result.verification_case).toBeNull()
    expect(result.ticket?.level2.delayHours).toBe(12)
  })

  it('degrades corrupt types to disabled and corrupt levels to defaults', () => {
    const result = toEscalationPolicies({
      ticket: 'corrupt',
      verification_case: {
        level2: { delayHours: 'later', channels: ['sms'] },
        level3: { delayHours: 24, channels: ['email'] },
      },
    })
    // Corrupt whole type → disabled (null).
    expect(result.ticket).toBeNull()
    // Corrupt level2 → defaults (null delay, ['in_app']); level3 keeps its
    // valid 24h delay but its ['email']-only channels degrade to ['in_app']
    // because in_app is mandatory for delivery.
    expect(result.verification_case?.level2).toEqual({ delayHours: null, channels: ['in_app'] })
    expect(result.verification_case?.level3).toEqual({ delayHours: 24, channels: ['in_app'] })
  })

  it('returns all-disabled defaults for non-object input', () => {
    expect(toEscalationPolicies(null)).toEqual(DEFAULT_ESCALATION_POLICIES)
    expect(toEscalationPolicies('x')).toEqual(DEFAULT_ESCALATION_POLICIES)
    expect(toEscalationPolicies([])).toEqual(DEFAULT_ESCALATION_POLICIES)
  })
})