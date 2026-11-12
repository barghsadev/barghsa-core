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

## API and notification worker traces

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the protected OTLP HTTP traces
endpoint. Use HTTPS for a collector outside the private network and supply
its authentication through `OTEL_EXPORTER_OTLP_TRACES_HEADERS`. The exporter
is off until the endpoint is set. `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` defaults
to 2,000 milliseconds and applies to the collector connection as well as the
export attempt.

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

On the configured collector, match an API request and notification worker
span by trace ID, and check their parent relationship and corresponding
logs. The API span uses the registered route template. The worker starts a
new trace when a row has no parent. Web instrumentation and other worker
queues require separate verification.
[W3C Trace Context](https://www.w3.org/TR/trace-context/) · [OpenTelemetry JavaScript instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)

The Jaeger rehearsal used the v2.23.0 source with Go 1.27.4 and the
`golang.org/x/net` and `golang.org/x/crypto` security updates. The upstream
container had four high-severity package findings. The rebuilt container
passed the vulnerability scan and ran as a non-root user with loopback-only
host ports. Its Jaeger v3 API returned the same successful and rolled-back
traces after restart. A temporary staging instance also returned both
synthetic traces over SSH. Its cleanup verified staging health and the
previous release metadata. Badger used a seven-day TTL in the rehearsal.
Persistent staging access, the 30-day error and slow-trace policy, and
operator UI verification remain release checks.
[Jaeger release](https://github.com/jaegertracing/jaeger/releases/tag/v2.23.0) · [Go security advisory](https://pkg.go.dev/vuln/GO-2026-6860)
