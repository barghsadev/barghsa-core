import { randomUUID } from 'node:crypto';
import type { DatabaseMetrics } from '@barghsa/db';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';

export interface DatabaseTelemetrySnapshot {
  metrics: DatabaseMetrics | null;
  replicationLag: number | null;
}
interface Descriptor {
  name: string;
  unit: string;
  counter?: boolean;
  value: (snapshot: DatabaseTelemetrySnapshot) => number | null;
}
const descriptors: Descriptor[] = [
  { name: 'postgresql.collection.success', unit: '1', value: (s) => (s.metrics ? 1 : 0) },
  {
    name: 'postgresql.connections.active',
    unit: '{connection}',
    value: (s) => s.metrics?.activeConnections ?? null,
  },
  {
    name: 'postgresql.connections.idle_in_transaction',
    unit: '{connection}',
    value: (s) => s.metrics?.idleInTransaction ?? null,
  },
  {
    name: 'postgresql.connections.waiting',
    unit: '{connection}',
    value: (s) => s.metrics?.waitingConnections ?? null,
  },
  {
    name: 'postgresql.connections.saturation',
    unit: '1',
    value: (s) => s.metrics?.connectionSaturation ?? null,
  },
  { name: 'postgresql.cache.hit_ratio', unit: '1', value: (s) => s.metrics?.cacheHitRatio ?? null },
  {
    name: 'postgresql.cache.hits',
    unit: '{block}',
    counter: true,
    value: (s) => s.metrics?.database.blks_hit ?? null,
  },
  {
    name: 'postgresql.cache.reads',
    unit: '{block}',
    counter: true,
    value: (s) => s.metrics?.database.blks_read ?? null,
  },
  {
    name: 'postgresql.query.calls',
    unit: '{query}',
    counter: true,
    value: (s) => s.metrics?.queryCalls ?? null,
  },
  {
    name: 'postgresql.queries.long_running',
    unit: '{query}',
    value: (s) => s.metrics?.longRunningQueries.length ?? null,
  },
  {
    name: 'postgresql.replication.lag',
    unit: 's',
    value: (s) => (s.metrics ? s.replicationLag : null),
  },
  {
    name: 'postgresql.deadlocks',
    unit: '{deadlock}',
    counter: true,
    value: (s) => s.metrics?.database.deadlocks ?? null,
  },
  {
    name: 'postgresql.transactions.committed',
    unit: '{transaction}',
    counter: true,
    value: (s) => s.metrics?.database.xact_commit ?? null,
  },
  {
    name: 'postgresql.transactions.rolled_back',
    unit: '{transaction}',
    counter: true,
    value: (s) => s.metrics?.database.xact_rollback ?? null,
  },
  {
    name: 'postgresql.tuples.returned',
    unit: '{tuple}',
    counter: true,
    value: (s) => s.metrics?.database.tup_returned ?? null,
  },
  {
    name: 'postgresql.tuples.fetched',
    unit: '{tuple}',
    counter: true,
    value: (s) => s.metrics?.database.tup_fetched ?? null,
  },
  {
    name: 'postgresql.scans.sequential',
    unit: '{scan}',
    counter: true,
    value: (s) => s.metrics?.tableScans?.sequential ?? null,
  },
  {
    name: 'postgresql.scans.index',
    unit: '{scan}',
    counter: true,
    value: (s) => s.metrics?.tableScans?.index ?? null,
  },
];

/** A private provider avoids replacing any application-wide OpenTelemetry SDK. */
export function createDatabaseTelemetry(
  getSnapshot: () => DatabaseTelemetrySnapshot,
  options: { endpoint?: string; intervalMs?: number; timeoutMs?: number } = {}
): MeterProvider | null {
  const endpoint = (options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT)?.trim();
  if (!endpoint) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Invalid OTLP metrics endpoint');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid OTLP metrics protocol');
  const intervalMs =
    options.intervalMs ?? Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || '15000');
  const timeoutMs = options.timeoutMs ?? Number(process.env.OTEL_METRIC_EXPORT_TIMEOUT || '5000');
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < 1000 ||
    intervalMs > 300000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 15000 ||
    timeoutMs > intervalMs
  ) {
    throw new Error('Invalid OTLP metrics timing');
  }
  const observed = new Set<string>();
  const exporter = new OTLPMetricExporter({
    url: url.toString(),
    timeoutMillis: timeoutMs,
    concurrencyLimit: 1,
  });
  // The SDK retains cumulative observations. Only export instruments observed in
  // this collection, so unknown data cannot become a fresh copy of an old value.
  const currentOnly: PushMetricExporter = {
    export(data, callback) {
      exporter.export(
        {
          ...data,
          scopeMetrics: data.scopeMetrics.map((scope) => ({
            ...scope,
            metrics:
              scope.scope.name === 'barghsa.postgresql'
                ? scope.metrics.filter((metric) => observed.has(metric.descriptor.name))
                : scope.metrics,
          })),
        },
        callback
      );
    },
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown(),
    selectAggregationTemporality: (type) => exporter.selectAggregationTemporality(type),
    selectAggregation: (type) => exporter.selectAggregation(type),
  };
  const reader = new PeriodicExportingMetricReader({
    exporter: currentOnly,
    exportIntervalMillis: intervalMs,
    exportTimeoutMillis: timeoutMs,
  });
  const provider = new MeterProvider({
    readers: [reader],
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME?.trim() || 'barghsa-api',
      'service.instance.id': randomUUID(),
    }),
  });
  const meter = provider.getMeter('barghsa.postgresql', '1.0.0');
  const instruments = descriptors.map((descriptor) => ({
    ...descriptor,
    instrument: descriptor.counter
      ? meter.createObservableCounter(descriptor.name, { unit: descriptor.unit })
      : meter.createObservableGauge(descriptor.name, { unit: descriptor.unit }),
  }));
  meter.addBatchObservableCallback(
    (result) => {
      observed.clear();
      let snapshot: DatabaseTelemetrySnapshot;
      try {
        snapshot = getSnapshot();
      } catch {
        snapshot = { metrics: null, replicationLag: null };
      }
      for (const descriptor of instruments) {
        const value = descriptor.value(snapshot);
        if (value !== null && Number.isFinite(value) && value >= 0) {
          observed.add(descriptor.name);
          result.observe(descriptor.instrument, value);
        }
      }
    },
    instruments.map(({ instrument }) => instrument)
  );
  return provider;
}
