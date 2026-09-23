import { Injectable } from '@nestjs/common';
import { CircuitBreaker } from '../verification/circuit-breaker.js';

export interface BillVerificationResult {
  source: string;
  status: 'verified' | 'unverified' | 'unavailable' | 'not_configured';
  attemptedAt: string;
  reason?: 'timeout' | 'auth_error' | 'provider_error' | 'circuit_open' | 'invalid_data';
  data?: Record<string, unknown>;
}

/** Deployment-owned adapter. Verification is advisory; an unavailable provider routes to staff. */
@Injectable()
export class BillVerificationProvider {
  private readonly breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 30_000,
    halfOpenMaxProbes: 1,
  });

  async verify(billIdentifier: string): Promise<BillVerificationResult> {
    const attemptedAt = new Date().toISOString();
    const base = process.env.SAVING_BILL_VERIFICATION_URL;
    const token = process.env.SAVING_BILL_VERIFICATION_TOKEN;
    if (!base || !token) return { source: 'none', status: 'not_configured', attemptedAt };
    let url: URL;
    try {
      url = new URL(`/bills/${encodeURIComponent(billIdentifier)}/verify`, base);
      if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
        return {
          source: 'configured_bill_provider',
          status: 'unavailable',
          attemptedAt,
          reason: 'provider_error',
        };
    } catch {
      return {
        source: 'configured_bill_provider',
        status: 'unavailable',
        attemptedAt,
        reason: 'provider_error',
      };
    }
    try {
      return await this.breaker.call(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch(url, {
              headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
              signal: AbortSignal.timeout(2_500),
            });
            if (response.status === 401 || response.status === 403) throw new Error('auth_error');
            if (!response.ok) throw new Error('provider_error');
            const payload: unknown = await response.json();
            if (
              typeof payload !== 'object' ||
              payload === null ||
              typeof (payload as Record<string, unknown>).verified !== 'boolean'
            )
              throw new Error('invalid_data');
            const parsed = payload as Record<string, unknown>;
            return {
              source: 'configured_bill_provider',
              status: parsed.verified ? 'verified' : 'unverified',
              attemptedAt,
              data:
                typeof parsed.data === 'object' &&
                parsed.data !== null &&
                !Array.isArray(parsed.data)
                  ? (parsed.data as Record<string, unknown>)
                  : {},
            } satisfies BillVerificationResult;
          } catch (error) {
            const reason =
              error instanceof Error && error.name === 'TimeoutError'
                ? 'timeout'
                : error instanceof Error
                  ? error.message
                  : 'provider_error';
            if (attempt === 1 || reason === 'auth_error' || reason === 'invalid_data') throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 100 + Math.floor(Math.random() * 100))
            );
          }
        }
        throw new Error('provider_error');
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'provider_error';
      const reason =
        this.breaker.isOpen && message.includes('OPEN')
          ? 'circuit_open'
          : error instanceof Error && error.name === 'TimeoutError'
            ? 'timeout'
            : message === 'auth_error' || message === 'invalid_data'
              ? message
              : 'provider_error';
      return { source: 'configured_bill_provider', status: 'unavailable', attemptedAt, reason };
    }
  }
}
