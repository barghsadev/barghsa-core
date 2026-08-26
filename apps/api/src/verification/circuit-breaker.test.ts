import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CircuitBreaker } from './circuit-breaker.js'

describe('CircuitBreaker', () => {
  const config = { failureThreshold: 3, resetTimeoutMs: 1_000, halfOpenMaxProbes: 2 }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker(config)
    expect(cb.getState()).toBe('CLOSED')
    expect(cb.isOpen).toBe(false)
  })

  it('passes calls through when closed', async () => {
    const cb = new CircuitBreaker(config)
    const result = await cb.call(() => Promise.resolve('ok'))
    expect(result).toBe('ok')
  })

  it('opens after exceeding failure threshold', async () => {
    const cb = new CircuitBreaker(config)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail')
    }

    expect(cb.getState()).toBe('OPEN')
    expect(cb.isOpen).toBe(true)
  })

  it('rejects calls when open', async () => {
    const cb = new CircuitBreaker(config)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail')
    }

    // Now it should reject immediately with circuit breaker error
    await expect(cb.call(fn)).rejects.toThrow('Circuit breaker is OPEN')
    expect(fn).toHaveBeenCalledTimes(3) // No new calls
  })

  it('transitions to HALF_OPEN after reset timeout', async () => {
    const cb = new CircuitBreaker(config)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail')
    }

    // Advance time past the reset timeout
    vi.advanceTimersByTime(1_500)

    // Should now be HALF_OPEN — probe will be attempted
    // The mock still rejects, so it goes back to OPEN
    // But first we need to assert that the call was attempted
    const halfOpenFn = vi.fn().mockRejectedValue(new Error('still failing'))
    await expect(cb.call(halfOpenFn)).rejects.toThrow('still failing')
    expect(halfOpenFn).toHaveBeenCalledTimes(1) // Probe was sent
  })

  it('closes circuit after successful half-open probe', async () => {
    const cb = new CircuitBreaker(config)
    const failFn = vi.fn().mockRejectedValue(new Error('fail'))

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(failFn)).rejects.toThrow('fail')
    }

    expect(cb.getState()).toBe('OPEN')

    // Advance time past the reset timeout
    vi.advanceTimersByTime(1_500)

    // Successful probe should close the circuit
    const successFn = vi.fn().mockResolvedValue('recovered')
    const result = await cb.call(successFn)
    expect(result).toBe('recovered')
    expect(cb.getState()).toBe('CLOSED')
    expect(cb.isOpen).toBe(false)
  })

  it('tracks failure count', async () => {
    const cb = new CircuitBreaker(config)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    await expect(cb.call(fn)).rejects.toThrow('fail')
    expect(cb.getFailureCount()).toBe(1)

    await expect(cb.call(fn)).rejects.toThrow('fail')
    expect(cb.getFailureCount()).toBe(2)
  })

  it('can be manually reset', async () => {
    const cb = new CircuitBreaker(config)
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail')
    }

    expect(cb.getState()).toBe('OPEN')

    cb.reset()

    expect(cb.getState()).toBe('CLOSED')
    expect(cb.getFailureCount()).toBe(0)
  })
})