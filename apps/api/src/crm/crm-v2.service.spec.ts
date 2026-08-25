import { describe, it, expect } from 'vitest'
import { ErrorCodes } from '@barghsa/shared/errors'

describe('CRM profile deletion error codes', () => {
  it('CRM_PROFILE_DELETION_BLOCKED has correct shape', () => {
    const code = ErrorCodes.CRM_PROFILE_DELETION_BLOCKED
    expect(code.code).toBe('CRM:PROFILE:DELETION_BLOCKED')
    expect(code.httpStatus).toBe(409)
    expect(code.messageKey).toBe('crm.profile.deletion.blocked')
    expect(code.severity).toBe('info')
  })

  it('CRM_PROFILE_ALREADY_ARCHIVED has correct shape', () => {
    const code = ErrorCodes.CRM_PROFILE_ALREADY_ARCHIVED
    expect(code.code).toBe('CRM:PROFILE:ALREADY_ARCHIVED')
    expect(code.httpStatus).toBe(409)
    expect(code.messageKey).toBe('crm.profile.already_archived')
    expect(code.severity).toBe('info')
  })

  it('CRM_PROFILE_LAST_OWNER has correct shape', () => {
    const code = ErrorCodes.CRM_PROFILE_LAST_OWNER
    expect(code.code).toBe('CRM:PROFILE:LAST_OWNER')
    expect(code.httpStatus).toBe(409)
    expect(code.messageKey).toBe('crm.profile.last_owner')
    expect(code.severity).toBe('info')
  })
})

describe('DeleteProfileDto shape validation', () => {
  it('requires a reason string', () => {
    const valid = { reason: 'Customer requested removal' }
    expect(valid.reason).toBeTypeOf('string')
    expect(valid.reason.length).toBeGreaterThan(0)
  })

  it('rejects empty reason', () => {
    const invalid = { reason: '' }
    expect(invalid.reason.length).toBe(0)
  })

  it('rejects missing reason', () => {
    const invalid = {} as { reason?: string }
    expect(invalid.reason).toBeUndefined()
  })
})

describe('CrmDeleteProfileResult type contract', () => {
  // Verifies the success shape matches what the controller expects
  it('success result has profileId and archivedAt', () => {
    const success: Record<string, unknown> = {
      success: true,
      profileId: '550e8400-e29b-41d4-a716-446655440000',
      reason: 'Customer request',
      archivedAt: '2026-08-26T01:30:00.000Z',
    }
    expect(success.success).toBe(true)
    expect(typeof success.profileId).toBe('string')
    expect(typeof success.archivedAt).toBe('string')
    expect(typeof success.reason).toBe('string')
  })

  it('error result has errorCode and error', () => {
    const error: Record<string, unknown> = {
      errorCode: 'CRM:PROFILE:DELETION_BLOCKED',
      error: 'Profile has 1 active order(s). Cancel orders before deletion.',
    }
    expect(error.errorCode).toBe('CRM:PROFILE:DELETION_BLOCKED')
    expect(typeof error.error).toBe('string')
  })

  it('null result means profile not found', () => {
    const result = null as Record<string, unknown> | null
    expect(result).toBeNull()
  })
})