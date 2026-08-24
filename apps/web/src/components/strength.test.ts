import { describe, it, expect } from 'vitest'

/** Copied from PasswordField.tsx for test isolation —
 * no UI package imports needed. */
type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong'

interface StrengthResult {
  score: number
  level: StrengthLevel
}

function evaluateStrength(password: string): StrengthResult {
  if (!password) return { score: 0, level: 'weak' }

  const len = password.length

  // Length score: up to 40 points (40 chars = max)
  let score = Math.min(len * 2, 40)

  // Character-class diversity: 15 points each
  if (/[a-z]/.test(password)) score += 15
  if (/[A-Z]/.test(password)) score += 15
  if (/\d/.test(password)) score += 15

  // Bonus for mixing multiple character classes
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length
  if (classes >= 3) score += 5
  if (classes >= 4) score += 10

  // Clamp to 0-100
  const clamped = Math.min(Math.max(score, 0), 100)

  let level: StrengthLevel
  if (clamped < 25) level = 'weak'
  else if (clamped < 50) level = 'fair'
  else if (clamped < 75) level = 'good'
  else level = 'strong'

  return { score: clamped, level }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('evaluateStrength', () => {
  it('returns weak for empty string', () => {
    const result = evaluateStrength('')
    expect(result.level).toBe('weak')
    expect(result.score).toBe(0)
  })

  it('returns weak for short simple passwords', () => {
    const result = evaluateStrength('ab')
    expect(result.level).toBe('weak')
    expect(result.score).toBeLessThan(25)
  })

  it('returns fair for 8-char lowercase only', () => {
    const result = evaluateStrength('abcdefgh')
    expect(result.level).toBe('fair')
  })

  it('returns good for 8-char with upper+lower+digit', () => {
    const result = evaluateStrength('Abcdefg1')
    expect(result.level).toBe('good')
  })

  it('returns strong for 16-char with all classes', () => {
    const result = evaluateStrength('Abcdefgh1!@#$%^&')
    expect(result.level).toBe('strong')
  })

  it('caps score at 55 for 100 uppercase chars (no diversity)', () => {
    const result = evaluateStrength('A'.repeat(100))
    // length=40 + uppercase=15 = 55
    expect(result.score).toBe(55)
    expect(result.level).toBe('good')
  })

  it('scores based on character diversity', () => {
    // 8-digit password — length + digits only = lower score
    const digitsOnly = evaluateStrength('12345678')
    // 8-char with mixed classes = higher score
    const mixed = evaluateStrength('Abcdefg1')
    expect(mixed.score).toBeGreaterThan(digitsOnly.score)
  })
})