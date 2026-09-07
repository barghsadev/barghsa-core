# PostgreSQL monitoring

The API collects PostgreSQL 17 database, connection, checkpoint, WAL, query and scan statistics. `/metrics` exposes Prometheus samples. Database collection failures set `pg_metrics_collection_success` to zero and remove stale samples. Optional views have `pg_metrics_view_available` labels; unavailable replication lag is not reported as zero.

## OpenTelemetry export

Set these values in the API's external runtime environment file to enable OTLP/HTTP JSON export to your collector:

```dotenv
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://otel-collector:4318/v1/metrics
OTEL_METRIC_EXPORT_INTERVAL=15000
OTEL_METRIC_EXPORT_TIMEOUT=5000
OTEL_SERVICE_NAME=barghsa-api
```

The metrics endpoint must be a complete HTTP(S) URL. Without it, no OTLP exporter is created. Export intervals accept 1,000 to 300,000 ms; timeouts accept 100 to 15,000 ms and cannot exceed the interval. Invalid enabled configuration fails startup. The standard OTLP metrics/generic header environment settings are handled by the exporter. Keep credentials in the external runtime file.

The private MeterProvider uses scope `barghsa.postgresql`, a service name and a generated instance ID. It does not replace a global SDK. It exports aggregate numbers only, including active/idle/waiting connections, saturation, query calls, cache hits/reads and ratio, replica lag, deadlocks, transactions, tuples and sequential/index scans. It does not export SQL text, query IDs or customer identifiers. Counters retain their PostgreSQL meaning; derive query throughput from `postgresql.query.calls` in the collector/backend. Missing samples are filtered before export because the SDK may retain prior cumulative observations. Shutdown waits for the active poll and closes the exporter with a bounded deadline.

The existing Prometheus endpoint remains available during collector failure. Export is best effort; it is not a durable event-delivery channel.

## Database and alert setup

`postgres-config/barghsa-postgres.conf` contains the development memory settings, I/O timing and `shared_preload_libraries = 'pg_stat_statements'`. Size production memory settings against the actual host. Once the extension is preloaded, enable it in the monitored database:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

The collector distinguishes an absent extension from an empty query list. PostgreSQL 17 checkpoint statistics come from `pg_stat_checkpointer`; shared query I/O timings use `shared_blk_read_time` and `shared_blk_write_time`.

`postgres-config/alert-rules.json` defines collection-failure, lag, slow-query, saturation, lock and deadlock rules. Load these into your monitoring stack and exercise delivery before claiming operational readiness. Query throughput in Prometheus can use `rate(pg_query_calls_total[5m])`. Statistics resets and pg_stat_statements entry eviction affect these counters. Scan counts are available as `pg_sequential_scans_total` and `pg_index_scans_total`.

## Verification scope

Local tests cover PostgreSQL 17 with and without pg_stat_statements, actual API scrape outage/recovery, OTLP payloads received by a local HTTP collector, rejected-export recovery, and omission of stale observations. Replica aggregation is tested with controlled PostgreSQL rows, not live streaming replicas. Production collector connectivity, alert delivery, host sizing and load baselines need separate execution evidence.

References: [OpenTelemetry JavaScript exporters](https://opentelemetry.io/docs/languages/js/exporters/), [PostgreSQL 17 statistics](https://www.postgresql.org/docs/17/monitoring-stats.html), [pg_stat_statements](https://www.postgresql.org/docs/17/pgstatstatements.html).
