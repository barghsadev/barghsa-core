# Structured operator logs

The API, background worker, inference process and database pool use Pino to
write one JSON record per line. The static web server and edge proxy use the
same core fields with their existing runtime log destinations.
API and worker error and fatal records use stderr. Database pool diagnostics
retain their existing stdout destination.

Every record carries `timestamp`, `level`, `service`, `environment` and
`correlationId`. API request outcomes include the registered route template,
status and duration. Worker delivery outcomes use the persisted originating
correlation ID when present. A legacy job uses the current poll's correlation
ID, or a generated ID outside a poll. IDs from different polls remain
independent. The proxy uses a validated upstream ID where available and its
generated request ID for requests that end at the edge.

`BARGHSA_DEPLOYMENT_ENV` determines the application diagnostic threshold.
Development emits debug and above, staging emits info and above, and
production emits warnings and errors. Proxy access records include successful
requests so status and latency remain available for operations. Database pool
warnings retain their existing production runtime policy.

Search the API and worker records by the response's `X-Correlation-ID`. Query
parameters, raw request paths, credentials, provider responses and SQL text
are excluded from request and delivery diagnostics. The API records an actor
reference only when an authenticated identity is available, using the existing
keyed pseudonym. Keep detailed protected audit history in the audit ledger.

Verify the final staging candidate by matching one request's response ID to
its API and edge records and a queued delivery to its worker record. Confirm
the configured external log sink receives those same structured records and
apply the approved retention policy there.

## Loki log shipping

Use `deploy/monitoring/operator-log-shipping.yml` with the verified Alloy
image and an approved Loki service on a dedicated internal Docker network.
Set `BARGHSA_LOKI_NETWORK` to that network and give Loki the `loki` alias.
Check network membership before starting Alloy and keep the push endpoint
off published host ports.

For API, worker, inference and web, set the four `BARGHSA_*_LOG_DIRECTORY`
values to the parent directories of the active containers' Docker `LogPath`
values. Confirm the `json-file` driver. Set `BARGHSA_EDGE_LOG_DIRECTORY` to
the authorized NGINX access log directory. The agent reads `access.log` there.
After a release, update any replaced container paths and recreate Alloy with
the same positions volume. The agent mounts the selected directories read-only.

Alloy accepts structured operator records, keeps validated route templates,
request and trace IDs, pseudonymous references and outcome fields, and removes
free-form messages and fields outside its allowlist. Use `service`,
`environment`, `level` and `origin` as Loki labels. Filter a correlation ID
from the JSON record after selecting the stream. Verify one API request and
one worker delivery in Loki and check `loki_write_sent_entries_total` and
`loki_write_dropped_entries_total` on Alloy. [Alloy Loki write metrics](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.write/#debug-metrics).

### Search and archive retention

Use `deploy/monitoring/operator-log-retention.yml` for a new dedicated Loki
instance with an approved immutable `BARGHSA_LOKI_IMAGE`. Its private data
volume holds the TSDB index, chunks and compactor state. The singleton
compactor retains 30 days of searchable records and waits two hours before
deleting marked chunks. Check the internal network and restrict its members
to approved shippers, archive jobs and query clients. Keep the volume across
container replacement. The configuration preserves the four shipped labels
and disables Loki's generated service and level fields. For an existing Loki
instance, preserve its schema history and rehearse the retention change and
archive compatibility with any previously generated labels before applying it.
[Loki retention](https://grafana.com/docs/loki/latest/operations/storage/retention/).

Use `deploy/monitoring/operator-log-archive.yml` with the verified immutable
backup helper image and a dedicated S3 bucket outside the Loki host. Configure
the image, private Loki network, storage class, archive environment file and
passphrase file in `/etc/barghsa/operator-log-archive.compose.env`. Use
`BARGHSA_LOG_ARCHIVE_IMAGE`, `BARGHSA_LOKI_NETWORK`,
`BARGHSA_LOG_ARCHIVE_STORAGE_CLASS`, `BARGHSA_LOG_ARCHIVE_ENV_FILE` and
`BARGHSA_LOG_ARCHIVE_GPG_FILE` for those settings. Give UID 10001 read access
to the passphrase file. Keep that key and the protected environment file
separate from database and configuration backup credentials.

Set `BACKUP_CLUSTER_ID` to `staging` or `production` in the archive environment
file. Supply the dedicated bucket, HTTPS endpoint and least-privilege S3
credentials as `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY`
and `BACKUP_S3_SECRET_KEY`. Limit write and read access to the environment's
`operator-logs/<environment>/daily/` prefix. Require conditional writes and
deny deletes to the archive job. Apply the approved archive expiration and
key retention policy to this bucket. Select a tier that supports immediate
readback, such as `GLACIER_IR` where supported. The archive job needs no
access to the canonical security, finance or audit ledgers.
[S3 storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html).

Install the checked-in `barghsa-operator-log-archive` service and timer after
placing the monitoring files at `/opt/barghsa/monitoring`. At 02:15 UTC the
timer archives the day eight calendar days earlier. Loki refuses arrivals
older than seven days, so that UTC day has closed to late arrivals. The job
checks the complete range, seals a gzip JSONL file with the dedicated key,
writes it conditionally and verifies its decrypted bytes from the bucket.
Replaying a day succeeds only if the stored archive matches. The success
receipt includes the UTC day, record count and SHA-256. A file may contain
zero records for a quiet day. Investigate gaps and zero counts against Loki
and shipper health before relying on the archive.

Check the timer receipt and expected object after each scheduled run. After
an outage, pass each missing UTC date explicitly to `archive` while the full
day is still searchable. Resolve any failed or conflicting receipt before
the 30-day cutoff. The default daily archive size bound is 64 MiB compressed.
Check observed volume before activation and investigate a bound failure
while the affected range is still searchable.

Restore into a private operator directory with the approved credential and
key. The restore command reads from the bucket while Loki is offline.

```sh
umask 077
docker compose --env-file /etc/barghsa/operator-log-archive.compose.env \
  -f /opt/barghsa/monitoring/operator-log-archive.yml \
  run --rm -T --no-deps archive restore 2026-11-01 > operator-logs.jsonl.gz
gzip -t operator-logs.jsonl.gz
```

Confirm the JSONL header identifies the correct day and environment, the
record count matches the trailer and the gzip SHA-256 matches the archived
receipt. Verify the selected destination tier, restricted access, off-host
restore and timer receipt before accepting persistent staging activation.

## API and worker traces

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the protected OTLP HTTP traces
endpoint. Use HTTPS for a collector outside the private network and supply
its authentication through `OTEL_EXPORTER_OTLP_TRACES_HEADERS`. The exporter
is off until the endpoint is set. `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` defaults
to 2,000 milliseconds and applies to the collector connection as well as the
export attempt.

For Sentry performance monitoring, copy the traces endpoint and header from
the approved environment's **Client Keys → OpenTelemetry** settings. Supply
the endpoint as `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and the header as
`OTEL_EXPORTER_OTLP_TRACES_HEADERS` in protected deployment configuration.
The header takes the form `x-sentry-auth=sentry%20sentry_key%3D<project-key>`.
Route through an approved collector when both Grafana and Sentry need the
traces. Keep the error envelopes and traces on their separate
ingestion paths. Verify a synthetic trace by ID in the approved Sentry project
before accepting the environment. [Sentry OTLP configuration](https://github.com/getsentry/otlp-tracing-sentry#setup-connect-to-sentry-2-minutes).

The API accepts one valid W3C `traceparent` and starts a new context for
missing, malformed or repeated values. It records the registered route
template, HTTP method and status. URLs, query values, headers, bodies,
exception text, baggage and `tracestate` are excluded. Request completion logs
add `traceId` and `spanId` when tracing is enabled and retain `correlationId`.

Forced password changes add an `auth.password.change` span below the HTTP
span. The account notification insert adds a `notification.outbox.insert`
client span with the database system, operation and table name. It omits SQL,
parameters, database addresses and errors. A failed operation records the
span status and preserves the existing transaction rollback.

Redis commands issued through the API's shared client appear under the active
request or domain span, including commands sent in a pipeline. Spans carry a
fixed Redis command name or `_OTHER` and mark failed commands as errors. Keys,
values, scripts, replies, connection details and error text stay private.
Calls without an active request trace use the same Redis client behavior.

Completed API spans with HTTP 5xx, timeout or an interrupted response are
selected for export, as are requests that run for more than 500 milliseconds.
`OTEL_TRACE_SUCCESS_SAMPLE_RATE` controls routine spans and defaults to 0.1.
The API and worker choose independently without using the caller's sampled
flag. Export uses a bounded queue and a failed collector can lose spans.
Whole-trace retention depends on collector configuration.

PostgreSQL sets trace context locally for each traced transaction. The
notification outbox captures that context at insertion for application and
trigger writers. The direct pool captures it on explicit transaction start.
The transaction pool also sets it for the transactions it opens around
standalone statements. Existing rows and untraced writers have no parent.

Enable the same protected endpoint in the worker to export
`notification.outbox.process` spans with the stored parent. In a forced
password change, both the insert and worker spans link to the domain span.
Delivery logs carry the worker span ID and original trace ID. Message
payloads and provider requests carry neither identifier.

The asynchronous job queue stores the active request span separately from the
job payload for profile exports and upload scans. Each worker claim exports an
`async.job.process` consumer span. A retry keeps the original parent and gets
its own span. Jobs queued before migration `0295` still run and start a new
trace. The job status API exposes neither the stored parent nor the payload.
Match the job consumer span to the originating request when verifying the
deployed collector. The worker records failure status without handler errors,
job IDs or payload values in the span.

Migration `0296` carries the request parent through sealed document scans,
knowledge-base processing, model connection tests and restricted authentication
delivery. Ingestion reuses the trace of the operation that scheduled the current
revision. A new ingestion request captures a new parent. Retrying a claimed scan,
model test or delivery keeps its original parent.

Find the consumer spans by trace ID using `document.scan.process`,
`knowledge_base.process`, `ai.model_test.process`, `auth.delivery.process`
and `auth.delivery.notice`. The two authentication spans share the original
parent because sending and inbox publication have separate retry boundaries.
Scanner alerts and safe OTP notices pass their consumer parent to the
notification outbox. Trace data excludes verification codes, provider payloads
and credentials.

On the configured collector, match an API request and notification worker
span by trace ID, and check their parent relationship and corresponding
logs. The API span uses the registered route template. The worker starts a
new trace when a row has no parent. For AI completions, match
`ai.inference.request` from the API to its `ai.inference.complete` child in
`barghsa-ai-inference`. The API sends its canonical parent only to the
configured internal inference service. The service extracts it after
authenticating the request. Provider calls omit this header. Prompts, replies,
model IDs and credentials stay out of both spans. Verify this relationship
on the deployed collector alongside the separate web and queue checks.

The static server exports `barghsa-web` spans with a fixed HTTP method and
status. The server accepts one valid W3C parent and starts a new trace for
malformed or duplicate values. Asset names, navigation paths, query values and
credentials stay out of these spans. Static delivery failures include the
trace and span IDs in the existing JSON log stream. Browser API requests are
routed separately at the edge and have their own server spans.
[W3C Trace Context](https://www.w3.org/TR/trace-context/) · [OpenTelemetry JavaScript instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)

The Jaeger rehearsal used the v2.23.0 source with Go 1.27.4 and the
`golang.org/x/net` and `golang.org/x/crypto` security updates. The upstream
container had four high-severity package findings. The rebuilt container
passed the vulnerability scan and ran as a non-root user with loopback-only
host ports. Its Jaeger v3 API returned the same successful and rolled-back
traces after restart. A temporary staging instance also returned both
synthetic traces over SSH. Its cleanup verified staging health and the
previous release metadata. Badger used a seven-day TTL in the rehearsal.
Persistent staging access and the 30-day error and slow-trace policy remain
release checks.
[Jaeger release](https://github.com/jaegertracing/jaeger/releases/tag/v2.23.0) · [Go security advisory](https://pkg.go.dev/vuln/GO-2026-6860)

### Tempo trace retention

Use `deploy/monitoring/trace-retention.yml` with verified immutable Alloy
and Tempo images. Supply `BARGHSA_ALLOY_IMAGE`, `BARGHSA_TEMPO_IMAGE`,
`BARGHSA_TRACE_INGEST_NETWORK`, `BARGHSA_TEMPO_QUERY_NETWORK` and
`BARGHSA_TEMPO_STORAGE_ENV_FILE` in the operator's Compose environment.
Create separate internal networks for approved API, worker, inference and web senders and
for authenticated Grafana query access. The service publishes no host ports.
Tempo reaches its S3 endpoint through a separate network.

Put `BARGHSA_TEMPO_S3_BUCKET`, `BARGHSA_TEMPO_S3_ENDPOINT`,
`BARGHSA_TEMPO_S3_ACCESS_KEY` and `BARGHSA_TEMPO_S3_SECRET_KEY` in the
protected storage environment file. Use a private, encrypted trace bucket
dedicated to the environment and an HTTPS endpoint with a trusted certificate.
Grant the Tempo identity only the bucket operations needed for block
storage and retention. Keep the `tempo-data` volume for the WAL and
scheduler state across service recreation. Validate the configuration with
`docker compose config --quiet`.

Use `deploy/monitoring/app-trace-retention.yml` for API, worker, inference and web writers
assigned to this collector. It connects those services to the sender network
and sends their sanitized spans to Alloy for sampling. The collector selects
10% of ordinary traces for the 7-day tenant. It preserves error spans and
spans longer than 500 ms in the 30-day tenant, together with their companion
spans seen during the 30-second trace decision window. A late error or slow
span still reaches the 30-day tenant. Its earlier companions may already
have been sampled or expired, so follow the shared trace ID across both
data sources. The collector replaces any incoming priority marker with its
own decision and routes each write to a fixed tenant.
[Alloy tail sampling](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.processor.tail_sampling/).

Add `deploy/monitoring/staging-trace-retention-query.yml` to the Grafana
monitoring configuration for this backend. In **Explore**, use **Barghsa
Tempo Ordinary** for recent sampled traces and **Barghsa Tempo Priority**
for longer-lived errors and slow operations. Verify both tenants by exact
trace ID. Watch Alloy queue refusals and Tempo retention jobs after enabling
the pipeline. Tempo expires blocks using their configured tenant retention
period, then clears the marked block bytes after its compaction grace period.
Confirm the deployed policy and bucket expiry with controlled trace records
before accepting the environment.
[Tempo tenant overrides](https://grafana.com/docs/tempo/latest/operations/manage-advanced-systems/multitenancy/) · [Tempo retention and block polling](https://grafana.com/docs/tempo/latest/configuration/polling/).

### Find a trace in Grafana Explore

Add `deploy/monitoring/staging-trace-query.yml` after the existing staging
monitoring and dashboard Compose files once an approved Tempo instance is
available. Set `BARGHSA_TEMPO_QUERY_NETWORK` to the name of its dedicated
internal Docker network. Check the network's `Internal` field and membership
before attaching Grafana. The Tempo query service needs the alias `tempo` on
this network. Keep its query port unpublished and restrict Grafana to its
loopback binding and authenticated operators.

In Grafana, open **Explore** and select **Barghsa Tempo**. Paste the `traceId`
from a structured log into **Trace ID**. To find an operation without a known
ID, choose a time range and search by service and span name. Compare span
parents and durations before following the `correlationId` back to logs.
Prometheus remains the default source for the existing dashboards. To remove
access, temporarily replace the mounted Tempo provisioning file with the
following configuration and reload datasource provisioning. Verify that
`barghsa-tempo` is gone, then recreate Grafana without the trace overlay and
check that it has left the query network.

```yaml
apiVersion: 1
deleteDatasources:
  - name: Barghsa Tempo
    orgId: 1
```

[Grafana Tempo documentation](https://grafana.com/docs/grafana/latest/datasources/tempo/) · [Datasource provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/#data-sources).
