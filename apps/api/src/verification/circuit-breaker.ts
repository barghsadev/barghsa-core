/**
 * A simple circuit breaker implementation for protecting external API calls.
 *
 * States:
 * - CLOSED: Normal operation — calls pass through.
 * - OPEN: Too many failures — calls are rejected immediately.
 * - HALF_OPEN: After the reset timeout, a single probe is allowed through
 *   to test if the service has recovered.
 *
 * Thread-safety note: This is designed for a single-threaded Node.js
 * event-loop context. No locking is needed.
 */
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  private failureCount = 0
  private lastFailureTime = 0
  private halfOpenProbes = 0

  constructor(
    private readonly config: {
      failureThreshold: number
      resetTimeoutMs: number
      halfOpenMaxProbes: number
    },
  ) {}

  /**
   * Execute a call through the circuit breaker.
   * Returns the result or throws if the circuit is open.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.assertClosed()
    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  /** Whether the circuit is currently open (rejecting calls). */
  get isOpen(): boolean {
    return this.state === 'OPEN'
  }

  /** Current state for observability. */
  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state
  }

  /** Current failure count. */
  getFailureCount(): number {
    return this.failureCount
  }

  /** Reset the circuit breaker to its initial closed state. */
  reset(): void {
    this.state = 'CLOSED'
    this.failureCount = 0
    this.halfOpenProbes = 0
  }

  private assertClosed(): void {
    if (this.state === 'CLOSED') return

    const now = Date.now()

    if (this.state === 'OPEN') {
      // Check if the reset timeout has elapsed
      if (now - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = 'HALF_OPEN'
        this.halfOpenProbes = 0
      } else {
        throw new Error('Circuit breaker is OPEN')
      }
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenProbes >= this.config.halfOpenMaxProbes) {
        throw new Error('Circuit breaker is OPEN (half-open probes exhausted)')
      }
      this.halfOpenProbes++
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      // A successful probe closes the circuit
      this.state = 'CLOSED'
      this.failureCount = 0
      this.halfOpenProbes = 0
    }
  }

  private onFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN'
    }
  }
}