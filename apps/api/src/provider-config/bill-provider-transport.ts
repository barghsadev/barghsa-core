import promClient from 'prom-client';
import { readCappedBytes } from '../storage/read-capped-bytes.js';
import { CircuitBreaker, resolveCircuitBreakerConfig } from '../verification/circuit-breaker.js';

const MAX_BILL_RESPONSE_BYTES = 2 * 1024 * 1024;

const circuitState = new promClient.Gauge({
  name: 'bill_provider_circuit_state',
  help: 'Bill provider circuit state (0 closed, 1 open, 2 half-open)',
  labelNames: ['service'] as const,
});
const operations = new promClient.Counter({
  name: 'bill_provider_operations_total',
  help: 'Admitted bill provider operations by outcome after any retries',
  labelNames: ['service', 'outcome'] as const,
});

export function createBillProviderCircuit(service: 'electricity' | 'saving') {
  const breaker = new CircuitBreaker(resolveCircuitBreakerConfig('BILL_PROVIDER'));
  operations.inc({ service, outcome: 'responded' }, 0);
  operations.inc({ service, outcome: 'failed' }, 0);
  const observeState = () => {
    const state = breaker.getState();
    circuitState.set({ service }, state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2);
  };
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await breaker.call(async () => {
        observeState();
        try {
          const result = await operation();
          operations.inc({ service, outcome: 'responded' });
          return result;
        } catch (error) {
          operations.inc({ service, outcome: 'failed' });
          throw error;
        }
      });
    } finally {
      observeState();
    }
  };
}

export async function fetchBillProviderJson(
  url: URL,
  token: string,
  timeoutMs: number
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) throw new Error('auth_error');
    throw new Error('provider_error');
  }
  if (!response.body) throw new Error('invalid_data');
  const { bytes, truncated } = await readCappedBytes(response.body, MAX_BILL_RESPONSE_BYTES);
  if (truncated) throw new Error('invalid_data');
  return JSON.parse(new TextDecoder().decode(bytes));
}
