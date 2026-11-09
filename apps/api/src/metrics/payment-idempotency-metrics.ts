import promClient from 'prom-client';

const lastConflict = new promClient.Gauge({
  name: 'payment_idempotency_last_conflict_timestamp_seconds',
  help: 'Server time of the most recent reuse of a payment key with different payment data',
  labelNames: ['operation'] as const,
});

export function observePaymentKeyConflict(
  operation: 'online_topup' | 'bank_receipt_topup' | 'wallet_invoice'
): void {
  lastConflict.setToCurrentTime({ operation });
}
