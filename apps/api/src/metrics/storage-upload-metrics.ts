import promClient from 'prom-client';
import { storageCircuitMetrics } from '@barghsa/shared/storage';

new promClient.Gauge({
  name: 'barghsa_storage_provider_circuits',
  help: 'Observed object-storage clients by circuit state',
  labelNames: ['state'] as const,
  collect() {
    for (const [state, count] of Object.entries(storageCircuitMetrics().states))
      this.set({ state }, count);
  },
});

new promClient.Counter({
  name: 'barghsa_storage_provider_requests_total',
  help: 'Actual object-storage transport attempts by availability outcome',
  labelNames: ['outcome'] as const,
  collect() {
    this.reset();
    for (const [outcome, count] of Object.entries(storageCircuitMetrics().requests))
      this.inc({ outcome }, count);
  },
});

const verifiedUploadBytes = new promClient.Histogram({
  name: 'barghsa_storage_verified_upload_bytes',
  help: 'Bytes of an inspected upload first recorded or accepted into the scan queue',
  buckets: [
    64 * 1024,
    256 * 1024,
    1024 ** 2,
    5 * 1024 ** 2,
    10 * 1024 ** 2,
    25 * 1024 ** 2,
    50 * 1024 ** 2,
    100 * 1024 ** 2,
  ],
});

export function observeVerifiedUpload(bytes: number): void {
  verifiedUploadBytes.observe(bytes);
}
