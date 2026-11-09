import promClient from 'prom-client';

const lastAnomaly = new promClient.Gauge({
  name: 'payment_callback_last_anomaly_timestamp_seconds',
  help: 'Server time of the most recent signed payment callback anomaly',
  labelNames: ['callback', 'reason'] as const,
});

export function observePaymentCallbackAnomaly(
  callback: 'topup' | 'chargeback',
  reason: 'invalid_signature' | 'stale_timestamp' | 'event_replay'
): void {
  lastAnomaly.setToCurrentTime({ callback, reason });
}
