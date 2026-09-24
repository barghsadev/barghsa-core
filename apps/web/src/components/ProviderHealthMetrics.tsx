import { providerText } from '@barghsa/i18n/providers';
import type { ProviderHealthMetrics as Metrics } from '../lib/email-providers-api.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';

export function ProviderHealthMetrics({
  metrics,
  active,
}: {
  metrics: Metrics | undefined;
  active: boolean;
}) {
  const locale = useLocale();
  const time = useAccountTime();
  if (!metrics) return null;
  const label = (key: Parameters<typeof providerText>[0]) => providerText(key, locale);
  const number = new Intl.NumberFormat(locale);
  const milliseconds = (value: number | null) =>
    value === null ? '—' : `${number.format(value)} ms`;
  const rate =
    metrics.attemptCount === 0
      ? '—'
      : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
          metrics.failureCount / metrics.attemptCount
        );
  return (
    <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
      <p className="font-medium">{label('admin.providers.health.lastHour')}</p>
      <p>
        {label('admin.providers.health.attempts')}: {number.format(metrics.attemptCount)}
      </p>
      <p>
        {label('admin.providers.health.failureRate')}: {rate}
      </p>
      <p>
        {label('admin.providers.health.avgLatency')}: {milliseconds(metrics.averageLatencyMs)}
      </p>
      <p>
        {label('admin.providers.health.latencyPercentiles')}:{' '}
        {[metrics.p50LatencyMs, metrics.p95LatencyMs, metrics.p99LatencyMs]
          .map(milliseconds)
          .join(' / ')}
      </p>
      {active && (
        <p>
          {label('admin.providers.health.queueDepth')}: {number.format(metrics.queueDepth)}
        </p>
      )}
      {active && metrics.oldestQueuedAt && (
        <p>
          {label('admin.providers.health.oldestQueued')}: {time.format(metrics.oldestQueuedAt)}
        </p>
      )}
    </div>
  );
}
