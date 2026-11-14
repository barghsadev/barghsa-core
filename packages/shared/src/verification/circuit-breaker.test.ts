import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER,
  DEFAULT_RETRY_CONFIG,
  VerificationErrorCodes,
  isVerificationPolicy,
  resolveCircuitBreakerConfig,
} from './index.js';

function pendingResult() {
  let resolve!: (value: number) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<number>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('provider recovery', () => {
  it('publishes the identity verification defaults and stable failure code', () => {
    expect(DEFAULT_CIRCUIT_BREAKER).toEqual({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxProbes: 3,
    });
    expect(DEFAULT_RETRY_CONFIG).toEqual({ maxRetries: 3, baseDelayMs: 200, maxDelayMs: 5_000 });
    expect(VerificationErrorCodes.CIRCUIT_OPEN).toBe('VERIFICATION:CIRCUIT_OPEN');
    expect(isVerificationPolicy(null)).toBe(false);
  });

  it('isolates provider settings and permits their exact upper bounds', () => {
    const env = {
      PAYMENT_GATEWAY_CIRCUIT_FAILURES: ' 100 ',
      PAYMENT_GATEWAY_CIRCUIT_WINDOW_MS: '600000',
      PAYMENT_GATEWAY_CIRCUIT_COOLDOWN_MS: '600000',
      BILL_PROVIDER_CIRCUIT_FAILURES: ' ',
    };
    expect(resolveCircuitBreakerConfig('PAYMENT_GATEWAY', env)).toEqual({
      failureThreshold: 100,
      failureWindowMs: 600_000,
      resetTimeoutMs: 600_000,
      halfOpenMaxProbes: 1,
    });
    for (const provider of ['BILL_PROVIDER', 'STORAGE_PROVIDER'] as const) {
      expect(resolveCircuitBreakerConfig(provider, env)).toEqual({
        failureThreshold: 5,
        failureWindowMs: 60_000,
        resetTimeoutMs: 120_000,
        halfOpenMaxProbes: 1,
      });
    }
  });

  it.each(['0', '-1', '1.5', '101', '9007199254740992'])(
    'rejects an invalid failure threshold (%s)',
    (value) => {
      expect(() =>
        resolveCircuitBreakerConfig('BILL_PROVIDER', { BILL_PROVIDER_CIRCUIT_FAILURES: value })
      ).toThrow('BILL_PROVIDER_CIRCUIT_FAILURES must be a positive integer no greater than 100');
    }
  );

  it('admits one probe after cooldown and reopens on an unsuccessful result', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      failureWindowMs: 10_000,
      resetTimeoutMs: 5_000,
      halfOpenMaxProbes: 1,
    });
    const failed = (status: number) => status >= 500;
    const unavailable = vi.fn(async () => 503);
    expect(await breaker.call(unavailable, failed)).toBe(503);
    expect(breaker.getFailureCount()).toBe(1);
    expect(await breaker.call(unavailable, failed)).toBe(503);
    expect(breaker.isOpen).toBe(true);
    vi.advanceTimersByTime(4_999);
    await expect(breaker.call(unavailable, failed)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(unavailable).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    const insideProbe = pendingResult();
    const probe = vi.fn(() => insideProbe.promise);
    const pending = breaker.call(probe, failed);
    expect(probe).toHaveBeenCalledWith(true);
    expect(breaker.getState()).toBe('HALF_OPEN');
    await expect(breaker.call(unavailable, failed)).rejects.toThrow('half-open probes exhausted');
    expect(unavailable).toHaveBeenCalledTimes(2);
    insideProbe.resolve(503);
    await expect(pending).resolves.toBe(503);
    expect(breaker.isOpen).toBe(true);

    vi.advanceTimersByTime(5_000);
    expect(await breaker.call(async () => 200, failed)).toBe(200);
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('ignores an older rejection while the recovery probe is in flight', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({ ...DEFAULT_CIRCUIT_BREAKER, failureThreshold: 1 });
    const stale = pendingResult();
    const lost = expect(breaker.call(() => stale.promise)).rejects.toThrow('old request failed');
    await expect(
      breaker.call(async () => {
        throw new Error('unavailable');
      })
    ).rejects.toThrow('unavailable');
    vi.advanceTimersByTime(DEFAULT_CIRCUIT_BREAKER.resetTimeoutMs);
    const recovered = pendingResult();
    const probing = breaker.call(() => recovered.promise);
    stale.reject(new Error('old request failed'));
    await lost;
    expect(breaker.getState()).toBe('HALF_OPEN');
    recovered.resolve(200);
    await expect(probing).resolves.toBe(200);
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('expires the oldest counted failure and leaves the threshold untouched by a healthy call', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      ...DEFAULT_CIRCUIT_BREAKER,
      failureThreshold: 2,
      failureWindowMs: 100,
    });
    const fail = async () => {
      throw new Error('upstream failure');
    };
    await expect(breaker.call(fail)).rejects.toThrow('upstream failure');
    vi.advanceTimersByTime(100);
    await expect(breaker.call(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getFailureCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(breaker.getFailureCount()).toBe(0);
    await expect(breaker.call(fail)).rejects.toThrow('upstream failure');
    expect(breaker.isOpen).toBe(false);
    await expect(breaker.call(fail)).rejects.toThrow('upstream failure');
    expect(breaker.getFailureCount()).toBe(2);
    expect(breaker.isOpen).toBe(true);
  });
});
