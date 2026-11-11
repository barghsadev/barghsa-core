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
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private recentFailures: number[] = [];
  private lastFailureTime = 0;
  private halfOpenProbes = 0;
  private generation = 0;

  constructor(
    private readonly config: {
      failureThreshold: number;
      resetTimeoutMs: number;
      halfOpenMaxProbes: number;
      failureWindowMs?: number;
    }
  ) {}

  /**
   * Execute a call through the circuit breaker.
   * Returns the result or throws if the circuit is open.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.assertClosed();
    const generation = this.generation;
    try {
      const result = await fn();
      if (generation === this.generation && this.state === 'HALF_OPEN') this.reset();
      return result;
    } catch (error) {
      if (generation === this.generation) this.onFailure();
      throw error;
    }
  }

  /** Whether the circuit is currently open (rejecting calls). */
  get isOpen(): boolean {
    return this.state === 'OPEN';
  }

  /** Current state for observability. */
  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state;
  }

  /** Current failure count. */
  getFailureCount(): number {
    if (this.state === 'CLOSED' && this.config.failureWindowMs !== undefined) {
      this.expireFailures(Date.now());
      return this.recentFailures.length;
    }
    return this.failureCount;
  }

  /** Reset the circuit breaker to its initial closed state. */
  reset(): void {
    this.generation++;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.recentFailures = [];
    this.halfOpenProbes = 0;
  }

  private assertClosed(): void {
    if (this.state === 'CLOSED') return;

    const now = Date.now();

    if (this.state === 'OPEN') {
      // Check if the reset timeout has elapsed
      if (now - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenProbes = 0;
      } else {
        throw new CircuitOpenError('Circuit breaker is OPEN');
      }
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenProbes >= this.config.halfOpenMaxProbes) {
        throw new CircuitOpenError('Circuit breaker is OPEN (half-open probes exhausted)');
      }
      this.halfOpenProbes++;
    }
  }

  private expireFailures(now: number): void {
    const window = this.config.failureWindowMs;
    if (window !== undefined)
      this.recentFailures = this.recentFailures.filter((at) => at >= now - window);
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    if (this.config.failureWindowMs !== undefined) {
      this.expireFailures(this.lastFailureTime);
      this.recentFailures.push(this.lastFailureTime);
      this.failureCount = this.recentFailures.length;
    } else {
      this.failureCount++;
    }

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
      this.generation++;
    }
  }
}

export class CircuitOpenError extends Error {}
