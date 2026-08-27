import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DUAL_APPROVAL_CONFIG,
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  validateDualApprovalConfig,
  toDualApprovalConfig,
} from './dual-approval-config.js'

// ─── Contract constants ──────────────────────────────────────────────

describe('dual-approval-config contract constants (T-09.07.01)', () => {
  it('disables dual approval by default (threshold 0)', () => {
    expect(DEFAULT_DUAL_APPROVAL_CONFIG).toEqual({ thresholdIrR: 0 })
  })

  it('stores under the finance.dual_approval_threshold app_config key', () => {
    expect(DUAL_APPROVAL_THRESHOLD_CONFIG_KEY).toBe('finance.dual_approval_threshold')
  })
})

// ─── Tests — validateDualApprovalConfig ──────────────────────────────

describe('validateDualApprovalConfig (T-09.07.01)', () => {
  it('accepts a positive integer threshold', () => {
    expect(validateDualApprovalConfig({ threshold_irr: 500_000_000 })).toEqual({
      ok: true,
      issues: [],
    })
  })

  it('accepts zero (dual approval disabled)', () => {
    expect(validateDualApprovalConfig({ threshold_irr: 0 })).toEqual({ ok: true, issues: [] })
  })

  it('accepts the camelCase alias', () => {
    expect(validateDualApprovalConfig({ thresholdIrR: 100_000 })).toEqual({ ok: true, issues: [] })
  })

  it('rejects a missing threshold', () => {
    const result = validateDualApprovalConfig({})
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toContain('required')
  })

  it('rejects a non-object input', () => {
    expect(validateDualApprovalConfig(null).ok).toBe(false)
    expect(validateDualApprovalConfig(42).ok).toBe(false)
  })

  it('rejects a negative threshold', () => {
    const result = validateDualApprovalConfig({ threshold_irr: -1 })
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toContain('between 0')
  })

  it('rejects a fractional threshold', () => {
    expect(validateDualApprovalConfig({ threshold_irr: 1.5 }).ok).toBe(false)
  })

  it('rejects a non-numeric threshold', () => {
    expect(validateDualApprovalConfig({ threshold_irr: 'abc' }).ok).toBe(false)
  })

  it('rejects coercible non-number payloads instead of silently accepting them', () => {
    // Number(true) === 1, Number([]) === 0, Number(['5']) === 5,
    // Number('500000000') === 500000000 — none of these may pass.
    expect(validateDualApprovalConfig({ threshold_irr: true }).ok).toBe(false)
    expect(validateDualApprovalConfig({ threshold_irr: false }).ok).toBe(false)
    expect(validateDualApprovalConfig({ threshold_irr: [] }).ok).toBe(false)
    expect(validateDualApprovalConfig({ threshold_irr: ['5'] }).ok).toBe(false)
    expect(validateDualApprovalConfig({ threshold_irr: '500000000' }).ok).toBe(false)
    expect(validateDualApprovalConfig({ threshold_irr: {} }).ok).toBe(false)
  })

  it('rejects a threshold above Number.MAX_SAFE_INTEGER', () => {
    expect(validateDualApprovalConfig({ threshold_irr: Number.MAX_SAFE_INTEGER + 1 }).ok).toBe(
      false,
    )
  })
})

// ─── Tests — toDualApprovalConfig ────────────────────────────────────

describe('toDualApprovalConfig (T-09.07.01)', () => {
  it('maps a snake_case input to the camelCase config', () => {
    expect(toDualApprovalConfig({ threshold_irr: 750_000_000 })).toEqual({
      thresholdIrR: 750_000_000,
    })
  })

  it('falls back to the default on malformed input', () => {
    expect(toDualApprovalConfig(null)).toEqual(DEFAULT_DUAL_APPROVAL_CONFIG)
    expect(toDualApprovalConfig({ threshold_irr: 'nope' })).toEqual(DEFAULT_DUAL_APPROVAL_CONFIG)
    expect(toDualApprovalConfig({ threshold_irr: -5 })).toEqual(DEFAULT_DUAL_APPROVAL_CONFIG)
    expect(toDualApprovalConfig({ threshold_irr: true })).toEqual(DEFAULT_DUAL_APPROVAL_CONFIG)
    expect(toDualApprovalConfig({ threshold_irr: ['500000000'] })).toEqual(
      DEFAULT_DUAL_APPROVAL_CONFIG,
    )
  })
})
