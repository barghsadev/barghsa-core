export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxProbes: number;
  failureWindowMs?: number;
}

export function resolveCircuitBreakerConfig(
  provider: 'PAYMENT_GATEWAY' | 'BILL_PROVIDER',
  env: NodeJS.ProcessEnv = process.env
): CircuitBreakerConfig {
  const positiveInteger = (setting: string, fallback: number, maximum: number): number => {
    const name = `${provider}_CIRCUIT_${setting}`;
    const value = env[name]?.trim();
    if (!value) return fallback;
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
    }
    return parsed;
  };
  return {
    failureThreshold: positiveInteger('FAILURES', 5, 100),
    failureWindowMs: positiveInteger('WINDOW_MS', 60_000, 600_000),
    resetTimeoutMs: positiveInteger('COOLDOWN_MS', 120_000, 600_000),
    halfOpenMaxProbes: 1,
  };
}

/** In-process breaker. Open circuits reject until the cooldown admits recovery probes. */
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private recentFailures: number[] = [];
  private lastFailureTime = 0;
  private halfOpenProbes = 0;
  private generation = 0;

  constructor(private readonly config: CircuitBreakerConfig) {}

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
