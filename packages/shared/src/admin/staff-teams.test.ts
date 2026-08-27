import { describe, it, expect } from 'vitest'
import {
  STAFF_ASSIGNMENT_WORK_TYPES,
  STAFF_ASSIGNMENT_STRATEGIES,
  DEFAULT_STAFF_ASSIGNMENT_RULES,
  validateStaffAssignmentRules,
  toStaffAssignmentRules,
  validateStaffTeamInput,
  isValidStaffAssignmentStrategy,
} from './staff-teams.js'

describe('staff assignment rules contract (T-09.08.02)', () => {
  it('defaults every work type to manual assignment', () => {
    expect(DEFAULT_STAFF_ASSIGNMENT_RULES).toEqual({
      ticket: { teamId: null, strategy: 'round_robin' },
      verification_case: { teamId: null, strategy: 'round_robin' },
    })
  })

  it('work types cover exactly the assignable domains today', () => {
    expect([...STAFF_ASSIGNMENT_WORK_TYPES].sort()).toEqual([
      'ticket',
      'verification_case',
    ])
  })

  describe('isValidStaffAssignmentStrategy', () => {
    it('accepts every declared strategy', () => {
      for (const s of STAFF_ASSIGNMENT_STRATEGIES) expect(isValidStaffAssignmentStrategy(s)).toBe(true)
    })
    it('rejects anything else', () => {
      for (const bad of ['', 'manual', 'round-robin', 1, null, undefined]) {
        expect(isValidStaffAssignmentStrategy(bad)).toBe(false)
      }
    })
  })

  describe('validateStaffAssignmentRules', () => {
    it('accepts an empty map (all manual)', () => {
      const result = validateStaffAssignmentRules({})
      expect(result.ok).toBe(true)
    })

    it('accepts a full map with teamId + strategy', () => {
      const result = validateStaffAssignmentRules({
        ticket: { teamId: 'team-1', strategy: 'round_robin' },
        verification_case: { teamId: null, strategy: 'expertise' },
      })
      expect(result.ok).toBe(true)
      expect(result.issues).toEqual([])
    })

    it('rejects unknown work types so typos cannot create dead config', () => {
      const result = validateStaffAssignmentRules({
        ticket: { teamId: 'team-1', strategy: 'round_robin' },
        consultation: { teamId: 'team-2', strategy: 'load' },
      })
      expect(result.ok).toBe(false)
      expect(result.issues.join(' ')).toContain("Unknown work type 'consultation'")
    })

    it('rejects malformed rules (bad teamId type, bad strategy)', () => {
      const result = validateStaffAssignmentRules({
        ticket: { teamId: 42, strategy: 'round_robin' },
        verification_case: { teamId: 'team-1', strategy: 'magic' },
      })
      expect(result.ok).toBe(false)
      expect(result.issues.join(' ')).toContain('ticket teamId must be a string or null')
      expect(result.issues.join(' ')).toContain('verification_case strategy must be one of')
    })

    it('rejects non-object input', () => {
      for (const bad of [null, undefined, 42, 'ticket', ['ticket']]) {
        expect(validateStaffAssignmentRules(bad).ok).toBe(false)
      }
    })
  })

  describe('toStaffAssignmentRules', () => {
    it('fills omitted work types with the manual default', () => {
      const result = toStaffAssignmentRules({ ticket: { teamId: 't-1', strategy: 'load' } })
      expect(result.ticket).toEqual({ teamId: 't-1', strategy: 'load' })
      expect(result.verification_case).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES.verification_case)
    })

    it('degrades corrupt rules per-type without throwing', () => {
      const result = toStaffAssignmentRules({
        ticket: 'garbage',
        verification_case: { teamId: 't-2', strategy: 'garbage' },
      })
      expect(result.ticket).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES.ticket)
      // teamId survives; strategy degrades to the default
      expect(result.verification_case.teamId).toBe('t-2')
      expect(result.verification_case.strategy).toBe('round_robin')
    })

    it('returns the manual default for non-object input', () => {
      expect(toStaffAssignmentRules(null)).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES)
      expect(toStaffAssignmentRules([1])).toEqual(DEFAULT_STAFF_ASSIGNMENT_RULES)
    })
  })
})

describe('staff team input validation (T-09.08.02)', () => {
  it('accepts a valid team', () => {
    const result = validateStaffTeamInput({
      name: 'Billing Support',
      description: 'Handles invoice disputes',
      skillTags: ['billing', 'invoices'],
      memberUserIds: ['u-1', 'u-2'],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects non-object input', () => {
    for (const bad of [null, undefined, 42, 'team', []]) {
      expect(validateStaffTeamInput(bad).ok).toBe(false)
    }
  })

  it('rejects empty / oversized names', () => {
    expect(validateStaffTeamInput({ name: '   ', description: null, skillTags: [], memberUserIds: [] }).ok).toBe(false)
    expect(validateStaffTeamInput({ name: 'x'.repeat(81), description: null, skillTags: [], memberUserIds: [] }).ok).toBe(false)
  })

  it('rejects invalid skill tags (non-string, empty, oversized, duplicates, too many)', () => {
    const base = { name: 'Team', description: null, memberUserIds: [] }
    expect(validateStaffTeamInput({ ...base, skillTags: [1] }).ok).toBe(false)
    expect(validateStaffTeamInput({ ...base, skillTags: ['  '] }).ok).toBe(false)
    expect(validateStaffTeamInput({ ...base, skillTags: ['x'.repeat(41)] }).ok).toBe(false)
    expect(validateStaffTeamInput({ ...base, skillTags: ['a', 'a'] }).ok).toBe(false)
    expect(validateStaffTeamInput({ ...base, skillTags: Array.from({ length: 21 }, (_, i) => `tag${i}`) }).ok).toBe(false)
  })

  it('rejects invalid member lists (non-string, empty, duplicates, too many)', () => {
    const base = { name: 'Team', description: null, skillTags: [] }
    expect(validateStaffTeamInput({ ...base, memberUserIds: [1] }).ok).toBe(false)
    expect(validateStaffTeamInput({ ...base, memberUserIds: ['  '] }).ok).toBe(false)
    expect(validateStaffTeamInput({ ...base, memberUserIds: ['u-1', 'u-1'] }).ok).toBe(false)
    expect(validateStaffTeamInput({ ...base, memberUserIds: Array.from({ length: 201 }, () => 'u') }).ok).toBe(false)
  })

  it('rejects a non-string non-null description', () => {
    expect(validateStaffTeamInput({ name: 'Team', description: 42, skillTags: [], memberUserIds: [] }).ok).toBe(false)
  })
})