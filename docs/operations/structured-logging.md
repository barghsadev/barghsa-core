# Structured operator logs

The API, background worker, inference process and database pool use Pino to
write one JSON record per line. The static web server and edge proxy use the
same core fields with their existing runtime log destinations.

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
