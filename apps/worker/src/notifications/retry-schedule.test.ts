import { describe, it, expect } from 'vitest'
import {
  RETRY_DELAYS_MS,
  DEFAULT_MAX_ATTEMPTS,
  JITTER_RATIO,
  nextRetryDelayMs,
  nextRetryAt,
  jitter,
  exponentialDelayMs,
  maxAttemptsForType,
  priorityForType,
} from './retry-schedule.js'

/**
 * Retry schedule tests (E-05, T-05.01.03).
 *
 * Verifies the bounded retry ladder (1min → 5min → 30min → 2hr → final),
 * the ±20% jitter bounds, and the per-type max_attempts / priority registry.
 */

describe('nextRetryDelayMs', () => {
  it('applies the exact retry ladder 1min → 5min → 30min → 2hr', () => {
    const rng = () => 0.5 // mid value → jitter factor 1.0, returns base exactly
    expect(nextRetryDelayMs(1, 5, rng)).toBe(RETRY_DELAYS_MS[0]) // 1 min
    expect(nextRetryDelayMs(2, 5, rng)).toBe(RETRY_DELAYS_MS[1]) // 5 min
    expect(nextRetryDelayMs(3, 5, rng)).toBe(RETRY_DELAYS_MS[2]) // 30 min
    expect(nextRetryDelayMs(4, 5, rng)).toBe(RETRY_DELAYS_MS[3]) // 2 hr
  })

  it('never exceeds the 2hr cap and stays positive under jitter', () => {
    const max = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!
    for (let attempt = 1; attempt <= 4; attempt++) {
      const delay = nextRetryDelayMs(attempt, 5, Math.random)!
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(max * 1.2) // ladder cap ± jitter
    }
  })

  it('returns null once the attempt budget is exhausted', () => {
    const rng = () => 0.5
    // After 5 completed attempts with maxAttempts=5 there is nothing left.
    expect(nextRetryDelayMs(5, 5, rng)).toBeNull()
    expect(nextRetryDelayMs(6, 5, rng)).toBeNull()
  })

  it('respects a per-type max_attempts budget', () => {
    const rng = () => 0.5
    // auth.otp_sent has maxAttempts=3 → exhausted after 3 completed attempts.
    expect(nextRetryDelayMs(2, maxAttemptsForType('auth.otp_sent'), rng)).not.toBeNull()
    expect(nextRetryDelayMs(3, maxAttemptsForType('auth.otp_sent'), rng)).toBeNull()
  })
})

describe('jitter', () => {
  it('keeps the delay within ±20% of the base', () => {
    const base = 60_000
    const low = jitter(base, JITTER_RATIO, () => 0) // min → -20%
    const high = jitter(base, JITTER_RATIO, () => 1) // max → +20%
    const mid = jitter(base, JITTER_RATIO, () => 0.5)
    expect(low).toBeCloseTo(base * 0.8, 6)
    expect(high).toBeCloseTo(base * 1.2, 6)
    expect(mid).toBeCloseTo(base, 6)
    // Every sampled value stays inside the bounds.
    for (let i = 0; i < 100; i++) {
      const v = jitter(base, JITTER_RATIO, Math.random)
      expect(v).toBeGreaterThanOrEqual(base * 0.8)
      expect(v).toBeLessThanOrEqual(base * 1.2)
    }
  })
})

describe('nextRetryAt', () => {
  it('returns a future timestamp for a retry-eligible attempt', () => {
    const from = new Date('2026-08-27T00:00:00Z')
    const at = nextRetryAt(1, 5, from, () => 0.5)
    expect(at).not.toBeNull()
    expect(at!.getTime()).toBeGreaterThan(from.getTime())
  })

  it('returns null once exhausted', () => {
    const from = new Date('2026-08-27T00:00:00Z')
    expect(nextRetryAt(5, 5, from, () => 0.5)).toBeNull()
  })
})

describe('exponentialDelayMs', () => {
  it('widens each retry interval but respects the ladder', () => {
    const a2 = exponentialDelayMs(2)
    const a3 = exponentialDelayMs(3)
    // Monotonic widening up to the cap.
    expect(a3).toBeGreaterThan(a2)
    expect(a2).toBeGreaterThan(exponentialDelayMs(1))
  })
})

describe('per-type registry', () => {
  it('resolves max_attempts per event key, falling back to the default', () => {
    expect(maxAttemptsForType('auth.otp_sent')).toBe(3)
    expect(maxAttemptsForType('unknown_event')).toBe(DEFAULT_MAX_ATTEMPTS)
  })

  it('derives urgent priority from immediate classification and normal otherwise', () => {
    // immediate classification → urgent (security/OTP, payment, refund, cancellation)
    expect(priorityForType('auth.otp_sent')).toBe('urgent')
    expect(priorityForType('auth.new_device_login')).toBe('urgent')
    expect(priorityForType('payment.invoice_paid')).toBe('urgent')
    expect(priorityForType('payment.bank_receipt_rejected')).toBe('urgent')
    expect(priorityForType('contract.cancelled')).toBe('urgent')
    // daytime classification → normal
    expect(priorityForType('contract.created')).toBe('normal')
    expect(priorityForType('order.submitted')).toBe('normal')
    expect(priorityForType('unknown')).toBe('normal')
  })
})
