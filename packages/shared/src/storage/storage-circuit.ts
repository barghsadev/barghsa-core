import type { S3Client } from '@aws-sdk/client-s3';
import {
  CircuitBreaker,
  CircuitOpenError,
  resolveCircuitBreakerConfig,
} from '../verification/circuit-breaker.js';
import { StorageProviderError } from './storage-provider.js';

const circuits = new Set<WeakRef<CircuitBreaker>>();
const requests = { responded: 0, failed: 0 };

export function storageCircuitMetrics() {
  const states = { CLOSED: 0, OPEN: 0, HALF_OPEN: 0 };
  for (const ref of circuits) {
    const circuit = ref.deref();
    if (circuit) states[circuit.getState()]++;
    else circuits.delete(ref);
  }
  return { states, requests: { ...requests } };
}

function unavailable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Guard actual S3 requests, including SDK retries and multipart part requests. */
export function protectStorageTransport(client: S3Client, observe: boolean): () => void {
  const breaker = new CircuitBreaker(resolveCircuitBreakerConfig('STORAGE_PROVIDER'));
  const ref = new WeakRef(breaker);
  const handler = client.config.requestHandler;
  const handle = handler.handle.bind(handler);
  handler.handle = async (request, options) => {
    try {
      return await breaker.call(
        async (halfOpen) => {
          const callerSignal =
            options && 'abortSignal' in options ? options.abortSignal : undefined;
          const deadline = halfOpen ? AbortSignal.timeout(30_000) : undefined;
          const signal =
            deadline && callerSignal instanceof AbortSignal
              ? AbortSignal.any([callerSignal, deadline])
              : (deadline ?? callerSignal);
          if (observe) circuits.add(ref);
          try {
            const result = await handle(request, {
              ...options,
              ...(signal ? { abortSignal: signal } : {}),
            });
            if (observe)
              requests[unavailable(result.response.statusCode) ? 'failed' : 'responded']++;
            return result;
          } catch (error) {
            if (observe) requests.failed++;
            throw error;
          }
        },
        (result) => unavailable(result.response.statusCode)
      );
    } catch (error) {
      if (error instanceof CircuitOpenError)
        throw new StorageProviderError('Object storage is temporarily unavailable', error);
      throw error;
    }
  };
  return () => {
    circuits.delete(ref);
  };
}
