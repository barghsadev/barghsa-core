# PostgreSQL monitoring

The API collects PostgreSQL 16 and 17 database, connection, checkpoint, WAL, query and scan statistics. `/metrics` exposes Prometheus samples. Database collection failures set `pg_metrics_collection_success` to zero and remove stale samples. Optional views have `pg_metrics_view_available` labels; unavailable replication lag is not reported as zero.

Each API process also reports `pg_pool_capacity`, `pg_pool_connections` by active or idle state, and `pg_pool_waiting_requests`. Sum the connection states for the current pool size. Active counts all non-idle clients, including clients still connecting. The application takes this snapshot before it queries database statistics, and returns it even if statistics collection fails. `pg_waiting_connections` separately counts PostgreSQL sessions waiting on locks.

Application `slow_query` and `query_timeout` warnings carry the measured duration or configured timeout in milliseconds. Use the private `pg_stat_statements` query IDs for statement-level investigation.

Profile exports admit up to two active job leases per database across worker replicas. A short PostgreSQL transaction serializes export claims and releases its lock before the export reads data or writes objects. Jobs above the limit stay queued until capacity opens. Expired leases remain eligible for the existing recovery path.

The deadline wrapper queues each timeout setting beside its statement through `pg` 8. The driver warns that overlapping `client.query()` calls will be removed in `pg` 9. The upgrade needs a replacement for that queue behavior and a fresh run of the PostgreSQL cancellation tests.

The staging Prometheus configuration scrapes the API on `barghsa-staging-api-1:4000` and the worker on `barghsa-staging-worker-1:9090` over the private network. After loading it, verify both targets are `up` on the loopback Prometheus endpoint. Check `pg_metrics_collection_success` separately to distinguish a reachable endpoint from successful database statistics collection.

To compare database behavior with API traffic, use `barghsa_http_request_duration_seconds_count` for completed responses and `barghsa_http_request_duration_seconds_bucket` for latency. Apply `rate(...[5m])` to the count and filter `status=~"[45].."` for errors by route and status. Estimate p50, p95 and p99 by using `histogram_quantile` with `0.50`, `0.95` or `0.99` over `sum by (le, route) (rate(barghsa_http_request_duration_seconds_bucket[5m]))`. Scope dashboard queries to the intended environment and database.

The API labels requests with the registered route template, HTTP method and response status. Early rejections and unknown routes use `unmatched`. The histogram excludes the health probes and only counts responses the API finished writing. Monitor ingress separately for client disconnects and proxy errors.

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

The database role used by the collector must have effective `pg_read_all_stats` privileges, directly or through `pg_monitor`. The application does not grant this role. Without it, PostgreSQL hides fields from other sessions; the collector reports failure instead of treating those fields as zero activity. A database administrator must configure the intended monitoring role before claiming complete statistics.

The collector distinguishes an absent extension from an empty query list. It reads the current server version on each poll. PostgreSQL 16 checkpoint statistics come from `pg_stat_bgwriter`, and query I/O timings use `blk_read_time` and `blk_write_time`. PostgreSQL 17 uses `pg_stat_checkpointer`, `shared_blk_read_time` and `shared_blk_write_time`. A failed version read reports collection failure.

After setup, confirm `pg_metrics_view_available{view="statements"}` is `1` and the private scrape reports `pg_top_query_duration_seconds` after ordinary queries run. Preloading alone does not install the extension in the monitored database.

`postgres-config/alert-rules.json` defines collection-failure, lag, slow-query, saturation, lock and deadlock rules. Load these into your monitoring stack and exercise delivery before claiming operational readiness. Query throughput in Prometheus can use `rate(pg_query_calls_total[5m])`. Statistics resets and pg_stat_statements entry eviction affect these counters. Scan counts are available as `pg_sequential_scans_total` and `pg_index_scans_total`.

## Verification scope

Local tests cover checkpoints and query timings on PostgreSQL 16 and 17 with pg_stat_statements, plus PostgreSQL 17 without the extension. Existing API evidence covers scrape outage/recovery, OTLP payloads received by a local HTTP collector, rejected-export recovery, and omission of stale observations. Replica aggregation is tested with controlled PostgreSQL rows, not live streaming replicas. Production collector connectivity, alert delivery, host sizing and load baselines need separate execution evidence.

References: [OpenTelemetry JavaScript exporters](https://opentelemetry.io/docs/languages/js/exporters/), [PostgreSQL 17 statistics](https://www.postgresql.org/docs/17/monitoring-stats.html), [pg_stat_statements](https://www.postgresql.org/docs/17/pgstatstatements.html).
