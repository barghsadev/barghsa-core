import { describe, it, expect } from 'vitest'
import {
  APPROVAL_ACTION_TYPES,
  APPROVAL_BOUNDS,
  isApprovalActionType,
  isApprovalRequestStatus,
  shouldRequireDualApproval,
  toApprovalRequestInput,
  validateApprovalRequestInput,
} from './approval-request.js'
import { DEFAULT_DUAL_APPROVAL_CONFIG } from './dual-approval-config.js'

describe('approval action types and statuses', () => {
  it('exposes the three financial actions from T-09.07.01', () => {
    expect(APPROVAL_ACTION_TYPES).toEqual([
      'refund',
      'manual_adjustment',
      'bank_payment_confirmation',
    ])
  })

  it('recognizes only known action types', () => {
    expect(isApprovalActionType('refund')).toBe(true)
    expect(isApprovalActionType('manual_adjustment')).toBe(true)
    expect(isApprovalActionType('bank_payment_confirmation')).toBe(true)
    expect(isApprovalActionType('withdrawal')).toBe(false)
    expect(isApprovalActionType(42)).toBe(false)
    expect(isApprovalActionType(null)).toBe(false)
  })

  it('recognizes request statuses but rejects lookalikes', () => {
    expect(isApprovalRequestStatus('pending')).toBe(true)
    expect(isApprovalRequestStatus('approved')).toBe(true)
    expect(isApprovalRequestStatus('rejected')).toBe(true)
    expect(isApprovalRequestStatus('PENDING')).toBe(false)
    expect(isApprovalRequestStatus('in_review')).toBe(false)
  })
})

describe('validateApprovalRequestInput (T-09.07.02)', () => {
  const valid = {
    action_type: 'refund',
    amount_irr: 250_000_000,
    reason: 'Customer overpaid for package 204',
  }

  it('accepts a valid request', () => {
    const result = validateApprovalRequestInput(valid)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('accepts camelCase aliases and optional details', () => {
    const result = validateApprovalRequestInput({
      actionType: 'manual_adjustment',
      amountIrR: 50_000_000,
      reason: 'Rounding correction',
      details: { invoiceId: 'inv-1', relatedWallet: 5 },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a non-object payload', () => {
    for (const bad of [null, undefined, 'refund', 42, []]) {
      const result = validateApprovalRequestInput(bad)
      expect(result.ok).toBe(false)
      expect(result.issues[0]).toContain('object')
    }
  })

  it('rejects an unknown action type', () => {
    const result = validateApprovalRequestInput({ ...valid, action_type: 'transfer' })
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('action_type must be one of')
  })

  it('rejects missing action type', () => {
    const { action_type: _omit, ...rest } = valid
    const result = validateApprovalRequestInput(rest)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('action_type is required')
  })

  it('rejects non-number amounts without coercion, mirroring the threshold validator', () => {
    for (const bad of ['250000000', true, 250_000_000.5, -1, 0, Number.NaN, {}]) {
      const result = validateApprovalRequestInput({ ...valid, amount_irr: bad })
      expect(result.ok).toBe(false)
      expect(result.issues.join(' ')).toContain('amount_irr must be an integer')
    }
  })

  it('rejects missing amount', () => {
    const { amount_irr: _omit, ...rest } = valid
    const result = validateApprovalRequestInput(rest)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('amount_irr is required')
  })

  it('rejects a missing, empty, or overlong reason', () => {
    const missing = { action_type: 'refund', amount_irr: 10_000, reason: '  ' }
    expect(validateApprovalRequestInput(missing).ok).toBe(false)

    const { reason: _omit, ...noReason } = valid
    expect(validateApprovalRequestInput(noReason).ok).toBe(false)

    const overlong = {
      ...valid,
      reason: 'x'.repeat(APPROVAL_BOUNDS.reasonMaxLength + 1),
    }
    const result = validateApprovalRequestInput(overlong)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('reason must not exceed')
  })

  it('rejects non-object details and oversized details payloads', () => {
    const arrayDetails = validateApprovalRequestInput({ ...valid, details: ['a'] })
    expect(arrayDetails.ok).toBe(false)

    const stringDetails = validateApprovalRequestInput({ ...valid, details: 'nope' })
    expect(stringDetails.ok).toBe(false)

    const huge = {
      ...valid,
      details: { pad: 'x'.repeat(APPROVAL_BOUNDS.detailsMaxJsonLength + 10) },
    }
    const result = validateApprovalRequestInput(huge)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('details must not exceed')
  })

  it('accepts null/undefined details', () => {
    expect(validateApprovalRequestInput({ ...valid, details: null }).ok).toBe(true)
    expect(validateApprovalRequestInput({ ...valid, details: undefined }).ok).toBe(true)
  })
})

describe('toApprovalRequestInput', () => {
  it('normalizes snake_case to camelCase', () => {
    expect(
      toApprovalRequestInput({
        action_type: 'bank_payment_confirmation',
        amount_irr: 500_000_000,
        reason: 'Confirm bank transfer',
        details: { bankRef: 'X' },
      }),
    ).toEqual({
      actionType: 'bank_payment_confirmation',
      amountIrR: 500_000_000,
      reason: 'Confirm bank transfer',
      details: { bankRef: 'X' },
    })
  })

  it('degrades malformed values to safe defaults', () => {
    expect(toApprovalRequestInput(null)).toEqual({
      actionType: 'refund',
      amountIrR: 0,
      reason: '',
      details: null,
    })
    expect(toApprovalRequestInput({ action_type: 'bogus', amount_irr: -3 })).toEqual({
      actionType: 'refund',
      amountIrR: 0,
      reason: '',
      details: null,
    })
  })
})

describe('shouldRequireDualApproval (T-09.07.02 routing rule)', () => {
  it('never requires approval when the threshold is 0 (disabled)', () => {
    expect(
      shouldRequireDualApproval(DEFAULT_DUAL_APPROVAL_CONFIG, 999_999_999),
    ).toBe(false)
  })

  it('requires approval only above the configured threshold', () => {
    const config = { thresholdIrR: 100_000_000 }
    expect(shouldRequireDualApproval(config, 100_000_000)).toBe(false) // equal → no
    expect(shouldRequireDualApproval(config, 99_999_999)).toBe(false)
    expect(shouldRequireDualApproval(config, 100_000_001)).toBe(true)
  })

  it('returns false for malformed amounts (callers validate first)', () => {
    const config = { thresholdIrR: 100_000_000 }
    expect(shouldRequireDualApproval(config, '100000001')).toBe(false)
    expect(shouldRequireDualApproval(config, 100_000_000.5)).toBe(false)
    expect(shouldRequireDualApproval(config, 0)).toBe(false)
    expect(shouldRequireDualApproval(config, Number.NaN)).toBe(false)
  })

  it('fails closed on a corrupt threshold (any value is non-routable)', () => {
    const corrupt = { thresholdIrR: -10 } as never
    expect(shouldRequireDualApproval(corrupt, 999_999_999)).toBe(false)
  })
})